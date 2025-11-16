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
      const shouldRetry = retryCount < 3;

      // Update job with error
      await this.prisma.uploadJob.update({
        where: { id: jobId },
        data: {
          status: shouldRetry ? 'PENDING' : 'FAILED',
          result: { error: e.message },
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
        console.warn(`[Queue] Upload job ${jobId} failed after ${retryCount} attempts`);
      }

      // Re-throw to trigger retry mechanism in BullMQ
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
      for (const imgUrl of product.images) {
        try {
          const mediaUrl = await this.uploadImageToMediaLibrary(site, imgUrl);
          uploadedImages.push({ src: mediaUrl });
        } catch (e) {
          console.warn(`Failed to upload image ${imgUrl}:`, e);
          // Fallback to original URL
          uploadedImages.push({ src: imgUrl });
        }
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

    const body = {
      name: product.title || 'Copied product',
      type: 'simple',
      regular_price: product.price ? String(product.price) : undefined,
      description: product.description || undefined,
      categories: categoryArray,
      images: uploadedImages.length > 0 ? uploadedImages : undefined,
    };
    
    console.log('[Queue] Uploading product to WooCommerce with category:', {
      categoryArray,
      targetCategory,
      productCategory: product.category,
      productCategoryId: product.categoryId,
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
    const auth = Buffer.from(
      `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
    ).toString('base64');

    // Download image
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      throw new Error(`Failed to download image: ${imageRes.status}`);
    }
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    const imageType = imageRes.headers.get('content-type') || 'image/jpeg';
    const fileName = imageUrl.split('/').pop() || 'image.jpg';

    // Upload to WordPress media library
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: imageType });
    formData.append('file', blob, fileName);

    const uploadRes = await fetch(mediaEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      throw new Error(`Failed to upload to media library: ${uploadRes.status}`);
    }

    const mediaData = await uploadRes.json();
    return mediaData.source_url;
  }
}

