import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { ReportGenerationService } from '../services/report-generation.service';
import { PdfGenerationProcessor } from './pdf-generation.processor';

/**
 * Job data for HTML generation
 */
export interface HtmlGenerationJobData {
  reportId: string;
  testRunId: string;
  templateId: string;
  priority?: number;
  initiatedBy?: string;
  timestamp?: string;
}

/**
 * Result from HTML generation job
 */
export interface HtmlGenerationJobResult {
  success: boolean;
  reportId: string;
  generationTimeMs?: number;
  sectionCount?: number;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * Queue name constant for HTML generation
 */
export const HTML_GENERATION_QUEUE_NAME = 'perfana-report-html-generation';

/**
 * BullMQ HTML Generation Processor
 *
 * This processor handles HTML generation jobs for reports using BullMQ.
 * It manages its own Redis connection and worker lifecycle following the
 * patterns established in BullMQClientService.
 *
 * Features:
 * - Graceful degradation in development mode when Redis is unavailable
 * - Automatic retry with exponential backoff
 * - Progress reporting for long-running jobs
 * - Clean shutdown handling
 */
@Injectable()
export class HtmlGenerationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HtmlGenerationProcessor.name);
  private redis: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private isRedisAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly reportGenerationService: ReportGenerationService,
    @Inject(forwardRef(() => PdfGenerationProcessor))
    private readonly pdfGenerationProcessor: PdfGenerationProcessor,
  ) {}

  async onModuleInit() {
    await this.initializeConnections();
  }

  /**
   * Initialize Redis connections and BullMQ queue/worker
   */
  private async initializeConnections(): Promise<void> {
    try {
      const redisUrl = this.configService.get('REDIS_URL', 'redis://localhost:6379');
      const isDevelopment = this.configService.get('NODE_ENV') === 'development';

      this.logger.log(`Connecting to Redis at: ${redisUrl} for HTML generation processor`);

      this.redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null, // Critical for BullMQ
        enableReadyCheck: false, // Recommended for BullMQ
        lazyConnect: true,
        connectTimeout: 10000,
        // No commandTimeout for BullMQ - blocking commands need unlimited time
      });

      this.redis.on('connect', () => {
        this.logger.log('Redis connected for HTML generation processor');
        this.isRedisAvailable = true;
        this.initializeQueueAndWorker();
      });

      this.redis.on('error', (error) => {
        this.logger.warn(`Redis connection error: ${error.message}`);
        this.isRedisAvailable = false;

        if (!isDevelopment) {
          this.logger.error('Redis is required in production mode');
          throw error;
        } else {
          this.logger.warn(
            'Redis unavailable in development mode - HTML generation processor will be disabled',
          );
        }
      });

      this.redis.on('close', () => {
        this.logger.warn('Redis connection closed for HTML generation processor');
        this.isRedisAvailable = false;
      });

      // Try to connect
      try {
        await this.redis.connect();
      } catch (error) {
        if (!isDevelopment) {
          throw error;
        }
        this.logger.warn(
          'Redis connection failed - HTML generation processor will be unavailable in development mode',
        );
      }
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      const isDevelopment = this.configService.get('NODE_ENV') === 'development';

      if (isDevelopment) {
        this.logger.warn(
          `Failed to initialize Redis in development mode: ${errorMessage}`,
        );
        this.logger.warn(
          'HTML generation processing will be unavailable. To enable, start Redis server.',
        );
      } else {
        this.logger.error(
          `Failed to initialize HTML generation processor connections: ${errorMessage}`,
        );
        throw error;
      }
    }
  }

  /**
   * Initialize BullMQ queue and worker
   */
  private initializeQueueAndWorker(): void {
    if (!this.redis || !this.isRedisAvailable) {
      return;
    }

    try {
      // Initialize queue for adding jobs
      this.queue = new Queue(HTML_GENERATION_QUEUE_NAME, {
        connection: this.redis,
        defaultJobOptions: {
          removeOnComplete: 50, // Keep 50 completed jobs for debugging
          removeOnFail: 25, // Keep 25 failed jobs for debugging
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      });

      // Initialize worker for processing jobs
      this.worker = new Worker<HtmlGenerationJobData, HtmlGenerationJobResult>(
        HTML_GENERATION_QUEUE_NAME,
        async (job) => this.processJob(job),
        {
          connection: this.redis,
          concurrency: 3, // Process up to 3 reports concurrently
          limiter: {
            max: 10,
            duration: 60000, // Max 10 jobs per minute
          },
        },
      );

      // Handle worker events
      this.worker.on('ready', () => {
        this.logger.log('HTML generation worker ready');
      });

      this.worker.on('active', (job) => {
        this.logger.debug(`Processing HTML generation job ${job.id} for report ${job.data.reportId}`);
      });

      this.worker.on('completed', (job, result) => {
        if (result.success) {
          this.logger.log(
            `HTML generation completed for report ${job.data.reportId} in ${result.generationTimeMs}ms`,
          );
        } else {
          this.logger.warn(
            `HTML generation failed for report ${job.data.reportId}: ${result.errorMessage}`,
          );
        }
      });

      this.worker.on('failed', (job, error) => {
        this.logger.error(
          `HTML generation job ${job?.id} failed: ${error.message}`,
          error.stack,
        );
      });

      this.worker.on('error', (error) => {
        this.logger.error(`HTML generation worker error: ${error.message}`);
      });

      this.logger.log('HTML generation queue and worker initialized successfully');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.error(`Failed to initialize queue and worker: ${errorMessage}`);
      this.isRedisAvailable = false;
    }
  }

  /**
   * Process a single HTML generation job
   */
  private async processJob(
    job: Job<HtmlGenerationJobData, HtmlGenerationJobResult>,
  ): Promise<HtmlGenerationJobResult> {
    const { reportId } = job.data;
    const startTime = Date.now();

    this.logger.log(`Starting HTML generation for report ${reportId}`);

    try {
      // Update progress - starting
      await job.updateProgress({ stage: 'starting', percent: 0 });

      // Generate HTML using the report generation service
      const result = await this.reportGenerationService.generateHtml(reportId);

      // Update progress - complete
      await job.updateProgress({ stage: 'complete', percent: 100 });

      // Auto-queue PDF generation after successful HTML generation
      try {
        if (this.pdfGenerationProcessor.isAvailable()) {
          const pdfJobId = await this.pdfGenerationProcessor.addJob(reportId, {
            initiatedBy: 'auto-after-html',
          });
          this.logger.log(
            `Auto-queued PDF generation job ${pdfJobId} for report ${reportId}`,
          );
        } else {
          this.logger.warn(
            `PDF generation processor unavailable - skipping auto PDF for report ${reportId}`,
          );
        }
      } catch (pdfError) {
        const pdfMsg =
          pdfError && typeof pdfError === 'object' && 'message' in pdfError
            ? (pdfError as Error).message
            : 'Unknown error';
        this.logger.warn(
          `Failed to auto-queue PDF generation for report ${reportId}: ${pdfMsg}`,
        );
      }

      return {
        success: true,
        reportId,
        generationTimeMs: result.generationTimeMs,
        sectionCount: result.sectionCount,
      };
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      this.logger.error(
        `HTML generation failed for report ${reportId}: ${errorMessage}`,
      );

      // The ReportGenerationService already updates the report status to 'failed'
      // so we just return the error result
      return {
        success: false,
        reportId,
        generationTimeMs: Date.now() - startTime,
        errorMessage,
        errorCode: 'HTML_GENERATION_ERROR',
      };
    }
  }

  /**
   * Check if Redis/BullMQ is available
   */
  isAvailable(): boolean {
    return this.isRedisAvailable && this.queue !== null && this.worker !== null;
  }

  /**
   * Add a new HTML generation job to the queue
   *
   * @param reportId - Report UUID to generate HTML for
   * @param testRunId - Test run UUID
   * @param templateId - Template UUID
   * @param options - Optional job options
   * @returns Job ID
   */
  async addJob(
    reportId: string,
    testRunId: string,
    templateId: string,
    options?: { priority?: number; initiatedBy?: string },
  ): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error(
        'HTML generation processor is not available. Please start Redis server.',
      );
    }

    const jobData: HtmlGenerationJobData = {
      reportId,
      testRunId,
      templateId,
      priority: options?.priority || 1,
      initiatedBy: options?.initiatedBy || 'api',
      timestamp: new Date().toISOString(),
    };

    const job = await this.queue!.add('generate-html', jobData, {
      jobId: `html-gen-${reportId}-${Date.now()}`,
      priority: options?.priority || 1,
    });

    this.logger.log(`Queued HTML generation job ${job.id} for report ${reportId}`);

    return job.id!;
  }

  /**
   * Get job status
   *
   * @param jobId - BullMQ job ID
   * @returns Job status information
   */
  async getJobStatus(jobId: string): Promise<{
    jobId: string;
    status: string;
    progress: unknown;
    result?: HtmlGenerationJobResult;
    failedReason?: string;
  } | null> {
    if (!this.isAvailable()) {
      throw new Error(
        'HTML generation processor is not available. Please start Redis server.',
      );
    }

    const job = await this.queue!.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress;

    return {
      jobId,
      status: state,
      progress: typeof progress === 'object' ? progress : { percent: progress || 0 },
      result: job.returnvalue as HtmlGenerationJobResult | undefined,
      failedReason: job.failedReason,
    };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  } | null> {
    if (!this.isAvailable()) {
      return null;
    }

    const counts = await this.queue!.getJobCounts();

    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
  }

  /**
   * Process a report synchronously (without queue)
   * Useful for immediate generation when Redis is unavailable
   *
   * @param reportId - Report UUID to generate HTML for
   * @returns HTML generation result
   */
  async processSync(reportId: string): Promise<HtmlGenerationJobResult> {
    const startTime = Date.now();

    this.logger.log(`Starting synchronous HTML generation for report ${reportId}`);

    try {
      const result = await this.reportGenerationService.generateHtml(reportId);

      return {
        success: true,
        reportId,
        generationTimeMs: result.generationTimeMs,
        sectionCount: result.sectionCount,
      };
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      return {
        success: false,
        reportId,
        generationTimeMs: Date.now() - startTime,
        errorMessage,
        errorCode: 'HTML_GENERATION_ERROR',
      };
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing HTML generation processor connections...');

    try {
      if (this.worker) {
        await this.worker.close();
      }

      if (this.queue) {
        await this.queue.close();
      }

      if (this.redis) {
        this.redis.disconnect();
      }

      this.logger.log('HTML generation processor connections closed');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.warn(`Error during HTML generation processor cleanup: ${errorMessage}`);
    }
  }
}
