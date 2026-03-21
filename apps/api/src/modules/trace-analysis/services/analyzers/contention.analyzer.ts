import { Injectable } from '@nestjs/common';
import {
  ContentionAnalysis,
  ConfidenceLevel,
} from '../../dto/trace-analysis.dto';
import { SpanAggregation } from './span-aggregation.service';
import { HierarchyInfo, HierarchyBuilderService } from './hierarchy-builder.service';

/**
 * Service responsible for analyzing contention patterns
 * Handles: detecting resource contention, queuing delays, start delays
 */
@Injectable()
export class ContentionAnalyzer {
  constructor(private readonly hierarchyBuilder: HierarchyBuilderService) {}

  /**
   * Analyze contention patterns
   */
  analyzeContention(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
    hierarchyInfo?: HierarchyInfo,
  ): ContentionAnalysis[] {
    const contentions: ContentionAnalysis[] = [];

    // Use provided hierarchy info or build it
    const { depthMap } = hierarchyInfo ||
      this.hierarchyBuilder.buildHierarchyMaps(current, baseline);

    for (const [key, curr] of current) {
      const base = baseline.get(key);
      if (!base || !curr.parentSpanName) continue;

      const delayIncrease = curr.avgStartDelay - base.avgStartDelay;
      if (delayIncrease <= 1) continue; // Ignore small delays

      const isContentionIndicator = delayIncrease > 10; // 10ms threshold
      const confidence: ConfidenceLevel =
        delayIncrease > 50 ? 'high' : delayIncrease > 20 ? 'medium' : 'low';

      let explanation = '';
      if (isContentionIndicator) {
        explanation =
          'Increased start delay suggests resource contention or queuing before span execution';
      } else {
        explanation = 'Minor start delay increase, may not be significant';
      }

      // Get depth info
      const depth = depthMap.get(key) || 0;

      contentions.push({
        spanName: curr.spanName,
        parentSpanName: curr.parentSpanName,
        currentStartDelay: Math.round(curr.avgStartDelay * 100) / 100,
        baselineStartDelay: Math.round(base.avgStartDelay * 100) / 100,
        startDelayIncrease: Math.round(delayIncrease * 100) / 100,
        isContentionIndicator,
        confidence,
        explanation,
        depth,
      });
    }

    // Sort by delay increase
    contentions.sort((a, b) => b.startDelayIncrease - a.startDelayIncrease);

    return contentions.slice(0, 10);
  }
}
