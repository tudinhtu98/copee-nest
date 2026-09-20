import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** Giá mặc định (điểm) cho từng việc AI. Đổi trong Cài đặt mà không cần deploy lại. */
export const AI_COSTS = {
  AI_POST_COST: 300,
  AI_IMAGE_COST: 2000,
  /** Viết kịch bản video kể chuyện: chỉ tốn một lượt Gemini chữ, rẻ như viết bài. */
  AI_VIDEO_SCRIPT_COST: 300,
} as const;

export type AiCostKey = keyof typeof AI_COSTS;

/**
 * Trừ điểm cho các việc dùng AI, theo đúng cách copee đang làm với video:
 * kiểm tra số dư TRƯỚC khi gọi AI, chỉ trừ tiền KHI đã làm xong.
 *
 * Trừ tiền làm bằng một câu UPDATE có kèm điều kiện `balance >= cost`, nên hai yêu cầu
 * chạy song song không thể tiêu quá số dư (giống BillingService.debit).
 */
@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  async cost(key: AiCostKey): Promise<number> {
    const raw = (await this.settings.get(key)) || this.config.get<string>(key);
    const value = parseInt(raw || '', 10);
    return Number.isFinite(value) && value >= 0 ? value : AI_COSTS[key];
  }

  /** Gọi trước khi dùng AI để người dùng biết sớm, không tốn lượt gọi Google. */
  async assertEnough(userId: string, key: AiCostKey): Promise<number> {
    const cost = await this.cost(key);
    if (cost === 0) return 0;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user || user.balance < cost) {
      throw new BadRequestException(
        `Số dư không đủ. Cần ${cost.toLocaleString('vi-VN')} điểm cho việc này.`,
      );
    }
    return cost;
  }

  /**
   * Trừ điểm sau khi làm xong. `reference` là khoá chống trừ trùng: gọi lại với cùng
   * reference (vd. khi thử lại) sẽ không trừ thêm lần nữa.
   */
  async charge(
    userId: string,
    key: AiCostKey,
    reference: string,
    description: string,
  ): Promise<number> {
    const cost = await this.cost(key);
    if (cost === 0) return 0;

    const already = await this.prisma.transaction.findFirst({
      where: { userId, reference },
    });
    if (already) return cost;

    const updated = await this.prisma.user.updateMany({
      where: { id: userId, balance: { gte: cost } },
      data: { balance: { decrement: cost } },
    });
    if (!updated.count) {
      // Hiếm: số dư vừa bị tiêu hết bởi việc khác trong lúc AI đang chạy
      this.logger.warn(
        `Không trừ được ${cost} điểm của ${userId} (${reference}): số dư không đủ`,
      );
      throw new BadRequestException(
        `Số dư không đủ. Cần ${cost.toLocaleString('vi-VN')} điểm cho việc này.`,
      );
    }
    await this.prisma.transaction.create({
      data: { userId, amount: -cost, type: 'DEBIT', reference, description },
    });
    return cost;
  }
}
