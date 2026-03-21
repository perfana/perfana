import { Injectable } from '@nestjs/common';
import { OTelTrace } from '../../../tempo/dto/tempo.dto';
import {
  ExecutionPatternComparison,
  ExecutionPattern,
} from '../../dto/trace-analysis.dto';

/**
 * Service responsible for analyzing execution patterns
 * Handles: sequential vs parallel execution, concurrency analysis
 */
@Injectable()
export class ExecutionPatternAnalyzer {
  /**
   * Analyze execution patterns (sequential vs parallel)
   */
  analyzeExecutionPatterns(
    currentTraces: OTelTrace[],
    baselineTraces: OTelTrace[],
  ): ExecutionPatternComparison {
    const currentPattern = this.calculateExecutionPattern(currentTraces);
    const baselinePattern = this.calculateExecutionPattern(baselineTraces);

    return {
      current: currentPattern,
      baseline: baselinePattern,
      patternChanged: currentPattern.isSequential !== baselinePattern.isSequential,
      parallelismChange:
        Math.round((currentPattern.parallelismRatio - baselinePattern.parallelismRatio) * 100) /
        100,
    };
  }

  /**
   * Calculate execution pattern for a set of traces
   */
  calculateExecutionPattern(traces: OTelTrace[]): ExecutionPattern {
    if (traces.length === 0) {
      return {
        isSequential: true,
        parallelismRatio: 0,
        maxConcurrentSpans: 0,
        avgConcurrentSpans: 0,
      };
    }

    let totalMaxConcurrent = 0;
    let totalAvgConcurrent = 0;

    for (const trace of traces) {
      // Create timeline events
      const events: { time: bigint; type: 'start' | 'end' }[] = [];
      for (const span of trace.spans) {
        events.push({ time: BigInt(span.startTimeUnixNano), type: 'start' });
        events.push({ time: BigInt(span.endTimeUnixNano), type: 'end' });
      }
      events.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

      // Count concurrent spans at each point
      let concurrent = 0;
      let maxConcurrent = 0;
      let totalConcurrent = 0;
      let samples = 0;

      for (const event of events) {
        if (event.type === 'start') {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
        } else {
          totalConcurrent += concurrent;
          samples++;
          concurrent--;
        }
      }

      totalMaxConcurrent += maxConcurrent;
      totalAvgConcurrent += samples > 0 ? totalConcurrent / samples : 0;
    }

    const avgMaxConcurrent = totalMaxConcurrent / traces.length;
    const avgConcurrent = totalAvgConcurrent / traces.length;
    const avgSpans =
      traces.reduce((sum, t) => sum + t.spanCount, 0) / traces.length;

    // Parallelism ratio: how much parallelism compared to fully sequential
    // 1.0 = fully sequential, higher = more parallel
    const parallelismRatio = avgSpans > 0 ? avgMaxConcurrent / avgSpans : 0;

    return {
      isSequential: avgMaxConcurrent <= 2,
      parallelismRatio: Math.round(parallelismRatio * 100) / 100,
      maxConcurrentSpans: Math.round(avgMaxConcurrent * 10) / 10,
      avgConcurrentSpans: Math.round(avgConcurrent * 10) / 10,
    };
  }
}
