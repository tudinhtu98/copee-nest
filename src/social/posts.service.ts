import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ContentPost, ContentPostStatus, FacebookPage, MediaAsset } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { toPageDto } from './connections.service';
import { MetaClient } from './meta.client';
import { MediaService, toMediaDto, type MediaAssetDto } from './media.service';

/** Giới hạn của Facebook cho bài hẹn giờ: từ 10 phút tới 30 ngày kể từ lúc gửi. */
export const SCHEDULE_MIN_MINUTES = 10;
export const SCHEDULE_MAX_DAYS = 30;
export const POST_MAX_IMAGES = 10;
/** Bài kẹt ở PUBLISHING lâu hơn mức này (máy chủ tắt giữa chừng) thì cho đăng lại. */
const PUBLISHING_STALE_MS = 5 * 60_000;
/** Mỗi lần mở danh sách chỉ hỏi Facebook tối đa ngần này bài hẹn giờ đã tới giờ. */
const DUE_CHECK_LIMIT = 5;

export interface ContentPostDto {
  id: string;
  pageId: string | null;
  pageName: string | null;
  productId: string | null;
  message: string;
  link: string | null;
  media: MediaAssetDto[];
  status: ContentPostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalPostId: string | null;
  permalink: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavePostInput {
  pageId?: string | null;
  productId?: string | null;
  message: string;
  link?: string | null;
  mediaIds: string[];
}

type PostRow = ContentPost & { page: FacebookPage | null };

/** Kiểm tra giờ hẹn theo giới hạn của Facebook. */
export function validateSchedule(scheduledAt: Date, now = new Date()): void {
  if (Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('Giờ hẹn không hợp lệ');
  const diff = scheduledAt.getTime() - now.getTime();
  if (diff < SCHEDULE_MIN_MINUTES * 60_000) {
    throw new BadRequestException(`Facebook chỉ cho hẹn giờ sau ít nhất ${SCHEDULE_MIN_MINUTES} phút kể từ bây giờ`);
  }
  if (diff > SCHEDULE_MAX_DAYS * 86_400_000) {
    throw new BadRequestException(`Facebook chỉ cho hẹn giờ trong vòng ${SCHEDULE_MAX_DAYS} ngày tới`);
  }
}

/**
 * Soạn, lưu nháp, đăng ngay hoặc hẹn giờ bài lên fanpage.
 * Hẹn giờ dùng tính năng lên lịch của chính Facebook nên máy chủ không cần job canh giờ.
 */
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly meta: MetaClient,
    private readonly media: MediaService,
  ) {}

  async list(userId: string, status?: ContentPostStatus): Promise<ContentPostDto[]> {
    await this.checkDueScheduled(userId);
    const rows = await this.prisma.contentPost.findMany({
      where: { userId, ...(status ? { status } : {}) },
      include: { page: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return this.toDtos(userId, rows);
  }

  async get(userId: string, id: string): Promise<ContentPostDto> {
    const [dto] = await this.toDtos(userId, [await this.findRow(userId, id)]);
    return dto!;
  }

  async create(userId: string, input: SavePostInput): Promise<ContentPostDto> {
    const data = await this.validate(userId, input);
    const row = await this.prisma.contentPost.create({ data: { ...data, userId } });
    return this.get(userId, row.id);
  }

  async update(userId: string, id: string, input: SavePostInput): Promise<ContentPostDto> {
    const post = await this.findRow(userId, id);
    if (post.status !== 'DRAFT' && post.status !== 'FAILED') {
      throw new ConflictException('Bài đã gửi lên Facebook, không sửa ở đây được nữa. Hãy sửa trực tiếp trên Page.');
    }
    await this.prisma.contentPost.update({ where: { id }, data: await this.validate(userId, input) });
    return this.get(userId, id);
  }

  /** Chỉ xoá khỏi copee; bài đã đăng trên Facebook vẫn giữ nguyên. */
  async remove(userId: string, id: string): Promise<void> {
    const post = await this.findRow(userId, id);
    if (post.status === 'PUBLISHING') throw new ConflictException('Bài đang được đăng, đợi xong rồi hãy xoá');
    await this.prisma.contentPost.delete({ where: { id } });
  }

  /**
   * Đăng ngay hoặc hẹn giờ. Ảnh được tải lên Page ở dạng chưa công khai rồi gắn vào bài,
   * nên bài nhiều ảnh hiện thành MỘT bài chứ không phải nhiều bài ảnh lẻ.
   */
  async publish(userId: string, id: string, scheduledAtIso?: string | null): Promise<ContentPostDto> {
    const post = await this.findRow(userId, id);
    if (!post.page) throw new BadRequestException('Bài chưa chọn Page để đăng');
    if (!toPageDto(post.page).canPublish) {
      throw new ConflictException(`Tài khoản Facebook đã kết nối không có quyền đăng bài lên Page "${post.page.name}"`);
    }
    const scheduledAt = scheduledAtIso ? new Date(scheduledAtIso) : undefined;
    if (scheduledAt) validateSchedule(scheduledAt);

    // Giành quyền đăng bằng một câu UPDATE có điều kiện: bấm hai lần gần nhau chỉ một lần thắng
    const claimed = await this.prisma.contentPost.updateMany({
      where: {
        id,
        userId,
        OR: [
          { status: { in: ['DRAFT', 'FAILED'] } },
          { status: 'PUBLISHING', updatedAt: { lt: new Date(Date.now() - PUBLISHING_STALE_MS) } },
        ],
      },
      data: { status: 'PUBLISHING', error: null },
    });
    if (!claimed.count) throw new ConflictException('Bài này đã hoặc đang được đăng');

    const page = post.page;
    try {
      const token = this.crypto.decrypt(page.encrypted);
      const assets = await this.media.findMany(userId, post.mediaIds);
      const photoIds: string[] = [];
      for (const asset of assets) {
        photoIds.push(await this.meta.uploadPagePhoto(page.externalId, token, await this.media.read(asset), Boolean(scheduledAt)));
      }
      const externalPostId = await this.meta.publishPagePost(page.externalId, token, {
        message: post.message,
        link: post.link,
        photoIds,
        scheduledAt,
      });
      const permalink = scheduledAt ? null : await this.permalink(externalPostId, token);
      await this.prisma.contentPost.update({
        where: { id },
        data: scheduledAt
          ? { status: 'SCHEDULED', scheduledAt, externalPostId, error: null }
          : { status: 'PUBLISHED', publishedAt: new Date(), externalPostId, permalink, error: null },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.prisma.contentPost.update({ where: { id }, data: { status: 'FAILED', error: message.slice(0, 500) } });
      throw e;
    }
    return this.get(userId, id);
  }

  /** Hỏi Facebook xem bài hẹn giờ đã lên chưa. */
  async refresh(userId: string, id: string): Promise<ContentPostDto> {
    const post = await this.findRow(userId, id);
    if (post.status === 'SCHEDULED') await this.syncScheduled(post);
    return this.get(userId, id);
  }

  /** Bài hẹn giờ đã tới giờ ⇒ kiểm tra để danh sách tự chuyển sang "Đã đăng". Lỗi thì bỏ qua. */
  private async checkDueScheduled(userId: string): Promise<void> {
    const due = await this.prisma.contentPost.findMany({
      where: { userId, status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      include: { page: true },
      take: DUE_CHECK_LIMIT,
    });
    for (const post of due) {
      await this.syncScheduled(post).catch((e) =>
        this.logger.warn(`Không kiểm tra được bài hẹn giờ ${post.id}: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  private async syncScheduled(post: PostRow): Promise<void> {
    if (!post.page || !post.externalPostId) return;
    const info = await this.meta.getPagePost(post.externalPostId, this.crypto.decrypt(post.page.encrypted));
    if (!info.is_published) return;
    await this.prisma.contentPost.update({
      where: { id: post.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: info.created_time ? new Date(info.created_time) : new Date(),
        permalink: info.permalink_url ?? null,
      },
    });
  }

  /** Link bài trên Facebook; lấy không được thì thôi, không làm hỏng việc đăng. */
  private async permalink(externalPostId: string, token: string): Promise<string | null> {
    try {
      return (await this.meta.getPagePost(externalPostId, token)).permalink_url ?? null;
    } catch {
      return null;
    }
  }

  private async validate(userId: string, input: SavePostInput) {
    const message = (input.message ?? '').trim();
    const mediaIds = [...new Set(input.mediaIds ?? [])];
    if (!message && !mediaIds.length) throw new BadRequestException('Bài viết cần có nội dung hoặc ảnh');
    if (mediaIds.length > POST_MAX_IMAGES) throw new BadRequestException(`Mỗi bài tối đa ${POST_MAX_IMAGES} ảnh`);
    await this.media.findMany(userId, mediaIds);
    if (input.pageId) {
      const page = await this.prisma.facebookPage.findFirst({ where: { id: input.pageId, userId } });
      if (!page) throw new NotFoundException('Không tìm thấy Page');
    }
    if (input.productId) {
      const product = await this.prisma.product.findFirst({ where: { id: input.productId, userId } });
      if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    return {
      message,
      link: input.link?.trim() || null,
      mediaIds,
      pageId: input.pageId ?? null,
      productId: input.productId ?? null,
    };
  }

  private async findRow(userId: string, id: string): Promise<PostRow> {
    const row = await this.prisma.contentPost.findFirst({ where: { id, userId }, include: { page: true } });
    if (!row) throw new NotFoundException('Không tìm thấy bài viết');
    return row;
  }

  private async toDtos(userId: string, rows: PostRow[]): Promise<ContentPostDto[]> {
    const ids = [...new Set(rows.flatMap((r) => r.mediaIds))];
    const assets = ids.length ? await this.prisma.mediaAsset.findMany({ where: { userId, id: { in: ids } } }) : [];
    const byId = new Map<string, MediaAsset>(assets.map((a) => [a.id, a]));
    return rows.map((r) => ({
      id: r.id,
      pageId: r.pageId,
      pageName: r.page?.name ?? null,
      productId: r.productId,
      message: r.message,
      link: r.link,
      // Ảnh đã bị xoá khỏi thư viện thì bỏ qua (bài đã đăng vẫn còn ảnh trên Facebook)
      media: r.mediaIds.flatMap((id) => {
        const asset = byId.get(id);
        return asset ? [toMediaDto(asset)] : [];
      }),
      status: r.status,
      scheduledAt: r.scheduledAt?.toISOString() ?? null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      externalPostId: r.externalPostId,
      permalink: r.permalink,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
