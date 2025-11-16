import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class UploadService {
  constructor(
    @InjectQueue('upload') private uploadQueue: Queue,
  ) {}

  async addUploadJob(data: {
    jobId: string;
    productId: string;
    siteId: string;
    targetCategory?: string;
    userId: string;
  }) {
    return this.uploadQueue.add('upload-product', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 1000, // Keep last 1000 completed jobs
      },
      removeOnFail: {
        age: 86400, // Keep failed jobs for 24 hours
      },
    });
  }

  async addBulkUploadJobs(jobs: Array<{
    jobId: string;
    productId: string;
    siteId: string;
    targetCategory?: string;
    userId: string;
  }>) {
    // Configure concurrency: process up to 5 jobs in parallel
    // This can be adjusted based on server capacity and WooCommerce API limits
    return this.uploadQueue.addBulk(
      jobs.map((job) => ({
        name: 'upload-product',
        data: job,
        opts: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: {
            age: 3600,
            count: 1000,
          },
          removeOnFail: {
            age: 86400,
          },
        },
      })),
    );
  }

  async getJobStatus(jobId: string) {
    const job = await this.uploadQueue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress;
    const returnValue = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      id: job.id,
      state,
      progress,
      returnValue,
      failedReason,
      data: job.data,
    };
  }
}

