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
const prisma_service_1 = require("../prisma/prisma.service");
const billing_service_1 = require("../billing/billing.service");
let ProductsService = class ProductsService {
    prisma;
    billing;
    constructor(prisma, billing) {
        this.prisma = prisma;
        this.billing = billing;
    }
    list(userId) {
        return this.prisma.product.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    }
    createUploadJob(userId, body) {
        const { productIds, siteId, targetCategory } = body;
        return this.prisma.uploadJob.createMany({
            data: productIds.map((productId) => ({ productId, siteId, targetCategory })),
            skipDuplicates: true,
        });
    }
    async processPendingUploads(userId) {
        const jobs = await this.prisma.uploadJob.findMany({
            where: { status: 'PENDING' },
            include: { product: true, site: true },
            take: 10,
        });
        if (jobs.length === 0)
            return { processed: 0 };
        let success = 0;
        for (const job of jobs) {
            try {
                const wcRes = await this.uploadToWoo(job.site, job.product);
                await this.prisma.uploadJob.update({ where: { id: job.id }, data: { status: 'SUCCESS', result: wcRes } });
                await this.prisma.product.update({ where: { id: job.productId }, data: { status: 'UPLOADED' } });
                await this.billing.debit(userId, 1000, `UPLOAD:${job.productId}`);
                success++;
            }
            catch (e) {
                await this.prisma.uploadJob.update({ where: { id: job.id }, data: { status: 'FAILED', result: { error: e.message } } });
                await this.prisma.product.update({ where: { id: job.productId }, data: { status: 'FAILED', errorMessage: e.message } });
            }
        }
        return { processed: jobs.length, success };
    }
    async uploadToWoo(site, product) {
        if (!site.wooConsumerKey || !site.wooConsumerSecret || !site.baseUrl) {
            throw new common_1.BadRequestException('Site chưa cấu hình WooCommerce API');
        }
        const auth = Buffer.from(`${site.wooConsumerKey}:${site.wooConsumerSecret}`).toString('base64');
        const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products`;
        const body = {
            name: product.title || 'Copied product',
            type: 'simple',
            regular_price: product.price ? String(product.price) : undefined,
            description: (product.description || '') + (product.sourceUrl ? `\n\nSource: ${product.sourceUrl}` : ''),
            categories: product.category ? [{ name: product.category }] : undefined,
            images: Array.isArray(product.images) ? product.images.map((u) => ({ src: u })) : undefined,
        };
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, billing_service_1.BillingService])
], ProductsService);
//# sourceMappingURL=products.service.js.map