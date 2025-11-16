import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { BillingModule } from '../billing/billing.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [BillingModule, UploadModule],
  providers: [ProductsService],
  controllers: [ProductsController],
})
export class ProductsModule {}
