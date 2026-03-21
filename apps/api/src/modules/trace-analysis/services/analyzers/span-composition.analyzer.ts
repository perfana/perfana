import { Injectable } from '@nestjs/common';
import { SpanComposition } from '../../dto/trace-analysis.dto';
import { SpanAggregation } from './span-aggregation.service';

/**
 * Service responsible for analyzing span composition changes
 * Handles: detecting new spans, missing spans, and common spans
 */
@Injectable()
export class SpanCompositionAnalyzer {
  /**
   * Analyze span composition changes between current and baseline
   */
  analyzeSpanComposition(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
  ): SpanComposition {
    const currentSpans = new Set(current.keys());
    const baselineSpans = new Set(baseline.keys());

    const newSpans: string[] = [];
    const missingSpans: string[] = [];
    const commonSpans: string[] = [];

    for (const span of currentSpans) {
      if (baselineSpans.has(span)) {
        commonSpans.push(span);
      } else {
        newSpans.push(span);
      }
    }

    for (const span of baselineSpans) {
      if (!currentSpans.has(span)) {
        missingSpans.push(span);
      }
    }

    return {
      newSpans: newSpans.map((s) => current.get(s)!.spanName),
      missingSpans: missingSpans.map((s) => baseline.get(s)!.spanName),
      commonSpans: commonSpans.map((s) => current.get(s)!.spanName),
    };
  }
}
