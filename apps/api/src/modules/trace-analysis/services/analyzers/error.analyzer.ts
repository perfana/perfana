import { Injectable } from '@nestjs/common';
import { OTelTrace } from '../../../tempo/dto/tempo.dto';
import {
  ErrorAnalysis,
  ErrorStats,
  ErrorComparison,
} from '../../dto/trace-analysis.dto';

/**
 * Service responsible for analyzing error patterns in traces
 * Handles: error statistics, error comparisons, new/resolved errors
 */
@Injectable()
export class ErrorAnalyzer {
  /**
   * Analyze error patterns
   */
  analyzeErrors(
    currentTraces: OTelTrace[],
    baselineTraces: OTelTrace[],
  ): ErrorAnalysis {
    const currentErrors = this.calculateErrorStats(currentTraces);
    const baselineErrors = this.calculateErrorStats(baselineTraces);

    // Compare errors by span
    const comparison: ErrorComparison[] = [];
    const allSpans = new Set([
      ...Object.keys(currentErrors.errorsByType),
      ...Object.keys(baselineErrors.errorsByType),
    ]);

    const newErrors: string[] = [];
    const resolvedErrors: string[] = [];

    for (const span of allSpans) {
      const currCount = currentErrors.errorsByType[span] || 0;
      const baseCount = baselineErrors.errorsByType[span] || 0;

      if (currCount > 0 && baseCount === 0) {
        newErrors.push(span);
      } else if (currCount === 0 && baseCount > 0) {
        resolvedErrors.push(span);
      }

      if (currCount > 0 || baseCount > 0) {
        comparison.push({
          spanName: span,
          currentErrorCount: currCount,
          baselineErrorCount: baseCount,
          errorChange: currCount - baseCount,
          isNewError: baseCount === 0 && currCount > 0,
          errorMessages: [],
        });
      }
    }

    comparison.sort((a, b) => Math.abs(b.errorChange) - Math.abs(a.errorChange));

    return {
      current: currentErrors,
      baseline: baselineErrors,
      comparison,
      newErrors,
      resolvedErrors,
    };
  }

  /**
   * Calculate error statistics for traces
   */
  calculateErrorStats(traces: OTelTrace[]): ErrorStats {
    let totalErrorSpans = 0;
    let totalSpans = 0;
    const errorsByType: Record<string, number> = {};

    for (const trace of traces) {
      for (const span of trace.spans) {
        totalSpans++;
        if (span.status?.code === 2) {
          totalErrorSpans++;
          const key = `${span.serviceName}::${span.operationName}`;
          errorsByType[key] = (errorsByType[key] || 0) + 1;
        }
      }
    }

    return {
      totalErrorSpans,
      errorRate: totalSpans > 0 ? (totalErrorSpans / totalSpans) * 100 : 0,
      errorsByType,
    };
  }
}
