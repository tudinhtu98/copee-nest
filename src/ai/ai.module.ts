import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { SocialModule } from '../social/social.module';
import { VideoModule } from '../video/video.module';
import { ActionsService } from './actions.service';
import { AiController } from './ai.controller';
import { ChatService } from './chat.service';
import { ContentService } from './content.service';
import { GeminiClient } from './gemini.client';
import { McpController } from './mcp.controller';
import { PointsService } from './points.service';
import { StoryService } from './story.service';
import { AiToolsService } from './tools';

/**
 * Trợ lý AI: viết bài, tạo ảnh, chat có công cụ, lớp đề xuất → xác nhận, và MCP server
 * cho agent bên ngoài. Dùng lại VideoModule / ProductsModule / SocialModule sẵn có.
 */
@Module({
  imports: [
    AuthModule,
    ApiKeysModule,
    SettingsModule,
    SocialModule,
    VideoModule,
    ProductsModule,
    BillingModule,
  ],
  providers: [
    GeminiClient,
    PointsService,
    ContentService,
    ActionsService,
    AiToolsService,
    ChatService,
    StoryService,
  ],
  controllers: [AiController, McpController],
  exports: [
    GeminiClient,
    PointsService,
    ContentService,
    ActionsService,
    AiToolsService,
    StoryService,
  ],
})
export class AiModule {}
