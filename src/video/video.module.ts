import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { VideoProcessor } from './video.processor';
import { RenderService } from './render.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { ShopeeModule } from '../shopee/shopee.module';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'video',
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86400 },
      },
    }),
    PrismaModule,
    BillingModule,
    ApiKeysModule,
    AuthModule,
    ShopeeModule,
    // Thư viện ảnh: ảnh chân dung cho video kể chuyện nằm chung kho ảnh với bài đăng
    SocialModule,
  ],
  controllers: [VideoController],
  providers: [VideoService, VideoProcessor, RenderService],
  exports: [VideoService],
})
export class VideoModule {}
