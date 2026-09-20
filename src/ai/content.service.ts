import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService, type MediaAssetDto } from '../social/media.service';
import { GeminiClient } from './gemini.client';
import { PointsService } from './points.service';

export const CONTENT_TONES = [
  'friendly',
  'professional',
  'urgent',
  'playful',
  'luxury',
] as const;
export const CONTENT_GOALS = [
  'messages',
  'engagement',
  'traffic',
  'awareness',
] as const;
export const IMAGE_ASPECT_RATIOS = ['1:1', '4:5', '9:16', '16:9'] as const;

export type ContentTone = (typeof CONTENT_TONES)[number];
export type ContentGoal = (typeof CONTENT_GOALS)[number];
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

const TONE_LABEL: Record<ContentTone, string> = {
  friendly: 'Thân thiện, gần gũi',
  professional: 'Chuyên nghiệp, tin cậy',
  urgent: 'Khẩn trương, kích thích mua ngay',
  playful: 'Vui nhộn, bắt trend',
  luxury: 'Sang trọng, cao cấp',
};

const GOAL_LABEL: Record<ContentGoal, string> = {
  messages: 'Kéo khách nhắn tin hỏi mua',
  engagement: 'Tăng tương tác (thích, bình luận, chia sẻ)',
  traffic: 'Kéo khách bấm vào link mua hàng',
  awareness: 'Giới thiệu sản phẩm mới',
};

const WRITE_SYSTEM = [
  'Bạn là copywriter viết bài Facebook bán hàng cho shop Việt Nam. Viết tiếng Việt tự nhiên, đúng chính tả, có dấu.',
  '',
  'Quy tắc bắt buộc:',
  '- Chỉ dùng thông tin được cung cấp. Không bịa giá, khuyến mãi, thông số, cam kết, chứng nhận.',
  '- Tuân thủ chính sách quảng cáo của Meta: không khẳng định đặc điểm cá nhân của người đọc',
  '  (tránh kiểu "Bạn đang béo?"), không hứa kết quả tuyệt đối, không chê bai đối thủ.',
  '- 1-2 dòng đầu phải hút mắt (phần hiện trước chữ "Xem thêm").',
  '- Viết giá bằng chữ số thường như "1.290.000đ"; KHÔNG biến giá thành hashtag hay viết tắt kiểu "#1_TRIỆU_290K".',
  '- Đoạn ngắn, emoji vừa phải để dễ đọc trên điện thoại; kết bài bằng lời kêu gọi hành động hợp mục tiêu.',
  '- Cuối bài 2-4 hashtag liên quan.',
  '',
  'Trả về DUY NHẤT một JSON hợp lệ, không kèm giải thích: {"variants": ["bài 1", "bài 2"]}',
  'Mỗi phương án là một bài hoàn chỉnh, khác nhau rõ về cách mở đầu và góc tiếp cận.',
].join('\n');

export interface WritePostInput {
  /** Mô tả tự nhập. Bỏ trống thì phải có productId. */
  brief?: string;
  productId?: string;
  tone: ContentTone;
  goal: ContentGoal;
  variants?: number;
  /** Cho AI xem một ảnh trong thư viện để viết sát hơn. */
  mediaId?: string;
  /** Kèm link mua hàng (affiliate) của sản phẩm vào bài. */
  includeLink?: boolean;
}

export interface WritePostResult {
  variants: string[];
  /** Link nên gắn kèm bài (nếu có), để giao diện điền sẵn. */
  link: string | null;
  cost: number;
}

export interface GenerateImageInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  /** Ảnh gốc trong thư viện: AI giữ nguyên sản phẩm, chỉ đổi bối cảnh. */
  referenceMediaId?: string;
  /** Hoặc lấy thẳng ảnh đầu tiên của một sản phẩm đã cào về làm ảnh gốc. */
  productId?: string;
}

/**
 * Bóc danh sách bài từ câu trả lời của model: model hay bọc JSON trong ```json
 * hoặc viết thêm chữ ngoài JSON, nên tìm khối {...} thay vì parse cả câu trả lời.
 */
export function parseVariants(text: string): string[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        variants?: unknown;
      };
      if (Array.isArray(parsed.variants)) {
        const variants = parsed.variants.filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0,
        );
        if (variants.length) return variants.map((v) => v.trim());
      }
    } catch {
      /* rơi xuống phương án dự phòng bên dưới */
    }
  }
  const plain = text.replace(/```(json)?/g, '').trim();
  return plain ? [plain] : [];
}

/** Ảnh sản phẩm lưu dạng mảng link trong cột images. */
export function productImages(product: Pick<Product, 'images'>): string[] {
  const raw = product.images as unknown;
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string')
    : [];
}

/** Mô tả sản phẩm cho AI đọc: chỉ những gì thật sự có trong DB. */
export function describeProduct(product: Product): string {
  const money = (v: number | null) =>
    v === null
      ? null
      : `${v.toLocaleString('vi-VN')}${product.currency ?? 'đ'}`;
  return [
    `Tên sản phẩm: ${product.title}`,
    product.category ? `Ngành hàng: ${product.category}` : '',
    money(product.price) ? `Giá bán: ${money(product.price)}` : '',
    money(product.originalPrice) && product.originalPrice !== product.price
      ? `Giá gốc: ${money(product.originalPrice)}`
      : '',
    product.description
      ? `Mô tả từ người bán:\n${product.description.slice(0, 2000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Hướng dẫn thêm cho model ảnh để ra ảnh dùng được làm ảnh bài đăng. */
function imagePrompt(prompt: string, hasReference: boolean): string {
  return [
    prompt.trim(),
    '',
    hasReference
      ? 'Dùng sản phẩm trong ảnh đính kèm làm chủ thể, giữ nguyên hình dáng, màu sắc, logo và chữ trên sản phẩm.'
      : '',
    'Ảnh quảng cáo chất lượng cao, ánh sáng đẹp, bố cục rõ chủ thể, phù hợp đăng Facebook.',
    'Không tự thêm chữ, logo hay watermark trừ khi được yêu cầu rõ.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** AI viết bài bán hàng và tạo ảnh, có thể lấy dữ liệu từ sản phẩm đã cào về. */
@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiClient,
    private readonly points: PointsService,
    private readonly media: MediaService,
  ) {}

  async writePost(
    userId: string,
    input: WritePostInput,
  ): Promise<WritePostResult> {
    const product = input.productId
      ? await this.findProduct(userId, input.productId)
      : null;
    const brief = (input.brief ?? '').trim();
    if (!product && brief.length < 5) {
      throw new BadRequestException(
        'Cần mô tả sản phẩm (ít nhất 5 ký tự) hoặc chọn một sản phẩm đã copy',
      );
    }
    await this.points.assertEnough(userId, 'AI_POST_COST');

    const images: { mimeType: string; base64: string }[] = [];
    if (input.mediaId) {
      const asset = await this.media.find(userId, input.mediaId);
      images.push({
        mimeType: asset.mimeType,
        base64: (await this.media.read(asset)).toString('base64'),
      });
    }

    const count = Math.min(Math.max(input.variants ?? 3, 1), 3);
    const link =
      input.includeLink !== false
        ? (product?.affiliateUrl ?? product?.sourceUrl ?? null)
        : null;
    const prompt = [
      `Viết ${count} phương án bài đăng Facebook.`,
      product
        ? `Thông tin sản phẩm:\n${describeProduct(product)}`
        : `Thông tin từ người bán:\n${brief}`,
      product && brief ? `Yêu cầu thêm của người bán: ${brief}` : '',
      `Văn phong: ${TONE_LABEL[input.tone]}.`,
      `Mục tiêu bài viết: ${GOAL_LABEL[input.goal]}.`,
      link
        ? 'Bài sẽ kèm link mua hàng, hãy mời khách bấm vào link ở cuối bài (KHÔNG tự viết link ra).'
        : '',
      images.length
        ? 'Ảnh sản phẩm đính kèm: chỉ mô tả những gì nhìn thấy, không suy diễn thêm.'
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const text = await this.gemini.generateText({
      system: WRITE_SYSTEM,
      prompt,
      images,
      maxOutputTokens: 4096,
    });
    const variants = parseVariants(text).slice(0, count);
    if (!variants.length)
      throw new BadRequestException(
        'AI không trả về nội dung dùng được, thử lại nhé.',
      );

    const cost = await this.points.charge(
      userId,
      'AI_POST_COST',
      `ai-post:${userId}:${Date.now()}`,
      product
        ? `AI viết bài cho "${product.title.slice(0, 60)}"`
        : 'AI viết bài Facebook',
    );
    return { variants, link, cost };
  }

  async generateImage(
    userId: string,
    input: GenerateImageInput,
  ): Promise<{ asset: MediaAssetDto; cost: number }> {
    await this.points.assertEnough(userId, 'AI_IMAGE_COST');

    // Ảnh gốc: lấy từ thư viện, hoặc tự tải ảnh đầu tiên của sản phẩm về thư viện
    let reference: { mimeType: string; base64: string } | undefined;
    let productId = input.productId;
    if (input.referenceMediaId) {
      const asset = await this.media.find(userId, input.referenceMediaId);
      reference = {
        mimeType: asset.mimeType,
        base64: (await this.media.read(asset)).toString('base64'),
      };
      productId = productId ?? asset.productId ?? undefined;
    } else if (input.productId) {
      const product = await this.findProduct(userId, input.productId);
      const [first] = productImages(product);
      if (!first)
        throw new BadRequestException(
          'Sản phẩm này chưa có ảnh để làm ảnh gốc',
        );
      const imported = await this.media.importFromUrl(
        userId,
        first,
        product.id,
      );
      const asset = await this.media.find(userId, imported.id);
      reference = {
        mimeType: asset.mimeType,
        base64: (await this.media.read(asset)).toString('base64'),
      };
    }

    const result = await this.gemini.generateImage({
      prompt: imagePrompt(input.prompt, Boolean(reference)),
      aspectRatio: input.aspectRatio,
      reference,
    });
    if (!result.image) {
      throw new BadRequestException(
        `AI không tạo được ảnh cho mô tả này (${result.blockedReason}). Hãy mô tả lại, tránh nội dung nhạy cảm hoặc người nổi tiếng.`,
      );
    }

    const asset = await this.media.store(userId, result.image, {
      source: 'AI_GENERATED',
      prompt: input.prompt.trim(),
      model: result.model,
      ...(productId ? { productId } : {}),
    });
    const cost = await this.points.charge(
      userId,
      'AI_IMAGE_COST',
      `ai-image:${asset.id}`,
      'AI tạo ảnh',
    );
    return { asset, cost };
  }

  /** Bảng giá hiện tại, để giao diện hiện trước khi bấm. */
  async prices(): Promise<{
    post: number;
    image: number;
    videoScript: number;
  }> {
    return {
      post: await this.points.cost('AI_POST_COST'),
      image: await this.points.cost('AI_IMAGE_COST'),
      videoScript: await this.points.cost('AI_VIDEO_SCRIPT_COST'),
    };
  }

  private async findProduct(
    userId: string,
    productId: string,
  ): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, userId },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
    return product;
  }
}
