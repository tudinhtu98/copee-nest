import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { VideoService } from './video.service';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';

@UseGuards(JwtOrApiKeyGuard)
@Roles(UserRole.USER)
@Controller('video')
export class VideoController {
  constructor(private readonly video: VideoService) {}

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.video.list(req.user.userId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      status: status || undefined,
    });
  }

  /** Tạo video từ productId (dùng trên web). */
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() body: { productId: string; style?: string },
  ) {
    return this.video.createFromProduct(
      req.user.userId,
      body.productId,
      body.style || 'default',
    );
  }

  /** Tạo video từ link Shopee (giống flow bot Telegram, tiện test trên web). */
  @Post('from-url')
  createFromUrl(
    @Req() req: AuthenticatedRequest,
    @Body() body: { sourceUrl: string; style?: string },
  ) {
    return this.video.createFromUrl(
      req.user.userId,
      body.sourceUrl,
      body.style || 'default',
    );
  }

  @Post(':id/retry')
  retry(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.video.retry(req.user.userId, id);
  }
}
