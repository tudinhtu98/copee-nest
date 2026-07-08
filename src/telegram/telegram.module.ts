import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { VideoModule } from '../video/video.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [BillingModule, VideoModule, ApiKeysModule, AuthModule],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
