import { Module } from '@nestjs/common';
import { VideoModule } from '../video/video.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { VideoBotService } from './video-bot.service';
import { VideoBotController } from './video-bot.controller';

@Module({
  imports: [VideoModule, ApiKeysModule, AuthModule],
  controllers: [VideoBotController],
  providers: [VideoBotService],
})
export class VideoBotModule {}
