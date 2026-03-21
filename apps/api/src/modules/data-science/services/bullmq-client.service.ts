import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, FlowProducer, Job } from 'bullmq';
import IORedis from 'ioredis';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface JobInitiationResult {
  success: boolean;
  jobId: string;
  testRunId: string;
  message: string;
  estimatedDuration: string;
  stages: number;
  trackingUrl: string;
}

export interface BatchJobResult {
  success: boolean;
  batchId: string;
  totalTestRuns: number;
  batchesCreated: number;
  estimatedDuration: string;
  trackingUrl: string;
  individualJobs: string[];
}

export interface ReevaluationResult {
  success: boolean;
  reevaluationId: string;
  jobId: string;
  testRunsProcessed: number;
  skippedStages: string[];
  estimatedDuration: string;
  trackingUrl: string;
}

export interface AnalyzeTestOptions {
  adapt?: boolean;
  benchmarksOnly?: boolean;
}

export interface BatchOptions {
  adapt?: boolean;
  sources?: {
    grafana?: boolean;
    dynatrace?: boolean;
    performanceMetrics?: boolean;
  };
  forceRefetch?: boolean;
}

export interface ReevaluationOptions {
  checks?: boolean;
  adapt?: boolean;
  // Optional fields for specific metric re-analysis
  applicationDashboardId?: string;
  panelId?: number;
  metricName?: string;
}

@Injectable()
export class BullMQClientService implements OnModuleDestroy {
  private readonly logger = new Logger(BullMQClientService.name);
  private redis: IORedis | null = null;
  private analysisQueue: Queue | null = null;
  private batchQueue: Queue | null = null;
  private reevalQueue: Queue | null = null;
  private flowProducer: FlowProducer | null = null;
  private isRedisAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    @InjectDataSource()
    private readonly dataSource: DataSource
  ) {
    this.initializeConnections();
  }

  private async initializeConnections() {
    try {
      const redisUrl = this.configService.get('REDIS_URL', 'redis://localhost:6379');
      const isDevelopment = this.configService.get('NODE_ENV') === 'development';

      this.logger.log(`Connecting to Redis at: ${redisUrl}`);

      this.redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,   // Critical for BullMQ
        enableReadyCheck: false,      // Recommended for BullMQ
        lazyConnect: true,
        connectTimeout: 5000,
        commandTimeout: 5000,
      });

      this.redis.on('connect', () => {
        this.logger.log('Redis connected for BullMQ client');
        this.isRedisAvailable = true;
        this.initializeQueues();
      });

      this.redis.on('error', (error) => {
        this.logger.warn(`Redis connection error: ${error.message}`);
        this.isRedisAvailable = false;

        if (!isDevelopment) {
          this.logger.error('Redis is required in production mode');
          throw error;
        } else {
          this.logger.warn('Redis unavailable in development mode - BullMQ features will be disabled');
        }
      });

      this.redis.on('close', () => {
        this.logger.warn('Redis connection closed');
        this.isRedisAvailable = false;
      });

      // Try to connect
      try {
        await this.redis.connect();
      } catch (error) {
        if (!isDevelopment) {
          throw error;
        }
        this.logger.warn('Redis connection failed - continuing without job queue support in development mode');
      }

    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      const isDevelopment = this.configService.get('NODE_ENV') === 'development';

      if (isDevelopment) {
        this.logger.warn(`Failed to initialize Redis in development mode: ${errorMessage}`);
        this.logger.warn('BullMQ job processing will be unavailable. To enable, start Redis server.');
      } else {
        this.logger.error(`Failed to initialize BullMQ connections: ${errorMessage}`);
        throw error;
      }
    }
  }

  private initializeQueues() {
    if (!this.redis || !this.isRedisAvailable) {
      return;
    }

    try {
      // Initialize queues
      this.analysisQueue = new Queue('perfana-analyze', {
        connection: this.redis,
        defaultJobOptions: {
          removeOnComplete: 50,
          removeOnFail: 10,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 }
        }
      });

      this.batchQueue = new Queue('perfana-batch', {
        connection: this.redis,
        defaultJobOptions: {
          removeOnComplete: 25,
          removeOnFail: 10,
          attempts: 2,
          backoff: { type: 'exponential', delay: 10000 }
        }
      });

      // Re-evaluation jobs now use the same batch queue
      this.reevalQueue = this.batchQueue;

      this.flowProducer = new FlowProducer({
        connection: this.redis
      });

      this.logger.log('BullMQ queues initialized successfully');
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to initialize queues: ${errorMessage}`);
      this.isRedisAvailable = false;
    }
  }

  private checkRedisAvailability(): void {
    if (!this.isRedisAvailable || !this.analysisQueue || !this.batchQueue || !this.reevalQueue || !this.flowProducer) {
      throw new Error('Redis/BullMQ is not available. Please start Redis server to enable job processing.');
    }
  }

  /**
   * POST /data/analyzeTest/{testRunId}
   * Initiates complete 7-stage pipeline analysis for a single test run
   */
  async analyzeTest(testRunId: string, options: AnalyzeTestOptions = {}): Promise<JobInitiationResult> {
    try {
      this.checkRedisAvailability();
      this.logger.log(`Initiating analysis for test run: ${testRunId}`);

      // Create the analysis job
      const job = await this.analysisQueue!.add('analyze-test', {
        testRunId,
        adapt: options.adapt || false,
        benchmarksOnly: options.benchmarksOnly || false,
        initiatedBy: 'api',
        timestamp: new Date().toISOString()
      }, {
        jobId: `analyze-${testRunId}-${Date.now()}`,
        priority: 1, // Highest priority
        delay: 0
      });

      this.logger.log(`Analysis job created with ID: ${job.id}`);

      return {
        success: true,
        jobId: job.id!,
        testRunId,
        message: `Analysis pipeline initiated for test run ${testRunId}`,
        estimatedDuration: '5-10 minutes',
        stages: options.adapt ? 7 : 6,
        trackingUrl: `/api/data-science/jobs/${job.id}/status`
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to initiate analysis for ${testRunId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * POST /data/refresh/batch
   * Refreshes missing data for test runs by detecting gaps and filling only missing ranges
   */
  async refreshBatch(testRunIds: string[], options: BatchOptions = {}): Promise<BatchJobResult> {
    try {
      this.checkRedisAvailability();
      this.logger.log(`Processing batch of ${testRunIds.length} test runs with missing-data refresh`);

      const batchId = `batch-${Date.now()}`;
      const includeAdapt = options.adapt !== false;

      const job = await this.batchQueue!.add('orchestrate-reevaluate-batch', {
        testRunIds,
        batchId,
        checks: true,
        adapt: includeAdapt,
        refreshMode: options.forceRefetch ? 'force' : 'missing-data',
        ...(options.sources ? { sources: options.sources } : {}),
      }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 10000 }
      });

      const jobId = job.id || batchId;
      this.logger.log(`Refresh batch job created with ID: ${jobId}`);

      return {
        success: true,
        batchId,
        totalTestRuns: testRunIds.length,
        batchesCreated: 1,
        estimatedDuration: this.estimateBatchDuration(testRunIds.length, 5),
        trackingUrl: `/api/data-science/batches/${batchId}/status`,
        individualJobs: [jobId]
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to process batch: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * POST /data/reevaluate/batch
   * Re-evaluates existing test runs with updated benchmarks (skips data collection)
   */
  async reevaluateBatch(testRunIds: string[], options: ReevaluationOptions = {}): Promise<ReevaluationResult> {
    try {
      this.checkRedisAvailability();
      this.logger.log(`Re-evaluating batch of ${testRunIds.length} test runs`);

      // Create re-evaluation flow (optimized pipeline)
      const reevalBatchId = `reeval-${Date.now()}`;
      const includeChecks = options.checks !== false; // Default to true
      const includeAdapt = options.adapt !== false; // Default to true

      // Reevaluate mode: no refreshMode set, so worker skips data collection
      const skipStages: string[] = ['dynatrace-collection', 'panels-processing', 'metrics-collection'];

      // Create a single orchestration job that handles the sequencing
      const jobData: any = {
        testRunIds: testRunIds,
        batchId: reevalBatchId,
        checks: includeChecks,
        adapt: includeAdapt,
      };

      // Add specific metric targeting if provided
      if (options.applicationDashboardId) {
        jobData.applicationDashboardId = options.applicationDashboardId;
      }
      if (options.panelId !== undefined) {
        jobData.panelId = options.panelId;
      }

      // Determine the actual configuration scope by checking what config exists
      const actualScope = await this.determineConfigurationScope(
        testRunIds[0]!, // Use first test run to determine scope
        options.applicationDashboardId,
        options.panelId,
        options.metricName
      );

      // Set job data based on actual configuration scope
      if (actualScope.scope === 'panel') {
        // Panel-level config exists, re-evaluate all metrics in the panel
        // Omit metricName property entirely for panel scope
        this.logger.log(`Panel-level configuration detected, re-evaluating all metrics in panel ${options.panelId}`);
      } else if (actualScope.scope === 'metric') {
        // Metric-specific config
        jobData.metricName = options.metricName;
      } else {
        // Use as provided for other scopes
        if (options.metricName !== undefined) {
          jobData.metricName = options.metricName;
        }
      }

      // Log the actual job data being put on the queue
      this.logger.log(`Re-evaluation job data:`, JSON.stringify(jobData, null, 2));

      const job = await this.batchQueue!.add('orchestrate-reevaluate-batch', jobData, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 10000 }
      });
      const jobId = job.id || reevalBatchId;

      this.logger.log(`Re-evaluation jobs created with ID: ${jobId}`);

      return {
        success: true,
        reevaluationId: reevalBatchId,
        jobId: jobId,
        testRunsProcessed: testRunIds.length,
        skippedStages: skipStages,
        estimatedDuration: `${Math.ceil(testRunIds.length * 2)} minutes`, // Faster since skipping collection
        trackingUrl: `/api/data-science/reevaluations/${reevalBatchId}/status`
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to initiate re-evaluation: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get job status from any queue
   */
  async getJobStatus(jobId: string): Promise<any> {
    this.checkRedisAvailability();

    const queueNames = ['perfana-analyze', 'perfana-batch'];

    for (const queueName of queueNames) {
      let queue: Queue | null = null;

      if (queueName === 'perfana-analyze') queue = this.analysisQueue;
      else if (queueName === 'perfana-batch') queue = this.batchQueue;

      if (!queue) {
        continue;
      }

      try {
        const job = await queue.getJob(jobId);
        if (job) {
          const state = await job.getState();
          const progress = job.progress;

          return {
            jobId,
            testRunId: job.data.testRunId,
            type: job.name,
            status: state,
            progress: typeof progress === 'object' ? progress : { percent: progress || 0 },
            created: new Date(job.timestamp),
            started: job.processedOn ? new Date(job.processedOn) : null,
            finished: job.finishedOn ? new Date(job.finishedOn) : null,
            duration: this.calculateDuration(job),
            attempts: job.attemptsMade,
            maxAttempts: job.opts.attempts || 1,
            queue: queueName,
            failedReason: job.failedReason,
            data: job.data
          };
        }
      } catch (error) {
        const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
        this.logger.warn(`Failed to check job ${jobId} in queue ${queueName}: ${errorMessage}`);
      }
    }

    throw new Error(`Job ${jobId} not found`);
  }


  private estimateBatchDuration(totalJobs: number, batchSize: number): string {
    const estimatedMinutes = Math.ceil((totalJobs / batchSize) * 7); // 7 min per batch
    return `${estimatedMinutes}-${estimatedMinutes + 10} minutes`;
  }

  private calculateDuration(job: Job): number | null {
    if (job.processedOn && job.finishedOn) {
      return job.finishedOn - job.processedOn;
    }
    return null;
  }

  /**
   * Determines the actual configuration scope by checking what configuration exists in the database
   */
  private async determineConfigurationScope(
    testRunId: string,
    applicationDashboardId?: string,
    panelId?: number,
    metricName?: string
  ): Promise<{ scope: 'metric' | 'panel' | 'dashboard' | 'environment'; configExists: boolean }> {
    try {
      // Get test run details to determine system_under_test_id, test_environment, and workload
      const testRunResult = await this.dataSource.query(`
        SELECT system_under_test_id, test_environment, workload
        FROM test_runs
        WHERE test_run_id = $1
      `, [testRunId]);

      if (testRunResult.length === 0) {
        this.logger.warn(`Test run ${testRunId} not found, defaulting to metric scope`);
        return { scope: 'metric', configExists: false };
      }

      const testRun = testRunResult[0];
      if (!testRun) {
        this.logger.warn(`Test run ${testRunId} not found, defaulting to metric scope`);
        return { scope: 'metric', configExists: false };
      }

      const { system_under_test_id, test_environment, workload } = testRun;

      // Check configuration hierarchy from most specific to least specific
      const configChecks = [
        // Metric-level config (most specific)
        {
          scope: 'metric' as const,
          shouldCheck: applicationDashboardId && panelId !== undefined && metricName,
          query: () => this.dataSource.query(`
            SELECT id
            FROM ds_compare_config
            WHERE system_under_test_id = $1
              AND test_environment = $2
              AND workload = $3
              AND application_dashboard_id = $4
              AND panel_id = $5
              AND metric_name = $6
          `, [system_under_test_id, test_environment, workload, applicationDashboardId, panelId, metricName])
        },
        // Panel-level config
        {
          scope: 'panel' as const,
          shouldCheck: applicationDashboardId && panelId !== undefined,
          query: () => this.dataSource.query(`
            SELECT id
            FROM ds_compare_config
            WHERE system_under_test_id = $1
              AND test_environment = $2
              AND workload = $3
              AND application_dashboard_id = $4
              AND panel_id = $5
              AND metric_name IS NULL
          `, [system_under_test_id, test_environment, workload, applicationDashboardId, panelId])
        },
        // Dashboard-level config
        {
          scope: 'dashboard' as const,
          shouldCheck: applicationDashboardId,
          query: () => this.dataSource.query(`
            SELECT id
            FROM ds_compare_config
            WHERE system_under_test_id = $1
              AND test_environment = $2
              AND workload = $3
              AND application_dashboard_id = $4
              AND panel_id IS NULL
              AND metric_name IS NULL
          `, [system_under_test_id, test_environment, workload, applicationDashboardId])
        },
        // Environment-level config (least specific)
        {
          scope: 'environment' as const,
          shouldCheck: true,
          query: () => this.dataSource.query(`
            SELECT id
            FROM ds_compare_config
            WHERE system_under_test_id = $1
              AND test_environment = $2
              AND workload = $3
              AND application_dashboard_id IS NULL
              AND panel_id IS NULL
              AND metric_name IS NULL
          `, [system_under_test_id, test_environment, workload])
        }
      ];

      // Check each scope in order of specificity
      for (const { scope, shouldCheck, query } of configChecks) {
        if (!shouldCheck) continue;

        const result = await query();
        if (result.length > 0) {
          this.logger.log(`Configuration scope determined: ${scope} for test run ${testRunId}`);
          return { scope, configExists: true };
        }
      }

      // No configuration found, default to metric scope
      this.logger.log(`No configuration found for test run ${testRunId}, defaulting to metric scope`);
      return { scope: 'metric', configExists: false };

    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Error determining configuration scope for test run ${testRunId}: ${errorMessage}`);
      // Default to metric scope on error
      return { scope: 'metric', configExists: false };
    }
  }

  /**
   * Generic method to add a job to the batch queue
   * Used for custom job types like 're-evaluate-adapt-conclusion'
   */
  async addJob(jobName: string, jobData: any, options: any = {}): Promise<string> {
    try {
      this.checkRedisAvailability();
      this.logger.log(`Adding job '${jobName}' to batch queue`);

      const job = await this.batchQueue!.add(jobName, jobData, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
        ...options
      });

      this.logger.log(`Job '${jobName}' created with ID: ${job.id}`);
      return job.id || `${jobName}-${Date.now()}`;
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to add job '${jobName}': ${errorMessage}`);
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing BullMQ connections...');

    try {
      if (this.analysisQueue) {
        await this.analysisQueue.close();
      }

      if (this.batchQueue) {
        await this.batchQueue.close();
      }

      if (this.reevalQueue) {
        await this.reevalQueue.close();
      }

      if (this.flowProducer) {
        await this.flowProducer.close();
      }

      if (this.redis) {
        this.redis.disconnect();
      }

      this.logger.log('BullMQ connections closed');
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.warn(`Error during BullMQ cleanup: ${errorMessage}`);
    }
  }
}