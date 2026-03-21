# Performance Timing Documentation

## Overview

The worker system now includes comprehensive performance timing to help identify slow operations across all pipeline stages. This document explains how to use the timing utilities and interpret the logs.

## Architecture

### Three Levels of Timing

1. **Job Level** (`worker-factory.ts`)
   - Tracks overall job execution time
   - Shows validation vs execution time breakdown
   - Logs job start/completion with timing details

2. **Stage Level** (`PipelineOrchestrator.ts`)
   - Tracks each pipeline stage (metrics, statistics, ADAPT, etc.)
   - Shows stage-by-stage timing breakdown with percentages
   - Identifies which stages are slowest

3. **Operation Level** (Individual Pipelines)
   - Tracks sub-operations within each pipeline
   - Shows detailed breakdown of database queries, API calls, etc.
   - Helps pinpoint exact bottlenecks

## Using the Timing Utility

### In Pipeline Classes

All pipelines inherit from `BasePipeline` which provides a built-in `timer`:

```typescript
// Start timing an operation
this.timer.start('operation-name', { metadata: 'optional' });

// End timing (logs automatically)
this.timer.end('operation-name', { additionalMetadata: 'optional' });

// Measure an async operation (automatic start/end)
const result = await this.timer.measure('operation-name', async () => {
  return await someAsyncOperation();
}, { metadata: 'optional' });

// Measure a sync operation
const result = this.timer.measureSync('operation-name', () => {
  return someSyncOperation();
}, { metadata: 'optional' });

// Log a comprehensive summary at the end
this.logTimingSummary({ testRunId, additionalContext: 'here' });
```

### Example: Adding Timing to a Pipeline

```typescript
async execute(input: unknown): Promise<PipelineResult> {
  this.timer.reset(); // Reset for new execution

  try {
    this.timer.start('pipeline-execution');

    // Time individual operations
    const data = await this.timer.measure('load-data', () =>
      this.loadData(input)
    );

    const results = await this.timer.measure('process-data', () =>
      this.processData(data),
      { recordCount: data.length }
    );

    await this.timer.measure('save-results', () =>
      this.saveResults(results)
    );

    const duration = this.timer.end('pipeline-execution');

    // Log comprehensive summary
    this.logTimingSummary({
      recordCount: results.length,
      success: true
    });

    return this.createSuccessResult(results, duration);
  } catch (error) {
    this.timer.end('pipeline-execution', { error: true });
    this.logTimingSummary({ error: true });
    throw error;
  }
}
```

## Log Output

### Job-Level Logs

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 JOB STARTED: analyze-test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Job ID: 12345
   Queue: analyze-critical
   Attempt: 1
   Started: 2025-09-30T10:15:00.000Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ JOB COMPLETED: analyze-test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Job ID: 12345
   Queue: analyze-critical

   ⏱️  TIMING BREAKDOWN:
      • Validation:        15ms
      • Execution:      45230ms
      • Total:          45245ms

   📊 Result: {"status":"success","message":"Analysis completed..."}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Stage-Level Logs

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 STAGE TIMING BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ metrics-collection             32450ms  71.7% ████████████████████████████████
✅ statistics-calculation          8920ms  19.7% ████████
✅ adapt-analysis                  2340ms   5.2% ██
✅ checks-evaluation               1120ms   2.5% █
✅ control-groups-creation          410ms   0.9%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Total Pipeline Duration: 45240ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Operation-Level Logs

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 PERFORMANCE SUMMARY: MetricsPipeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Overall Statistics:
   • Total Operations: 6
   • Total Duration: 32450ms
   • Average Duration: 5408ms

🐌 Top 5 Slowest Operations:
   1. fetch-and-flatten-metrics: 28340ms 🐌
   2. save-to-database: 3890ms 🐢
   3. load-panel-documents: 180ms ✅
   4. load-test-run: 25ms ⚡
   5. validate-input: 15ms ⚡

⚡ Top 5 Fastest Operations:
   1. validate-input: 15ms
   2. load-test-run: 25ms
   3. initialize-grafana-client: 30ms
   4. filter-panels: 45ms
   5. load-panel-documents: 180ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Timing Emojis

The system uses emojis to quickly identify performance issues:

- ⚡ **< 100ms** - Very fast, excellent performance
- ✅ **100-500ms** - Good performance
- ⏱️ **500-1000ms** - Acceptable but worth monitoring
- 🐢 **1-5 seconds** - Slow, investigate if possible
- 🐌 **> 5 seconds** - Very slow, optimization needed

## Best Practices

### 1. Always Reset Timer

```typescript
async execute(input: unknown): Promise<PipelineResult> {
  this.timer.reset(); // Clear previous execution data
  // ... rest of implementation
}
```

### 2. Log Summary at End

```typescript
try {
  // ... pipeline execution
  this.logTimingSummary({ success: true, recordCount: results.length });
} catch (error) {
  this.logTimingSummary({ error: true });
  throw error;
}
```

### 3. Add Meaningful Metadata

```typescript
await this.timer.measure('fetch-grafana-data',
  () => this.fetchData(panelIds),
  {
    panelCount: panelIds.length,
    batchSize: 20,
    concurrency: 10
  }
);
```

### 4. Use Nested Timers for Complex Operations

```typescript
const operationTimer = this.createTimer('complex-operation');

operationTimer.start('sub-operation-1');
await doSomething();
operationTimer.end('sub-operation-1');

operationTimer.start('sub-operation-2');
await doSomethingElse();
operationTimer.end('sub-operation-2');

operationTimer.logSummary();
```

## Analyzing Performance Issues

### Finding Bottlenecks

1. **Check Job-Level Timing** - Is most time in validation or execution?
2. **Check Stage Breakdown** - Which pipeline stage is slowest?
3. **Check Operation Details** - What specific operation within that stage?

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| High "fetch-and-flatten-metrics" time | Grafana API slow/many panels | Increase concurrency, reduce batch size |
| High "save-to-database" time | Too many small inserts | Increase batch size, use bulk inserts |
| High "statistics-calculation" time | Large data volume | Optimize SQL queries, add indexes |
| High "load-panel-documents" time | Database slow | Add indexes, optimize query |

## Adding Timing to New Pipelines

1. Inherit from `BasePipeline` (already done)
2. Reset timer at start of `execute()`
3. Wrap operations with `this.timer.measure()`
4. Call `this.logTimingSummary()` at end
5. Test and verify logs appear correctly

## Future Enhancements

- Export timing data to metrics system (Prometheus/Grafana)
- Automated performance regression detection
- Historical timing trend analysis
- Alerting on slow operations