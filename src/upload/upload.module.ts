import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UploadProcessor } from './upload.processor';
import { UploadService } from './upload.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'upload',
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600, // 1 hour
          count: 1000,
        },
        removeOnFail: {
          age: 86400, // 24 hours
        },
      },
    }),
    PrismaModule,
    BillingModule,
  ],
  providers: [UploadProcessor, UploadService],
  exports: [UploadService],
})
export class UploadModule {}

