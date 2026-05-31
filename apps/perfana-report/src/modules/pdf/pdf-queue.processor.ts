import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { PdfService } from './pdf.service';

/**
 * Job data for PDF generation
 */
export interface PdfGenerationJobData {
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
/** @public */
export const PDF_GENERATION_QUEUE_NAME = 'perfana-report-pdf-generation';

/**
 * BullMQ PDF Queue Processor
 *
 * Consumes PDF generation jobs from BullMQ queue and processes them using PdfService.
 *
 * Features:
 * - Concurrent job processing (configurable)
 * - Progress reporting
 * - Automatic retry with exponential backoff
 * - Rate limiting
 * - Clean shutdown handling
 */
@Injectable()
export class PdfQueueProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfQueueProcessor.name);
  private redis: IORedis | null = null;
  private worker: Worker | null = null;
  private isRedisAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly pdfService: PdfService
  ) {}

  async onModuleInit() {
    await this.initializeConnections();
  }

  /**
   * Initialize Redis connection and BullMQ worker
   */
  private async initializeConnections(): Promise<void> {
    try {
      const redisHost = this.configService.get('REDIS_HOST', 'localhost');
      const redisPort = parseInt(
        this.configService.get('REDIS_PORT', '6379'),
        10
      );
      const redisUrl = `redis://${redisHost}:${redisPort}`;

      this.logger.log(
        `Connecting to Redis at: ${redisUrl} for PDF queue processor`
      );

      this.redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null, // Critical for BullMQ
        enableReadyCheck: false, // Recommended for BullMQ
        lazyConnect: true,
        connectTimeout: 10000,
      });

      this.redis.on('connect', () => {
        this.logger.log('Redis connected for PDF queue processor');
        this.isRedisAvailable = true;
        this.initializeWorker();
      });

      this.redis.on('error', error => {
        this.logger.error(`Redis connection error: ${error.message}`);
        this.isRedisAvailable = false;
        throw error;
      });

      this.redis.on('close', () => {
        this.logger.warn('Redis connection closed for PDF queue processor');
        this.isRedisAvailable = false;
      });

      // Try to connect
      await this.redis.connect();
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      this.logger.error(
        `Failed to initialize Redis connection: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Initialize BullMQ worker
   */
  private initializeWorker(): void {
    if (!this.redis || !this.isRedisAvailable) {
      return;
    }

    try {
      const concurrency = parseInt(
        this.configService.get('QUEUE_CONCURRENCY', '2'),
        10
      );

      // Initialize worker for processing jobs
      this.worker = new Worker<PdfGenerationJobData, PdfGenerationJobResult>(
        PDF_GENERATION_QUEUE_NAME,
        async job => this.processJob(job),
        {
          connection: this.redis as unknown as ConnectionOptions,
          concurrency, // Lower concurrency for resource-intensive PDF generation
          lockDuration: 120000, // 2 minutes lock duration for PDF generation
          limiter: {
            max: 5,
            duration: 60000, // Max 5 PDF jobs per minute
          },
        }
      );

      // Handle worker events
      this.worker.on('ready', () => {
        this.logger.log(
          `PDF generation worker ready (concurrency: ${concurrency})`
        );
      });

      this.worker.on('active', job => {
        this.logger.debug(
          `Processing PDF generation job ${job.id} for report ${job.data.reportId}`
        );
      });

      this.worker.on('completed', (job, result) => {
        if (result.success) {
          this.logger.log(
            `PDF generation completed for report ${job.data.reportId} in ${result.generationTimeMs}ms (${this.formatFileSize(result.fileSizeBytes || 0)})`
          );
        } else {
          this.logger.warn(
            `PDF generation failed for report ${job.data.reportId}: ${result.errorMessage}`
          );
        }
      });

      this.worker.on('failed', (job, error) => {
        this.logger.error(
          `PDF generation job ${job?.id} failed: ${error.message}`,
          error.stack
        );
      });

      this.worker.on('error', error => {
        this.logger.error(`PDF generation worker error: ${error.message}`);
      });

      this.logger.log('PDF generation worker initialized successfully');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.error(`Failed to initialize worker: ${errorMessage}`);
      this.isRedisAvailable = false;
    }
  }

  /**
   * Process a single PDF generation job
   */
  private async processJob(
    job: Job<PdfGenerationJobData, PdfGenerationJobResult>
  ): Promise<PdfGenerationJobResult> {
    const { reportId } = job.data;
    const startTime = Date.now();

    this.logger.log(`Starting PDF generation for report ${reportId}`);

    try {
      // Update progress - starting
      await job.updateProgress({ stage: 'loading_report', percent: 10 });

      // Update status to pdf_processing
      await this.pdfService.updateReportStatus(reportId, 'pdf_processing');

      // Update progress - generating PDF
      await job.updateProgress({ stage: 'generating_pdf', percent: 30 });

      // Generate PDF from HTML
      const pdfBuffer = await this.pdfService.generatePdf(reportId);

      // Update progress - storing PDF metadata
      await job.updateProgress({ stage: 'storing_pdf', percent: 80 });

      // Store PDF metadata in database
      await this.pdfService.storePdfMetadata(reportId, pdfBuffer);

      // Update progress - complete
      await job.updateProgress({ stage: 'complete', percent: 100 });

      const generationTimeMs = Date.now() - startTime;

      return {
        success: true,
        reportId,
        generationTimeMs,
        fileSizeBytes: pdfBuffer.length,
      };
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      this.logger.error(
        `PDF generation failed for report ${reportId}: ${errorMessage}`
      );

      // Update report status to failed
      await this.pdfService.updateReportStatus(
        reportId,
        'failed',
        errorMessage,
        'PDF_GENERATION_ERROR'
      );

      return {
        success: false,
        reportId,
        generationTimeMs: Date.now() - startTime,
        errorMessage,
        errorCode: 'PDF_GENERATION_ERROR',
      };
    }
  }

  /**
   * Format file size for logging
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  async onModuleDestroy() {
    this.logger.log('Closing PDF queue processor connections...');

    try {
      if (this.worker) {
        await this.worker.close();
        this.logger.log('Worker closed successfully');
      }

      if (this.redis) {
        this.redis.disconnect();
        this.logger.log('Redis connection closed');
      }

      this.logger.log('PDF queue processor connections closed');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.warn(
        `Error during PDF queue processor cleanup: ${errorMessage}`
      );
    }
  }
}
