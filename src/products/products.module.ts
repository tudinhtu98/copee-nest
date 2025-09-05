import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  providers: [ProductsService],
  controllers: [ProductsController],
})
export class ProductsModule {}
