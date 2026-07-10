import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { VideoBotService } from './video-bot.service';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';

@UseGuards(JwtOrApiKeyGuard)
@Roles(UserRole.USER)
@Controller('video-bot')
export class VideoBotController {
  constructor(private readonly videoBot: VideoBotService) {}

  /** Tạo mã để user nhập vào bot video: /lienket <mã>. */
  @Post('link-code')
  linkCode(@Req() req: AuthenticatedRequest) {
    return this.videoBot.generateLinkCode(req.user.userId);
  }
}
