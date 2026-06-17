import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { TelegramService } from './telegram.service';

@Module({
  imports: [BillingModule],
  providers: [TelegramService],
})
export class TelegramModule {}
