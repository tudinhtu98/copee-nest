import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { ShopeeService } from './shopee.service';

@UseGuards(JwtOrApiKeyGuard)
@Roles(UserRole.USER)
@Controller('shopee')
export class ShopeeController {
  constructor(private readonly shopee: ShopeeService) {}

  /**
   * POST /shopee/affiliate
   * body: { url, subId?, affiliateId? } — không truyền affiliateId thì lấy của tài khoản.
   */
  @Post('affiliate')
  async createAffiliateLink(
    @Req() req: AuthenticatedRequest,
    @Body() body: { url: string; subId?: string; affiliateId?: string },
  ) {
    const { affiliateId, subId, affiliateUrl } =
      await this.shopee.createAffiliateLink(req.user.userId, body);
    return { affiliateId, subId, affiliateUrl };
  }
}
