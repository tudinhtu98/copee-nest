import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from './connections.service';
import { MediaService } from './media.service';
import { MetaClient, type MetaPagePost } from './meta.client';
import { PostsService, type ContentPostDto } from './posts.service';

export interface PagePostDto {
  /** Id bài trên Facebook, dạng "<pageId>_<postId>". */
  id: string;
  message: string;
  createdAt: string;
  permalink: string | null;
  /** Ảnh đại diện bài (link CDN Facebook, có hạn dùng). */
  picture: string | null;
  imageCount: number;
  type: string;
  link: string | null;
  reactions: number;
  comments: number;
  shares: number;
  /** Bài đã có bản trong copee (soạn ở đây hoặc đã nhập về). */
  localPostId: string | null;
}

export interface PagePostsResponse {
  items: PagePostDto[];
  nextCursor: string | null;
}

/** Link website của bài chia sẻ link (Facebook bọc qua l.facebook.com, lấy bản gốc). */
function sharedLink(p: MetaPagePost): string | null {
  const first = p.attachments?.data?.[0];
  return first?.type === 'share' && first.unshimmed_url
    ? first.unshimmed_url
    : null;
}

export function toPagePostDto(
  p: MetaPagePost,
  local: Map<string, string>,
): PagePostDto {
  const first = p.attachments?.data?.[0];
  const albumSize = first?.subattachments?.data?.length ?? 0;
  return {
    id: p.id,
    message: p.message ?? '',
    createdAt: new Date(p.created_time).toISOString(),
    permalink: p.permalink_url ?? null,
    picture: p.full_picture ?? null,
    imageCount: albumSize || (p.full_picture ? 1 : 0),
    type: first?.media_type?.toLowerCase() ?? first?.type ?? 'status',
    link: sharedLink(p),
    reactions: p.reactions?.summary?.total_count ?? 0,
    comments: p.comments?.summary?.total_count ?? 0,
    shares: p.shares?.count ?? 0,
    localPostId: local.get(p.id) ?? null,
  };
}

/**
 * Bài đang có trên fanpage — kể cả bài đăng thẳng trên Facebook, không qua copee.
 * Đọc trực tiếp từ Facebook mỗi lần xem (không lưu bản sao) nên luôn khớp với Page.
 */
@Injectable()
export class PagePostsService {
  private readonly logger = new Logger(PagePostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaClient,
    private readonly connections: ConnectionsService,
    private readonly media: MediaService,
    private readonly posts: PostsService,
  ) {}

  async list(
    userId: string,
    pageId: string,
    after?: string,
  ): Promise<PagePostsResponse> {
    const { page, token } = await this.connections.pageWithToken(
      userId,
      pageId,
    );
    if (!(await this.hasReadScope(page.connectionId))) {
      throw new BadRequestException(
        'Kết nối Facebook thiếu quyền "pages_read_user_content" để xem bài trên Page. Hãy kết nối lại và đồng ý cấp quyền.',
      );
    }
    const { posts, nextCursor } = await this.meta.listPagePosts(
      page.externalId,
      token,
      after,
    );
    const ids = posts.map((p) => p.id);
    const rows = ids.length
      ? await this.prisma.contentPost.findMany({
          where: { userId, externalPostId: { in: ids } },
          select: { id: true, externalPostId: true },
        })
      : [];
    const local = new Map(rows.map((r) => [r.externalPostId!, r.id]));
    return { items: posts.map((p) => toPagePostDto(p, local)), nextCursor };
  }

  /**
   * Đưa bài có sẵn trên Page vào copee (tải ảnh đầu tiên về thư viện) để dùng lại nội dung
   * hoặc làm video. Gọi nhiều lần vẫn chỉ có một bản.
   */
  async import(
    userId: string,
    pageId: string,
    postId: string,
  ): Promise<ContentPostDto> {
    const { page, token } = await this.connections.pageWithToken(
      userId,
      pageId,
    );
    this.assertBelongs(page.externalId, postId);
    const existing = await this.prisma.contentPost.findFirst({
      where: { userId, externalPostId: postId },
    });
    if (existing) return this.posts.get(userId, existing.id);

    const post = await this.meta.getPagePost(postId, token);
    const mediaIds: string[] = [];
    if (post.full_picture) {
      try {
        const asset = await this.media.store(
          userId,
          await this.meta.downloadImage(post.full_picture),
          { source: 'UPLOAD' },
        );
        mediaIds.push(asset.id);
      } catch (e) {
        this.logger.warn(
          `Không tải được ảnh của bài ${postId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    try {
      const row = await this.prisma.contentPost.create({
        data: {
          userId,
          pageId: page.id,
          message: post.message ?? '',
          link: sharedLink(post),
          mediaIds,
          status: 'PUBLISHED',
          publishedAt: new Date(post.created_time),
          externalPostId: postId,
          permalink: post.permalink_url ?? null,
        },
      });
      return this.posts.get(userId, row.id);
    } catch (e) {
      // Hai lần nhập cùng lúc: lần sau đụng ràng buộc unique thì trả về bản đã tạo
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const row = await this.prisma.contentPost.findFirstOrThrow({
          where: { userId, externalPostId: postId },
        });
        return this.posts.get(userId, row.id);
      }
      throw e;
    }
  }

  /** Xoá bài trên Facebook (không khôi phục được) và gỡ bản trong copee nếu có. */
  async remove(userId: string, pageId: string, postId: string): Promise<void> {
    const { page, token } = await this.connections.pageWithToken(
      userId,
      pageId,
    );
    this.assertBelongs(page.externalId, postId);
    await this.meta.deletePagePost(postId, token);
    await this.prisma.contentPost.deleteMany({
      where: { userId, externalPostId: postId },
    });
  }

  private async hasReadScope(connectionId: string): Promise<boolean> {
    const connection = await this.prisma.socialConnection.findUnique({
      where: { id: connectionId },
      select: { scopes: true },
    });
    return Boolean(connection?.scopes.includes('pages_read_user_content'));
  }

  /** Id bài của Page luôn dạng "<pageId>_<postId>": chặn thao tác lên đối tượng khác bằng token Page. */
  private assertBelongs(pageExternalId: string, postId: string): void {
    if (!postId.startsWith(`${pageExternalId}_`)) {
      throw new BadRequestException('Bài viết không thuộc Page này');
    }
  }
}
