import { Module } from '@nestjs/common';
import { ShopeeController } from './shopee.controller';
import { ShopeeService } from './shopee.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ApiKeysModule, AuthModule],
  providers: [ShopeeService],
  controllers: [ShopeeController],
  exports: [ShopeeService],
})
export class ShopeeModule {}
