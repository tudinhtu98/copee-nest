import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsService } from './settings.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
