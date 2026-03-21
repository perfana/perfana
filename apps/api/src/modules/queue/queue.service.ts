import { Inject, Injectable } from '@nestjs/common';
import { Queue, Job, JobsOptions } from 'bullmq';

@Injectable()
export class QueueService {
  constructor(@Inject('BULL_QUEUE') private readonly queue: Queue) {}

  async sendJob(
    jobName: string,
    data: any,
    options: JobsOptions = {}
  ): Promise<string> {
    const job = await this.queue.add(jobName, data, options);
    return job.id!;
  }

  async getJobById(jobId: string): Promise<Job | undefined> {
    return this.queue.getJob(jobId);
  }

  async cancel(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  async retry(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.retry();
    }
  }

  async getJobs(status: 'completed' | 'failed' | 'delayed' | 'active' | 'waiting' = 'waiting'): Promise<Job[]> {
    return this.queue.getJobs([status]);
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