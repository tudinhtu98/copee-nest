import { BadRequestException, Injectable } from '@nestjs/common';
import type { AiActionKind } from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../social/connections.service';
import { PagePostsService } from '../social/page-posts.service';
import { PostsService } from '../social/posts.service';
import { VideoService } from '../video/video.service';
import { ActionsService, type ActionActor } from './actions.service';
import { CONTENT_GOALS, CONTENT_TONES, ContentService, IMAGE_ASPECT_RATIOS, type ContentGoal, type ContentTone } from './content.service';

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (chữ thường) — MCP dùng thẳng, Gemini cần đổi sang dạng chữ in. */
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  /** Dữ liệu trả cho AI (JSON gọn để đỡ tốn token). */
  data: unknown;
  /** Câu mô tả ngắn hiện cho người dùng: "đã làm gì". */
  summary: string;
  /** Công cụ tạo đề xuất: id để gắn thẻ Xác nhận vào câu trả lời. */
  actionId?: string;
  /** Điểm đã trừ ngay trong lượt này (AI viết bài). */
  cost?: number;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const enumStr = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description });

const PROPOSAL_NOTE =
  'Công cụ này KHÔNG làm ngay: nó tạo ĐỀ XUẤT kèm nội dung sẽ thực hiện và chi phí, người dùng phải xác nhận.';

const READ_TOOLS: ToolDefinition[] = [
  {
    name: 'get_balance',
    description: 'Số dư điểm hiện tại của người dùng và bảng giá từng việc (viết bài, tạo ảnh, tạo video).',
    inputSchema: obj({}),
  },
  {
    name: 'list_transactions',
    description: 'Lịch sử cộng/trừ điểm gần đây.',
    inputSchema: obj({ limit: int('Số dòng, mặc định 10, tối đa 50') }),
  },
  {
    name: 'list_products',
    description: 'Sản phẩm đã copy về, mới nhất trước. Trả id dùng cho tạo video / viết bài / đăng lên site.',
    inputSchema: obj({
      q: str('Tìm theo tên sản phẩm'),
      status: enumStr(['DRAFT', 'READY', 'UPLOADED', 'FAILED'], 'Lọc theo trạng thái'),
      limit: int('Số dòng, mặc định 10, tối đa 50'),
    }),
  },
  {
    name: 'get_product',
    description: 'Chi tiết một sản phẩm: tên, mô tả, giá, ảnh, link affiliate.',
    inputSchema: obj({ productId: str('id sản phẩm') }, ['productId']),
  },
  {
    name: 'list_sites',
    description: 'Các website WooCommerce đã kết nối (dùng khi đăng sản phẩm lên site).',
    inputSchema: obj({}),
  },
  {
    name: 'list_video_jobs',
    description: 'Các job tạo video gần đây kèm trạng thái và link video.',
    inputSchema: obj({ limit: int('Số dòng, mặc định 10') }),
  },
  {
    name: 'list_pages',
    description: 'Fanpage Facebook đã kết nối (id dùng cho đăng bài và xem bài trên Page).',
    inputSchema: obj({}),
  },
  {
    name: 'list_page_posts',
    description: 'Bài đang có trên một fanpage, mới nhất trước, kèm lượt tương tác.',
    inputSchema: obj({ pageId: str('id Page lấy từ list_pages'), after: str('Con trỏ trang sau') }, ['pageId']),
  },
  {
    name: 'list_drafts',
    description: 'Bài viết đang có trong copee: nháp, đã hẹn giờ, đã đăng, đăng lỗi.',
    inputSchema: obj({ status: enumStr(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'FAILED'], 'Lọc theo trạng thái') }),
  },
];

/** Công cụ làm ngay (miễn phí hoặc rẻ), không cần bước xác nhận. */
const DIRECT_TOOLS: ToolDefinition[] = [
  {
    name: 'write_post_content',
    description:
      'AI viết nội dung bài bán hàng (1-3 phương án) từ mô tả hoặc từ một sản phẩm đã copy. ' +
      'Trừ điểm theo bảng giá (xem get_balance) và trả về nội dung để người dùng chọn.',
    inputSchema: obj(
      {
        brief: str('Mô tả sản phẩm / yêu cầu, bỏ trống nếu đã có productId'),
        productId: str('Viết dựa trên sản phẩm đã copy'),
        tone: enumStr(CONTENT_TONES, 'Văn phong'),
        goal: enumStr(CONTENT_GOALS, 'Mục tiêu bài viết'),
        variants: int('Số phương án 1-3, mặc định 3'),
        includeLink: { type: 'boolean', description: 'Có gắn link mua hàng của sản phẩm không (mặc định có)' },
      },
      ['tone', 'goal'],
    ),
  },
  {
    name: 'save_post_draft',
    description: 'Lưu bài NHÁP vào copee (chưa đăng, không tốn điểm). Dùng publish_post để đăng sau.',
    inputSchema: obj(
      {
        message: str('Nội dung bài'),
        pageId: str('Fanpage sẽ đăng (lấy từ list_pages)'),
        productId: str('Sản phẩm liên quan'),
        link: str('Link mua hàng gắn kèm'),
        mediaIds: { type: 'array', items: { type: 'string' }, description: 'Ảnh trong thư viện, theo thứ tự' },
      },
      ['message'],
    ),
  },
];

/** Công cụ tạo đề xuất chờ xác nhận. */
const PROPOSAL_TOOLS: (ToolDefinition & { kind: AiActionKind })[] = [
  {
    name: 'publish_post',
    kind: 'PUBLISH_POST',
    description: `Đăng ngay hoặc hẹn giờ một bài nháp lên fanpage (hẹn từ 10 phút tới 30 ngày). ${PROPOSAL_NOTE}`,
    inputSchema: obj({ postId: str('id bài nháp'), scheduledAt: str('ISO 8601 có múi giờ; bỏ trống = đăng ngay') }, ['postId']),
  },
  {
    name: 'generate_image',
    kind: 'GENERATE_IMAGE',
    description: `AI tạo ảnh cho bài đăng (tốn điểm). Có productId thì lấy ảnh sản phẩm làm gốc và giữ nguyên sản phẩm. ${PROPOSAL_NOTE}`,
    inputSchema: obj(
      {
        prompt: str('Mô tả ảnh muốn tạo'),
        aspectRatio: enumStr(IMAGE_ASPECT_RATIOS, 'Khung ảnh, mặc định 1:1'),
        productId: str('Dùng ảnh sản phẩm này làm ảnh gốc'),
        referenceMediaId: str('Hoặc dùng ảnh có sẵn trong thư viện làm ảnh gốc'),
      },
      ['prompt'],
    ),
  },
  {
    name: 'create_video',
    kind: 'CREATE_VIDEO',
    description: `Tạo video quảng cáo từ ảnh sản phẩm (tốn điểm, render mất vài phút). ${PROPOSAL_NOTE}`,
    inputSchema: obj({ productId: str('id sản phẩm'), style: str('Kiểu video, mặc định "default"') }, ['productId']),
  },
  {
    name: 'upload_product',
    kind: 'UPLOAD_PRODUCT',
    description: `Đăng một sản phẩm đã copy lên website WooCommerce đã kết nối. ${PROPOSAL_NOTE}`,
    inputSchema: obj(
      { productId: str('id sản phẩm'), siteId: str('id site lấy từ list_sites'), targetCategory: str('Danh mục trên site') },
      ['productId', 'siteId'],
    ),
  },
  {
    name: 'delete_page_post',
    kind: 'DELETE_PAGE_POST',
    description: `Xoá vĩnh viễn một bài trên fanpage. ${PROPOSAL_NOTE}`,
    inputSchema: obj({ pageId: str('id Page'), postId: str('id bài dạng <pageId>_<postId>') }, ['pageId', 'postId']),
  },
];

/** Chỉ có ở MCP. Trong chat, AI không được tự xác nhận đề xuất của chính nó. */
const CONFIRM_TOOLS: ToolDefinition[] = [
  {
    name: 'confirm_action',
    description:
      'Thực hiện một đề xuất đã tạo. CHỈ gọi sau khi đã cho người dùng xem đề xuất (gồm chi phí) và họ đồng ý rõ ràng. ' +
      'Đề xuất hết hạn sau 15 phút.',
    inputSchema: obj({ actionId: str('id đề xuất') }, ['actionId']),
  },
  {
    name: 'cancel_action',
    description: 'Huỷ một đề xuất đang chờ xác nhận.',
    inputSchema: obj({ actionId: str('id đề xuất') }, ['actionId']),
  },
];

function clamp(value: unknown, fallback: number, max = 50): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : fallback;
}

function short(text: string | null | undefined, max = 160): string {
  return (text ?? '').replace(/\s+/g, ' ').slice(0, max);
}

/**
 * Bộ công cụ của trợ lý AI, dùng chung cho chat trong web và agent ngoài qua MCP.
 * Công cụ đọc luôn giới hạn trong dữ liệu của chính người dùng đang gọi; công cụ ghi
 * chỉ tạo đề xuất (trừ viết bài và lưu nháp — rẻ hoặc miễn phí nên làm ngay).
 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly content: ContentService,
    private readonly actions: ActionsService,
    private readonly connections: ConnectionsService,
    private readonly posts: PostsService,
    private readonly pagePosts: PagePostsService,
    private readonly video: VideoService,
  ) {}

  /** `includeConfirm`: chỉ MCP mới có công cụ xác nhận. */
  definitions(opts: { includeConfirm?: boolean } = {}): ToolDefinition[] {
    const proposals = PROPOSAL_TOOLS.map(({ kind: _kind, ...t }) => t);
    return [...READ_TOOLS, ...DIRECT_TOOLS, ...proposals, ...(opts.includeConfirm ? CONFIRM_TOOLS : [])];
  }

  async execute(name: string, rawArgs: unknown, actor: ActionActor): Promise<ToolResult> {
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const userId = actor.userId;

    const proposal = PROPOSAL_TOOLS.find((t) => t.name === name);
    if (proposal) {
      const action = await this.actions.propose(actor, proposal.kind, args);
      return {
        actionId: action.id,
        summary: `Đề xuất: ${action.summary}`,
        data: {
          actionId: action.id,
          status: 'CHỜ XÁC NHẬN',
          summary: action.summary,
          changes: action.items,
          warnings: action.warnings,
          costPoints: action.costPoints,
          next:
            actor.source === 'MCP'
              ? 'Chưa thực hiện. Trình bày đề xuất (kèm chi phí) cho người dùng; chỉ gọi confirm_action khi họ đồng ý rõ ràng.'
              : 'Chưa thực hiện. Người dùng sẽ thấy thẻ đề xuất và tự bấm Xác nhận. KHÔNG nói là đã làm xong.',
        },
      };
    }

    switch (name) {
      case 'get_balance': {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
        const prices = await this.content.prices();
        return {
          data: { balance: user.balance, prices: { ...prices, video: await this.video.getCost() }, unit: 'điểm' },
          summary: `Số dư ${user.balance.toLocaleString('vi-VN')} điểm`,
        };
      }

      case 'list_transactions': {
        const rows = await this.prisma.transaction.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: clamp(args.limit, 10),
        });
        return {
          data: rows.map((t) => ({ amount: t.amount, type: t.type, description: t.description, at: t.createdAt.toISOString() })),
          summary: `${rows.length} giao dịch gần nhất`,
        };
      }

      case 'list_products': {
        const rows = await this.prisma.product.findMany({
          where: {
            userId,
            ...(args.q ? { title: { contains: String(args.q), mode: 'insensitive' as const } } : {}),
            ...(args.status ? { status: String(args.status) as never } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: clamp(args.limit, 10),
        });
        return {
          data: rows.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            price: p.price,
            originalPrice: p.originalPrice,
            category: p.category,
            hasImages: Array.isArray(p.images) && (p.images as unknown[]).length > 0,
          })),
          summary: `${rows.length} sản phẩm`,
        };
      }

      case 'get_product': {
        const product = await this.prisma.product.findFirst({ where: { id: String(args.productId ?? ''), userId } });
        if (!product) throw new BadRequestException('Không tìm thấy sản phẩm');
        const images = Array.isArray(product.images) ? (product.images as string[]) : [];
        return {
          data: {
            id: product.id,
            title: product.title,
            description: short(product.description, 1500),
            price: product.price,
            originalPrice: product.originalPrice,
            currency: product.currency,
            category: product.category,
            status: product.status,
            imageCount: images.length,
            affiliateUrl: product.affiliateUrl,
            sourceUrl: product.sourceUrl,
          },
          summary: `Sản phẩm "${short(product.title, 60)}"`,
        };
      }

      case 'list_sites': {
        const rows = await this.prisma.site.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
        return {
          data: rows.map((s) => ({ id: s.id, name: s.name, url: s.baseUrl })),
          summary: `${rows.length} site`,
        };
      }

      case 'list_video_jobs': {
        const res = await this.video.list(userId, { limit: clamp(args.limit, 10) });
        const jobs = (res as { jobs?: unknown[]; data?: unknown[] }).jobs ?? (res as { data?: unknown[] }).data ?? res;
        return { data: jobs, summary: 'Danh sách job video' };
      }

      case 'list_pages': {
        const pages = await this.connections.pages(userId);
        return {
          data: pages.map((p) => ({ id: p.id, name: p.name, canPublish: p.canPublish })),
          summary: `${pages.length} fanpage`,
        };
      }

      case 'list_page_posts': {
        const res = await this.pagePosts.list(userId, String(args.pageId ?? ''), args.after ? String(args.after) : undefined);
        return {
          data: {
            posts: res.items.map((p) => ({
              pagePostId: p.id,
              createdAt: p.createdAt,
              text: short(p.message),
              reactions: p.reactions,
              comments: p.comments,
              shares: p.shares,
              link: p.link,
            })),
            nextCursor: res.nextCursor,
          },
          summary: `${res.items.length} bài trên fanpage`,
        };
      }

      case 'list_drafts': {
        const rows = await this.posts.list(userId, args.status ? (String(args.status) as never) : undefined);
        return {
          data: rows.slice(0, 30).map((p) => ({
            postId: p.id,
            status: p.status,
            page: p.pageName,
            text: short(p.message),
            images: p.media.length,
            scheduledAt: p.scheduledAt,
            publishedAt: p.publishedAt,
            permalink: p.permalink,
            error: p.error,
          })),
          summary: `${rows.length} bài trong copee`,
        };
      }

      case 'write_post_content': {
        this.actions.assertCanWrite(actor);
        const res = await this.content.writePost(userId, {
          ...(args.brief ? { brief: String(args.brief) } : {}),
          ...(args.productId ? { productId: String(args.productId) } : {}),
          tone: String(args.tone ?? 'friendly') as ContentTone,
          goal: String(args.goal ?? 'messages') as ContentGoal,
          variants: clamp(args.variants, 3, 3),
          ...(args.includeLink === false ? { includeLink: false } : {}),
        });
        return {
          data: { variants: res.variants, link: res.link, costPoints: res.cost, note: 'Đã trừ điểm. Hỏi người dùng chọn phương án nào rồi lưu nháp.' },
          summary: `AI viết ${res.variants.length} phương án (−${res.cost} điểm)`,
          cost: res.cost,
        };
      }

      case 'save_post_draft': {
        this.actions.assertCanWrite(actor);
        const post = await this.posts.create(userId, {
          message: String(args.message ?? ''),
          pageId: args.pageId ? String(args.pageId) : null,
          productId: args.productId ? String(args.productId) : null,
          link: args.link ? String(args.link) : null,
          mediaIds: Array.isArray(args.mediaIds) ? (args.mediaIds as string[]).map(String) : [],
        });
        return {
          data: { postId: post.id, status: post.status, page: post.pageName, note: 'Đã lưu nháp. Dùng publish_post để đăng hoặc hẹn giờ.' },
          summary: 'Đã lưu bài nháp',
        };
      }

      case 'confirm_action': {
        if (actor.source !== 'MCP') {
          throw new BadRequestException('Trong chat, chỉ người dùng bấm nút Xác nhận trên thẻ đề xuất mới thực hiện được');
        }
        const action = await this.actions.confirm(actor, String(args.actionId ?? ''));
        return {
          data: { actionId: action.id, status: action.status, summary: action.summary, results: action.items, error: action.error },
          summary: `Xác nhận: ${action.summary}`,
        };
      }

      case 'cancel_action': {
        if (actor.source !== 'MCP') throw new BadRequestException('Chat không tự huỷ đề xuất được');
        const action = await this.actions.cancel(actor, String(args.actionId ?? ''));
        return { data: { actionId: action.id, status: action.status }, summary: `Huỷ: ${action.summary}` };
      }

      default:
        throw new BadRequestException(`Công cụ không tồn tại: ${name}`);
    }
  }
}
