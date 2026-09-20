import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { Roles } from '../auth/roles.decorator';
import type { AiActionKind } from '@prisma/client';
import { ActionsService, type ActionActor } from './actions.service';
import { ChatService } from './chat.service';
import {
  ContentService,
  type ContentGoal,
  type ContentTone,
  type ImageAspectRatio,
} from './content.service';
import {
  DraftStoryDto,
  GenerateImageDto,
  ProposeActionDto,
  SendMessageDto,
  WritePostDto,
} from './dto';
import { StoryService } from './story.service';
import type {
  StoryClips,
  StorySetting,
  StoryStyle,
} from '../video/story.prompt';

/** AI viết bài bán hàng và tạo ảnh. Trừ điểm như các tính năng khác (xem bảng giá ở /ai/prices). */
@UseGuards(JwtOrApiKeyGuard)
@Roles(UserRole.USER)
@Controller('ai')
export class AiController {
  constructor(
    private readonly content: ContentService,
    private readonly chat: ChatService,
    private readonly actions: ActionsService,
    private readonly story: StoryService,
  ) {}

  /** Người dùng bấm nút trên web: nguồn UI, luôn có quyền thực hiện trên dữ liệu của chính mình. */
  private actor(req: AuthenticatedRequest): ActionActor {
    return { userId: req.user.userId, source: 'UI', canWrite: true };
  }

  @Get('prices')
  prices() {
    return this.content.prices();
  }

  @Post('write-post')
  writePost(@Req() req: AuthenticatedRequest, @Body() body: WritePostDto) {
    return this.content.writePost(req.user.userId, {
      ...body,
      tone: body.tone as ContentTone,
      goal: body.goal as ContentGoal,
    });
  }

  @Post('generate-image')
  generateImage(
    @Req() req: AuthenticatedRequest,
    @Body() body: GenerateImageDto,
  ) {
    return this.content.generateImage(req.user.userId, {
      ...body,
      aspectRatio: body.aspectRatio as ImageAspectRatio,
    });
  }

  // ───────────── Video kể chuyện: bước 1, viết kịch bản để người dùng duyệt ─────────────

  /** Danh sách phong cách kể chuyện và bối cảnh quay cho giao diện. */
  @Get('story/options')
  storyOptions() {
    return this.story.options();
  }

  /** AI viết kịch bản. Chưa dựng video — người dùng sửa xong mới gọi POST /video/story. */
  @Post('story/script')
  draftStory(@Req() req: AuthenticatedRequest, @Body() body: DraftStoryDto) {
    return this.story.draft(req.user.userId, {
      ...body,
      style: body.style as StoryStyle,
      clips: body.clips as StoryClips,
      setting: body.setting as StorySetting | undefined,
    });
  }

  // ───────────── Trợ lý AI ─────────────

  @Get('conversations')
  listConversations(@Req() req: AuthenticatedRequest) {
    return this.chat.listConversations(req.user.userId);
  }

  @Post('conversations')
  createConversation(@Req() req: AuthenticatedRequest) {
    return this.chat.createConversation(req.user.userId);
  }

  @Get('conversations/:id')
  conversation(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.chat.detail(req.user.userId, id);
  }

  @Delete('conversations/:id')
  async removeConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    await this.chat.remove(req.user.userId, id);
    return { ok: true };
  }

  @Post('conversations/:id/messages')
  send(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.chat.send(req.user.userId, id, body.message);
  }

  // ───────────── Đề xuất chờ xác nhận ─────────────

  @Get('actions')
  listActions(@Req() req: AuthenticatedRequest) {
    return this.actions.list(req.user.userId);
  }

  @Post('actions')
  propose(@Req() req: AuthenticatedRequest, @Body() body: ProposeActionDto) {
    return this.actions.propose(
      this.actor(req),
      body.kind as AiActionKind,
      body.params ?? {},
    );
  }

  @Post('actions/:id/confirm')
  confirm(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.actions.confirm(this.actor(req), id);
  }

  @Post('actions/:id/cancel')
  cancel(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.actions.cancel(this.actor(req), id);
  }
}
