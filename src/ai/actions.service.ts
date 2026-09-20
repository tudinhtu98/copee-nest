import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AiAction,
  AiActionKind,
  AiActionSource,
  Product,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { PagePostsService } from '../social/page-posts.service';
import { PostsService, validateSchedule } from '../social/posts.service';
import { VideoService } from '../video/video.service';
import {
  ContentService,
  type ImageAspectRatio,
  IMAGE_ASPECT_RATIOS,
} from './content.service';
import { PointsService } from './points.service';

/** Đề xuất quá thời hạn này mà chưa xác nhận thì phải tạo lại (số liệu có thể đã đổi). */
export const ACTION_TTL_MINUTES = 15;

export interface ActionItem {
  label: string;
  before?: string;
  after?: string;
  ok?: boolean;
  error?: string;
}

export interface ActionPreview {
  items: ActionItem[];
  warnings: string[];
}

export interface ActionDto {
  id: string;
  kind: AiActionKind;
  status: string;
  source: AiActionSource;
  summary: string;
  items: ActionItem[];
  warnings: string[];
  /** Số điểm sẽ bị trừ khi xác nhận. */
  costPoints: number;
  error: string | null;
  expiresAt: string;
  executedAt: string | null;
  createdAt: string;
}

export interface ActionActor {
  userId: string;
  source: AiActionSource;
  /** Agent qua MCP chỉ đề xuất/xác nhận được khi khoá API có quyền ghi. */
  canWrite: boolean;
  apiKeyId?: string;
}

interface Plan {
  summary: string;
  items: ActionItem[];
  warnings: string[];
  params: Record<string, unknown>;
  costPoints: number;
}

export const ACTION_KINDS: AiActionKind[] = [
  'PUBLISH_POST',
  'DELETE_PAGE_POST',
  'GENERATE_IMAGE',
  'CREATE_VIDEO',
  'UPLOAD_PRODUCT',
];

function points(value: number): string {
  return `${value.toLocaleString('vi-VN')} điểm`;
}

function dateVn(d: Date): string {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function snippet(text: string, max = 100): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max
    ? `${flat.slice(0, max)}…`
    : flat || '(không có chữ)';
}

export function toActionDto(a: AiAction, now = new Date()): ActionDto {
  const preview = a.preview as unknown as ActionPreview;
  const result = a.result as unknown as { items?: ActionItem[] } | null;
  return {
    id: a.id,
    kind: a.kind,
    // Đề xuất quá hạn mà chưa ai bấm thì trong DB vẫn là PROPOSED; hiển thị đúng là đã hết hạn
    status: a.status === 'PROPOSED' && a.expiresAt < now ? 'EXPIRED' : a.status,
    source: a.source,
    summary: a.summary,
    items: result?.items ?? preview.items ?? [],
    warnings: preview.warnings ?? [],
    costPoints: a.costPoints,
    error: a.error,
    expiresAt: a.expiresAt.toISOString(),
    executedAt: a.executedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Thao tác tốn tiền hoặc khó hoàn tác (đăng bài, xoá bài, tạo ảnh, tạo video, đăng sản phẩm)
 * đi qua hai bước: `propose` kiểm tra và cho xem trước (chưa đụng gì), `confirm` mới làm thật.
 *
 * Chốt an toàn nằm ở đây chứ không ở lời dặn AI:
 *  - AI trong chat KHÔNG có công cụ xác nhận, chỉ người dùng bấm nút mới thực hiện;
 *  - agent qua MCP phải dùng khoá API có quyền ghi;
 *  - đề xuất hết hạn sau 15 phút;
 *  - việc tốn điểm luôn ghi rõ số điểm trước khi xác nhận.
 */
@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posts: PostsService,
    private readonly pagePosts: PagePostsService,
    private readonly content: ContentService,
    private readonly video: VideoService,
    private readonly products: ProductsService,
    private readonly pointsService: PointsService,
  ) {}

  async list(userId: string): Promise<ActionDto[]> {
    const rows = await this.prisma.aiAction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => toActionDto(r));
  }

  async propose(
    actor: ActionActor,
    kind: AiActionKind,
    rawParams: unknown,
  ): Promise<ActionDto> {
    this.assertCanWrite(actor);
    const params = (rawParams ?? {}) as Record<string, unknown>;
    const plan = await this.plan(actor.userId, kind, params);
    const row = await this.prisma.aiAction.create({
      data: {
        userId: actor.userId,
        source: actor.source,
        kind,
        summary: plan.summary,
        params: plan.params as object,
        preview: { items: plan.items, warnings: plan.warnings } as object,
        costPoints: plan.costPoints,
        apiKeyId: actor.apiKeyId ?? null,
        expiresAt: new Date(Date.now() + ACTION_TTL_MINUTES * 60_000),
      },
    });
    return toActionDto(row);
  }

  /**
   * Thực hiện đề xuất. Giành quyền bằng UPDATE có điều kiện: bấm hai lần gần nhau
   * thì chỉ một lần chạy.
   */
  async confirm(actor: ActionActor, id: string): Promise<ActionDto> {
    this.assertCanWrite(actor);
    const action = await this.find(actor.userId, id);
    if (action.status !== 'PROPOSED') {
      throw new ConflictException(
        `Đề xuất này đã ở trạng thái "${toActionDto(action).status}", không thực hiện lại được`,
      );
    }
    if (action.expiresAt < new Date()) {
      await this.prisma.aiAction.updateMany({
        where: { id, status: 'PROPOSED' },
        data: { status: 'EXPIRED' },
      });
      throw new ConflictException(
        `Đề xuất đã quá ${ACTION_TTL_MINUTES} phút. Hãy tạo đề xuất mới.`,
      );
    }
    const claimed = await this.prisma.aiAction.updateMany({
      where: { id, userId: actor.userId, status: 'PROPOSED' },
      data: { status: 'EXECUTING' },
    });
    if (!claimed.count)
      throw new ConflictException('Đề xuất này đang hoặc đã được thực hiện');

    try {
      const items = await this.execute(actor.userId, action);
      const done = await this.prisma.aiAction.update({
        where: { id },
        data: {
          status: 'EXECUTED',
          result: { items } as object,
          executedAt: new Date(),
          error: null,
        },
      });
      return toActionDto(done);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Thực hiện đề xuất ${id} (${action.kind}) lỗi: ${message}`,
      );
      const failed = await this.prisma.aiAction.update({
        where: { id },
        data: {
          status: 'FAILED',
          error: message.slice(0, 1000),
          executedAt: new Date(),
        },
      });
      return toActionDto(failed);
    }
  }

  async cancel(actor: ActionActor, id: string): Promise<ActionDto> {
    await this.find(actor.userId, id);
    const { count } = await this.prisma.aiAction.updateMany({
      where: { id, userId: actor.userId, status: 'PROPOSED' },
      data: { status: 'CANCELLED' },
    });
    if (!count)
      throw new ConflictException('Chỉ huỷ được đề xuất đang chờ xác nhận');
    return toActionDto(await this.find(actor.userId, id));
  }

  assertCanWrite(actor: ActionActor): void {
    if (!actor.canWrite) {
      throw new BadRequestException(
        'Khoá API này chỉ có quyền đọc. Tạo khoá mới có quyền "ai:write" trong Cài đặt → API keys để agent thực hiện thao tác.',
      );
    }
  }

  // ───────────────────────── Lập đề xuất ─────────────────────────

  private async plan(
    userId: string,
    kind: AiActionKind,
    p: Record<string, unknown>,
  ): Promise<Plan> {
    switch (kind) {
      case 'PUBLISH_POST':
        return this.planPublish(userId, p);
      case 'DELETE_PAGE_POST':
        return this.planDeletePagePost(userId, p);
      case 'GENERATE_IMAGE':
        return this.planImage(userId, p);
      case 'CREATE_VIDEO':
        return this.planVideo(userId, p);
      case 'UPLOAD_PRODUCT':
        return this.planUpload(userId, p);
      default:
        throw new BadRequestException(
          `Loại thao tác không hỗ trợ: ${String(kind)}`,
        );
    }
  }

  private async planPublish(
    userId: string,
    p: Record<string, unknown>,
  ): Promise<Plan> {
    const postId = String(p.postId ?? '');
    const post = await this.posts.get(userId, postId);
    if (post.status !== 'DRAFT' && post.status !== 'FAILED') {
      throw new ConflictException('Chỉ đăng được bài nháp hoặc bài đăng lỗi');
    }
    if (!post.pageId || !post.pageName)
      throw new BadRequestException('Bài chưa chọn Page để đăng');
    const scheduledAt = p.scheduledAt ? new Date(String(p.scheduledAt)) : null;
    if (scheduledAt) validateSchedule(scheduledAt);
    return {
      summary: scheduledAt
        ? `Hẹn giờ đăng bài lên "${post.pageName}"`
        : `Đăng bài lên "${post.pageName}" ngay`,
      items: [
        { label: 'Fanpage', after: post.pageName },
        { label: 'Nội dung', after: snippet(post.message, 160) },
        { label: 'Ảnh', after: `${post.media.length} ảnh` },
        {
          label: 'Thời gian',
          after: scheduledAt ? dateVn(scheduledAt) : 'Ngay khi xác nhận',
        },
      ],
      warnings: scheduledAt
        ? []
        : ['Bài hiện công khai trên fanpage ngay khi xác nhận.'],
      params: {
        postId: post.id,
        scheduledAt: scheduledAt?.toISOString() ?? null,
      },
      costPoints: 0,
    };
  }

  private async planDeletePagePost(
    userId: string,
    p: Record<string, unknown>,
  ): Promise<Plan> {
    const pageId = String(p.pageId ?? '');
    const postId = String(p.postId ?? '');
    const page = await this.prisma.facebookPage.findFirst({
      where: { id: pageId, userId },
    });
    if (!page) throw new NotFoundException('Không tìm thấy Page');
    if (!postId.startsWith(`${page.externalId}_`))
      throw new BadRequestException('Bài viết không thuộc Page này');
    return {
      summary: `Xoá bài trên fanpage "${page.name}"`,
      items: [
        { label: 'Fanpage', after: page.name },
        { label: 'Bài viết', after: postId },
      ],
      warnings: [
        'Bài bị xoá cùng toàn bộ lượt thích, bình luận, chia sẻ. Không khôi phục được.',
      ],
      params: { pageId: page.id, postId },
      costPoints: 0,
    };
  }

  private async planImage(
    userId: string,
    p: Record<string, unknown>,
  ): Promise<Plan> {
    const prompt = String(p.prompt ?? '').trim();
    if (prompt.length < 5)
      throw new BadRequestException('Mô tả ảnh ít nhất 5 ký tự');
    const aspectRatio = (IMAGE_ASPECT_RATIOS as readonly string[]).includes(
      String(p.aspectRatio),
    )
      ? (String(p.aspectRatio) as ImageAspectRatio)
      : '1:1';
    const cost = await this.pointsService.cost('AI_IMAGE_COST');
    const product = p.productId
      ? await this.findProduct(userId, String(p.productId))
      : null;
    return {
      summary: 'AI tạo ảnh',
      items: [
        { label: 'Mô tả', after: snippet(prompt, 160) },
        { label: 'Khung ảnh', after: aspectRatio },
        ...(product
          ? [{ label: 'Ảnh gốc', after: `Ảnh sản phẩm "${product.title}"` }]
          : []),
        { label: 'Chi phí', after: points(cost) },
      ],
      warnings: [`Xác nhận là trừ ${points(cost)} khỏi số dư.`],
      params: {
        prompt,
        aspectRatio,
        ...(p.referenceMediaId
          ? { referenceMediaId: String(p.referenceMediaId) }
          : {}),
        ...(product ? { productId: product.id } : {}),
      },
      costPoints: cost,
    };
  }

  private async planVideo(
    userId: string,
    p: Record<string, unknown>,
  ): Promise<Plan> {
    const product = await this.findProduct(userId, String(p.productId ?? ''));
    const cost = await this.video.getCost();
    const style = String(p.style ?? 'default');
    return {
      summary: `Tạo video cho "${snippet(product.title, 60)}"`,
      items: [
        { label: 'Sản phẩm', after: product.title },
        { label: 'Kiểu video', after: style },
        { label: 'Chi phí', after: points(cost) },
      ],
      warnings: [
        `Xác nhận là trừ ${points(cost)} và xếp hàng render (vài phút mới xong).`,
      ],
      params: { productId: product.id, style },
      costPoints: cost,
    };
  }

  private async planUpload(
    userId: string,
    p: Record<string, unknown>,
  ): Promise<Plan> {
    const product = await this.findProduct(userId, String(p.productId ?? ''));
    const site = await this.prisma.site.findFirst({
      where: { id: String(p.siteId ?? ''), userId },
    });
    if (!site) throw new NotFoundException('Không tìm thấy site');
    const targetCategory = p.targetCategory
      ? String(p.targetCategory)
      : undefined;
    return {
      summary: `Đăng "${snippet(product.title, 50)}" lên ${site.name}`,
      items: [
        { label: 'Sản phẩm', after: product.title },
        { label: 'Site', after: `${site.name} (${site.baseUrl})` },
        ...(targetCategory
          ? [{ label: 'Danh mục', after: targetCategory }]
          : []),
      ],
      warnings: ['Sản phẩm sẽ được đẩy lên website thật của bạn.'],
      params: {
        productId: product.id,
        siteId: site.id,
        ...(targetCategory ? { targetCategory } : {}),
      },
      costPoints: 0,
    };
  }

  // ───────────────────────── Thực hiện ─────────────────────────

  private async execute(
    userId: string,
    action: AiAction,
  ): Promise<ActionItem[]> {
    const p = action.params as Record<string, unknown>;
    const preview = action.preview as unknown as ActionPreview;
    const done = (extra: ActionItem[] = []) => [
      ...preview.items.map((i) => ({ ...i, ok: true })),
      ...extra,
    ];

    switch (action.kind) {
      case 'PUBLISH_POST': {
        const post = await this.posts.publish(
          userId,
          String(p.postId),
          (p.scheduledAt as string | null) ?? null,
        );
        return done(
          post.permalink
            ? [{ label: 'Link bài', after: post.permalink, ok: true }]
            : [],
        );
      }

      case 'DELETE_PAGE_POST':
        await this.pagePosts.remove(userId, String(p.pageId), String(p.postId));
        return done();

      case 'GENERATE_IMAGE': {
        const { asset, cost } = await this.content.generateImage(userId, {
          prompt: String(p.prompt),
          aspectRatio: String(p.aspectRatio) as ImageAspectRatio,
          ...(p.referenceMediaId
            ? { referenceMediaId: String(p.referenceMediaId) }
            : {}),
          ...(p.productId ? { productId: String(p.productId) } : {}),
        });
        return done([
          { label: 'Ảnh đã tạo', after: asset.url, ok: true },
          { label: 'Đã trừ', after: points(cost), ok: true },
        ]);
      }

      case 'CREATE_VIDEO': {
        const job = await this.video.createFromProduct(
          userId,
          String(p.productId),
          String(p.style ?? 'default'),
        );
        return done([
          { label: 'Mã job', after: job.id, ok: true },
          {
            label: 'Trạng thái',
            after: 'Đang xếp hàng render, xong sẽ báo trong mục Video',
            ok: true,
          },
        ]);
      }

      case 'UPLOAD_PRODUCT': {
        await this.products.createUploadJob(userId, {
          productIds: [String(p.productId)],
          siteId: String(p.siteId),
          ...(p.targetCategory
            ? { targetCategory: String(p.targetCategory) }
            : {}),
        });
        return done([
          { label: 'Trạng thái', after: 'Đã xếp hàng đăng lên site', ok: true },
        ]);
      }

      default:
        throw new BadRequestException(
          `Loại thao tác không hỗ trợ: ${String(action.kind)}`,
        );
    }
  }

  private async findProduct(
    userId: string,
    productId: string,
  ): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, userId },
    });
    if (!product)
      throw new NotFoundException(`Không tìm thấy sản phẩm ${productId}`);
    return product;
  }

  private async find(userId: string, id: string): Promise<AiAction> {
    const row = await this.prisma.aiAction.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Không tìm thấy đề xuất');
    return row;
  }
}
