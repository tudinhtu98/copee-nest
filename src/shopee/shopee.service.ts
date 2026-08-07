import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AffiliateLinkResult,
  buildShopeeAffiliateLink,
  isShopeeUrl,
} from './affiliate';

@Injectable()
export class ShopeeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Affiliate ID user đã lưu trong thông tin tài khoản (null nếu chưa nhập). */
  async getUserAffiliateId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { shopeeAffiliateId: true },
    });
    const id = user?.shopeeAffiliateId?.trim();
    return id ? id : null;
  }

  /**
   * Tạo link affiliate. Nếu không truyền affiliateId thì lấy từ tài khoản user.
   */
  async createAffiliateLink(
    userId: string,
    params: { url: string; subId?: string; affiliateId?: string },
  ): Promise<AffiliateLinkResult> {
    const url = params.url?.trim();
    if (!url) {
      throw new BadRequestException('Thiếu link sản phẩm');
    }
    if (!isShopeeUrl(url)) {
      throw new BadRequestException('Link không phải link Shopee hợp lệ');
    }

    const affiliateId =
      params.affiliateId?.trim() || (await this.getUserAffiliateId(userId));
    if (!affiliateId) {
      throw new BadRequestException(
        'Bạn chưa nhập Shopee Affiliate ID trong thông tin tài khoản',
      );
    }

    const result = buildShopeeAffiliateLink(url, affiliateId, params.subId);
    if (!result) {
      throw new BadRequestException('Không tạo được link affiliate từ link này');
    }
    return result;
  }
}
