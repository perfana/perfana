# 🔄 **BullMQ External Integration Guide**
*How to initiate, orchestrate, and monitor jobs from external components*

## **Architecture Overview**
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│  Perfana API    │    │   BullMQ Queues  │    │  perfana-ds-worker  │
│  (Job Client)   │────▶│   (Redis)        │────▶│  (Job Processors)   │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
        │                       │                        │
        ▼                       ▼                        ▼
   Job Initiation        Queue Management         Job Execution
   Job Monitoring        Flow Orchestration       Result Storage
   Status APIs          Job Dependencies          Error Handling
```

This document describes how external components (like the main Perfana API) should interact with the BullMQ worker system to initiate, orchestrate, and monitor jobs.

---

## **1. Single Test Analysis Flow** 🎯
*Equivalent to Python's `analyze_test_task` - POST `/analyzeTest/{testRunId}`*

### **External Component Implementation (Perfana API)**

```typescript
// In your main Perfana API application
import { Queue } from 'bullmq';
import { createRedisConnection } from './shared/redis-config';

export class PerfanaJobClient {
  private analysisQueue: Queue;

  constructor() {
    this.analysisQueue = new Queue('perfana:critical', {
      connection: createRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 10,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      }
    });
  }

  /**
   * POST /analyzeTest/{testRunId}
   * Initiates complete 7-stage pipeline analysis for a single test run
   */
  async analyzeTest(testRunId: string, options: {
    adapt?: boolean;
    benchmarksOnly?: boolean;
  }): Promise<JobInitiationResult> {

    // Validate test run exists
    await this.validateTestRun(testRunId);

    // Create the analysis job
    const job = await this.analysisQueue.add('analyze-test', {
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

    // Store job tracking in database
    await this.trackJobInitiation(testRunId, job.id!, 'analyze-test');

    return {
      success: true,
      jobId: job.id!,
      testRunId,
      message: `Analysis pipeline initiated for test run ${testRunId}`,
      estimatedDuration: '5-10 minutes',
      stages: 7,
      trackingUrl: `/api/jobs/${job.id}/status`
    };
  }
}
```

### **API Endpoint Implementation**

```typescript
// In your Fastify/Express API routes
app.post('/analyzeTest/:testRunId', async (request, reply) => {
  const { testRunId } = request.params;
  const { adapt, benchmarksOnly } = request.body;

  try {
    const result = await jobClient.analyzeTest(testRunId, {
      adapt,
      benchmarksOnly
    });

    return reply.code(200).send({
      status: 'initiated',
      data: result,
      links: {
        status: `/api/jobs/${result.jobId}/status`,
        results: `/api/test-runs/${testRunId}/results`,
        cancel: `/api/jobs/${result.jobId}/cancel`
      }
    });

  } catch (error) {
    return reply.code(500).send({
      status: 'failed',
      message: error.message,
      error_code: 'ANALYSIS_INITIATION_FAILED'
    });
  }
});
```

---

## **2. Batch Processing Flow** 📦
*Equivalent to Python's `refresh_batch` - POST `/refresh/batch`*

### **Batch Orchestration Implementation**

```typescript
export class PerfanaBatchClient {
  private batchQueue: Queue;
  private flowProducer: FlowProducer;

  /**
   * POST /refresh/batch
   * Processes multiple test runs with intelligent batching and parallel execution
   */
  async refreshBatch(testRunIds: string[], options: {
    batchSize?: number;
    maxConcurrency?: number;
    adapt?: boolean;
  }): Promise<BatchJobResult> {

    const batchSize = options.batchSize || 5;
    const maxConcurrency = options.maxConcurrency || 3;

    // Create batch job tracking
    const batchId = `batch-${Date.now()}`;
    const batches = this.chunkArray(testRunIds, batchSize);

    // Create master batch job
    const batchJob = await this.batchQueue.add('batch-analysis', {
      batchId,
      totalTestRuns: testRunIds.length,
      batchCount: batches.length,
      adapt: options.adapt,
      status: 'initiated'
    }, {
      jobId: batchId,
      priority: 2
    });

    // Process batches with controlled concurrency
    const batchPromises = batches.map(async (batch, batchIndex) => {
      // Stagger batch start times to prevent resource contention
      const delay = batchIndex * 30000; // 30 second delays

      const batchFlow: FlowJob = {
        name: 'batch-flow',
        data: {
          batchId,
          batchIndex,
          testRunIds: batch,
          adapt: options.adapt
        },
        opts: { delay },
        children: batch.map(testRunId => ({
          name: 'analyze-test',
          data: {
            testRunId,
            adapt: options.adapt,
            batchId,
            batchIndex
          },
          queueName: 'perfana:critical',
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            priority: 2
          }
        }))
      };

      return this.flowProducer.add(batchFlow);
    });

    // Wait for all batches to be queued
    const batchFlows = await Promise.allSettled(batchPromises);
    const successfulBatches = batchFlows.filter(b => b.status === 'fulfilled').length;

    return {
      success: true,
      batchId,
      totalTestRuns: testRunIds.length,
      batchesCreated: successfulBatches,
      estimatedDuration: this.estimateBatchDuration(testRunIds.length, batchSize),
      trackingUrl: `/api/batches/${batchId}/status`,
      individualJobs: batchFlows
        .filter(b => b.status === 'fulfilled')
        .map(b => (b as any).value.id)
    };
  }

  private estimateBatchDuration(totalJobs: number, batchSize: number): string {
    const estimatedMinutes = Math.ceil((totalJobs / batchSize) * 7); // 7 min per batch
    return `${estimatedMinutes}-${estimatedMinutes + 10} minutes`;
  }
}
```

### **Batch API Endpoint**

```typescript
app.post('/refresh/batch', async (request, reply) => {
  const { testRunIds, batchSize, maxConcurrency, adapt } = request.body;

  // Validation
  if (!Array.isArray(testRunIds) || testRunIds.length === 0) {
    return reply.code(400).send({
      status: 'error',
      message: 'testRunIds must be a non-empty array'
    });
  }

  try {
    const result = await batchClient.refreshBatch(testRunIds, {
      batchSize,
      maxConcurrency,
      adapt
    });

    return reply.code(200).send({
      status: 'initiated',
      data: result,
      links: {
        status: `/api/batches/${result.batchId}/status`,
        progress: `/api/batches/${result.batchId}/progress`,
        cancel: `/api/batches/${result.batchId}/cancel`
      }
    });

  } catch (error) {
    return reply.code(500).send({
      status: 'failed',
      message: error.message,
      error_code: 'BATCH_INITIATION_FAILED'
    });
  }
});
```

---

## **3. Re-evaluation Flow** 🔄
*Equivalent to Python's `reevaluate_batch` - POST `/reevaluate/batch`*

### **Re-evaluation Orchestration**

```typescript
export class PerfanaReevaluationClient {
  private reevalQueue: Queue;

  /**
   * POST /reevaluate/batch
   * Re-evaluates existing test runs with updated benchmarks (skips data collection)
   */
  async reevaluateBatch(testRunIds: string[], options: {
    benchmarkIds?: string[];
    skipStages?: string[];
    forceRecalculation?: boolean;
  }): Promise<ReevaluationResult> {

    // Validate that test runs have existing data
    const validTestRuns = await this.validateTestRunsForReevaluation(testRunIds);

    if (validTestRuns.length === 0) {
      throw new Error('No valid test runs found for re-evaluation');
    }

    // Create re-evaluation flow (optimized pipeline)
    const reevalBatchId = `reeval-${Date.now()}`;

    const reevalFlow: FlowJob = {
      name: 'reevaluation-batch',
      data: {
        batchId: reevalBatchId,
        testRunIds: validTestRuns,
        benchmarkIds: options.benchmarkIds,
        skipStages: options.skipStages || ['dynatrace-collection', 'panels-processing', 'metrics-collection'],
        forceRecalculation: options.forceRecalculation
      },
      children: validTestRuns.map(testRunId => ({
        name: 'reevaluate-checks',
        data: {
          testRunId,
          benchmarkIds: options.benchmarkIds,
          skipDataCollection: true,
          recalculateStatistics: options.forceRecalculation || false
        },
        queueName: 'perfana:processing',
        opts: {
          attempts: 2,
          priority: 3,
          backoff: { type: 'fixed', delay: 10000 }
        }
      }))
    };

    const job = await this.flowProducer.add(reevalFlow);

    return {
      success: true,
      reevaluationId: reevalBatchId,
      jobId: job.id!,
      testRunsProcessed: validTestRuns.length,
      skippedStages: options.skipStages || ['dynatrace-collection', 'panels-processing', 'metrics-collection'],
      estimatedDuration: `${Math.ceil(validTestRuns.length * 2)} minutes`, // Faster since skipping collection
      trackingUrl: `/api/reevaluations/${reevalBatchId}/status`
    };
  }

  private async validateTestRunsForReevaluation(testRunIds: string[]): Promise<string[]> {
    // Check which test runs have sufficient data for re-evaluation
    const validations = await Promise.all(
      testRunIds.map(async (testRunId) => {
        const hasMetrics = await this.hasExistingMetrics(testRunId);
        const hasStatistics = await this.hasExistingStatistics(testRunId);
        return { testRunId, valid: hasMetrics && hasStatistics };
      })
    );

    return validations
      .filter(v => v.valid)
      .map(v => v.testRunId);
  }
}
```

### **Re-evaluation API Endpoint**

```typescript
app.post('/reevaluate/batch', async (request, reply) => {
  const { testRunIds, benchmarkIds, skipStages, forceRecalculation } = request.body;

  try {
    const result = await reevaluationClient.reevaluateBatch(testRunIds, {
      benchmarkIds,
      skipStages,
      forceRecalculation
    });

    return reply.code(200).send({
      status: 'initiated',
      data: result,
      optimizations: {
        stagesSkipped: result.skippedStages.length,
        estimatedSpeedup: '60-70%',
        dataReuseEnabled: true
      },
      links: {
        status: `/api/reevaluations/${result.reevaluationId}/status`,
        results: `/api/reevaluations/${result.reevaluationId}/results`
      }
    });

  } catch (error) {
    return reply.code(500).send({
      status: 'failed',
      message: error.message,
      error_code: 'REEVALUATION_INITIATION_FAILED'
    });
  }
});
```

---

## **4. Job Monitoring & Status APIs** 📊

### **Universal Job Status Endpoint**

```typescript
export class JobMonitoringClient {
  private queues: Map<string, Queue> = new Map();

  /**
   * GET /api/jobs/{jobId}/status
   * Universal job status for any job type
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    // Try to find the job across all queues
    const queueNames = ['perfana:critical', 'perfana:processing', 'perfana:background'];

    for (const queueName of queueNames) {
      const queue = this.getQueue(queueName);
      const job = await queue.getJob(jobId);

      if (job) {
        const state = await job.getState();
        const progress = job.progress;
        const logs = await queue.getJobLogs(jobId);

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

          // Pipeline specific info
          pipeline: await this.getPipelineInfo(job),

          // Error information
          failedReason: job.failedReason,

          // Logs (last 10 entries)
          recentLogs: logs.logs.slice(-10),

          // Next steps
          nextActions: this.getNextActions(state, job)
        };
      }
    }

    throw new Error(`Job ${jobId} not found`);
  }

  /**
   * GET /api/test-runs/{testRunId}/jobs
   * Get all jobs for a specific test run
   */
  async getTestRunJobs(testRunId: string): Promise<TestRunJobsResponse> {
    const allJobs = await Promise.all(
      Array.from(this.queues.values()).map(async (queue) => {
        const jobs = await queue.getJobs(['completed', 'failed', 'active', 'waiting']);
        return jobs.filter(job => job.data.testRunId === testRunId);
      })
    );

    const jobs = allJobs.flat().sort((a, b) => b.timestamp - a.timestamp);

    return {
      testRunId,
      totalJobs: jobs.length,
      jobsByStatus: this.groupJobsByStatus(jobs),
      pipeline: await this.buildPipelineStatus(jobs),
      overall: this.calculateOverallStatus(jobs),
      estimatedCompletion: this.estimateCompletion(jobs)
    };
  }

  private async getPipelineInfo(job: any): Promise<PipelineInfo | null> {
    if (job.name === 'analyze-test') {
      // Get child jobs for pipeline stages
      const childJobs = await this.getChildJobs(job.id);

      return {
        stages: [
          { name: 'dynatrace-collection', status: this.getStageStatus(childJobs, 'dynatrace-collection') },
          { name: 'panels-processing', status: this.getStageStatus(childJobs, 'panels-processing') },
          { name: 'metrics-collection', status: this.getStageStatus(childJobs, 'metrics-collection') },
          { name: 'statistics-calculation', status: this.getStageStatus(childJobs, 'statistics-calculation') },
          { name: 'checks-evaluation', status: this.getStageStatus(childJobs, 'checks-evaluation') },
          { name: 'adapt-analysis', status: this.getStageStatus(childJobs, 'adapt-analysis') }
        ],
        currentStage: this.getCurrentStage(childJobs),
        completedStages: this.getCompletedStages(childJobs),
        totalStages: job.data.adapt ? 6 : 5
      };
    }

    return null;
  }
}
```

### **Real-time Status Updates**

```typescript
// WebSocket implementation for real-time job updates
export class JobStatusWebSocket {
  private io: SocketIO.Server;

  async setupJobStatusUpdates(): Promise<void> {
    // Listen to BullMQ events for real-time updates
    const queues = ['perfana:critical', 'perfana:processing', 'perfana:background'];

    queues.forEach(queueName => {
      const queue = this.getQueue(queueName);

      queue.on('completed', (job) => {
        this.io.to(`job:${job.id}`).emit('job-completed', {
          jobId: job.id,
          testRunId: job.data.testRunId,
          result: job.returnvalue,
          duration: job.finishedOn! - job.processedOn!
        });
      });

      queue.on('failed', (job, err) => {
        this.io.to(`job:${job.id}`).emit('job-failed', {
          jobId: job.id,
          testRunId: job.data.testRunId,
          error: err.message,
          attempt: job.attemptsMade
        });
      });

      queue.on('progress', (job, progress) => {
        this.io.to(`job:${job.id}`).emit('job-progress', {
          jobId: job.id,
          testRunId: job.data.testRunId,
          progress: progress
        });
      });
    });
  }
}
```

---

## **5. Client SDK for External Integration** 🔧

```typescript
// Exportable SDK for other Perfana components
export class PerfanaJobSDK {
  private jobClient: PerfanaJobClient;
  private batchClient: PerfanaBatchClient;
  private reevalClient: PerfanaReevaluationClient;
  private monitoringClient: JobMonitoringClient;

  constructor(redisConfig: RedisOptions) {
    // Initialize all clients
  }

  // Single test analysis
  async analyzeTest(testRunId: string, options?: AnalyzeTestOptions): Promise<JobInitiationResult> {
    return this.jobClient.analyzeTest(testRunId, options);
  }

  // Batch processing
  async processBatch(testRunIds: string[], options?: BatchOptions): Promise<BatchJobResult> {
    return this.batchClient.refreshBatch(testRunIds, options);
  }

  // Re-evaluation
  async reevaluate(testRunIds: string[], options?: ReevaluationOptions): Promise<ReevaluationResult> {
    return this.reevalClient.reevaluateBatch(testRunIds, options);
  }

  // Monitoring
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    return this.monitoringClient.getJobStatus(jobId);
  }

  // Utility methods
  async waitForCompletion(jobId: string, timeoutMs: number = 600000): Promise<JobResult> {
    return this.monitoringClient.waitForJobCompletion(jobId, timeoutMs);
  }

  async cancelJob(jobId: string): Promise<boolean> {
    return this.monitoringClient.cancelJob(jobId);
  }
}
```

---

## **6. Type Definitions** 📝

```typescript
// Job initiation types
interface JobInitiationResult {
  success: boolean;
  jobId: string;
  testRunId: string;
  message: string;
  estimatedDuration: string;
  stages: number;
  trackingUrl: string;
}

interface BatchJobResult {
  success: boolean;
  batchId: string;
  totalTestRuns: number;
  batchesCreated: number;
  estimatedDuration: string;
  trackingUrl: string;
  individualJobs: string[];
}

interface ReevaluationResult {
  success: boolean;
  reevaluationId: string;
  jobId: string;
  testRunsProcessed: number;
  skippedStages: string[];
  estimatedDuration: string;
  trackingUrl: string;
}

// Job status types
interface JobStatusResponse {
  jobId: string;
  testRunId: string;
  type: string;
  status: JobState;
  progress: JobProgress;
  created: Date;
  started: Date | null;
  finished: Date | null;
  duration: number | null;
  attempts: number;
  maxAttempts: number;
  queue: string;
  pipeline: PipelineInfo | null;
  failedReason?: string;
  recentLogs: string[];
  nextActions: string[];
}

interface PipelineInfo {
  stages: PipelineStage[];
  currentStage: string;
  completedStages: number;
  totalStages: number;
}

interface PipelineStage {
  name: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

// Options types
interface AnalyzeTestOptions {
  adapt?: boolean;
  benchmarksOnly?: boolean;
}

interface BatchOptions {
  batchSize?: number;
  maxConcurrency?: number;
  adapt?: boolean;
}

interface ReevaluationOptions {
  benchmarkIds?: string[];
  skipStages?: string[];
  forceRecalculation?: boolean;
}
```

---

## **7. Usage Examples** 💡

### **Simple Test Analysis**

```typescript
// In your Perfana API
const jobSDK = new PerfanaJobSDK(redisConfig);

// Start analysis
const result = await jobSDK.analyzeTest('test-run-123', { adapt: true });
console.log(`Job started: ${result.jobId}`);

// Monitor progress
const status = await jobSDK.getJobStatus(result.jobId);
console.log(`Current status: ${status.status}`);

// Wait for completion
const finalResult = await jobSDK.waitForCompletion(result.jobId);
console.log(`Analysis completed: ${finalResult.success}`);
```

### **Batch Processing**

```typescript
// Process multiple test runs
const testRunIds = ['test-1', 'test-2', 'test-3', 'test-4', 'test-5'];

const batchResult = await jobSDK.processBatch(testRunIds, {
  batchSize: 2,
  maxConcurrency: 3,
  adapt: true
});

console.log(`Batch ${batchResult.batchId} processing ${batchResult.totalTestRuns} test runs`);
```

### **Re-evaluation with Optimization**

```typescript
// Re-evaluate with data reuse
const reevalResult = await jobSDK.reevaluate(['test-1', 'test-2'], {
  skipStages: ['dynatrace-collection', 'panels-processing', 'metrics-collection'],
  forceRecalculation: false
});

console.log(`Re-evaluation will complete in ${reevalResult.estimatedDuration}`);
```

---

## **Summary: External Integration Pattern** 🎯

### **For Perfana API Developers:**

1. **Import the SDK**: `import { PerfanaJobSDK } from '@perfana/job-client'`
2. **Initialize once**: `const jobSDK = new PerfanaJobSDK(redisConfig)`
3. **Use the three main flows**:
   - `await jobSDK.analyzeTest(testRunId, { adapt: true })`
   - `await jobSDK.processBatch(testRunIds, { batchSize: 5 })`
   - `await jobSDK.reevaluate(testRunIds, { skipStages: ['metrics-collection'] })`
4. **Monitor progress**: `await jobSDK.getJobStatus(jobId)`

### **Key Benefits:**
- ✅ **Clean separation**: Workers handle processing, clients handle orchestration
- ✅ **Type safety**: Full TypeScript support for all job types
- ✅ **Real-time monitoring**: WebSocket updates and REST APIs
- ✅ **Fault tolerance**: Built-in retry, cancellation, and error handling
- ✅ **Performance**: Optimized batch processing and resource management

### **Infrastructure Requirements:**
- **Redis instance**: Shared between client and worker components
- **Network connectivity**: Client must reach Redis on same network as workers
- **Authentication**: Redis AUTH if using secured Redis instance
- **Monitoring**: Optional but recommended for production deployments

This architecture ensures your worker system can be consumed by any external component while maintaining enterprise-grade reliability and observability.