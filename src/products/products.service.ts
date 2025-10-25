import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
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

  async processPendingUploads(userId: string) {
    const jobs = await this.prisma.uploadJob.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        retryCount: { lt: 3 },
        product: { userId },
        site: { userId },
      },
      include: { product: true, site: true },
      take: 10,
    });
    if (jobs.length === 0) return { processed: 0 };

    let success = 0;
    for (const job of jobs) {
      try {
        const wcRes = await this.uploadToWoo(job.site, job.product, job.targetCategory || undefined);
        await this.prisma.uploadJob.update({
          where: { id: job.id },
          data: { status: 'SUCCESS', result: wcRes },
        });
        await this.prisma.product.update({
          where: { id: job.productId },
          data: { status: 'UPLOADED', errorMessage: null },
        });
        await this.billing.debit(
          job.product.userId,
          1000,
          `UPLOAD:${job.productId}`,
        );
        success++;
      } catch (e: any) {
        const retryCount = job.retryCount + 1;
        const shouldRetry = retryCount < 3;

        await this.prisma.uploadJob.update({
          where: { id: job.id },
          data: {
            status: shouldRetry ? 'PENDING' : 'FAILED',
            result: { error: e.message },
            retryCount,
            lastRetryAt: new Date(),
          },
        });

        await this.prisma.product.update({
          where: { id: job.productId },
          data: {
            status: shouldRetry ? 'DRAFT' : 'FAILED',
            errorMessage: e.message,
          },
        });

        if (!shouldRetry) {
          console.warn(`Upload job ${job.id} failed after ${retryCount} attempts`);
        }
      }
    }
    return { processed: jobs.length, success };
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
      }
      if (imagesProvided) {
        updateData.images = normalizedImages.length ? normalizedImages : Prisma.JsonNull;
      }

      return this.prisma.product.update({
        where: { id: existing.id },
        data: updateData,
      });
    }

    const createData: Prisma.ProductUncheckedCreateInput = {
      userId,
      sourceShop: 'shopee',
      sourceUrl,
      title: title && title.length > 0 ? title : 'Sản phẩm Shopee',
      status: 'DRAFT',
      currency: currency && currency.length > 0 ? currency : 'VND',
      description: descriptionProvided ? description ?? null : undefined,
      price: priceProvided ? price ?? null : undefined,
      category: categoryProvided ? category ?? null : undefined,
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

    // Map category using category mapping
    let categoryArray: { id?: string; name?: string }[] | undefined = undefined;
    if (targetCategory) {
      // Use target category if provided
      categoryArray = [{ name: targetCategory }];
    } else if (product.category) {
      // Check for category mapping
      const mapping = await this.prisma.categoryMapping.findUnique({
        where: {
          siteId_sourceName: {
            siteId: site.id,
            sourceName: product.category,
          },
        },
      });

      if (mapping) {
        // Use mapped WooCommerce category ID
        categoryArray = [{ id: mapping.targetId }];
      } else {
        // Fallback to category name
        categoryArray = [{ name: product.category }];
      }
    }

    const body = {
      name: product.title || 'Copied product',
      type: 'simple',
      regular_price: product.price ? String(product.price) : undefined,
      description:
        (product.description || '') +
        (product.sourceUrl ? `\n\nSource: ${product.sourceUrl}` : ''),
      categories: categoryArray,
      images: uploadedImages.length > 0 ? uploadedImages : undefined,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Woo API error: ${res.status} ${text}`);
    }
    return await res.json();
  }
}
