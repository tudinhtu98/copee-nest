import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { RenderService } from './render.service';
import { SettingsService } from '../settings/settings.service';
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
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
  ) {
    super();
  }

  /** Điểm trừ mỗi video: setting DB (đổi qua admin) -> env -> 5000. */
  private async getCost(): Promise<number> {
    const s = await this.settings.get('VIDEO_COST');
    const n = parseInt(s || this.config.get<string>('VIDEO_COST') || '5000', 10);
    return Number.isFinite(n) && n >= 0 ? n : 5000;
  }

  /** Thư mục lưu video (mặc định ./uploads/videos). */
  private get videoDir(): string {
    const d = this.config.get<string>('VIDEO_DIR') || 'uploads/videos';
    return isAbsolute(d) ? d : join(process.cwd(), d);
  }

  /** Ghép link affiliate của user vào caption thô. */
  private async buildCaption(
    userId: string,
    sourceUrl: string,
    rawCaption: string,
  ): Promise<string> {
    const site = await this.prisma.site.findFirst({
      where: { userId, shopeeAffiliateId: { not: null } },
      select: { shopeeAffiliateId: true },
    });
    const affLink = toAffiliateLink(sourceUrl, site?.shopeeAffiliateId);
    return finalizeCaption(rawCaption, affLink);
  }

  async process(job: Job<VideoJobData>): Promise<any> {
    const { jobId, userId, productId } = job.data;

    const videoJob = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        product: true,
        user: { select: { telegramId: true, username: true } },
      },
    });
    if (!videoJob) throw new Error(`Video job ${jobId} không tồn tại`);

    const product = videoJob.product;
    const telegramId = videoJob.user.telegramId;
    const username = videoJob.user.username;

    try {
      await this.prisma.videoJob.update({
        where: { id: jobId },
        data: { status: 'PROCESSING' },
      });

      const images = Array.isArray(product.images)
        ? (product.images as string[])
        : [];
      const videoPath = join(this.videoDir, `${jobId}.mp4`);

      // GUARD chống render trùng: nếu file video đã tồn tại từ lần chạy trước
      // (job retry sau khi render xong nhưng bước sau lỗi) thì KHÔNG gọi AI lại
      // -> tránh bị Google tính tiền lần 2 (~40k/lần).
      const alreadyRendered =
        existsSync(videoPath) && statSync(videoPath).size > 0;

      let caption = videoJob.caption ?? '';
      let durationSec: number | null = videoJob.durationSec ?? null;

      if (alreadyRendered) {
        this.logger.warn(
          `♻️ Job ${jobId}: video đã render trước đó — bỏ qua gọi AI (tránh tính tiền lần 2).`,
        );
        // Hiếm: có file nhưng chưa kịp lưu caption -> tạo lại caption (rẻ, chỉ Gemini text)
        if (!caption) {
          const script = await this.render.generateScript({
            title: product.title,
            category: product.category,
            price: product.price,
            originalPrice: product.originalPrice,
            images,
          });
          caption = await this.buildCaption(
            userId,
            product.sourceUrl,
            script.caption,
          );
        }
      } else {
        this.logger.log(`🎬 Tạo video job ${jobId}: ${product.title}`);
        // 1) Gemini viết kịch bản + caption, 2) Omni/Veo sinh video (nhạc native, không chữ)
        const result = await this.render.renderProductVideo({
          title: product.title,
          category: product.category,
          price: product.price,
          originalPrice: product.originalPrice,
          images,
        });
        caption = await this.buildCaption(
          userId,
          product.sourceUrl,
          result.caption,
        );
        durationSec = result.durationSec;

        // Lưu video ra file
        await mkdir(this.videoDir, { recursive: true });
        await writeFile(videoPath, result.videoBuffer);

        // Đánh dấu ĐÃ RENDER sớm (trước khi trừ tiền): nếu bước sau lỗi,
        // lần retry sẽ dùng lại file này thay vì gọi AI lại.
        await this.prisma.videoJob.update({
          where: { id: jobId },
          data: { videoUrl: videoPath, caption, durationSec },
        });
      }

      // Trừ tiền — IDEMPOTENT theo reference VIDEO:jobId (retry KHÔNG trừ 2 lần).
      const cost = await this.getCost();
      const debited = await this.prisma.transaction.findFirst({
        where: { reference: `VIDEO:${jobId}`, type: 'DEBIT' },
        select: { id: true },
      });
      if (!debited) {
        await this.billing.debit(
          userId,
          cost,
          `VIDEO:${jobId}`,
          `Tạo video: ${product.title}`.slice(0, 180),
        );
      } else {
        this.logger.warn(`Job ${jobId}: đã trừ tiền trước đó — bỏ qua.`);
      }

      // Lưu kết quả cuối
      await this.prisma.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'DONE',
          videoUrl: videoPath,
          durationSec,
          caption,
          cost,
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
          username,
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

      if (!shouldRetry) {
        this.events.emit(NotifyEvents.VideoFailed, {
          telegramId: telegramId || '',
          productTitle: product.title,
          reason: e.message?.slice(0, 200) || 'Lỗi không xác định',
          username,
        } as VideoFailedPayload);
      }

      throw e;
    }
  }
}
