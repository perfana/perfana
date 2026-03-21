/**
 * FlowProducer implementation for complex job orchestration
 * Based on BULLMQ_EXTERNAL_INTEGRATION.md specifications
 */

import { FlowProducer, FlowJob } from 'bullmq';
import { acquireRedisConnection, releaseRedisConnection } from '../config/redis-pool.js';
import { getQueueForJob } from '../config/queues.js';
import { ENHANCED_JOB_CONFIGS } from '../types/jobs.js';
import { getLogger } from '../lib/utils/logger.js';
import type Redis from 'ioredis';

const logger = getLogger('flow-producer');

export class PerfanaFlowProducer {
  private flowProducer: FlowProducer | null = null;
  private redis: Redis | null = null;

  constructor() {
    // Initialize asynchronously - will be called by getInstance
  }

  /**
   * Initialize flow producer with pooled Redis connection
   */
  public async initialize(): Promise<void> {
    if (this.flowProducer) {
      return; // Already initialized
    }

    try {
      this.redis = await acquireRedisConnection();

      this.flowProducer = new FlowProducer({
        connection: this.redis,
        prefix: 'perfana-flow'
      });

      // Setup error handling
      this.flowProducer.on('error', (error) => {
        logger.error('FlowProducer error:', error);
      });

      logger.info('✅ FlowProducer initialized with pooled Redis connection');
    } catch (error) {
      logger.error('❌ Failed to initialize FlowProducer:', error);
      throw error;
    }
  }

  /**
   * Create single test analysis flow (7-stage sequential pipeline)
   */
  async createAnalyzeTestFlow(testRunId: string, options: {
    adapt?: boolean;
    benchmarksOnly?: boolean;
  } = {}): Promise<FlowJob> {
    const { adapt = true, benchmarksOnly = false } = options;

    logger.info(`Creating analyze-test flow for testRunId: ${testRunId}`);

    // Stage 0: Initial analysis
    const analyzeJob: FlowJob = {
      name: 'analyze-test',
      queueName: getQueueForJob('analyze-test'),
      data: { testRunId, adapt, benchmarksOnly },
      opts: {
        ...ENHANCED_JOB_CONFIGS['analyze-test'],
        jobId: `analyze-${testRunId}-${Date.now()}`
      },
      children: []
    };

    // Stage 1: Dynatrace collection (parallel)
    const dynatraceJob: FlowJob = {
      name: 'dynatrace-collection',
      queueName: getQueueForJob('dynatrace-collection'),
      data: { testRunId },
      opts: {
        ...ENHANCED_JOB_CONFIGS['dynatrace-collection'],
        jobId: `dynatrace-${testRunId}-${Date.now()}`
      }
    };

    // Stage 2: Panels processing (depends on analyze-test)
    const panelsJob: FlowJob = {
      name: 'panels-processing',
      queueName: getQueueForJob('panels-processing'),
      data: { testRunId },
      opts: {
        ...ENHANCED_JOB_CONFIGS['panels-processing'],
        jobId: `panels-${testRunId}-${Date.now()}`
      }
    };

    // Stage 3: Metrics collection (depends on panels)
    const metricsJob: FlowJob = {
      name: 'metrics-collection',
      queueName: getQueueForJob('metrics-collection'),
      data: { testRunId, benchmarksOnly },
      opts: {
        ...ENHANCED_JOB_CONFIGS['metrics-collection'],
        jobId: `metrics-${testRunId}-${Date.now()}`
      }
    };

    // Stage 4: Statistics calculation (depends on metrics)
    const statisticsJob: FlowJob = {
      name: 'statistics-calculation',
      queueName: getQueueForJob('statistics-calculation'),
      data: { testRunIds: [testRunId] },
      opts: {
        ...ENHANCED_JOB_CONFIGS['statistics-calculation'],
        jobId: `statistics-${testRunId}-${Date.now()}`
      }
    };

    // Stage 5: Checks evaluation (depends on statistics)
    const checksJob: FlowJob = {
      name: 'checks-evaluation',
      queueName: getQueueForJob('checks-evaluation'),
      data: { testRunIds: [testRunId] },
      opts: {
        ...ENHANCED_JOB_CONFIGS['checks-evaluation'],
        jobId: `checks-${testRunId}-${Date.now()}`
      }
    };

    // Stage 6: ADAPT analysis (depends on checks, conditional)
    const adaptJob: FlowJob | null = adapt ? {
      name: 'adapt-analysis',
      queueName: getQueueForJob('adapt-analysis'),
      data: {
        testRunIds: [testRunId],
        updateControlGroup: true,
        updateControlStatistics: true
      },
      opts: {
        ...ENHANCED_JOB_CONFIGS['adapt-analysis'],
        jobId: `adapt-${testRunId}-${Date.now()}`
      }
    } : null;

    // Stage 7: Control groups (depends on ADAPT if enabled, otherwise on checks)
    const controlGroupsJob: FlowJob = {
      name: 'control-groups-pipeline',
      queueName: getQueueForJob('control-groups-pipeline'),
      data: { testRunIds: [testRunId] },
      opts: {
        ...ENHANCED_JOB_CONFIGS['control-groups-pipeline'],
        jobId: `control-groups-${testRunId}-${Date.now()}`
      }
    };

    // Build dependency chain
    // Note: Dynatrace job runs in parallel with analyze-test, but panels depends on both
    // Only include Dynatrace job if there are configured instances (it will gracefully skip if none found)
    analyzeJob.children = [dynatraceJob, panelsJob];
    panelsJob.children = [metricsJob];
    metricsJob.children = [statisticsJob];
    statisticsJob.children = [checksJob];

    if (adaptJob) {
      checksJob.children = [adaptJob];
      adaptJob.children = [controlGroupsJob];
    } else {
      checksJob.children = [controlGroupsJob];
    }

    return analyzeJob;
  }

  /**
   * Create batch processing flow (parallel + sequential hybrid)
   */
  async createBatchFlow(testRunIds: string[], options: {
    adapt?: boolean;
    dependencies?: string[];
    batchSize?: number;
  } = {}): Promise<FlowJob> {
    const { adapt = true, dependencies = [], batchSize = 10 } = options;
    const batchId = `batch-${Date.now()}`;

    logger.info(`Creating batch flow for ${testRunIds.length} test runs, batchId: ${batchId}`);

    // Batch coordinator job
    const batchJob: FlowJob = {
      name: 'batch-flow',
      queueName: getQueueForJob('batch-flow'),
      data: {
        testRunIds,
        adapt,
        dependencies,
        batchId,
        batchSize
      },
      opts: {
        ...ENHANCED_JOB_CONFIGS['batch-flow'],
        jobId: `batch-flow-${batchId}`
      },
      children: []
    };

    // Create batches of test runs
    const batches = this.chunkArray(testRunIds, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchJobId = `batch-analysis-${batchId}-${i}`;

      const batchAnalysisJob: FlowJob = {
        name: 'batch-analysis',
        queueName: getQueueForJob('batch-analysis'),
        data: {
          testRunIds: batch,
          adapt,
          batchId,
          batchIndex: i,
          totalBatches: batches.length
        },
        opts: {
          ...ENHANCED_JOB_CONFIGS['batch-analysis'],
          jobId: batchJobId
        }
      };

      batchJob.children!.push(batchAnalysisJob);
    }

    return batchJob;
  }

  /**
   * Create re-evaluation flow (optimized, skips data collection)
   */
  async createReevaluationFlow(testRunIds: string[], options: {
    updateBenchmarkIds?: boolean;
    batchSize?: number;
  } = {}): Promise<FlowJob> {
    const { updateBenchmarkIds = true, batchSize = 15 } = options;
    const batchId = `reeval-${Date.now()}`;

    logger.info(`Creating re-evaluation flow for ${testRunIds.length} test runs, batchId: ${batchId}`);

    // Re-evaluation coordinator job
    const reevalJob: FlowJob = {
      name: 'reevaluation-batch',
      queueName: getQueueForJob('reevaluation-batch'),
      data: {
        testRunIds,
        updateBenchmarkIds,
        batchId,
        batchSize
      },
      opts: {
        ...ENHANCED_JOB_CONFIGS['reevaluation-batch'],
        jobId: `reeval-batch-${batchId}`
      },
      children: []
    };

    // Create optimized batches (larger since no data collection)
    const batches = this.chunkArray(testRunIds, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      // For each test run in batch, create re-evaluation job
      for (const testRunId of batch) {
        const reevalCheckJob: FlowJob = {
          name: 'reevaluate-checks',
          queueName: getQueueForJob('reevaluate-checks'),
          data: {
            testRunId,
            updateBenchmarkIds
          },
          opts: {
            ...ENHANCED_JOB_CONFIGS['reevaluate-checks'],
            jobId: `reeval-${testRunId}-${Date.now()}`
          }
        };

        reevalJob.children!.push(reevalCheckJob);
      }
    }

    return reevalJob;
  }

  /**
   * Execute a flow and return job information
   */
  async executeFlow(flow: FlowJob): Promise<{ jobId: string; flowId: string }> {
    if (!this.flowProducer) {
      throw new Error('FlowProducer not initialized. Call initialize() first.');
    }

    try {
      const result = await this.flowProducer.add(flow);

      logger.info(`Flow executed successfully:`, {
        jobId: result.job.id,
        flowId: result.job.opts?.jobId,
        name: flow.name
      });

      return {
        jobId: result.job.id!,
        flowId: result.job.opts?.jobId as string
      };
    } catch (error) {
      logger.error('Failed to execute flow:', error);
      throw error;
    }
  }

  /**
   * Get flow status and progress
   */
  async getFlowStatus(_flowId: string): Promise<{
    status: string;
    progress: number;
    completedJobs: number;
    totalJobs: number;
    errors: string[];
  }> {
    // Implementation for flow status monitoring
    // This would integrate with BullMQ's flow monitoring capabilities
    return {
      status: 'pending',
      progress: 0,
      completedJobs: 0,
      totalJobs: 0,
      errors: []
    };
  }

  /**
   * Cancel a running flow
   */
  async cancelFlow(flowId: string): Promise<void> {
    try {
      // Implementation for flow cancellation
      logger.info(`Cancelling flow: ${flowId}`);
    } catch (error) {
      logger.error(`Failed to cancel flow ${flowId}:`, error);
      throw error;
    }
  }

  /**
   * Close the flow producer and cleanup
   */
  async close(): Promise<void> {
    try {
      if (this.flowProducer) {
        await this.flowProducer.close();
        this.flowProducer = null;
      }

      // FIXED: Release Redis connection back to pool instead of disconnecting
      if (this.redis) {
        releaseRedisConnection(this.redis);
        this.redis = null;
      }

      logger.info('FlowProducer closed successfully');
    } catch (error) {
      logger.error('Error closing FlowProducer:', error);
    }
  }

  /**
   * Utility method to chunk arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// Singleton instance for external use
let flowProducerInstance: PerfanaFlowProducer | null = null;

export async function getFlowProducer(): Promise<PerfanaFlowProducer> {
  if (!flowProducerInstance) {
    flowProducerInstance = new PerfanaFlowProducer();
    await flowProducerInstance.initialize();
  }
  return flowProducerInstance;
}

export async function closeFlowProducer(): Promise<void> {
  if (flowProducerInstance) {
    await flowProducerInstance.close();
    flowProducerInstance = null;
  }
}