import { Inject, Injectable } from '@nestjs/common';
import { Queue, JobsOptions } from 'bullmq';

@Injectable()
export class QueueService {
  constructor(@Inject('BULL_QUEUE') private readonly queue: Queue) {}

  async sendJob(
    jobName: string,
    data: any,
    options: JobsOptions = {}
  ): Promise<string> {
    const job = await this.queue.add(jobName, data, options);
    if (!job.id) throw new Error('BullMQ failed to assign job ID');
    return job.id;
  }

  async getJobCounts(): Promise<{ waiting: number; active: number; completed: number; failed: number; delayed: number }> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
  }
}
