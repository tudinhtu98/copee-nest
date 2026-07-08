import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { VideoModule } from '../video/video.module';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [BillingModule, VideoModule],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
