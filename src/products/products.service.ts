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

    const where: any = { userId }

    if (options?.search) {
      where.OR = [
        { title: { contains: options.search, mode: 'insensitive' } },
        { description: { contains: options.search, mode: 'insensitive' } },
        { category: { contains: options.search, mode: 'insensitive' } },
        { sourceUrl: { contains: options.search, mode: 'insensitive' } },
      ]
    }

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
      retryCount: { lt: 3 },
      product: { userId },
      site: { userId },
    }
    
    // Exclude CANCELLED jobs
    if (jobIds && jobIds.length > 0) {
      where.id = { in: jobIds }
    }

    const jobs = await this.prisma.uploadJob.findMany({
      where,
      include: { product: true, site: true },
      take: jobIds && jobIds.length > 0 ? jobIds.length : 100, // Increased limit for queue processing
    });
    
    if (jobs.length === 0) return { processed: 0, queued: 0 };

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
      price?: number | null
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
    const price = typeof input.price === 'number' ? Math.round(input.price) : undefined;

    const descriptionProvided = Object.prototype.hasOwnProperty.call(input, 'description');
    const priceProvided = Object.prototype.hasOwnProperty.call(input, 'price');
    const currencyProvided = Object.prototype.hasOwnProperty.call(input, 'currency');
    const categoryProvided = Object.prototype.hasOwnProperty.call(input, 'category');
    const imagesProvided = Object.prototype.hasOwnProperty.call(input, 'images');

    // Check for category mapping if category is provided
    let categoryId: string | undefined = undefined;
    let needsMapping = false;
    if (category && category.length > 0) {
      // Find mapping for this category in any of user's sites
      const userSites = await this.prisma.site.findMany({
        where: { userId },
        select: { id: true },
      });
      const siteIds = userSites.map((s) => s.id);

      if (siteIds.length > 0) {
        const mapping = (await this.prisma.categoryMapping.findFirst({
          where: {
            siteId: { in: siteIds },
            sourceName: category,
          },
          include: {
            wooCategory: true,
          } as any,
        })) as any;

        if (mapping) {
          // Use WooCommerce category ID from mapping
          categoryId = mapping.wooCategory?.wooId || mapping.targetId || undefined;
          needsMapping = false;
        } else {
          needsMapping = true;
        }
      } else {
        needsMapping = true;
      }
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
      category: categoryProvided ? category ?? null : undefined,
      categoryId: categoryId || undefined,
      needsMapping: needsMapping,
      images: normalizedImages.length ? normalizedImages : undefined,
    };

    return this.prisma.product.create({ data: createData });
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
      console.log(`Using category ID from targetCategory: ${categoryId}`);
    } else if (product.category) {
      // Priority 3: Check for category mapping
      const mapping = (await this.prisma.categoryMapping.findUnique({
        where: {
          siteId_sourceName: {
            siteId: site.id,
            sourceName: product.category,
          },
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
    
    console.log('Uploading product to WooCommerce with category:', {
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
