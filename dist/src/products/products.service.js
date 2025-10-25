"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const billing_service_1 = require("../billing/billing.service");
let ProductsService = class ProductsService {
    prisma;
    billing;
    constructor(prisma, billing) {
        this.prisma = prisma;
        this.billing = billing;
    }
    async list(userId, options) {
        const page = options?.page || 1;
        const limit = options?.limit || 20;
        const skip = (page - 1) * limit;
        const where = { userId };
        if (options?.search) {
            where.OR = [
                { title: { contains: options.search, mode: 'insensitive' } },
                { description: { contains: options.search, mode: 'insensitive' } },
                { category: { contains: options.search, mode: 'insensitive' } },
                { sourceUrl: { contains: options.search, mode: 'insensitive' } },
            ];
        }
        if (options?.status) {
            where.status = options.status;
        }
        const orderBy = {};
        orderBy[options?.sortBy || 'createdAt'] = options?.sortOrder || 'desc';
        const [items, total] = await Promise.all([
            this.prisma.product.findMany({
                where,
                orderBy,
                skip,
                take: limit,
            }),
            this.prisma.product.count({ where }),
        ]);
        return {
            items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async createUploadJob(userId, body) {
        const { productIds, siteId, targetCategory } = body;
        if (!productIds || productIds.length === 0) {
            throw new common_1.BadRequestException('Chưa chọn sản phẩm');
        }
        const site = await this.prisma.site.findUnique({ where: { id: siteId } });
        if (!site || site.userId !== userId) {
            throw new common_1.ForbiddenException('Site không hợp lệ');
        }
        const products = await this.prisma.product.findMany({
            where: { id: { in: productIds }, userId },
        });
        if (products.length !== productIds.length) {
            throw new common_1.ForbiddenException('Sản phẩm không hợp lệ');
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
    async processPendingUploads(userId) {
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
        if (jobs.length === 0)
            return { processed: 0 };
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
                await this.billing.debit(job.product.userId, 1000, `UPLOAD:${job.productId}`);
                success++;
            }
            catch (e) {
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
    async updateProduct(userId, productId, data) {
        const product = await this.prisma.product.findUnique({ where: { id: productId } });
        if (!product || product.userId !== userId) {
            throw new common_1.ForbiddenException('Không tìm thấy sản phẩm');
        }
        const updateData = {};
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
        }
        else if (data.price === null) {
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
    async copyProduct(userId, input) {
        const sourceUrl = input.sourceUrl?.trim();
        if (!sourceUrl) {
            throw new common_1.BadRequestException('Thiếu đường dẫn sản phẩm');
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
            const updateData = {
                status: 'DRAFT',
            };
            if (title)
                updateData.title = title;
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
                updateData.images = normalizedImages.length ? normalizedImages : client_1.Prisma.JsonNull;
            }
            return this.prisma.product.update({
                where: { id: existing.id },
                data: updateData,
            });
        }
        const createData = {
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
    async uploadImageToMediaLibrary(site, imageUrl) {
        const mediaEndpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`;
        const auth = Buffer.from(`${site.wooConsumerKey}:${site.wooConsumerSecret}`).toString('base64');
        const imageRes = await fetch(imageUrl);
        if (!imageRes.ok) {
            throw new Error(`Failed to download image: ${imageRes.status}`);
        }
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
        const imageType = imageRes.headers.get('content-type') || 'image/jpeg';
        const fileName = imageUrl.split('/').pop() || 'image.jpg';
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
    async uploadToWoo(site, product, targetCategory) {
        if (!site.wooConsumerKey || !site.wooConsumerSecret || !site.baseUrl) {
            throw new common_1.BadRequestException('Site chưa cấu hình WooCommerce API');
        }
        const auth = Buffer.from(`${site.wooConsumerKey}:${site.wooConsumerSecret}`).toString('base64');
        const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products`;
        let uploadedImages = [];
        if (Array.isArray(product.images) && product.images.length > 0) {
            for (const imgUrl of product.images) {
                try {
                    const mediaUrl = await this.uploadImageToMediaLibrary(site, imgUrl);
                    uploadedImages.push({ src: mediaUrl });
                }
                catch (e) {
                    console.warn(`Failed to upload image ${imgUrl}:`, e);
                    uploadedImages.push({ src: imgUrl });
                }
            }
        }
        let categoryArray = undefined;
        if (targetCategory) {
            categoryArray = [{ name: targetCategory }];
        }
        else if (product.category) {
            const mapping = await this.prisma.categoryMapping.findUnique({
                where: {
                    siteId_sourceName: {
                        siteId: site.id,
                        sourceName: product.category,
                    },
                },
            });
            if (mapping) {
                categoryArray = [{ id: mapping.targetId }];
            }
            else {
                categoryArray = [{ name: product.category }];
            }
        }
        const body = {
            name: product.title || 'Copied product',
            type: 'simple',
            regular_price: product.price ? String(product.price) : undefined,
            description: (product.description || '') +
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
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        billing_service_1.BillingService])
], ProductsService);
//# sourceMappingURL=products.service.js.map