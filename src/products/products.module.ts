import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { BillingModule } from '../billing/billing.module';
import { UploadModule } from '../upload/upload.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [BillingModule, UploadModule, ApiKeysModule, AuthModule],
  providers: [ProductsService],
  controllers: [ProductsController],
})
export class ProductsModule {}
