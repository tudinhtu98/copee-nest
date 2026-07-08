import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TelegramService } from './telegram.service';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';

@UseGuards(JwtOrApiKeyGuard)
@Roles(UserRole.USER)
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  /** Tạo mã để user nhập vào bot: /lienket <mã> — gắn Telegram vào tài khoản. */
  @Post('link-code')
  linkCode(@Req() req: AuthenticatedRequest) {
    return this.telegram.generateLinkCode(req.user.userId);
  }
}
