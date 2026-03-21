/**
 * Job status and monitoring APIs for external integration
 * Based on BULLMQ_EXTERNAL_INTEGRATION.md specifications
 */

import { Queue, QueueEvents, Job } from 'bullmq';
import { EventEmitter } from 'events';
import { createRedisConnection } from '../config/redis.js';
import { QUEUE_TYPES, getQueueForJob as _getQueueForJob } from '../config/queues.js';
import { getWorkerFactory } from '../workers/worker-factory.js';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('monitoring-api');

export interface JobStatus {
  id: string;
  name: string;
  queueName: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
  progress: number;
  data: Record<string, any>;
  result?: any;
  error?: string;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  attemptsMade: number;
  attemptsTotal: number;
  delay: number;
  timestamp: number;
}

export interface QueueStats {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  totalJobs: number;
  throughputPerHour: number;
  avgProcessingTime: number;
}

export interface SystemStats {
  queues: QueueStats[];
  workers: {
    queueName: string;
    isRunning: boolean;
    concurrency: number;
    jobsCompleted: number;
    jobsFailed: number;
    jobsActive: number;
    averageProcessingTime: number;
    memoryUsage: number;
    cpuUsage: number;
  }[];
  system: {
    totalMemoryMB: number;
    freeMemoryMB: number;
    cpuCores: number;
    loadAverage: number[];
    uptime: number;
  };
}

export interface FlowStatus {
  flowId: string;
  name: string;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  progress: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  activeJobs: number;
  jobs: JobStatus[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export class MonitoringAPI extends EventEmitter {
  private redis: any;
  private queues: Map<string, Queue> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();
  private statsCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor() {
    super();
    this.redis = createRedisConnection();
    this.initializeQueues();
  }

  /**
   * Initialize queue monitoring for all queue types
   */
  private async initializeQueues(): Promise<void> {
    for (const queueType of Object.values(QUEUE_TYPES)) {
      try {
        // Create Queue instance for monitoring
        const queue = new Queue(queueType, {
          connection: this.redis,
          prefix: 'bull'
        });

        this.queues.set(queueType, queue);

        // Create QueueEvents for real-time monitoring
        const queueEvents = new QueueEvents(queueType, {
          connection: this.redis,
          prefix: 'bull'
        });

        this.queueEvents.set(queueType, queueEvents);

        // Setup event listeners
        this.setupQueueEventListeners(queueType, queueEvents);

        logger.info(`Queue monitoring initialized: ${queueType}`);

      } catch (error) {
        logger.error(`Failed to initialize monitoring for queue ${queueType}:`, error);
      }
    }
  }

  /**
   * Setup event listeners for real-time monitoring
   */
  private setupQueueEventListeners(queueName: string, queueEvents: QueueEvents): void {
    queueEvents.on('waiting', ({ jobId }) => {
      this.emit('jobWaiting', { queueName, jobId });
    });

    queueEvents.on('active', ({ jobId, prev }) => {
      this.emit('jobActive', { queueName, jobId, prev });
    });

    queueEvents.on('completed', ({ jobId, returnvalue, prev }) => {
      this.emit('jobCompleted', { queueName, jobId, returnvalue, prev });
    });

    queueEvents.on('failed', ({ jobId, failedReason, prev }) => {
      this.emit('jobFailed', { queueName, jobId, failedReason, prev });
    });

    queueEvents.on('progress', ({ jobId, data }) => {
      this.emit('jobProgress', { queueName, jobId, progress: data });
    });

    queueEvents.on('stalled', ({ jobId }) => {
      this.emit('jobStalled', { queueName, jobId });
    });
  }

  /**
   * Get status of a specific job
   */
  async getJobStatus(jobId: string, queueName?: string): Promise<JobStatus | null> {
    try {
      // If queue name not provided, search all queues
      const queuesToSearch = queueName
        ? [this.queues.get(queueName)]
        : Array.from(this.queues.values());

      for (const queue of queuesToSearch) {
        if (!queue) {continue;}

        const job = await queue.getJob(jobId);
        if (job) {
          return await this.formatJobStatus(job);
        }
      }

      return null;
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}:`, error);
      return null;
    }
  }

  /**
   * Get jobs by status from a specific queue
   */
  async getJobsByStatus(
    queueName: string,
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused',
    start = 0,
    end = 99
  ): Promise<JobStatus[]> {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        throw new Error(`Queue not found: ${queueName}`);
      }

      const jobs = await queue.getJobs([status], start, end);
      return await Promise.all(jobs.map(job => this.formatJobStatus(job)));

    } catch (error) {
      logger.error(`Error getting jobs by status for queue ${queueName}:`, error);
      return [];
    }
  }

  /**
   * Get comprehensive queue statistics
   */
  async getQueueStats(queueName: string): Promise<QueueStats | null> {
    try {
      const cacheKey = `queue-stats-${queueName}`;
      const cached = this.getCachedData(cacheKey);
      if (cached) {return cached;}

      const queue = this.queues.get(queueName);
      if (!queue) {
        throw new Error(`Queue not found: ${queueName}`);
      }

      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();
      const delayed = await queue.getDelayed();

      // Calculate throughput (jobs completed in last hour)
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const recentCompleted = completed.filter(job =>
        job.processedOn && job.processedOn > oneHourAgo
      );

      // Calculate average processing time
      const completedWithTiming = completed.filter(job =>
        job.processedOn && job.finishedOn
      );

      const avgProcessingTime = completedWithTiming.length > 0
        ? completedWithTiming.reduce((sum, job) =>
            sum + (job.finishedOn! - job.processedOn!), 0
          ) / completedWithTiming.length
        : 0;

      const stats: QueueStats = {
        queueName,
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: 0, // TODO: Implement paused jobs count
        totalJobs: waiting.length + active.length + completed.length + failed.length + delayed.length,
        throughputPerHour: recentCompleted.length,
        avgProcessingTime
      };

      this.setCachedData(cacheKey, stats);
      return stats;

    } catch (error) {
      logger.error(`Error getting queue stats for ${queueName}:`, error);
      return null;
    }
  }

  /**
   * Get system-wide statistics
   */
  async getSystemStats(): Promise<SystemStats> {
    try {
      const cacheKey = 'system-stats';
      const cached = this.getCachedData(cacheKey);
      if (cached) {return cached;}

      // Get queue stats
      const queueStatsPromises = Object.values(QUEUE_TYPES).map(queueName =>
        this.getQueueStats(queueName)
      );

      const queueStats = (await Promise.all(queueStatsPromises))
        .filter((stats): stats is QueueStats => stats !== null);

      // Get worker stats
      const workerFactory = getWorkerFactory();
      const workers = workerFactory.getAllWorkers();

      const workerStats = workers.map(worker => {
        const status = worker.getStatus();
        const metrics = worker.getMetrics();

        return {
          queueName: status.queueName,
          isRunning: status.isRunning,
          concurrency: status.concurrency,
          jobsCompleted: metrics.jobsCompleted,
          jobsFailed: metrics.jobsFailed,
          jobsActive: metrics.jobsActive,
          averageProcessingTime: metrics.averageProcessingTime,
          memoryUsage: metrics.memoryUsage,
          cpuUsage: metrics.cpuUsage
        };
      });

      // Get system stats
      const os = await import('os');
      const systemStats: SystemStats = {
        queues: queueStats,
        workers: workerStats,
        system: {
          totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
          freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
          cpuCores: os.cpus().length,
          loadAverage: os.loadavg(),
          uptime: Math.round(os.uptime())
        }
      };

      this.setCachedData(cacheKey, systemStats);
      return systemStats;

    } catch (error) {
      logger.error('Error getting system stats:', error);
      throw error;
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string, queueName?: string): Promise<boolean> {
    try {
      const queuesToSearch = queueName
        ? [this.queues.get(queueName)]
        : Array.from(this.queues.values());

      for (const queue of queuesToSearch) {
        if (!queue) {continue;}

        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          logger.info(`Job cancelled: ${jobId} from queue ${queue.name}`);
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error(`Error cancelling job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string, queueName?: string): Promise<boolean> {
    try {
      const queuesToSearch = queueName
        ? [this.queues.get(queueName)]
        : Array.from(this.queues.values());

      for (const queue of queuesToSearch) {
        if (!queue) {continue;}

        const job = await queue.getJob(jobId);
        if (job && (await job.isFailed())) {
          await job.retry();
          logger.info(`Job retried: ${jobId} from queue ${queue.name}`);
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error(`Error retrying job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Get flow status (for FlowProducer monitoring)
   */
  async getFlowStatus(flowId: string): Promise<FlowStatus | null> {
    // Implementation would depend on how flows are tracked
    // This is a placeholder for the comprehensive flow monitoring
    logger.debug(`Flow status requested for: ${flowId}`);
    return null;
  }

  /**
   * Format job data for external consumption
   */
  private async formatJobStatus(job: Job): Promise<JobStatus> {
    return {
      id: job.id!,
      name: job.name,
      queueName: job.queueName,
      status: await this.getJobStatusString(job),
      progress: (job.progress as number) || 0,
      data: job.data,
      result: job.returnvalue,
      error: job.failedReason,
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      attemptsMade: job.attemptsMade,
      attemptsTotal: job.opts.attempts || 1,
      delay: job.opts.delay || 0,
      timestamp: job.timestamp
    };
  }

  /**
   * Get job status as string
   */
  private async getJobStatusString(job: Job): Promise<'paused' | 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'> {
    if (await job.isWaiting()) {return 'waiting';}
    if (await job.isActive()) {return 'active';}
    if (await job.isCompleted()) {return 'completed';}
    if (await job.isFailed()) {return 'failed';}
    if (await job.isDelayed()) {return 'delayed';}
    return 'paused';
  }

  /**
   * Cache management
   */
  private getCachedData(key: string): any {
    const cached = this.statsCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCachedData(key: string, data: any): void {
    this.statsCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Close monitoring API and cleanup resources
   */
  async close(): Promise<void> {
    try {
      // Close queue events
      for (const queueEvents of this.queueEvents.values()) {
        await queueEvents.close();
      }

      // Close queues
      for (const queue of this.queues.values()) {
        await queue.close();
      }

      // Disconnect Redis
      await this.redis.disconnect();

      this.queues.clear();
      this.queueEvents.clear();
      this.statsCache.clear();

      logger.info('Monitoring API closed successfully');

    } catch (error) {
      logger.error('Error closing monitoring API:', error);
    }
  }
}

// Global monitoring API instance
let monitoringAPIInstance: MonitoringAPI | null = null;

export function getMonitoringAPI(): MonitoringAPI {
  if (!monitoringAPIInstance) {
    monitoringAPIInstance = new MonitoringAPI();
  }
  return monitoringAPIInstance;
}

export async function closeMonitoringAPI(): Promise<void> {
  if (monitoringAPIInstance) {
    await monitoringAPIInstance.close();
    monitoringAPIInstance = null;
  }
}