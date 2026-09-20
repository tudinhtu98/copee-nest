import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { Roles } from '../auth/roles.decorator';
import { ConnectionsService } from './connections.service';
import { ConnectTokenDto, ImportImageDto, PublishPostDto, SavePostDto } from './dto';
import { MediaService, MEDIA_MAX_UPLOAD_MB } from './media.service';
import { PagePostsService } from './page-posts.service';
import { PostsService } from './posts.service';

/**
 * Facebook gọi lại sau khi người dùng đồng ý. Route này KHÔNG có guard: Facebook không mang
 * theo phiên đăng nhập, danh tính nằm trong `state` đã ký.
 */
@Controller('social/facebook')
export class SocialCallbackController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly config: ConfigService,
  ) {}

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error_description') error: string,
    @Res() res: Response,
  ) {
    const target = `${this.config.get('PUBLIC_WEB_URL') || 'http://localhost:3000'}/dashboard/fanpage`;
    if (error || !code) return res.redirect(`${target}?error=${encodeURIComponent(error || 'Kết nối bị huỷ')}`);
    try {
      await this.connections.completeOAuth(code, state);
      return res.redirect(`${target}?connected=1`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Kết nối thất bại';
      return res.redirect(`${target}?error=${encodeURIComponent(message)}`);
    }
  }
}

@UseGuards(JwtOrApiKeyGuard)
@Roles(UserRole.USER)
@Controller('social')
export class SocialController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly media: MediaService,
    private readonly posts: PostsService,
    private readonly pagePostsService: PagePostsService,
  ) {}

  // ───────────── Kết nối Facebook ─────────────

  @Get('connections')
  listConnections(@Req() req: AuthenticatedRequest) {
    return this.connections.list(req.user.userId);
  }

  @Get('facebook/auth-url')
  authUrl(@Req() req: AuthenticatedRequest) {
    return { url: this.connections.authUrl(req.user.userId) };
  }

  /** Dán token thủ công (dùng khi chưa cấu hình App ID/Secret của Facebook). */
  @Post('facebook/token')
  connectWithToken(@Req() req: AuthenticatedRequest, @Body() body: ConnectTokenDto) {
    return this.connections.connectWithToken(req.user.userId, body.accessToken);
  }

  @Delete('connections/:id')
  async disconnect(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.connections.disconnect(req.user.userId, id);
    return { ok: true };
  }

  // ───────────── Fanpage ─────────────

  @Get('pages')
  pages(@Req() req: AuthenticatedRequest) {
    return this.connections.pages(req.user.userId);
  }

  @Post('pages/refresh')
  refreshPages(@Req() req: AuthenticatedRequest) {
    return this.connections.refreshPages(req.user.userId);
  }

  @Get('pages/:pageId/posts')
  pagePosts(@Req() req: AuthenticatedRequest, @Param('pageId') pageId: string, @Query('after') after?: string) {
    return this.pagePostsService.list(req.user.userId, pageId, after?.slice(0, 500) || undefined);
  }

  @Post('pages/:pageId/posts/:postId/import')
  importPagePost(@Req() req: AuthenticatedRequest, @Param('pageId') pageId: string, @Param('postId') postId: string) {
    return this.pagePostsService.import(req.user.userId, pageId, postId);
  }

  @Delete('pages/:pageId/posts/:postId')
  async removePagePost(@Req() req: AuthenticatedRequest, @Param('pageId') pageId: string, @Param('postId') postId: string) {
    await this.pagePostsService.remove(req.user.userId, pageId, postId);
    return { ok: true };
  }

  // ───────────── Thư viện ảnh ─────────────

  @Get('media')
  listMedia(@Req() req: AuthenticatedRequest) {
    return this.media.list(req.user.userId);
  }

  @Post('media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_UPLOAD_MB * 1024 * 1024, files: 1 } }))
  upload(@Req() req: AuthenticatedRequest, @UploadedFile() file?: { buffer: Buffer }) {
    if (!file) throw new BadRequestException('Chưa chọn ảnh để tải lên');
    return this.media.store(req.user.userId, file.buffer, { source: 'UPLOAD' });
  }

  /** Lưu ảnh sản phẩm (link ngoài) vào thư viện để đăng lên Page. */
  @Post('media/from-url')
  importImage(@Req() req: AuthenticatedRequest, @Body() body: ImportImageDto) {
    return this.media.importFromUrl(req.user.userId, body.url, body.productId);
  }

  @Get('media/:id/file')
  async mediaFile(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Res() res: Response) {
    const asset = await this.media.find(req.user.userId, id);
    res.setHeader('Content-Type', asset.mimeType);
    // id ảnh không bao giờ đổi nội dung nên cho trình duyệt giữ lâu
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(await this.media.read(asset));
  }

  @Delete('media/:id')
  async removeMedia(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.media.remove(req.user.userId, id);
    return { ok: true };
  }

  // ───────────── Bài viết ─────────────

  @Get('posts')
  listPosts(@Req() req: AuthenticatedRequest, @Query('status') status?: string) {
    return this.posts.list(req.user.userId, status as never);
  }

  @Post('posts')
  createPost(@Req() req: AuthenticatedRequest, @Body() body: SavePostDto) {
    return this.posts.create(req.user.userId, body);
  }

  @Patch('posts/:id')
  updatePost(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: SavePostDto) {
    return this.posts.update(req.user.userId, id, body);
  }

  @Delete('posts/:id')
  async removePost(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.posts.remove(req.user.userId, id);
    return { ok: true };
  }

  @Post('posts/:id/publish')
  publish(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: PublishPostDto) {
    return this.posts.publish(req.user.userId, id, body.scheduledAt ?? null);
  }

  @Post('posts/:id/refresh')
  refreshPost(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.posts.refresh(req.user.userId, id);
  }
}
