import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [BillingModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
