/**
 * pg-boss Mock Helpers
 *
 * Provides mock implementations for pg-boss queue operations during testing
 */

import { vi } from 'vitest';

export interface MockJob {
  id: string;
  name: string;
  data: unknown;
  done: Date | null;
  createdOn: Date;
  startedOn: Date | null;
  completedOn: Date | null;
  retryCount: number;
}

export interface MockPgBoss {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  work: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  getQueueSize: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock pg-boss instance for testing
 */
export function createMockPgBoss(): MockPgBoss {
  const jobs: MockJob[] = [];
  let jobIdCounter = 1;

  const mockBoss: MockPgBoss = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),

    send: vi.fn().mockImplementation(async (name: string, data: unknown, options?: any) => {
      const job: MockJob = {
        id: `job-${jobIdCounter++}`,
        name,
        data,
        done: null,
        createdOn: new Date(),
        startedOn: null,
        completedOn: null,
        retryCount: 0
      };
      jobs.push(job);
      return job.id;
    }),

    work: vi.fn().mockImplementation((name: string, options: any, handler: Function) => {
      // Store the handler for later execution in tests
      return Promise.resolve();
    }),

    complete: vi.fn().mockImplementation(async (jobId: string, data?: unknown) => {
      const job = jobs.find(j => j.id === jobId);
      if (job) {
        job.completedOn = new Date();
        job.done = new Date();
      }
      return job;
    }),

    fail: vi.fn().mockImplementation(async (jobId: string, data?: unknown) => {
      const job = jobs.find(j => j.id === jobId);
      if (job) {
        job.completedOn = new Date();
        job.done = new Date();
      }
      return job;
    }),

    fetch: vi.fn().mockImplementation(async (name: string, batchSize?: number) => {
      const availableJobs = jobs.filter(j => j.name === name && !j.startedOn);
      const fetchCount = batchSize || 1;
      const fetchedJobs = availableJobs.slice(0, fetchCount);

      // Mark as started
      fetchedJobs.forEach(job => {
        job.startedOn = new Date();
      });

      return fetchedJobs.length === 1 ? fetchedJobs[0] || null : fetchedJobs;
    }),

    getQueueSize: vi.fn().mockImplementation(async (name?: string) => {
      if (name) {
        return jobs.filter(j => j.name === name && !j.done).length;
      }
      return jobs.filter(j => !j.done).length;
    }),

    cancel: vi.fn().mockImplementation(async (jobId: string) => {
      const job = jobs.find(j => j.id === jobId);
      if (job && !job.done) {
        job.done = new Date();
        return true;
      }
      return false;
    })
  };

  // Add helper methods to access internal state during testing
  (mockBoss as any)._getJobs = () => jobs;
  (mockBoss as any)._clearJobs = () => jobs.splice(0, jobs.length);
  (mockBoss as any)._findJob = (id: string) => jobs.find(j => j.id === id);

  return mockBoss;
}

/**
 * Create a mock job handler for testing pipeline execution
 */
export function createMockJobHandler(
  result: 'success' | 'error' | 'timeout' = 'success',
  delay: number = 100
) {
  return vi.fn().mockImplementation(async (job: MockJob) => {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, delay));

    switch (result) {
      case 'success':
        return {
          status: 'success',
          message: 'Job completed successfully',
          data: { processedAt: new Date() }
        };
      case 'error':
        throw new Error('Mock job processing error');
      case 'timeout':
        await new Promise(resolve => setTimeout(resolve, 60000)); // Very long delay
        return { status: 'success' };
      default:
        return { status: 'success' };
    }
  });
}

/**
 * Utility to simulate job queue scenarios
 */
export class MockJobQueueScenario {
  private boss: MockPgBoss;
  private handlers: Map<string, Function> = new Map();

  constructor() {
    this.boss = createMockPgBoss();
  }

  registerHandler(jobName: string, handler: Function): void {
    this.handlers.set(jobName, handler);
    this.boss.work.mockImplementation((name: string, options: any, handlerFn: Function) => {
      if (name === jobName) {
        this.handlers.set(name, handlerFn);
      }
      return Promise.resolve();
    });
  }

  async sendJob(jobName: string, data: unknown): Promise<string> {
    return this.boss.send(jobName, data);
  }

  async processJobs(jobName: string, count: number = 1): Promise<any[]> {
    const handler = this.handlers.get(jobName);
    if (!handler) {
      throw new Error(`No handler registered for job: ${jobName}`);
    }

    const jobs = await this.boss.fetch(jobName, count);
    const jobsArray = Array.isArray(jobs) ? jobs : [jobs].filter(Boolean);
    const results = [];

    for (const job of jobsArray) {
      try {
        const result = await handler(job);
        await this.boss.complete(job.id, result);
        results.push({ jobId: job.id, result });
      } catch (error) {
        await this.boss.fail(job.id, error);
        results.push({ jobId: job.id, error });
      }
    }

    return results;
  }

  getBoss(): MockPgBoss {
    return this.boss;
  }

  getJobs(): MockJob[] {
    return (this.boss as any)._getJobs();
  }

  clearJobs(): void {
    (this.boss as any)._clearJobs();
  }
}