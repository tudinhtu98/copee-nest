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
      // Get job, product, and site data (including wpUsername and wpApplicationPassword)
      const uploadJob = await this.prisma.uploadJob.findUnique({
        where: { id: jobId },
        include: { 
          product: true, 
          site: true,
        },
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

      console.log(`[Queue] 🔄 Processing upload job ${jobId} for product: ${uploadJob.product.title}`);

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
    // WooCommerce keys are REQUIRED for creating products via WooCommerce REST API
    if (!site.wooConsumerKey || !site.wooConsumerSecret || !site.baseUrl) {
      throw new Error('Site chưa cấu hình WooCommerce API keys. WooCommerce keys là bắt buộc để tạo sản phẩm.');
    }

    const auth = Buffer.from(
      `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
    ).toString('base64');
    const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products`;

    // Upload images to media library
    let uploadedImages: { src: string; name?: string }[] = [];
    if (Array.isArray(product.images) && product.images.length > 0) {
      console.log(`[Queue][Upload] 📸 Uploading ${product.images.length} images to WordPress`);
      for (let i = 0; i < product.images.length; i++) {
        const imgUrl = product.images[i];
        try {
          const mediaUrl = await this.uploadImageToMediaLibrary(site, imgUrl);
          uploadedImages.push({ src: mediaUrl });
        } catch (e: any) {
          console.error(`[Queue][Upload] ❌ Failed to upload image ${i + 1}/${product.images.length}:`, e.message);
        }
      }
      console.log(`[Queue][Upload] 📊 Images: ${uploadedImages.length}/${product.images.length} uploaded successfully`);
    }

    // Map category with priority: categoryId > targetCategory > categoryName
    let categoryArray: { id?: string; name?: string }[] | undefined = undefined;
    
    if (product.categoryId) {
      // Priority 1: Use categoryId from product (already mapped)
      categoryArray = [{ id: product.categoryId }];
    } else if (targetCategory) {
      // Priority 2: Use target category ID (always ID, never name)
      const categoryId = String(targetCategory);
      categoryArray = [{ id: categoryId }];
    } else if (product.category) {
      // Priority 3: Fallback to category name
      categoryArray = [{ name: product.category }];
    }

    // Log warning if no images available
    if (uploadedImages.length === 0 && Array.isArray(product.images) && product.images.length > 0) {
      console.warn(`[Queue][Upload] ⚠️ All ${product.images.length} images failed to upload. Product will be created without images.`);
    }

    // WooCommerce pricing:
    // - regular_price: Giá gốc (originalPrice) hoặc giá hiện tại nếu không có originalPrice
    // - sale_price: Giá đã giảm (price) - chỉ set nếu có originalPrice và price < originalPrice
    let regularPrice: string | undefined = undefined;
    let salePrice: string | undefined = undefined;
    
    if (product.originalPrice) {
      // Có giá gốc: dùng làm regular_price
      regularPrice = String(product.originalPrice);
      // Nếu có giá đã giảm và nhỏ hơn giá gốc, dùng làm sale_price
      if (product.price && product.price < product.originalPrice) {
        salePrice = String(product.price);
      } else if (product.price) {
        // Nếu price >= originalPrice, dùng price làm regular_price
        regularPrice = String(product.price);
      }
    } else if (product.price) {
      // Không có giá gốc: dùng price làm regular_price
      regularPrice = String(product.price);
    }
    
    const body: any = {
      name: product.title || 'Copied product',
      type: 'external', // External product - redirects to Shopee when clicking "Buy"
      regular_price: regularPrice,
      sale_price: salePrice,
      description: product.description || undefined,
      categories: categoryArray,
      images: uploadedImages.length > 0 ? uploadedImages : undefined,
    };
    
    // Add external URL and button text for Shopee link
    if (product.sourceUrl) {
      body.external_url = product.sourceUrl;
      body.button_text = 'Mua ngay';
    }
    
    console.log(`[Queue] 📦 Uploading product to WooCommerce: ${product.title} (${uploadedImages.length} images, category: ${categoryArray?.[0]?.id || categoryArray?.[0]?.name || 'none'})`);

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
    
    console.log(`[Queue] ✅ Product uploaded successfully: ID ${responseData.id} - ${product.title}`);
    
    return responseData;
  }

  private async uploadImageToMediaLibrary(site: any, imageUrl: string): Promise<string> {
    const mediaEndpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`;
    
    // Priority: Use Application Password if available, otherwise fallback to WooCommerce credentials
    const siteAny = site as any;
    let auth: string;
    let authMethod: string;
    
    if (siteAny.wpUsername && siteAny.wpApplicationPassword) {
      auth = Buffer.from(
        `${siteAny.wpUsername}:${siteAny.wpApplicationPassword}`,
      ).toString('base64');
      authMethod = 'Application Password';
    } else {
      if (!site.wooConsumerKey || !site.wooConsumerSecret) {
        throw new Error('Cần cấu hình Application Password hoặc WooCommerce keys để upload hình ảnh. Application Password được khuyến nghị.');
      }
      auth = Buffer.from(
        `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
      ).toString('base64');
      authMethod = 'WooCommerce Keys (fallback)';
    }

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

        if (attempt === 1) {
          console.log(`[Queue][Image Upload] Downloading: ${imageUrl.substring(0, 80)}...`);
        }

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
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (lastError || !imageRes || !imageBuffer) {
      throw new Error(`Failed to download image after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
    }

    // Get and normalize Content-Type
    let imageType = imageRes.headers.get('content-type') || 'image/jpeg';
    
    // Remove charset and other parameters from MIME type (e.g., "image/jpeg;charset=UTF-8" -> "image/jpeg")
    imageType = imageType.split(';')[0].trim().toLowerCase();
    
    // Validate and map to allowed WordPress MIME types
    const allowedMimeTypes: Record<string, string> = {
      'image/jpeg': 'image/jpeg',
      'image/jpg': 'image/jpeg',
      'image/png': 'image/png',
      'image/gif': 'image/gif',
      'image/webp': 'image/webp',
      'image/bmp': 'image/bmp',
      'image/tiff': 'image/tiff',
    };
    
    // If not in allowed list, default to jpeg
    if (!allowedMimeTypes[imageType]) {
      console.warn(`[Queue][Image Upload] ⚠️ Unknown MIME type: ${imageType}, defaulting to image/jpeg`);
      imageType = 'image/jpeg';
    } else {
      imageType = allowedMimeTypes[imageType];
    }
    
    // Extract file name and ensure it has proper extension
    let fileName = imageUrl.split('/').pop() || 'image.jpg';
    
    // Remove query parameters from filename
    fileName = fileName.split('?')[0];
    
    // Add extension if missing
    const extensionMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/tiff': '.tiff',
    };
    
    const extension = extensionMap[imageType] || '.jpg';
    if (!fileName.toLowerCase().endsWith(extension)) {
      // Remove any existing extension and add correct one
      const nameWithoutExt = fileName.split('.')[0];
      fileName = `${nameWithoutExt}${extension}`;
    }

    // Upload to WordPress media library
    const formData = new FormData();
    const cleanMimeType = imageType.split(';')[0].trim();
    const blob = new Blob([new Uint8Array(imageBuffer)], { type: cleanMimeType });
    formData.append('file', blob, fileName);
    
    console.log(`[Queue][Image Upload] 📤 Uploading to WordPress (${(imageBuffer.length / 1024).toFixed(0)} KB, ${imageType})`);
    
    // Upload to WordPress with timeout (60 seconds)
    const uploadController = new AbortController();
    const uploadTimeoutId = setTimeout(() => uploadController.abort(), 60000);
    
    let uploadRes: Response;
    try {
      uploadRes = await fetch(mediaEndpoint, {
        method: 'POST',
        signal: uploadController.signal,
        headers: {
          Authorization: `Basic ${auth}`,
        },
        body: formData,
      });
      clearTimeout(uploadTimeoutId);
    } catch (error: any) {
      clearTimeout(uploadTimeoutId);
      console.error(`[Queue][Image Upload] ❌ Upload request failed:`, {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      if (error.name === 'AbortError') {
        throw new Error(`Upload timeout: WordPress server did not respond within 60 seconds`);
      }
      throw error;
    }

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
        errorMessage = `${errorMessage}. Response: ${errorText.substring(0, 200)}`;
      }
      
      console.error(`[Queue][Image Upload] ❌ Upload failed (${uploadRes.status}): ${errorMessage.substring(0, 150)}`);
      
      // Provide helpful error message based on status code
      if (uploadRes.status === 401 || uploadRes.status === 403) {
        if (authMethod === 'WooCommerce Keys') {
          errorMessage = `${errorMessage}\n\nNOTE: WordPress REST API may require Application Password instead of WooCommerce API keys. Please configure Application Password in Settings → WordPress Authentication tab.`;
        } else {
          errorMessage = `${errorMessage}\n\nNOTE: Application Password authentication failed. Please verify the username and password are correct in Settings → WordPress Authentication tab.`;
        }
      } else if (uploadRes.status === 413) {
        errorMessage = `${errorMessage}\n\nNOTE: Image file is too large. WordPress may have file size limits.`;
      } else if (uploadRes.status === 415) {
        errorMessage = `${errorMessage}\n\nNOTE: Unsupported media type. WordPress may not accept this image format.`;
      }
      
      throw new Error(errorMessage);
    }

    let mediaData: any;
    try {
      const responseText = await uploadRes.text();
      mediaData = JSON.parse(responseText);
    } catch (parseError: any) {
      console.error(`[Queue][Image Upload] ❌ Failed to parse WordPress response:`, {
        error: parseError.message,
        status: uploadRes.status,
        contentType: uploadRes.headers.get('content-type'),
      });
      throw new Error(`WordPress API returned invalid JSON response. Status: ${uploadRes.status}`);
    }
    
    // WordPress may return source_url, url, or guid.rendered
    const uploadedImageUrl = mediaData.source_url || mediaData.url || (mediaData.guid && mediaData.guid.rendered) || mediaData.guid;
    
    if (!uploadedImageUrl) {
      throw new Error(`WordPress API returned success but no image URL found. Response keys: ${Object.keys(mediaData).join(', ')}`);
    }
    
    console.log(`[Queue][Image Upload] ✅ Uploaded: ${uploadedImageUrl.substring(0, 80)}...`);
    return uploadedImageUrl;
  }
}


