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
import { SettingsService } from '../settings/settings.service';
import { MediaService } from '../social/media.service';
import {
  countWords,
  joinSpoken,
  MAX_WORDS_PER_CLIP,
  STORY_CLIP_OPTIONS,
  type StoryClips,
  type StoryScene,
  type StorySetting,
} from './story.prompt';

export interface VideoJobData {
  jobId: string;
  userId: string;
  /** Video sản phẩm mới có productId; video kể chuyện thì không. */
  productId?: string;
  kind?: 'PRODUCT' | 'STORY';
}

/** Kịch bản người dùng đã xác nhận ở bước xem trước, gửi lên để dựng video. */
export interface CreateStoryInput {
  title: string;
  scenes: StoryScene[];
  caption?: string;
  clips: StoryClips;
  mediaId?: string;
  /** Mô tả người dẫn khi người dùng không tải ảnh chân dung lên. */
  presenter?: string;
  setting?: StorySetting;
}

@Injectable()
export class VideoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly media: MediaService,
    @InjectQueue('video') private readonly queue: Queue,
  ) {}

  /** Số điểm trừ mỗi video. Ưu tiên setting DB (đổi qua admin) -> env -> 5000. */
  async getCost(): Promise<number> {
    const s = await this.settings.get('VIDEO_COST');
    const raw = s || this.config.get<string>('VIDEO_COST') || '5000';
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 5000;
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
        where: {
          userId,
          sourceUrl: { contains: `.${ids.shopId}.${ids.itemId}` },
        },
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
  async createFromProduct(
    userId: string,
    productId: string,
    style = 'default',
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.userId !== userId) {
      throw new ForbiddenException('Sản phẩm không hợp lệ');
    }

    const images = Array.isArray(product.images)
      ? (product.images as any[])
      : [];
    if (images.length === 0) {
      throw new BadRequestException('Sản phẩm không có ảnh để tạo video');
    }

    // Kiểm tra số dư trước (trừ tiền thật khi render xong ở processor)
    const cost = await this.getCost();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user || user.balance < cost) {
      throw new BadRequestException(
        `Số dư không đủ. Cần ${cost.toLocaleString('vi-VN')} điểm cho 1 video.`,
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

  /**
   * Tạo video "một người nói chuyện" từ kịch bản ĐÃ ĐƯỢC NGƯỜI DÙNG XÁC NHẬN.
   *
   * Không gọi AI ở đây: chỉ kiểm tra dữ liệu + số dư rồi xếp hàng, vì việc dựng video
   * mất vài phút. Chi phí = giá 1 video x số clip (3 clip thì tốn gấp 3).
   */
  async createStory(userId: string, input: CreateStoryInput) {
    const clips = Number(input.clips) as StoryClips;
    if (!STORY_CLIP_OPTIONS.includes(clips)) {
      throw new BadRequestException('Chỉ tạo được video 1 clip hoặc 3 clip');
    }

    const scenes = (input.scenes || [])
      .map((s) => ({
        spoken: (s.spoken || '').trim(),
        visual: (s.visual || '').trim(),
      }))
      .filter((s) => s.spoken.length > 0);
    if (scenes.length !== clips) {
      throw new BadRequestException(
        `Kịch bản phải có đúng ${clips} cảnh, mỗi cảnh một câu thoại`,
      );
    }
    const tooLong = scenes.findIndex(
      (s) => countWords(s.spoken) > MAX_WORDS_PER_CLIP * 1.5,
    );
    if (tooLong >= 0) {
      throw new BadRequestException(
        `Cảnh ${tooLong + 1} quá dài so với 8 giây (tối đa khoảng ${MAX_WORDS_PER_CLIP} tiếng). Hãy rút ngắn lời thoại.`,
      );
    }
    if (input.mediaId) await this.media.find(userId, input.mediaId);

    const cost = (await this.getCost()) * clips;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user || user.balance < cost) {
      throw new BadRequestException(
        `Số dư không đủ. Cần ${cost.toLocaleString('vi-VN')} điểm cho video ${clips} clip.`,
      );
    }

    const job = await this.prisma.videoJob.create({
      data: {
        userId,
        kind: 'STORY',
        status: 'PENDING',
        style: input.setting ?? 'default',
        title: (input.title || scenes[0].spoken).slice(0, 180),
        caption: input.caption?.trim() || null,
        scenes: scenes as unknown as object,
        spokenText: joinSpoken(scenes),
        mediaId: input.mediaId ?? null,
        presenter: input.mediaId ? null : input.presenter?.trim() || null,
        clips,
      },
    });

    await this.queue.add(
      'render-video',
      { jobId: job.id, userId, kind: 'STORY' } as VideoJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86400 },
      },
    );

    return job;
  }

  /** Một video của chính người dùng (dùng để hỏi tiến độ trên web). */
  async detail(userId: string, jobId: string) {
    const job = await this.prisma.videoJob.findFirst({
      where: { id: jobId, userId },
      include: { product: { select: { title: true, sourceUrl: true } } },
    });
    if (!job) throw new NotFoundException('Không tìm thấy video');
    return job;
  }

  /** N sản phẩm đã copy gần nhất (dùng cho bot: chọn để tạo video). */
  recentProducts(userId: string, limit = 10) {
    return this.prisma.product.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: { id: true, title: true, price: true },
    });
  }

  /** Tìm sản phẩm theo tên (không phân biệt dấu tiếng Việt). */
  searchProducts(userId: string, q: string, limit = 10) {
    const term = `%${q.trim()}%`;
    return this.prisma.$queryRawUnsafe<
      Array<{ id: string; title: string; price: number | null }>
    >(
      `SELECT id, title, price FROM products
       WHERE user_id = $1 AND unaccent(title) ILIKE unaccent($2)
       ORDER BY updated_at DESC LIMIT $3`,
      userId,
      term,
      Math.min(Math.max(limit, 1), 50),
    );
  }

  async list(
    userId: string,
    options?: { page?: number; limit?: number; status?: string; kind?: string },
  ) {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { userId };
    if (options?.status) where.status = options.status;
    if (options?.kind) where.kind = options.kind;

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
      {
        jobId: job.id,
        userId,
        ...(job.productId ? { productId: job.productId } : {}),
        kind: job.kind as 'PRODUCT' | 'STORY',
      } as VideoJobData,
      { attempts: 2, backoff: { type: 'exponential', delay: 3000 } },
    );
    return { message: 'Đã đưa lại vào hàng đợi' };
  }
}
