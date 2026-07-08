import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export interface VideoJobData {
  jobId: string;
  userId: string;
  productId: string;
}

@Injectable()
export class VideoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue('video') private readonly queue: Queue,
  ) {}

  /** Số điểm trừ mỗi video (mặc định 2000, cấu hình qua VIDEO_COST). */
  get cost(): number {
    return parseInt(this.config.get<string>('VIDEO_COST') || '5000', 10);
  }

  /** Bóc shopid + itemid từ link Shopee để match sản phẩm cho chắc. */
  extractShopeeIds(url: string): { shopId: string; itemId: string } | null {
    if (!url) return null;
    // Dạng .../...-i.<shopid>.<itemid>  hoặc  .../product/<shopid>/<itemid>
    const m1 = url.match(/i\.(\d+)\.(\d+)/);
    if (m1) return { shopId: m1[1], itemId: m1[2] };
    const m2 = url.match(/product\/(\d+)\/(\d+)/);
    if (m2) return { shopId: m2[1], itemId: m2[2] };
    return null;
  }

  /** Tìm sản phẩm đã copy của user theo link Shopee. */
  async findProductByUrl(userId: string, rawUrl: string) {
    const url = (rawUrl || '').trim();
    // Ưu tiên match theo shopid.itemid (bền vững với query/slug khác nhau)
    const ids = this.extractShopeeIds(url);
    if (ids) {
      const byId = await this.prisma.product.findFirst({
        where: { userId, sourceUrl: { contains: `.${ids.shopId}.${ids.itemId}` } },
        orderBy: { updatedAt: 'desc' },
      });
      if (byId) return byId;
    }
    // Fallback: match theo origin+pathname (bỏ query/hash)
    let normalized = url;
    try {
      const u = new URL(url);
      normalized = u.origin + u.pathname;
    } catch {
      /* giữ nguyên nếu không phải URL hợp lệ */
    }
    return this.prisma.product.findFirst({
      where: { userId, sourceUrl: { startsWith: normalized } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Tạo job video từ link Shopee (dùng cho bot Telegram). */
  async createFromUrl(userId: string, rawUrl: string, style = 'default') {
    const product = await this.findProductByUrl(userId, rawUrl);
    if (!product) {
      throw new NotFoundException(
        'Chưa tìm thấy sản phẩm này trong copee. Hãy dùng extension copy sản phẩm trước, rồi gửi lại link.',
      );
    }
    return this.createFromProduct(userId, product.id, style);
  }

  /** Tạo job video từ productId. Kiểm tra số dư trước, đẩy vào queue. */
  async createFromProduct(userId: string, productId: string, style = 'default') {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.userId !== userId) {
      throw new ForbiddenException('Sản phẩm không hợp lệ');
    }

    const images = Array.isArray(product.images) ? (product.images as any[]) : [];
    if (images.length === 0) {
      throw new BadRequestException('Sản phẩm không có ảnh để tạo video');
    }

    // Kiểm tra số dư trước (trừ tiền thật khi render xong ở processor)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user || user.balance < this.cost) {
      throw new BadRequestException(
        `Số dư không đủ. Cần ${this.cost.toLocaleString('vi-VN')} điểm cho 1 video.`,
      );
    }

    const job = await this.prisma.videoJob.create({
      data: { userId, productId, style, status: 'PENDING' },
    });

    await this.queue.add(
      'render-video',
      { jobId: job.id, userId, productId } as VideoJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86400 },
      },
    );

    return job;
  }

  async list(
    userId: string,
    options?: { page?: number; limit?: number; status?: string },
  ) {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { userId };
    if (options?.status) where.status = options.status;

    const [items, total] = await Promise.all([
      this.prisma.videoJob.findMany({
        where,
        include: { product: { select: { title: true, sourceUrl: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.videoJob.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async retry(userId: string, jobId: string) {
    const job = await this.prisma.videoJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== userId) {
      throw new ForbiddenException('Không tìm thấy video job');
    }
    if (job.status === 'PROCESSING' || job.status === 'PENDING') {
      throw new BadRequestException('Video đang được xử lý');
    }
    await this.prisma.videoJob.update({
      where: { id: jobId },
      data: { status: 'PENDING', errorMessage: null },
    });
    await this.queue.add(
      'render-video',
      { jobId: job.id, userId, productId: job.productId } as VideoJobData,
      { attempts: 2, backoff: { type: 'exponential', delay: 3000 } },
    );
    return { message: 'Đã đưa lại vào hàng đợi' };
  }
}
