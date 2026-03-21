import { Injectable } from '@nestjs/common';
import { OTelTrace } from '../../../tempo/dto/tempo.dto';
import { TraceSummary } from '../../dto/trace-analysis.dto';

/**
 * Aggregated statistics for a span across multiple traces
 */
export interface SpanAggregation {
  spanName: string;
  serviceName: string;
  totalDuration: number;
  selfDuration: number;
  callCount: number;
  errorCount: number;
  minDuration: number;
  maxDuration: number;
  avgStartDelay: number;
  parentSpanName?: string;
}

/**
 * Service responsible for span aggregation and summary statistics
 * Handles: aggregating spans across traces, calculating summary metrics
 */
@Injectable()
export class SpanAggregationService {
  /**
   * Calculate summary statistics for current vs baseline traces
   */
  calculateSummary(
    currentTraces: OTelTrace[],
    baselineTraces: OTelTrace[],
  ): TraceSummary {
    const avgCurrent =
      currentTraces.length > 0
        ? currentTraces.reduce((sum, t) => sum + t.durationMs, 0) / currentTraces.length
        : 0;
    const avgBaseline =
      baselineTraces.length > 0
        ? baselineTraces.reduce((sum, t) => sum + t.durationMs, 0) / baselineTraces.length
        : 0;

    const avgSpansCurrent =
      currentTraces.length > 0
        ? currentTraces.reduce((sum, t) => sum + t.spanCount, 0) / currentTraces.length
        : 0;
    const avgSpansBaseline =
      baselineTraces.length > 0
        ? baselineTraces.reduce((sum, t) => sum + t.spanCount, 0) / baselineTraces.length
        : 0;

    const durationChange = avgCurrent - avgBaseline;
    const durationChangePercent = avgBaseline > 0 ? (durationChange / avgBaseline) * 100 : 0;

    return {
      currentTraceCount: currentTraces.length,
      baselineTraceCount: baselineTraces.length,
      avgDurationCurrent: Math.round(avgCurrent * 100) / 100,
      avgDurationBaseline: Math.round(avgBaseline * 100) / 100,
      avgDurationChange: Math.round(durationChange * 100) / 100,
      avgDurationChangePercent: Math.round(durationChangePercent * 10) / 10,
      avgSpanCountCurrent: Math.round(avgSpansCurrent * 10) / 10,
      avgSpanCountBaseline: Math.round(avgSpansBaseline * 10) / 10,
      avgSpanCountChange: Math.round((avgSpansCurrent - avgSpansBaseline) * 10) / 10,
    };
  }

  /**
   * Aggregate spans across multiple traces
   */
  aggregateSpans(traces: OTelTrace[]): Map<string, SpanAggregation> {
    const aggregations = new Map<string, SpanAggregation>();

    for (const trace of traces) {
      const spanMap = new Map(trace.spans.map((s) => [s.spanId, s]));

      for (const span of trace.spans) {
        const key = `${span.serviceName}::${span.operationName}`;
        const durationMs = span.durationNanos / 1_000_000;

        // Calculate self duration (exclude child span durations)
        let childDuration = 0;
        for (const otherSpan of trace.spans) {
          if (otherSpan.parentSpanId === span.spanId) {
            childDuration += otherSpan.durationNanos / 1_000_000;
          }
        }
        const selfDuration = Math.max(0, durationMs - childDuration);

        // Calculate start delay from parent
        let startDelay = 0;
        if (span.parentSpanId) {
          const parent = spanMap.get(span.parentSpanId);
          if (parent) {
            const parentStart = BigInt(parent.startTimeUnixNano);
            const spanStart = BigInt(span.startTimeUnixNano);
            startDelay = Number(spanStart - parentStart) / 1_000_000;
          }
        }

        const isError = span.status?.code === 2; // OTel ERROR status code

        const existing = aggregations.get(key);
        if (existing) {
          existing.totalDuration += durationMs;
          existing.selfDuration += selfDuration;
          existing.callCount += 1;
          existing.errorCount += isError ? 1 : 0;
          existing.minDuration = Math.min(existing.minDuration, durationMs);
          existing.maxDuration = Math.max(existing.maxDuration, durationMs);
          existing.avgStartDelay =
            (existing.avgStartDelay * (existing.callCount - 1) + startDelay) /
            existing.callCount;
        } else {
          const parent = span.parentSpanId ? spanMap.get(span.parentSpanId) : undefined;
          aggregations.set(key, {
            spanName: span.operationName,
            serviceName: span.serviceName,
            totalDuration: durationMs,
            selfDuration,
            callCount: 1,
            errorCount: isError ? 1 : 0,
            minDuration: durationMs,
            maxDuration: durationMs,
            avgStartDelay: startDelay,
            parentSpanName: parent?.operationName,
          });
        }
      }
    }

    return aggregations;
  }
}
