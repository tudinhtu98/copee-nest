import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly uploadService: UploadService,
  ) {}

  async list(
    userId: string,
    options?: {
      page?: number
      limit?: number
      search?: string
      status?: string
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
    },
  ) {
    const page = options?.page || 1
    const limit = options?.limit || 20
    const skip = (page - 1) * limit

    // Use raw query with unaccent for Vietnamese search without diacritics
    if (options?.search) {
      const searchTerm = `%${options.search}%`
      const paramsList: any[] = [searchTerm, userId]
      let paramIndex = 3
      
      let additionalConditions = 'AND p.user_id = $2'
      if (options.status) {
        additionalConditions += ` AND p.status = $${paramIndex}`
        paramsList.push(options.status)
        paramIndex++
      }
      
      const sortBy = options.sortBy || 'created_at'
      const sortOrder = options.sortOrder || 'desc'
      const sortColumn = sortBy === 'createdAt' ? 'created_at' : sortBy
      
      paramsList.push(limit, skip)

      const [itemsRaw, totalRaw] = await Promise.all([
        this.prisma.$queryRawUnsafe<Array<{
          id: string
          title: string | null
          source_url: string
          status: string
          category: string | null
          price: number | null
          original_price: number | null
          description: string | null
          images: string[] | null
          currency: string | null
          created_at: Date
          updated_at: Date | null
        }>>(
          `SELECT p.*
           FROM products p
           WHERE (unaccent(p.title) ILIKE unaccent($1) 
                  OR unaccent(p.description) ILIKE unaccent($1)
                  OR unaccent(p.category) ILIKE unaccent($1)
                  OR unaccent(p.source_url) ILIKE unaccent($1))
           ${additionalConditions}
           ORDER BY p.${sortColumn} ${sortOrder.toUpperCase()}
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          ...paramsList,
        ),
        this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::int as count
           FROM products p
           WHERE (unaccent(p.title) ILIKE unaccent($1) 
                  OR unaccent(p.description) ILIKE unaccent($1)
                  OR unaccent(p.category) ILIKE unaccent($1)
                  OR unaccent(p.source_url) ILIKE unaccent($1))
           ${additionalConditions}`,
          searchTerm,
          userId,
          ...(options.status ? [options.status] : []),
        ),
      ])

      const items = itemsRaw.map((item) => ({
        id: item.id,
        title: item.title,
        sourceUrl: item.source_url,
        status: item.status as any,
        category: item.category,
        price: item.price,
        originalPrice: item.original_price,
        description: item.description,
        images: item.images,
        currency: item.currency,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }))

      const total = Number(totalRaw[0]?.count || 0)

      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    }

    // Normal query when no search
    const where: any = { userId }

    if (options?.status) {
      where.status = options.status
    }

    const orderBy: any = {}
    orderBy[options?.sortBy || 'createdAt'] = options?.sortOrder || 'desc'

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ])

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async createUploadJob(
    userId: string,
    body: { productIds: string[]; siteId: string; targetCategory?: string },
  ) {
    const { productIds, siteId, targetCategory } = body;
    if (!productIds || productIds.length === 0) {
      throw new BadRequestException('Chưa chọn sản phẩm');
    }

    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site || site.userId !== userId) {
      throw new ForbiddenException('Site không hợp lệ');
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, userId },
    });
    if (products.length !== productIds.length) {
      throw new ForbiddenException('Sản phẩm không hợp lệ');
    }

    await this.prisma.uploadJob.createMany({
      data: products.map((product) => ({
        productId: product.id,
        siteId,
        targetCategory,
      })),
      skipDuplicates: true,
    });

    return { queued: products.length };
  }

  async listUploadJobs(
    userId: string,
    options?: {
      page?: number
      limit?: number
      status?: string
      siteId?: string
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
    },
  ) {
    const page = options?.page || 1
    const limit = options?.limit || 20
    const skip = (page - 1) * limit

    const where: any = {
      product: { userId },
      site: { userId },
    }

    if (options?.status) {
      where.status = options.status
    }

    if (options?.siteId) {
      where.siteId = options.siteId
    }

    const orderBy: any = {}
    orderBy[options?.sortBy || 'createdAt'] = options?.sortOrder || 'desc'

    const [items, total] = await Promise.all([
      this.prisma.uploadJob.findMany({
        where,
        include: { 
          product: true, 
          site: true,
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.uploadJob.count({ where }),
    ])
    
    // Fetch WooCommerce categories to map targetCategory IDs to names
    const siteIds = [...new Set(items.map((job: any) => job.siteId))];
    const categoriesMap = new Map<string, Map<string, string>>(); // siteId -> (categoryId -> categoryName)
    
    for (const siteId of siteIds) {
      const siteCategories = await this.prisma.wooCommerceCategory.findMany({
        where: { siteId },
        select: { wooId: true, name: true },
      });
      const categoryMap = new Map<string, string>();
      siteCategories.forEach((cat: any) => {
        categoryMap.set(String(cat.wooId), cat.name);
      });
      categoriesMap.set(siteId, categoryMap);
    }
    
    // Map category names to jobs
    const itemsWithCategoryNames = items.map((job: any) => {
      const categoryMap = categoriesMap.get(job.siteId);
      const categoryName = job.targetCategory && categoryMap 
        ? categoryMap.get(String(job.targetCategory)) || job.targetCategory
        : job.targetCategory;
      return {
        ...job,
        targetCategoryName: categoryName,
      };
    });

    return {
      items: itemsWithCategoryNames,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async processPendingUploads(userId: string, jobIds?: string[]) {
    const where: any = {
      status: { in: ['PENDING', 'FAILED'] },
      product: { userId },
      site: { userId },
    }
    
    // Exclude CANCELLED jobs
    if (jobIds && jobIds.length > 0) {
      where.id = { in: jobIds }
      // If specific jobs selected, allow retry even if retryCount >= 3 (manual retry)
    } else {
      // If no specific jobs, only process jobs with retryCount < 3 (auto retry)
      where.retryCount = { lt: 3 };
    }

    const jobs = await this.prisma.uploadJob.findMany({
      where,
      include: { product: true, site: true },
      take: jobIds && jobIds.length > 0 ? jobIds.length : 100, // Increased limit for queue processing
    });
    
    if (jobs.length === 0) return { processed: 0, queued: 0 };

    // Reset retryCount for FAILED jobs that are being manually retried
    const failedJobsToReset = jobs.filter(job => job.status === 'FAILED' && job.retryCount >= 3);
    if (failedJobsToReset.length > 0) {
      await this.prisma.uploadJob.updateMany({
        where: { id: { in: failedJobsToReset.map(j => j.id) } },
        data: { 
          retryCount: 0, // Reset retry count for manual retry
          status: 'PENDING', // Reset to PENDING
        },
      });
      console.log(`[Queue] Reset ${failedJobsToReset.length} FAILED jobs for manual retry`);
    }

    // Add jobs to queue for parallel processing
    const queueJobs = jobs.map((job) => ({
      jobId: job.id,
      productId: job.productId,
      siteId: job.siteId,
      targetCategory: job.targetCategory || undefined,
      userId: job.product.userId,
    }));

    // Add all jobs to queue (status will be updated to PROCESSING by the processor)
    await this.uploadService.addBulkUploadJobs(queueJobs);

    console.log(`[Queue] Added ${jobs.length} upload jobs to queue for parallel processing`);

    return { processed: jobs.length, queued: jobs.length };
  }

  async cancelUploadJobs(userId: string, jobIds?: string[]) {
    const where: any = {
      product: { userId },
      site: { userId },
    };

    if (jobIds && jobIds.length > 0) {
      // If specific jobs selected, can cancel any status except SUCCESS
      where.id = { in: jobIds };
      where.status = { not: 'SUCCESS' };
    } else {
      // If no jobs selected, only cancel FAILED jobs
      where.status = 'FAILED';
    }

    const result = await this.prisma.uploadJob.updateMany({
      where,
      data: {
        status: 'CANCELLED',
      },
    });

    return { cancelled: result.count };
  }

  async updateProduct(
    userId: string,
    productId: string,
    data: {
      title?: string | null
      description?: string | null
      price?: number | null
      category?: string | null
      sourceUrl?: string | null
    },
  ) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.userId !== userId) {
      throw new ForbiddenException('Không tìm thấy sản phẩm');
    }

    const updateData: Prisma.ProductUpdateInput = {};
    let hasChanges = false;

    if (typeof data.title === 'string') {
      updateData.title = data.title.trim();
      hasChanges = true;
    }

    if (data.description !== undefined) {
      const description = data.description?.trim();
      updateData.description = description ?? null;
      hasChanges = true;
    }

    if (typeof data.price === 'number') {
      updateData.price = Math.round(data.price);
      hasChanges = true;
    } else if (data.price === null) {
      updateData.price = null;
      hasChanges = true;
    }

    if (data.category !== undefined) {
      const trimmedCategory = data.category?.trim();
      updateData.category =
        trimmedCategory && trimmedCategory.length > 0 ? trimmedCategory : null;
      hasChanges = true;
    }

    if (data.sourceUrl !== undefined && typeof data.sourceUrl === 'string') {
      const trimmedSourceUrl = data.sourceUrl.trim();
      if (trimmedSourceUrl.length > 0) {
        updateData.sourceUrl = trimmedSourceUrl;
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return product;
    }

    return this.prisma.product.update({ where: { id: productId }, data: updateData });
  }

  async deleteProduct(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.userId !== userId) {
      throw new ForbiddenException('Không tìm thấy sản phẩm');
    }

    // Delete related upload jobs first
    await this.prisma.uploadJob.deleteMany({ where: { productId } });

    // Delete the product
    await this.prisma.product.delete({ where: { id: productId } });

    return { message: 'Đã xóa sản phẩm' };
  }

  async deleteProducts(userId: string, productIds: string[]) {
    if (!productIds || productIds.length === 0) {
      throw new BadRequestException('Danh sách sản phẩm không được để trống');
    }

    // Verify all products belong to the user
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        userId,
      },
    });

    if (products.length !== productIds.length) {
      throw new ForbiddenException('Một số sản phẩm không tồn tại hoặc không thuộc quyền sở hữu của bạn');
    }

    // Delete related upload jobs first
    await this.prisma.uploadJob.deleteMany({
      where: { productId: { in: productIds } },
    });

    // Delete the products
    await this.prisma.product.deleteMany({
      where: { id: { in: productIds } },
    });

    return { message: `Đã xóa ${productIds.length} sản phẩm`, deleted: productIds.length };
  }

  async copyProduct(
    userId: string,
    input: {
      sourceUrl: string
      title?: string
      description?: string | null
      images?: string[] | null
      price?: number | null // Sale price (giá đã giảm)
      originalPrice?: number | null // Regular price (giá gốc)
      currency?: string | null
      category?: string | null
    },
  ) {
    const sourceUrl = input.sourceUrl?.trim();
    if (!sourceUrl) {
      throw new BadRequestException('Thiếu đường dẫn sản phẩm');
    }

    const normalizedImages = Array.isArray(input.images)
      ? input.images.filter((url) => typeof url === 'string' && url.trim().length > 0)
      : [];

    const title = typeof input.title === 'string' ? input.title.trim() : undefined;
    const description = typeof input.description === 'string' ? input.description.trim() : undefined;
    const currency = typeof input.currency === 'string' ? input.currency.trim() : undefined;
    const category = typeof input.category === 'string' ? input.category.trim() : undefined;
    const price = typeof input.price === 'number' ? Math.round(input.price) : undefined; // Sale price (giá đã giảm)
    const originalPrice = typeof input.originalPrice === 'number' ? Math.round(input.originalPrice) : undefined; // Regular price (giá gốc)

    const descriptionProvided = Object.prototype.hasOwnProperty.call(input, 'description');
    const priceProvided = Object.prototype.hasOwnProperty.call(input, 'price');
    const originalPriceProvided = Object.prototype.hasOwnProperty.call(input, 'originalPrice');
    const currencyProvided = Object.prototype.hasOwnProperty.call(input, 'currency');
    const categoryProvided = Object.prototype.hasOwnProperty.call(input, 'category');
    const imagesProvided = Object.prototype.hasOwnProperty.call(input, 'images');

    // Category mapping is no longer used - user selects category directly in upload dialog
    let categoryId: string | undefined = undefined;
    let needsMapping = false;
    if (category && category.length > 0) {
      // Category will be selected manually during upload
      needsMapping = true;
    }

    const existing = await this.prisma.product.findFirst({
      where: { userId, sourceUrl },
    });

    if (existing) {
      const updateData: Prisma.ProductUpdateInput = {
        status: 'DRAFT',
      };

      if (title) updateData.title = title;
      if (descriptionProvided) {
        updateData.description = description ?? null;
      }
      if (priceProvided) {
        updateData.price = price ?? null;
      }
      if (originalPriceProvided) {
        (updateData as any).originalPrice = originalPrice ?? null;
      }
      if (currencyProvided) {
        updateData.currency = currency && currency.length > 0 ? currency : 'VND';
      }
      if (categoryProvided) {
        updateData.category =
          category && category.length > 0 ? category : null;
        (updateData as any).categoryId = categoryId || null;
        (updateData as any).needsMapping = needsMapping;
      }
      if (imagesProvided) {
        updateData.images = normalizedImages.length ? normalizedImages : Prisma.JsonNull;
      }

      return this.prisma.product.update({
        where: { id: existing.id },
        data: updateData,
      });
    }

    const createData: any = {
      userId,
      sourceShop: 'shopee',
      sourceUrl,
      title: title && title.length > 0 ? title : 'Sản phẩm Shopee',
      status: 'DRAFT',
      currency: currency && currency.length > 0 ? currency : 'VND',
      description: descriptionProvided ? description ?? null : undefined,
      price: priceProvided ? price ?? null : undefined,
      originalPrice: originalPriceProvided ? originalPrice ?? null : undefined,
      category: categoryProvided ? category ?? null : undefined,
      categoryId: categoryId || undefined,
      needsMapping: needsMapping,
      images: normalizedImages.length ? normalizedImages : undefined,
    };

    return this.prisma.product.create({ data: createData });
  }

  private async uploadImageToMediaLibrary(site: any, imageUrl: string): Promise<string> {
    const mediaEndpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`;
    
    // WordPress REST API may not accept WooCommerce credentials
    // Try WooCommerce credentials first, but log if it fails
    const auth = Buffer.from(
      `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
    ).toString('base64');
    
    console.log(`[Image Upload] Using WordPress REST API with WooCommerce credentials`);
    console.log(`[Image Upload] Endpoint: ${mediaEndpoint}`);
    console.log(`[Image Upload] Note: If this fails with 401/403, WordPress may require Application Password instead of WooCommerce keys`);

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

        console.log(`[Image Upload] Downloading image (attempt ${attempt}/${maxRetries}): ${imageUrl}`);

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
        console.warn(`[Image Upload] Attempt ${attempt}/${maxRetries} failed:`, error.message);

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`[Image Upload] Retrying in ${delay}ms...`);
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

    console.log(`[Image Upload] Uploading to WordPress media library: ${mediaEndpoint}`);
    console.log(`[Image Upload] Image size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`[Image Upload] Image type: ${imageType}, File name: ${fileName}`);
    
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
      
      console.error(`[Image Upload] WordPress upload failed:`, {
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
      console.error(`[Image Upload] WordPress response missing source_url:`, mediaData);
      throw new Error(`WordPress API returned success but no source_url. Response: ${JSON.stringify(mediaData).substring(0, 200)}`);
    }
    
    console.log(`[Image Upload] Successfully uploaded to WordPress: ${mediaData.source_url}`);
    return mediaData.source_url;
  }

  private async uploadToWoo(site: any, product: any, targetCategory?: string) {
    if (!site.wooConsumerKey || !site.wooConsumerSecret || !site.baseUrl) {
      throw new BadRequestException('Site chưa cấu hình WooCommerce API');
    }

    const auth = Buffer.from(
      `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
    ).toString('base64');
    const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products`;

    // Upload images to media library
    let uploadedImages: { src: string; name?: string }[] = [];
    if (Array.isArray(product.images) && product.images.length > 0) {
      console.log(`[Upload] Starting to upload ${product.images.length} images to WordPress media library`);
      for (let i = 0; i < product.images.length; i++) {
        const imgUrl = product.images[i];
        try {
          console.log(`[Upload] Uploading image ${i + 1}/${product.images.length}: ${imgUrl}`);
          const mediaUrl = await this.uploadImageToMediaLibrary(site, imgUrl);
          uploadedImages.push({ src: mediaUrl });
          console.log(`[Upload] Successfully uploaded image ${i + 1}/${product.images.length}: ${mediaUrl}`);
        } catch (e: any) {
          console.error(`[Upload] Failed to upload image ${i + 1}/${product.images.length} to WordPress:`, e.message);
          
          // Don't use Shopee URLs directly - WooCommerce will try to download them and timeout
          // Skip this image - product will be created without it
          // User can manually add images later or retry the job after fixing WordPress authentication
          console.warn(`[Upload] Skipping image ${imgUrl} - WordPress upload failed. Product will be created without this image.`);
        }
      }
      console.log(`[Upload] Images summary: ${uploadedImages.length}/${product.images.length} successfully uploaded to WordPress`);
      if (uploadedImages.length < product.images.length) {
        console.warn(`[Upload] ${product.images.length - uploadedImages.length} images failed to upload. Product will be created with ${uploadedImages.length} images.`);
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
      console.log(`Using category ID from targetCategory: ${categoryId}`);
    } else if (product.category) {
      // Fallback to category name
      categoryArray = [{ name: product.category }];
    }

    // Log warning if no images available
    if (uploadedImages.length === 0 && Array.isArray(product.images) && product.images.length > 0) {
      console.warn(`[Upload] WARNING: No images available. All ${product.images.length} images failed to upload. Product will be created without images.`);
      // Don't throw error - allow product creation without images
      // User can manually add images later or retry the job
    } else if (uploadedImages.length > 0) {
      console.log(`[Upload] Images ready for product: ${uploadedImages.length} images`);
    }

    const body = {
      name: product.title || 'Copied product',
      type: 'simple',
      regular_price: product.price ? String(product.price) : undefined,
      description: product.description || undefined,
      categories: categoryArray,
      images: uploadedImages.length > 0 ? uploadedImages : undefined,
    };
    
    console.log('[Upload] Uploading product to WooCommerce:', {
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
      console.error('WooCommerce response missing product ID:', {
        status: res.status,
        response: responseData,
        endpoint,
        productTitle: product.title,
      });
      throw new Error(`WooCommerce API returned success but no product ID. Response: ${JSON.stringify(responseData).substring(0, 200)}`);
    }
    
    console.log(`Successfully uploaded product to WooCommerce:`, {
      productId: responseData.id,
      productTitle: product.title,
      siteUrl: site.baseUrl,
    });
    
    return responseData;
  }
}

