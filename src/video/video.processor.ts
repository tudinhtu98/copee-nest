import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { RenderService } from './render.service';
import { toAffiliateLink, finalizeCaption } from './caption';
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
    return parseInt(this.config.get<string>('VIDEO_COST') || '5000', 10);
  }

  /** Thư mục lưu video (mặc định ./uploads/videos). */
  private get videoDir(): string {
    const d = this.config.get<string>('VIDEO_DIR') || 'uploads/videos';
    return isAbsolute(d) ? d : join(process.cwd(), d);
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

      this.logger.log(`🎬 Tạo video job ${jobId}: ${product.title}`);

      const images = Array.isArray(product.images)
        ? (product.images as string[])
        : [];

      // 1) Gemini viết kịch bản + caption, 2) Veo sinh video (có nhạc native)
      const result = await this.render.renderProductVideo({
        title: product.title,
        category: product.category,
        price: product.price,
        originalPrice: product.originalPrice,
        images,
      });

      // 3) Ghép link affiliate vào caption
      const site = await this.prisma.site.findFirst({
        where: { userId, shopeeAffiliateId: { not: null } },
        select: { shopeeAffiliateId: true },
      });
      const affLink = toAffiliateLink(product.sourceUrl, site?.shopeeAffiliateId);
      const caption = finalizeCaption(result.caption, affLink);

      // 4) Lưu video ra file
      await mkdir(this.videoDir, { recursive: true });
      const videoPath = join(this.videoDir, `${jobId}.mp4`);
      await writeFile(videoPath, result.videoBuffer);

      // 5) Trừ tiền (chỉ khi thành công)
      await this.billing.debit(
        userId,
        this.cost,
        `VIDEO:${jobId}`,
        `Tạo video: ${product.title}`.slice(0, 180),
      );

      // 6) Lưu kết quả
      await this.prisma.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'DONE',
          videoUrl: videoPath,
          durationSec: result.durationSec,
          caption,
          cost: this.cost,
          errorMessage: null,
        },
      });

      // 7) Bắn event -> bot gửi video về
      if (telegramId) {
        this.events.emit(NotifyEvents.VideoReady, {
          telegramId,
          videoPath,
          caption,
          productTitle: product.title,
        } as VideoReadyPayload);
      }

      this.logger.log(`✅ Video job ${jobId} xong: ${videoPath}`);
      return { success: true, videoPath };
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

      throw e;
    }
  }
}
