import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService) {}

  list(userId: string) {
    return this.prisma.product.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  createUploadJob(userId: string, body: { productIds: string[]; siteId: string; targetCategory?: string }) {
    const { productIds, siteId, targetCategory } = body;
    return this.prisma.uploadJob.createMany({
      data: productIds.map((productId) => ({ productId, siteId, targetCategory })),
      skipDuplicates: true,
    });
  }

  async processPendingUploads(userId: string) {
    const jobs = await this.prisma.uploadJob.findMany({
      where: { status: 'PENDING' },
      include: { product: true, site: true },
      take: 10,
    });
    if (jobs.length === 0) return { processed: 0 };

    let success = 0;
    for (const job of jobs) {
      try {
        const wcRes = await this.uploadToWoo(job.site, job.product);
        await this.prisma.uploadJob.update({ where: { id: job.id }, data: { status: 'SUCCESS', result: wcRes } });
        await this.prisma.product.update({ where: { id: job.productId }, data: { status: 'UPLOADED' } });
        await this.billing.debit(userId, 1000, `UPLOAD:${job.productId}`);
        success++;
      } catch (e: any) {
        await this.prisma.uploadJob.update({ where: { id: job.id }, data: { status: 'FAILED', result: { error: e.message } } });
        await this.prisma.product.update({ where: { id: job.productId }, data: { status: 'FAILED', errorMessage: e.message } });
      }
    }
    return { processed: jobs.length, success };
  }

  private async uploadToWoo(site: any, product: any) {
    if (!site.wooConsumerKey || !site.wooConsumerSecret || !site.baseUrl) {
      throw new BadRequestException('Site chưa cấu hình WooCommerce API');
    }
    const auth = Buffer.from(`${site.wooConsumerKey}:${site.wooConsumerSecret}`).toString('base64');
    const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products`;
    const body = {
      name: product.title || 'Copied product',
      type: 'simple',
      regular_price: product.price ? String(product.price) : undefined,
      description: (product.description || '') + (product.sourceUrl ? `\n\nSource: ${product.sourceUrl}` : ''),
      categories: product.category ? [{ name: product.category }] : undefined,
      images: Array.isArray(product.images) ? product.images.map((u: string) => ({ src: u })) : undefined,
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
}


