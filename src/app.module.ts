import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { SitesModule } from './sites/sites.module';
import { BillingModule } from './billing/billing.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [AuthModule, UsersModule, ProductsModule, SitesModule, BillingModule, AdminModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
