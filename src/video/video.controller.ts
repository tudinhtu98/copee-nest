import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { VideoService } from './video.service';
import { CreateStoryVideoDto } from './dto';
import type { StoryClips, StorySetting } from './story.prompt';
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
    @Query('kind') kind?: string,
  ) {
    return this.video.list(req.user.userId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      status: status || undefined,
      kind: kind || undefined,
    });
  }

  /** Giá 1 clip, để giao diện hiện trước khi người dùng bấm dựng. */
  @Get('prices')
  async prices() {
    return { perClip: await this.video.getCost() };
  }

  /**
   * Tạo video "một người nói chuyện" từ kịch bản người dùng đã duyệt.
   * Kịch bản do AI viết ở bước trước (POST /ai/story/script) và người dùng sửa được.
   */
  @Post('story')
  createStory(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateStoryVideoDto,
  ) {
    return this.video.createStory(req.user.userId, {
      title: body.title,
      scenes: body.scenes.map((s) => ({
        spoken: s.spoken,
        visual: s.visual ?? '',
      })),
      caption: body.caption,
      clips: body.clips as StoryClips,
      mediaId: body.mediaId,
      presenter: body.presenter,
      setting: body.setting as StorySetting | undefined,
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

  /** Trạng thái một video (web hỏi lại vài giây một lần trong lúc chờ dựng). */
  @Get(':id')
  detail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.video.detail(req.user.userId, id);
  }

  /** Tải/xem file mp4. Video nằm trên đĩa máy chủ nên phải đi qua đây mới kiểm tra được quyền. */
  @Get(':id/file')
  async file(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const job = await this.video.detail(req.user.userId, id);
    if (!job.videoUrl || !existsSync(job.videoUrl)) {
      throw new NotFoundException('Video chưa dựng xong hoặc file đã bị xoá');
    }
    const info = await stat(job.videoUrl);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', info.size);
    // Nội dung ứng với một id không bao giờ đổi
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    createReadStream(job.videoUrl).pipe(res);
  }

  @Post(':id/retry')
  retry(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.video.retry(req.user.userId, id);
  }
}
