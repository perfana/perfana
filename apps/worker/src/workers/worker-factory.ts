/**
 * Enhanced Worker Factory with monitoring and resource management
 * Based on BULLMQ_EXTERNAL_INTEGRATION.md specifications
 */

/**
 * DEPRECATED: This is the old complex worker factory
 * Use simple-worker-factory.ts for the new simplified system
 */

import { Worker, Job, JobsOptions as _JobsOptions } from 'bullmq';
import { QUEUE_CONFIGURATIONS as _QUEUE_CONFIGURATIONS, getQueueConfig, QueueType } from '../config/queues.js';
import { ENHANCED_JOB_CONFIGS, EnhancedJobOptions as _EnhancedJobOptions } from '../types/jobs.js';
import { getLogger } from '../lib/utils/logger.js';
import os from 'os';
import { EventEmitter } from 'events';

const logger = getLogger('worker-factory');

export interface WorkerMetrics {
  jobsCompleted: number;
  jobsFailed: number;
  jobsActive: number;
  averageProcessingTime: number;
  memoryUsage: number;
  cpuUsage: number;
  lastUpdated: Date;
}

export interface WorkerConfig {
  queueName: string;
  workerName?: string;
  jobHandler: (job: Job) => Promise<any>;  // Removed database parameter
  jobNames?: string[]; // ADDED: Specific job names this worker should process
  concurrency?: number;
  rateLimiter?: {
    max: number;
    duration: number;
  };
  enableMetrics?: boolean;
  resourceMonitoring?: boolean;
}

export class EnhancedWorker extends EventEmitter {
  private worker!: Worker;  // Will be initialized in initializeWorker()
  private metrics: WorkerMetrics;
  private metricsInterval: NodeJS.Timeout | null = null;
  private jobStartTimes: Map<string, number> = new Map();

  constructor(
    private config: WorkerConfig
  ) {
    super();

    this.metrics = {
      jobsCompleted: 0,
      jobsFailed: 0,
      jobsActive: 0,
      averageProcessingTime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      lastUpdated: new Date()
    };

    // Initialize worker asynchronously - will be called by factory
    // this.initializeWorker() will be called explicitly
  }

  /**
   * Initialize worker with separate Redis instances for instant job pickup
   * CRITICAL: BullMQ requires actual IORedis instances (not options) for both
   * connection and blockingConnection to enable BRPOPLPUSH for instant pickup.
   * Without blockingConnection, workers fall back to 30s polling interval.
   */
  public async initializeWorker(): Promise<void> {
    try {
      // Import Redis and get minimal config for BullMQ
      const Redis = (await import('ioredis')).default;
      const { getConfig } = await import('../config/environment.js');
      const env = getConfig();

      // CRITICAL: BullMQ requires minimal, clean Redis configuration
      // DO NOT include extra options like commandTimeout, connectTimeout, etc.
      // These can interfere with BullMQ's blocking mode (BRPOPLPUSH)
      const bullmqConfig = {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD || undefined,
        db: env.REDIS_DB,
        maxRetriesPerRequest: null,   // critical for BullMQ
        enableReadyCheck: false        // recommended for BullMQ
      };

      // Create two separate Redis instances for BullMQ
      // Connection for normal commands, blockingConnection for instant job pickup
      const connection = new Redis(bullmqConfig);
      const blockingConnection = new Redis(bullmqConfig);

      // Wait for connections to be ready
      await connection.ping();
      await blockingConnection.ping();

      logger.info(`Redis connections ready for queue ${this.config.queueName}`, {
        connectionStatus: connection.status,
        blockingConnectionStatus: blockingConnection.status
      });

      const queueConfig = getQueueConfig(this.config.queueName as QueueType);

      this.worker = new Worker(
        this.config.queueName,
        this.createJobProcessor(),
        {
          connection: connection as any,              // Regular connection for commands
          blockingConnection: blockingConnection as any,      // Separate instance for BRPOPLPUSH (instant pickup)
          concurrency: this.config.concurrency || queueConfig?.concurrency || 1,
          // limiter: this.config.rateLimiter || queueConfig?.rateLimiter,  // DISABLED: Breaks blocking mode
          prefix: 'bull',
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 25 },
          lockDuration: 300000,  // 5 minutes - give jobs time to complete
          lockRenewTime: 30000,   // Renew lock every 30 seconds
          settings: {
            drainDelay: 100,       // CRITICAL: Must be > 50ms to enable blocking mode (BRPOPLPUSH)
            stalledInterval: 5000  // Check for stalled jobs every 5s
          } as any
        }
      );

      // Setup event listeners after worker creation
      this.setupEventListeners();

      if (this.config.enableMetrics) {
        this.startMetricsCollection();
      }

      logger.info(`Enhanced worker initialized with blocking connection for queue: ${this.config.queueName}`, {
        concurrency: this.config.concurrency || queueConfig?.concurrency || 1,
        enableMetrics: this.config.enableMetrics,
        resourceMonitoring: this.config.resourceMonitoring
      });
    } catch (error) {
      logger.error(`Failed to initialize worker for queue ${this.config.queueName}:`, error);
      throw error;
    }
  }

  /**
   * Create job processor with enhanced error handling and monitoring
   */
  private createJobProcessor() {
    return async (job: Job) => {
      const startTime = Date.now();
      const jobId = job.id!;
      const timingBreakdown = {
        validation: 0,
        execution: 0,
        total: 0
      };

      try {
        // Record job start time
        this.jobStartTimes.set(jobId, startTime);
        this.metrics.jobsActive++;

        // CRITICAL: Check if this worker should process this job name
        if (this.config.jobNames && this.config.jobNames.length > 0) {
          if (!this.config.jobNames.includes(job.name || '')) {
            logger.debug(`Skipping job ${jobId} with name "${job.name}" - not in worker's job list [${this.config.jobNames.join(', ')}]`);
            // Return success to remove from queue, but don't process
            return { skipped: true, reason: 'wrong-job-name', jobName: job.name };
          }
        }

        // Log job start with context
        logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 JOB STARTED: ${job.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Job ID: ${jobId}
   Queue: ${this.config.queueName}
   Worker: ${this.config.workerName || 'unknown'}
   Attempt: ${job.attemptsMade + 1}
   Started: ${new Date(startTime).toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`, { jobId, queueName: this.config.queueName, workerName: this.config.workerName, data: job.data, attempts: job.attemptsMade });

        // Resource validation before job execution
        const validationStart = Date.now();
        await this.validateResourceRequirements(job);
        timingBreakdown.validation = Date.now() - validationStart;

        // Execute job with timeout handling
        const executionStart = Date.now();
        const result = await this.executeJobWithTimeout(job);
        timingBreakdown.execution = Date.now() - executionStart;
        timingBreakdown.total = Date.now() - startTime;

        // Update metrics on success
        this.updateMetricsOnSuccess(timingBreakdown.total);

        // Log successful completion with timing breakdown
        logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ JOB COMPLETED: ${job.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Job ID: ${jobId}
   Queue: ${this.config.queueName}

   ⏱️  TIMING BREAKDOWN:
      • Validation:  ${timingBreakdown.validation.toString().padStart(8)}ms
      • Execution:   ${timingBreakdown.execution.toString().padStart(8)}ms
      • Total:       ${timingBreakdown.total.toString().padStart(8)}ms

   📊 Result: ${typeof result === 'object' ? JSON.stringify(result).substring(0, 150) + '...' : result}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`, {
          jobId,
          queueName: this.config.queueName,
          timingBreakdown,
          result
        });

        // Emit success event
        this.emit('jobCompleted', {
          jobId,
          jobName: job.name,
          queueName: this.config.queueName,
          processingTime: timingBreakdown.total,
          timingBreakdown,
          result
        });

        return result;

      } catch (error) {
        // Update metrics on failure
        timingBreakdown.total = Date.now() - startTime;
        this.updateMetricsOnFailure(timingBreakdown.total);

        // Enhanced error logging with classification
        const errorInfo = this.classifyError(error);
        logger.error(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ JOB FAILED: ${job.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Job ID: ${jobId}
   Queue: ${this.config.queueName}
   Attempt: ${job.attemptsMade + 1}

   ⏱️  Duration: ${timingBreakdown.total}ms

   🔴 Error: ${errorInfo.type}
      Message: ${errorInfo.message}
      Severity: ${errorInfo.severity}
      Retryable: ${errorInfo.retryable}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`, {
          jobId,
          queueName: this.config.queueName,
          error: errorInfo,
          processingTimeMs: timingBreakdown.total,
          attempts: job.attemptsMade,
          data: job.data,
          timingBreakdown
        });

        // Emit failure event
        this.emit('jobFailed', {
          jobId,
          jobName: job.name,
          queueName: this.config.queueName,
          error: errorInfo,
          processingTime: timingBreakdown.total,
          timingBreakdown,
          attempts: job.attemptsMade
        });

        throw error;

      } finally {
        // Cleanup
        this.jobStartTimes.delete(jobId);
        this.metrics.jobsActive = Math.max(0, this.metrics.jobsActive - 1);
        this.metrics.lastUpdated = new Date();
      }
    };
  }

  /**
   * Execute job with timeout handling
   */
  private async executeJobWithTimeout(job: Job): Promise<any> {
    const jobConfig = ENHANCED_JOB_CONFIGS[job.name];
    const timeout = jobConfig?.timeout || 300000; // Default 5 minutes

    logger.info(`executeJobWithTimeout called for ${job.name}`, {
      hasHandler: !!this.config.jobHandler,
      jobData: job.data
    });

    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Job timeout after ${timeout}ms`));
      }, timeout);

      try {
        logger.info(`About to call job handler for ${job.name}`);
        const result = await this.config.jobHandler(job);
        logger.info(`Job handler completed for ${job.name}`, { result });
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        logger.error(`Job handler error for ${job.name}`, error);
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Validate resource requirements before job execution
   */
  private async validateResourceRequirements(job: Job): Promise<void> {
    if (!this.config.resourceMonitoring) {
      return;
    }

    const jobConfig = ENHANCED_JOB_CONFIGS[job.name];
    if (!jobConfig?.resource_requirements) {
      return;
    }

    const requirements = jobConfig.resource_requirements;
    const systemInfo = {
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      cpuCores: os.cpus().length,
      loadAverage: os.loadavg()[0]
    };

    // Memory check
    if (requirements.memory_mb > systemInfo.freeMemoryMB) {
      logger.warn(`Insufficient memory for job ${job.name}`, {
        required: requirements.memory_mb,
        available: systemInfo.freeMemoryMB,
        jobId: job.id
      });
    }

    // CPU load check (simple heuristic)
    const cpuLoadRatio = systemInfo.loadAverage / systemInfo.cpuCores;
    if (requirements.cpu_cores > 1 && cpuLoadRatio > 0.8) {
      logger.warn(`High CPU load for job ${job.name}`, {
        loadAverage: systemInfo.loadAverage,
        cpuCores: systemInfo.cpuCores,
        loadRatio: cpuLoadRatio,
        jobId: job.id
      });
    }
  }

  /**
   * Setup comprehensive event listeners
   */
  private setupEventListeners(): void {
    this.worker.on('ready', () => {
      logger.info(`Worker ready: ${this.config.queueName}`);
      this.emit('ready', this.config.queueName);
    });

    this.worker.on('error', (error) => {
      // Filter out Redis timeout errors from BullMQ polling - these are normal
      if (error.message?.includes('Command timed out')) {
        logger.debug(`Worker polling timeout: ${this.config.queueName} (normal behavior)`);
        return;
      }

      logger.error(`Worker error: ${this.config.queueName}`, error);
      this.emit('error', error);
    });

    this.worker.on('failed', (job, error) => {
      logger.error(`Job failed in worker: ${this.config.queueName}`, {
        jobId: job?.id,
        jobName: job?.name,
        error: error.message
      });
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn(`Job stalled: ${jobId} in queue: ${this.config.queueName}`);
    });

    this.worker.on('progress', (job, progress) => {
      logger.debug(`Job progress: ${job.name}`, {
        jobId: job.id,
        progress: `${progress}%`
      });
    });
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.emit('metrics', this.getMetrics());
    }, 10000); // Collect every 10 seconds
  }

  /**
   * Collect system-level metrics
   */
  private collectSystemMetrics(): void {
    this.metrics.memoryUsage = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
    this.metrics.cpuUsage = os.loadavg()[0];
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Update metrics on successful job completion
   */
  private updateMetricsOnSuccess(processingTime: number): void {
    this.metrics.jobsCompleted++;

    // Calculate rolling average processing time
    const totalJobs = this.metrics.jobsCompleted;
    this.metrics.averageProcessingTime =
      (this.metrics.averageProcessingTime * (totalJobs - 1) + processingTime) / totalJobs;
  }

  /**
   * Update metrics on job failure
   */
  private updateMetricsOnFailure(_processingTime: number): void {
    this.metrics.jobsFailed++;
  }

  /**
   * Classify errors for better monitoring and debugging
   */
  private classifyError(error: any): {
    type: string;
    message: string;
    code?: string;
    retryable: boolean;
    severity: 'low' | 'medium' | 'high' | 'critical';
  } {
    if (error.message?.includes('timeout')) {
      return {
        type: 'TIMEOUT_ERROR',
        message: error.message,
        retryable: true,
        severity: 'medium'
      };
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return {
        type: 'CONNECTION_ERROR',
        message: error.message,
        code: error.code,
        retryable: true,
        severity: 'high'
      };
    }

    if (error.message?.includes('validation')) {
      return {
        type: 'VALIDATION_ERROR',
        message: error.message,
        retryable: false,
        severity: 'medium'
      };
    }

    if (error.code?.startsWith('23')) { // PostgreSQL constraint violations
      return {
        type: 'DATABASE_CONSTRAINT_ERROR',
        message: error.message,
        code: error.code,
        retryable: false,
        severity: 'high'
      };
    }

    // Default classification
    return {
      type: 'UNKNOWN_ERROR',
      message: error.message || String(error),
      retryable: true,
      severity: 'medium'
    };
  }

  /**
   * Get current worker metrics
   */
  getMetrics(): WorkerMetrics {
    return { ...this.metrics };
  }

  /**
   * Get worker status information
   */
  getStatus(): {
    queueName: string;
    isRunning: boolean;
    metrics: WorkerMetrics;
    activeJobs: number;
    concurrency: number;
  } {
    return {
      queueName: this.config.queueName,
      isRunning: !this.worker.closing,
      metrics: this.getMetrics(),
      activeJobs: this.jobStartTimes.size,
      concurrency: this.worker.concurrency
    };
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    await this.worker.pause();
    logger.info(`Worker paused: ${this.config.queueName}`);
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume();
    logger.info(`Worker resumed: ${this.config.queueName}`);
  }

  /**
   * Gracefully close the worker
   */
  async close(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    try {
      // BullMQ will handle closing its own Redis connections
      await this.worker.close();

      logger.info(`Worker closed: ${this.config.queueName}`);
    } catch (error) {
      logger.error(`Error closing worker: ${this.config.queueName}`, error);
      throw error;
    }
  }
}

/**
 * Worker factory for creating enhanced workers
 */
export class WorkerFactory {
  private workers: Map<string, EnhancedWorker> = new Map();

  constructor() {
    // No longer needs database - workers use TypeORM via NestJS
  }

  /**
   * Create an enhanced worker
   */
  async createWorker(config: WorkerConfig & { workerName?: string }): Promise<EnhancedWorker> {
    const workerKey = config.workerName || config.queueName;

    if (this.workers.has(workerKey)) {
      throw new Error(`Worker already exists for key: ${workerKey}`);
    }

    const worker = new EnhancedWorker(config);

    // Initialize worker with pooled Redis connection
    await worker.initializeWorker();

    this.workers.set(workerKey, worker);

    logger.info(`Worker created and registered: ${workerKey} (queue: ${config.queueName})`);
    return worker;
  }

  /**
   * Get a worker by queue name
   */
  getWorker(queueName: string): EnhancedWorker | undefined {
    return this.workers.get(queueName);
  }

  /**
   * Get all workers
   */
  getAllWorkers(): EnhancedWorker[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get aggregated metrics from all workers
   */
  getAggregatedMetrics(): {
    totalWorkers: number;
    totalJobsCompleted: number;
    totalJobsFailed: number;
    totalJobsActive: number;
    averageProcessingTime: number;
    systemMemoryUsage: number;
    systemCpuUsage: number;
  } {
    const workers = this.getAllWorkers();

    return workers.reduce((acc, worker) => {
      const metrics = worker.getMetrics();
      return {
        totalWorkers: acc.totalWorkers + 1,
        totalJobsCompleted: acc.totalJobsCompleted + metrics.jobsCompleted,
        totalJobsFailed: acc.totalJobsFailed + metrics.jobsFailed,
        totalJobsActive: acc.totalJobsActive + metrics.jobsActive,
        averageProcessingTime: (acc.averageProcessingTime + metrics.averageProcessingTime) / 2,
        systemMemoryUsage: Math.max(acc.systemMemoryUsage, metrics.memoryUsage),
        systemCpuUsage: Math.max(acc.systemCpuUsage, metrics.cpuUsage)
      };
    }, {
      totalWorkers: 0,
      totalJobsCompleted: 0,
      totalJobsFailed: 0,
      totalJobsActive: 0,
      averageProcessingTime: 0,
      systemMemoryUsage: 0,
      systemCpuUsage: 0
    });
  }

  /**
   * Pause all workers
   */
  async pauseAll(): Promise<void> {
    const pausePromises = this.getAllWorkers().map(worker => worker.pause());
    await Promise.all(pausePromises);
    logger.info('All workers paused');
  }

  /**
   * Resume all workers
   */
  async resumeAll(): Promise<void> {
    const resumePromises = this.getAllWorkers().map(worker => worker.resume());
    await Promise.all(resumePromises);
    logger.info('All workers resumed');
  }

  /**
   * Close all workers
   */
  async closeAll(): Promise<void> {
    const closePromises = this.getAllWorkers().map(worker => worker.close());
    await Promise.allSettled(closePromises);
    this.workers.clear();
    logger.info('All workers closed');
  }
}

// Global worker factory instance
let workerFactoryInstance: WorkerFactory | null = null;

export function getWorkerFactory(): WorkerFactory {
  if (!workerFactoryInstance) {
    workerFactoryInstance = new WorkerFactory();
  }
  return workerFactoryInstance;
}

export async function closeWorkerFactory(): Promise<void> {
  if (workerFactoryInstance) {
    await workerFactoryInstance.closeAll();
    workerFactoryInstance = null;
  }
}