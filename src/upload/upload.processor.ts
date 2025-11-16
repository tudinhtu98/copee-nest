import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';

interface UploadJobData {
  jobId: string;
  productId: string;
  siteId: string;
  targetCategory?: string;
  userId: string;
}

@Processor('upload', {
  concurrency: 5, // Process up to 5 jobs in parallel
})
@Injectable()
export class UploadProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {
    super();
  }

  async process(job: Job<UploadJobData>): Promise<any> {
    const { jobId, productId, siteId, targetCategory, userId } = job.data;

    try {
      // Get job, product, and site data
      const uploadJob = await this.prisma.uploadJob.findUnique({
        where: { id: jobId },
        include: { product: true, site: true },
      });

      if (!uploadJob) {
        throw new Error(`Upload job ${jobId} not found`);
      }

      if (uploadJob.status === 'CANCELLED') {
        console.log(`[Queue] Upload job ${jobId} is cancelled, skipping`);
        return { skipped: true, reason: 'CANCELLED' };
      }

      // Update status to PROCESSING if still PENDING
      if (uploadJob.status === 'PENDING' || uploadJob.status === 'FAILED') {
        await this.prisma.uploadJob.update({
          where: { id: jobId },
          data: { status: 'PROCESSING' },
        });
      }

      console.log(`[Queue] Processing upload job ${jobId} for product ${uploadJob.product.title}`);

      // Upload to WooCommerce
      const wcRes = await this.uploadToWoo(
        uploadJob.site,
        uploadJob.product,
        targetCategory || undefined,
      );

      // Double-check that product was created
      if (!wcRes || !wcRes.id) {
        throw new Error(
          `Upload appeared successful but no WooCommerce product ID returned. Response: ${JSON.stringify(wcRes).substring(0, 200)}`,
        );
      }

      // Update job status
      await this.prisma.uploadJob.update({
        where: { id: jobId },
        data: {
          status: 'SUCCESS',
          result: { productId: wcRes.id, ...wcRes },
        },
      });

      // Update product status
      await this.prisma.product.update({
        where: { id: productId },
        data: { status: 'UPLOADED', errorMessage: null },
      });

      // Deduct billing
      await this.billing.debit(userId, 1000, `UPLOAD:${productId}`);

      console.log(
        `[Queue] Successfully processed upload job ${jobId}, WooCommerce product ID: ${wcRes.id}`,
      );

      return {
        success: true,
        jobId,
        productId: wcRes.id,
        permalink: wcRes.permalink,
      };
    } catch (e: any) {
      console.error(`[Queue] Error processing upload job ${jobId}:`, e.message, e.stack);

      const uploadJob = await this.prisma.uploadJob.findUnique({
        where: { id: jobId },
      });

      if (!uploadJob) {
        throw e;
      }

      const retryCount = uploadJob.retryCount + 1;
      const maxRetries = 3;
      const shouldRetry = retryCount < maxRetries;

      // Update job with error
      await this.prisma.uploadJob.update({
        where: { id: jobId },
        data: {
          status: shouldRetry ? 'PENDING' : 'FAILED',
          result: { error: e.message, stack: e.stack, timestamp: new Date().toISOString() },
          retryCount,
          lastRetryAt: new Date(),
        },
      });

      // Update product status
      await this.prisma.product.update({
        where: { id: productId },
        data: {
          status: shouldRetry ? 'DRAFT' : 'FAILED',
          errorMessage: e.message,
        },
      });

      if (!shouldRetry) {
        console.warn(`[Queue] Upload job ${jobId} failed after ${retryCount} attempts. Status set to FAILED. User can manually retry.`);
      } else {
        console.log(`[Queue] Upload job ${jobId} will retry (attempt ${retryCount}/${maxRetries})`);
      }

      // Re-throw to trigger retry mechanism in BullMQ (only if shouldRetry)
      // If shouldRetry is false, BullMQ will mark job as failed, but we've already set status to FAILED in DB
      throw e;
    }
  }

  private async uploadToWoo(site: any, product: any, targetCategory?: string): Promise<any> {
    if (!site.wooConsumerKey || !site.wooConsumerSecret || !site.baseUrl) {
      throw new Error('Site chưa cấu hình WooCommerce API');
    }

    const auth = Buffer.from(
      `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
    ).toString('base64');
    const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products`;

    // Upload images to media library
    let uploadedImages: { src: string; name?: string }[] = [];
    if (Array.isArray(product.images) && product.images.length > 0) {
      console.log(`[Queue][Upload] Starting to upload ${product.images.length} images to WordPress media library`);
      for (let i = 0; i < product.images.length; i++) {
        const imgUrl = product.images[i];
        try {
          console.log(`[Queue][Upload] Uploading image ${i + 1}/${product.images.length}: ${imgUrl}`);
          const mediaUrl = await this.uploadImageToMediaLibrary(site, imgUrl);
          uploadedImages.push({ src: mediaUrl });
          console.log(`[Queue][Upload] Successfully uploaded image ${i + 1}/${product.images.length}: ${mediaUrl}`);
        } catch (e: any) {
          const errorDetails = {
            message: e.message,
            stack: e.stack,
            name: e.name,
            url: imgUrl,
          };
          console.error(`[Queue][Upload] Failed to upload image ${i + 1}/${product.images.length} to WordPress:`, errorDetails);
          
          // Don't use Shopee URLs directly - WooCommerce will try to download them and timeout
          // Skip this image - product will be created without it
          // User can manually add images later or retry the job after fixing WordPress authentication
          console.warn(`[Queue][Upload] Skipping image ${imgUrl} - WordPress upload failed. Product will be created without this image.`);
        }
      }
      console.log(`[Queue][Upload] Images summary: ${uploadedImages.length}/${product.images.length} successfully uploaded to WordPress`);
      if (uploadedImages.length < product.images.length) {
        console.warn(`[Queue][Upload] ${product.images.length - uploadedImages.length} images failed to upload. Product will be created with ${uploadedImages.length} images.`);
      }
    }

    // Map category with priority: categoryId > targetCategory > mapping > categoryName
    let categoryArray: { id?: string; name?: string }[] | undefined = undefined;
    
    if (product.categoryId) {
      // Priority 1: Use categoryId from product (already mapped)
      categoryArray = [{ id: product.categoryId }];
    } else if (targetCategory) {
      // Priority 2: Use target category ID (always ID, never name)
      const categoryId = String(targetCategory);
      categoryArray = [{ id: categoryId }];
      console.log(`[Queue] Using category ID from targetCategory: ${categoryId}`);
    } else if (product.category) {
      // Priority 3: Check for category mapping
      const mapping = (await this.prisma.categoryMapping.findFirst({
        where: {
          siteId: site.id,
          sourceName: product.category,
        },
        include: {
          wooCategory: true,
        } as any,
      })) as any;

      if (mapping) {
        // Use mapped WooCommerce category ID (prioritize wooCategory.wooId)
        const wooCategoryId = mapping.wooCategory?.wooId || mapping.targetId || undefined;
        if (wooCategoryId) {
          categoryArray = [{ id: wooCategoryId }];
        } else {
          // Fallback to category name if no ID available
          categoryArray = [{ name: product.category }];
        }
      } else {
        // Priority 4: Fallback to category name
        categoryArray = [{ name: product.category }];
      }
    }

    // Log warning if no images available
    if (uploadedImages.length === 0 && Array.isArray(product.images) && product.images.length > 0) {
      console.warn(`[Queue][Upload] WARNING: No images available. All ${product.images.length} images failed to upload. Product will be created without images.`);
      // Don't throw error - allow product creation without images
      // User can manually add images later or retry the job
    } else if (uploadedImages.length > 0) {
      console.log(`[Queue][Upload] Images ready for product: ${uploadedImages.length} images`);
    }

    const body = {
      name: product.title || 'Copied product',
      type: 'simple',
      regular_price: product.price ? String(product.price) : undefined,
      description: product.description || undefined,
      categories: categoryArray,
      images: uploadedImages.length > 0 ? uploadedImages : undefined,
    };
    
    console.log('[Queue] Uploading product to WooCommerce:', {
      productTitle: product.title,
      categoryArray,
      targetCategory,
      productCategory: product.category,
      productCategoryId: product.categoryId,
      imagesCount: uploadedImages.length,
      totalImagesAttempted: Array.isArray(product.images) ? product.images.length : 0,
      images: uploadedImages.length > 0 ? uploadedImages.map(img => img.src) : 'NO IMAGES',
    });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });
    
    const responseText = await res.text();
    let responseData: any;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`WooCommerce API returned invalid JSON: ${responseText.substring(0, 200)}`);
    }
    
    if (!res.ok) {
      const errorMessage = responseData?.message || responseData?.code || responseText;
      throw new Error(`WooCommerce API error (${res.status}): ${errorMessage}`);
    }
    
    // Validate that product was actually created
    if (!responseData || !responseData.id) {
      console.error('[Queue] WooCommerce response missing product ID:', {
        status: res.status,
        response: responseData,
        endpoint,
        productTitle: product.title,
      });
      throw new Error(`WooCommerce API returned success but no product ID. Response: ${JSON.stringify(responseData).substring(0, 200)}`);
    }
    
    console.log(`[Queue] Successfully uploaded product to WooCommerce:`, {
      productId: responseData.id,
      productTitle: product.title,
      siteUrl: site.baseUrl,
    });
    
    return responseData;
  }

  private async uploadImageToMediaLibrary(site: any, imageUrl: string): Promise<string> {
    const mediaEndpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`;
    
    // WordPress REST API may not accept WooCommerce credentials
    // Try WooCommerce credentials first, but log if it fails
    const auth = Buffer.from(
      `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
    ).toString('base64');
    
    console.log(`[Queue][Image Upload] Using WordPress REST API with WooCommerce credentials`);
    console.log(`[Queue][Image Upload] Endpoint: ${mediaEndpoint}`);
    console.log(`[Queue][Image Upload] Note: If this fails with 401/403, WordPress may require Application Password instead of WooCommerce keys`);

    // Download image with timeout and retry
    let imageRes: Response | undefined;
    let imageBuffer: Buffer | undefined;
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

        console.log(`[Queue][Image Upload] Downloading image (attempt ${attempt}/${maxRetries}): ${imageUrl}`);

        imageRes = await fetch(imageUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Referer': 'https://shopee.vn/',
          },
        });

        clearTimeout(timeoutId);

        if (!imageRes.ok) {
          throw new Error(`Failed to download image: ${imageRes.status} ${imageRes.statusText}`);
        }

        // Read response with timeout
        const arrayBuffer = await Promise.race([
          imageRes.arrayBuffer(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Download timeout: response body too slow')), 30000),
          ),
        ]);

        imageBuffer = Buffer.from(arrayBuffer);
        lastError = null;
        break; // Success, exit retry loop
        } catch (error: any) {
        lastError = error;
        const errorDetails = {
          message: error.message,
          name: error.name,
          code: error.code,
          cause: error.cause,
        };
        console.warn(`[Queue][Image Upload] Attempt ${attempt}/${maxRetries} failed:`, errorDetails);

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`[Queue][Image Upload] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (lastError || !imageRes || !imageBuffer) {
      throw new Error(`Failed to download image after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
    }

    const imageType = imageRes.headers.get('content-type') || 'image/jpeg';
    const fileName = imageUrl.split('/').pop() || 'image.jpg';

    // Upload to WordPress media library
    const formData = new FormData();
    // Convert Buffer to Uint8Array for Blob
    const blob = new Blob([new Uint8Array(imageBuffer)], { type: imageType });
    formData.append('file', blob, fileName);

    console.log(`[Queue][Image Upload] Uploading to WordPress media library: ${mediaEndpoint}`);
    console.log(`[Queue][Image Upload] Image size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`[Queue][Image Upload] Image type: ${imageType}, File name: ${fileName}`);
    
    const uploadRes = await fetch(mediaEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        // Don't set Content-Type - let browser set it with boundary for multipart/form-data
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text().catch(() => 'Unable to read error response');
      let errorMessage = `Failed to upload to media library: ${uploadRes.status} ${uploadRes.statusText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.message) {
          errorMessage = `${errorMessage}. Message: ${errorData.message}`;
        } else if (errorData.code) {
          errorMessage = `${errorMessage}. Code: ${errorData.code}`;
        }
        if (errorData.data) {
          errorMessage = `${errorMessage}. Data: ${JSON.stringify(errorData.data)}`;
        }
      } catch (e) {
        // If not JSON, include first 500 chars of response
        errorMessage = `${errorMessage}. Response: ${errorText.substring(0, 500)}`;
      }
      
      console.error(`[Queue][Image Upload] WordPress upload failed:`, {
        status: uploadRes.status,
        statusText: uploadRes.statusText,
        endpoint: mediaEndpoint,
        imageSize: `${(imageBuffer.length / 1024).toFixed(2)} KB`,
        imageType,
        errorMessage,
        fullErrorResponse: errorText.substring(0, 1000), // Log first 1000 chars for debugging
      });
      
      // Provide helpful error message based on status code
      if (uploadRes.status === 401 || uploadRes.status === 403) {
        errorMessage = `${errorMessage}\n\nNOTE: WordPress REST API may require Application Password instead of WooCommerce API keys. Please check WordPress settings.`;
      } else if (uploadRes.status === 413) {
        errorMessage = `${errorMessage}\n\nNOTE: Image file is too large. WordPress may have file size limits.`;
      } else if (uploadRes.status === 415) {
        errorMessage = `${errorMessage}\n\nNOTE: Unsupported media type. WordPress may not accept this image format.`;
      }
      
      throw new Error(errorMessage);
    }

    const mediaData = await uploadRes.json();
    
    if (!mediaData || !mediaData.source_url) {
      console.error(`[Queue][Image Upload] WordPress response missing source_url:`, mediaData);
      throw new Error(`WordPress API returned success but no source_url. Response: ${JSON.stringify(mediaData).substring(0, 200)}`);
    }
    
    console.log(`[Queue][Image Upload] Successfully uploaded to WordPress: ${mediaData.source_url}`);
    return mediaData.source_url;
  }
}


