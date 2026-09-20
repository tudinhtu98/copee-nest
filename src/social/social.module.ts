import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectionsService } from './connections.service';
import { CryptoService } from './crypto.service';
import { MediaService } from './media.service';
import { MetaClient } from './meta.client';
import { PagePostsService } from './page-posts.service';
import { PostsService } from './posts.service';
import {
  SocialCallbackController,
  SocialController,
} from './social.controller';

/** Kết nối Facebook, quản lý fanpage: thư viện ảnh, soạn / đăng / hẹn giờ bài, bài có sẵn trên Page. */
@Module({
  imports: [AuthModule, ApiKeysModule],
  providers: [
    CryptoService,
    MetaClient,
    ConnectionsService,
    MediaService,
    PostsService,
    PagePostsService,
  ],
  controllers: [SocialCallbackController, SocialController],
  exports: [
    CryptoService,
    MetaClient,
    ConnectionsService,
    MediaService,
    PostsService,
    PagePostsService,
  ],
})
export class SocialModule {}
