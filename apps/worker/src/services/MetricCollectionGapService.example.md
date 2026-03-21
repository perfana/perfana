# MetricCollectionGapService Usage Examples

## Overview

The `MetricCollectionGapService` detects gaps in collected data and manages completion status for metric collection. It's used by the `PipelineOrchestrator` to decide whether to skip metric collection stages.

## Basic Usage

### 1. Detect Gaps in Data Collection

```typescript
import { MetricCollectionGapService } from './services/MetricCollectionGapService';

// Inject the service via NestJS DI
constructor(private readonly gapService: MetricCollectionGapService) {}

// Detect gaps for a test run
const gaps = await gapService.detectGaps('test-run-123');

// Check if there are any gaps
if (gaps.length > 0) {
  console.log(`Found ${gaps.length} sources with gaps`);

  for (const gap of gaps) {
    console.log(`Source: ${gap.sourceType}/${gap.sourceId}`);
    console.log(`Missing ranges: ${gap.missingRanges.length}`);
    console.log(`Failed ranges: ${gap.failedRanges.length}`);
  }
}
```

### 2. Check if Collection is Complete

```typescript
// Check if all metric collection is complete
const isComplete = await gapService.isCollectionComplete('test-run-123');

if (isComplete) {
  console.log('All metric collection is complete!');
  // Skip metric collection stage
} else {
  console.log('Collection is incomplete, proceeding with collection...');
  // Run metric collection stage
}
```

### 3. Get Incomplete Sources

```typescript
// Get details about incomplete sources
const incompleteSources = await gapService.getIncompleteSources('test-run-123');

for (const source of incompleteSources) {
  console.log(`Incomplete: ${source.sourceType}/${source.sourceId}`);
  console.log(`Last collected: ${source.lastCollectedAt}`);
  console.log(`Failed ranges: ${source.failedRanges.length}`);

  // Show failed attempts
  for (const failedRange of source.failedRanges) {
    console.log(`  Range: ${failedRange.from} - ${failedRange.to}`);
    console.log(`  Attempts: ${failedRange.attempts}`);
    console.log(`  Last error: ${failedRange.lastError}`);
  }
}
```

### 4. Mark Source as Complete

```typescript
// After successfully filling all gaps for a source
await gapService.markSourceComplete(
  'test-run-123',
  'grafana',
  'grafana-instance-1'
);

console.log('Source marked as complete');
```

### 5. Calculate Coverage Percentage

```typescript
// Get coverage percentage (0-100)
const coverage = await gapService.calculateCoverage('test-run-123');

console.log(`Coverage: ${coverage.toFixed(2)}%`);

if (coverage < 80) {
  console.warn('Coverage is below 80%, consider re-collecting');
}
```

### 6. Get Collection Summary

```typescript
// Get comprehensive summary
const summary = await gapService.getCollectionSummary('test-run-123');

console.log('Collection Summary:');
console.log(`  Total sources: ${summary.totalSources}`);
console.log(`  Complete: ${summary.completeSources}`);
console.log(`  Incomplete: ${summary.incompleteSources}`);
console.log(`  Coverage: ${summary.coverage.toFixed(2)}%`);
console.log(`  Gaps: ${summary.gaps}`);
console.log(`  Failed ranges: ${summary.failedRanges}`);
```

## Integration with PipelineOrchestrator

### Example: Skip Metric Collection if Complete

```typescript
import { PipelineOrchestrator } from './services/PipelineOrchestrator';
import { MetricCollectionGapService } from './services/MetricCollectionGapService';

export class AnalyzeTestWorker {
  constructor(
    private readonly orchestrator: PipelineOrchestrator,
    private readonly gapService: MetricCollectionGapService
  ) {}

  async analyzeTest(testRunId: string) {
    const stages: string[] = [];

    // Check if metric collection is needed
    const isCollectionComplete = await this.gapService.isCollectionComplete(testRunId);

    if (!isCollectionComplete) {
      // Add metric collection stages
      stages.push('dynatrace-collection');
      stages.push('performance-test-metrics');
      stages.push('metrics-collection');
    } else {
      console.log('Metric collection already complete, skipping...');
    }

    // Always run analysis stages
    stages.push('statistics-calculation');
    stages.push('control-groups-creation');
    stages.push('adapt-analysis');

    // Execute pipeline
    const result = await this.orchestrator.executeSequentialPipeline(testRunId, {
      stages,
      errorHandling: 'continue',
    });

    return result;
  }
}
```

### Example: Fill Gaps in Incremental Collection

```typescript
export class IncrementalMetricsWorker {
  constructor(private readonly gapService: MetricCollectionGapService) {}

  async collectMetricsIncremental(testRunId: string) {
    // Detect gaps
    const gaps = await this.gapService.detectGaps(testRunId);

    if (gaps.length === 0) {
      console.log('No gaps detected, collection complete');
      return;
    }

    // Process each gap
    for (const gap of gaps) {
      console.log(`Processing gap for ${gap.sourceType}/${gap.sourceId}`);

      // Collect missing ranges
      for (const missingRange of gap.missingRanges) {
        try {
          await this.collectRange(gap.sourceType, gap.sourceId, missingRange);
        } catch (error) {
          console.error(`Failed to collect range: ${error.message}`);
        }
      }

      // Retry failed ranges
      for (const failedRange of gap.failedRanges) {
        if (failedRange.attempts < 5) {
          try {
            await this.collectRange(gap.sourceType, gap.sourceId, failedRange);
          } catch (error) {
            console.error(`Retry failed: ${error.message}`);
          }
        }
      }

      // Check if source is now complete
      const sourceGaps = await this.gapService.detectGaps(testRunId);
      const sourceComplete = !sourceGaps.some(
        g => g.sourceType === gap.sourceType && g.sourceId === gap.sourceId
      );

      if (sourceComplete) {
        await this.gapService.markSourceComplete(
          testRunId,
          gap.sourceType,
          gap.sourceId
        );
      }
    }
  }

  private async collectRange(
    sourceType: string,
    sourceId: string | null,
    range: { from: Date; to: Date }
  ): Promise<void> {
    // Implementation of range collection
    console.log(`Collecting ${sourceType} from ${range.from} to ${range.to}`);
  }
}
```

## Advanced Usage

### Example: Monitor Collection Progress

```typescript
export class CollectionMonitor {
  constructor(private readonly gapService: MetricCollectionGapService) {}

  async monitorProgress(testRunId: string) {
    const summary = await this.gapService.getCollectionSummary(testRunId);

    // Create progress report
    const report = {
      testRunId,
      timestamp: new Date(),
      progress: {
        percentage: summary.coverage,
        completeSources: summary.completeSources,
        totalSources: summary.totalSources,
      },
      issues: {
        gaps: summary.gaps,
        failedRanges: summary.failedRanges,
      },
      status: this.determineStatus(summary),
    };

    return report;
  }

  private determineStatus(summary: any): string {
    if (summary.coverage === 100) return 'complete';
    if (summary.coverage >= 80) return 'good';
    if (summary.coverage >= 50) return 'partial';
    if (summary.failedRanges > 0) return 'failing';
    return 'incomplete';
  }
}
```

### Example: Validate Before Analysis

```typescript
export class AnalysisValidator {
  constructor(private readonly gapService: MetricCollectionGapService) {}

  async validateDataCompleteness(testRunId: string): Promise<{
    canAnalyze: boolean;
    reason?: string;
    coverage: number;
  }> {
    const coverage = await this.gapService.calculateCoverage(testRunId);
    const gaps = await this.gapService.detectGaps(testRunId);

    // Require at least 80% coverage for analysis
    if (coverage < 80) {
      return {
        canAnalyze: false,
        reason: `Insufficient coverage: ${coverage.toFixed(2)}% (minimum 80% required)`,
        coverage,
      };
    }

    // Check for excessive gaps
    if (gaps.length > 5) {
      return {
        canAnalyze: false,
        reason: `Too many gaps: ${gaps.length} sources with missing data`,
        coverage,
      };
    }

    return {
      canAnalyze: true,
      coverage,
    };
  }
}
```

## Error Handling

```typescript
try {
  const gaps = await gapService.detectGaps('test-run-123');
} catch (error) {
  if (error.message.includes('Test run not found')) {
    console.error('Test run does not exist');
  } else {
    console.error('Failed to detect gaps:', error);
  }
}
```

## Testing

See `MetricCollectionGapService.test.ts` for comprehensive test examples.

## Related Services

- `WorkerDatabaseService` - Database access for collection status
- `PipelineOrchestrator` - Pipeline execution coordination
- `MetricsPipeline` - Metric collection from Grafana
- `DynatracePipeline` - Metric collection from Dynatrace
- `PerformanceTestMetricsPipeline` - Performance test metric collection
