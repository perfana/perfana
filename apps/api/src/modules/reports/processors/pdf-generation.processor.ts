import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { GeneratedReport } from '@perfana/shared';

/**
 * Job data for PDF generation
 */
interface PdfGenerationJobData {
  reportId: string;
  priority?: number;
  initiatedBy?: string;
  timestamp?: string;
}

/**
 * Result from PDF generation job
 */
export interface PdfGenerationJobResult {
  success: boolean;
  reportId: string;
  generationTimeMs?: number;
  fileSizeBytes?: number;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * Queue name constant for PDF generation
 */
const PDF_GENERATION_QUEUE_NAME = 'perfana-report-pdf-generation';

/**
 * BullMQ PDF Generation Processor
 *
 * This processor handles on-demand PDF generation from HTML reports using Puppeteer.
 * It manages its own Redis connection and worker lifecycle following the patterns
 * established in HtmlGenerationProcessor.
 *
 * Features:
 * - Graceful degradation in development mode when Redis is unavailable
 * - Puppeteer-based HTML to PDF conversion
 * - Automatic retry with exponential backoff
 * - Progress reporting for long-running jobs
 * - Clean shutdown handling
 */
@Injectable()
export class PdfGenerationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfGenerationProcessor.name);
  private redis: IORedis | null = null;
  private queue: Queue | null = null;
  private isRedisAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(GeneratedReport)
    private readonly reportRepo: Repository<GeneratedReport>,
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

      this.logger.log(`Connecting to Redis at: ${redisUrl} for PDF generation processor`);

      this.redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null, // Critical for BullMQ
        enableReadyCheck: false, // Recommended for BullMQ
        lazyConnect: true,
        connectTimeout: 10000,
        // No commandTimeout for BullMQ - blocking commands need unlimited time
      });

      this.redis.on('connect', () => {
        this.logger.log('Redis connected for PDF generation processor');
        this.isRedisAvailable = true;
        this.initializeQueue();
      });

      this.redis.on('error', (error) => {
        this.logger.warn(`Redis connection error: ${error.message}`);
        this.isRedisAvailable = false;

        if (!isDevelopment) {
          this.logger.error('Redis is required in production mode');
          throw error;
        } else {
          this.logger.warn(
            'Redis unavailable in development mode - PDF generation processor will be disabled',
          );
        }
      });

      this.redis.on('close', () => {
        this.logger.warn('Redis connection closed for PDF generation processor');
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
          'Redis connection failed - PDF generation processor will be unavailable in development mode',
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
          'PDF generation processing will be unavailable. To enable, start Redis server.',
        );
      } else {
        this.logger.error(
          `Failed to initialize PDF generation processor connections: ${errorMessage}`,
        );
        throw error;
      }
    }
  }

  /**
   * Initialize BullMQ queue (for adding jobs only - perfana-report processes them)
   */
  private initializeQueue(): void {
    if (!this.redis || !this.isRedisAvailable) {
      return;
    }

    try {
      // Initialize queue for adding jobs ONLY
      // NOTE: perfana-report service has the Worker that processes these jobs
      this.queue = new Queue(PDF_GENERATION_QUEUE_NAME, {
        connection: this.redis,
        defaultJobOptions: {
          removeOnComplete: 25, // Keep fewer completed jobs (PDFs are resource-intensive)
          removeOnFail: 10, // Keep failed jobs for debugging
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 }, // Longer delay for PDF generation
        },
      });

      this.logger.log('PDF generation queue initialized successfully (jobs will be processed by perfana-report service)');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.error(`Failed to initialize queue: ${errorMessage}`);
      this.isRedisAvailable = false;
    }
  }

  // NOTE: PDF processing methods removed from perfana-api
  // All PDF generation is handled by perfana-report service
  // This class only queues jobs - it does not process them

  /**
   * Check if Redis/BullMQ is available
   */
  isAvailable(): boolean {
    return this.isRedisAvailable && this.queue !== null;
  }

  /**
   * Add a new PDF generation job to the queue
   *
   * @param reportId - Report UUID to generate PDF for
   * @param options - Optional job options
   * @returns Job ID
   */
  async addJob(
    reportId: string,
    options?: { priority?: number; initiatedBy?: string },
  ): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error(
        'PDF generation processor is not available. Please start Redis server.',
      );
    }

    // Verify report exists and has HTML content before queuing
    const report = await this.reportRepo.findOne({
      where: { id: reportId },
      select: ['id', 'html_content', 'status'],
    });

    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    if (!report.html_content) {
      throw new Error(`Report ${reportId} does not have HTML content. Generate HTML first.`);
    }

    const jobData: PdfGenerationJobData = {
      reportId,
      priority: options?.priority || 1,
      initiatedBy: options?.initiatedBy || 'api',
      timestamp: new Date().toISOString(),
    };

    const job = await this.queue!.add('generate-pdf', jobData, {
      jobId: `pdf-gen-${reportId}-${Date.now()}`,
      priority: options?.priority || 1,
    });

    this.logger.log(`Queued PDF generation job ${job.id} for report ${reportId}`);

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
    result?: PdfGenerationJobResult;
    failedReason?: string;
  } | null> {
    if (!this.isAvailable()) {
      throw new Error(
        'PDF generation processor is not available. Please start Redis server.',
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
      result: job.returnvalue as PdfGenerationJobResult | undefined,
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


  async onModuleDestroy() {
    this.logger.log('Closing PDF generation processor connections...');

    try {
      if (this.queue) {
        await this.queue.close();
      }

      if (this.redis) {
        this.redis.disconnect();
      }

      this.logger.log('PDF generation processor connections closed');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.warn(`Error during PDF generation processor cleanup: ${errorMessage}`);
    }
  }
}
