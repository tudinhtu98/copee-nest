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
import { finalizeCaption } from './caption';
import { ShopeeService } from '../shopee/shopee.service';
import { buildShopeeAffiliateLink } from '../shopee/affiliate';
import { MediaService } from '../social/media.service';
import type { StoryScene, StorySetting } from './story.prompt';
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
    private readonly shopee: ShopeeService,
    private readonly media: MediaService,
  ) {
    super();
  }

  /** Điểm trừ mỗi video: setting DB (đổi qua admin) -> env -> 5000. */
  private async getCost(): Promise<number> {
    const s = await this.settings.get('VIDEO_COST');
    const n = parseInt(
      s || this.config.get<string>('VIDEO_COST') || '5000',
      10,
    );
    return Number.isFinite(n) && n >= 0 ? n : 5000;
  }

  /** Thư mục lưu video (mặc định ./uploads/videos). */
  private get videoDir(): string {
    const d = this.config.get<string>('VIDEO_DIR') || 'uploads/videos';
    return isAbsolute(d) ? d : join(process.cwd(), d);
  }

  /**
   * Ghép link mua vào caption thô: ưu tiên link affiliate đã lưu trên sản phẩm,
   * không có thì tạo từ affiliate ID trong tài khoản, cuối cùng mới dùng link nguồn.
   */
  private async buildCaption(
    userId: string,
    product: { sourceUrl: string; affiliateUrl: string | null },
    rawCaption: string,
  ): Promise<string> {
    let link = product.affiliateUrl?.trim() || '';

    if (!link) {
      const affiliateId = await this.shopee.getUserAffiliateId(userId);
      if (affiliateId) {
        link =
          buildShopeeAffiliateLink(product.sourceUrl, affiliateId)
            ?.affiliateUrl || '';
      }
    }

    return finalizeCaption(rawCaption, link || product.sourceUrl);
  }

  /**
   * Dựng video kể chuyện: đọc ảnh chân dung trong thư viện (nếu có) rồi gọi Veo/Omni
   * với đúng kịch bản người dùng đã duyệt — KHÔNG hỏi lại AI về nội dung.
   */
  private async renderStory(videoJob: {
    id: string;
    userId: string;
    scenes: unknown;
    mediaId: string | null;
    presenter: string | null;
    style: string;
  }): Promise<{ videoBuffer: Buffer; durationSec: number }> {
    const scenes = (
      Array.isArray(videoJob.scenes) ? videoJob.scenes : []
    ) as StoryScene[];
    if (!scenes.length) throw new Error('Video kể chuyện thiếu kịch bản');

    let portrait: { data: string; mime: string } | undefined;
    if (videoJob.mediaId) {
      const asset = await this.media.find(videoJob.userId, videoJob.mediaId);
      portrait = {
        data: (await this.media.read(asset)).toString('base64'),
        mime: asset.mimeType,
      };
    }

    const result = await this.render.renderStoryVideo({
      scenes,
      portrait,
      presenter: videoJob.presenter ?? undefined,
      // style giữ mã bối cảnh ('car', 'cafe'…); 'default' nghĩa là để AI tự chọn.
      setting:
        videoJob.style !== 'default'
          ? (videoJob.style as StorySetting)
          : undefined,
    });
    return { videoBuffer: result.videoBuffer, durationSec: result.durationSec };
  }

  async process(job: Job<VideoJobData>): Promise<any> {
    const { jobId, userId } = job.data;

    const videoJob = await this.prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        product: true,
        user: { select: { telegramId: true, username: true } },
      },
    });
    if (!videoJob) throw new Error(`Video job ${jobId} không tồn tại`);

    const product = videoJob.product;
    const isStory = videoJob.kind === 'STORY';
    if (!isStory && !product)
      throw new Error(`Video job ${jobId} thiếu sản phẩm`);
    // Tên hiển thị trong log và tin nhắn Telegram
    const label = product?.title ?? videoJob.title ?? 'Video kể chuyện';
    const telegramId = videoJob.user.telegramId;
    const username = videoJob.user.username;

    try {
      await this.prisma.videoJob.update({
        where: { id: jobId },
        data: { status: 'PROCESSING' },
      });

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
        if (!caption && product) {
          const script = await this.render.generateScript({
            title: product.title,
            category: product.category,
            price: product.price,
            originalPrice: product.originalPrice,
            images: (product.images as string[]) ?? [],
          });
          caption = await this.buildCaption(userId, product, script.caption);
        }
      } else {
        this.logger.log(
          `🎬 Tạo video job ${jobId} (${videoJob.kind}): ${label}`,
        );

        let videoBuffer: Buffer;
        if (isStory) {
          // Kịch bản đã chốt từ bước xem trước; caption cũng đã lưu sẵn khi tạo job.
          const result = await this.renderStory(videoJob);
          videoBuffer = result.videoBuffer;
          durationSec = result.durationSec;
          caption = caption || videoJob.spokenText || '';
        } else {
          // 1) Gemini viết kịch bản + caption, 2) Omni/Veo sinh video (nhạc native, không chữ)
          const result = await this.render.renderProductVideo({
            title: product!.title,
            category: product!.category,
            price: product!.price,
            originalPrice: product!.originalPrice,
            images: (product!.images as string[]) ?? [],
          });
          videoBuffer = result.videoBuffer;
          caption = await this.buildCaption(userId, product!, result.caption);
          durationSec = result.durationSec;
        }

        // Lưu video ra file
        await mkdir(this.videoDir, { recursive: true });
        await writeFile(videoPath, videoBuffer);

        // Đánh dấu ĐÃ RENDER sớm (trước khi trừ tiền): nếu bước sau lỗi,
        // lần retry sẽ dùng lại file này thay vì gọi AI lại.
        await this.prisma.videoJob.update({
          where: { id: jobId },
          data: { videoUrl: videoPath, caption, durationSec },
        });
      }

      // Trừ tiền — IDEMPOTENT theo reference VIDEO:jobId (retry KHÔNG trừ 2 lần).
      // Video kể chuyện nhiều clip tính tiền theo số clip đã dựng.
      const cost = (await this.getCost()) * (isStory ? videoJob.clips : 1);
      const debited = await this.prisma.transaction.findFirst({
        where: { reference: `VIDEO:${jobId}`, type: 'DEBIT' },
        select: { id: true },
      });
      if (!debited) {
        await this.billing.debit(
          userId,
          cost,
          `VIDEO:${jobId}`,
          `Tạo video: ${label}`.slice(0, 180),
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
          productTitle: label,
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
          productTitle: label,
          reason: e.message?.slice(0, 200) || 'Lỗi không xác định',
          username,
        } as VideoFailedPayload);
      }

      throw e;
    }
  }
}
