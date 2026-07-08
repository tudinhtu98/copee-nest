import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { RenderService } from './render.service';
import { buildCaption, toAffiliateLink } from './caption';
import { NotifyEvents } from '../telegram/telegram.events';
import type {
  VideoReadyPayload,
  VideoFailedPayload,
} from '../telegram/telegram.events';
import type { VideoJobData } from './video.service';

@Processor('video', { concurrency: 3 })
@Injectable()
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly render: RenderService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    super();
  }

  private get cost(): number {
    return parseInt(this.config.get<string>('VIDEO_COST') || '2000', 10);
  }

  async process(job: Job<VideoJobData>): Promise<any> {
    const { jobId, userId, productId } = job.data;

    const videoJob = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: { product: true, user: { select: { telegramId: true } } },
    });
    if (!videoJob) throw new Error(`Video job ${jobId} không tồn tại`);

    const product = videoJob.product;
    const telegramId = videoJob.user.telegramId;

    try {
      await this.prisma.videoJob.update({
        where: { id: jobId },
        data: { status: 'PROCESSING' },
      });

      this.logger.log(`🎬 Render video job ${jobId}: ${product.title}`);

      const images = Array.isArray(product.images)
        ? (product.images as string[])
        : [];

      // 1) Render video trên Creatomate
      const result = await this.render.renderProductVideo({
        title: product.title,
        price: product.price,
        originalPrice: product.originalPrice,
        images,
      });

      // 2) Caption + link affiliate (lấy aff_id từ site đầu tiên có cấu hình)
      const site = await this.prisma.site.findFirst({
        where: { userId, shopeeAffiliateId: { not: null } },
        select: { shopeeAffiliateId: true },
      });
      const affLink = toAffiliateLink(
        product.sourceUrl,
        site?.shopeeAffiliateId,
      );
      const caption = buildCaption(
        {
          title: product.title,
          price: product.price,
          originalPrice: product.originalPrice,
          category: product.category,
        },
        affLink,
      );

      // 3) Trừ tiền (chỉ khi render xong)
      await this.billing.debit(
        userId,
        this.cost,
        `VIDEO:${jobId}`,
        `Tạo video: ${product.title}`.slice(0, 180),
      );

      // 4) Lưu kết quả
      await this.prisma.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'DONE',
          videoUrl: result.url,
          durationSec: result.durationSec,
          caption,
          cost: this.cost,
          errorMessage: null,
        },
      });

      // 5) Bắn event để bot gửi video về cho user
      if (telegramId) {
        this.events.emit(NotifyEvents.VideoReady, {
          telegramId,
          videoUrl: result.url,
          caption,
          productTitle: product.title,
        } as VideoReadyPayload);
      }

      this.logger.log(`✅ Video job ${jobId} xong: ${result.url}`);
      return { success: true, url: result.url };
    } catch (e: any) {
      this.logger.error(`❌ Video job ${jobId} lỗi: ${e.message}`);

      const retryCount = videoJob.retryCount + 1;
      const maxRetries = 2;
      const shouldRetry = retryCount < maxRetries;

      await this.prisma.videoJob.update({
        where: { id: jobId },
        data: {
          status: shouldRetry ? 'PENDING' : 'FAILED',
          retryCount,
          errorMessage: e.message?.slice(0, 500),
        },
      });

      if (!shouldRetry && telegramId) {
        this.events.emit(NotifyEvents.VideoFailed, {
          telegramId,
          productTitle: product.title,
          reason: e.message?.slice(0, 200) || 'Lỗi không xác định',
        } as VideoFailedPayload);
      }

      throw e; // để BullMQ retry theo attempts
    }
  }
}
