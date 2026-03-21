import { Injectable } from '@nestjs/common';
import {
  RootCauseAnalysis,
  TraceSummary,
  ConfidenceLevel,
} from '../../dto/trace-analysis.dto';
import { SpanAggregation } from './span-aggregation.service';
import { HierarchyInfo, HierarchyBuilderService } from './hierarchy-builder.service';

/**
 * Service responsible for analyzing root causes of performance degradation
 * Handles: identifying likely root causes, confidence scoring, contribution analysis
 */
@Injectable()
export class RootCauseAnalyzer {
  constructor(private readonly hierarchyBuilder: HierarchyBuilderService) {}

  /**
   * Analyze root causes of performance degradation
   */
  analyzeRootCauses(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
    summary: TraceSummary,
    hierarchyInfo?: HierarchyInfo,
  ): RootCauseAnalysis[] {
    const rootCauses: RootCauseAnalysis[] = [];
    const totalIncrease = summary.avgDurationChange;

    if (totalIncrease <= 0) {
      return rootCauses; // No degradation
    }

    // Use provided hierarchy info or build it
    const { parentMap, depthMap } = hierarchyInfo ||
      this.hierarchyBuilder.buildHierarchyMaps(current, baseline);

    for (const [key, curr] of current) {
      const base = baseline.get(key);
      if (!base) continue;

      const currAvgDuration = curr.totalDuration / curr.callCount;
      const baseAvgDuration = base.totalDuration / base.callCount;
      const durationIncrease = currAvgDuration - baseAvgDuration;

      const currAvgSelf = curr.selfDuration / curr.callCount;
      const baseAvgSelf = base.selfDuration / base.callCount;
      const selfIncrease = currAvgSelf - baseAvgSelf;

      if (durationIncrease <= 0) continue;

      const percentIncrease = (durationIncrease / baseAvgDuration) * 100;
      const selfPercentIncrease = baseAvgSelf > 0 ? (selfIncrease / baseAvgSelf) * 100 : 0;
      const contributionToTotal = (durationIncrease / totalIncrease) * 100;

      // Determine if this is likely a root cause
      const isLikelyRootCause = selfIncrease > 0 && selfPercentIncrease > 10;
      const confidence = this.calculateConfidence(
        selfPercentIncrease,
        contributionToTotal,
        curr.callCount,
      );

      let explanation = '';
      if (selfIncrease > durationIncrease * 0.5) {
        explanation =
          'High self-duration increase indicates this span\'s own processing is slower';
      } else if (selfIncrease > 0) {
        explanation =
          'Moderate self-duration increase suggests this span contributed to slowdown';
      } else {
        explanation = 'Duration increase likely propagated from child spans';
      }

      // Get hierarchy info
      const parentSpanName = parentMap.get(key);
      const depth = depthMap.get(key) || 0;

      rootCauses.push({
        spanName: curr.spanName,
        serviceName: curr.serviceName,
        durationIncrease: Math.round(durationIncrease * 100) / 100,
        percentIncrease: Math.round(percentIncrease * 10) / 10,
        selfDurationIncrease: Math.round(selfIncrease * 100) / 100,
        selfPercentIncrease: Math.round(selfPercentIncrease * 10) / 10,
        isLikelyRootCause,
        confidence,
        explanation,
        contributionToTotalIncrease: Math.round(contributionToTotal * 10) / 10,
        parentSpanName,
        depth,
      });
    }

    // Sort by contribution to total increase
    rootCauses.sort(
      (a, b) => b.contributionToTotalIncrease - a.contributionToTotalIncrease,
    );

    return rootCauses.slice(0, 10); // Top 10 root causes
  }

  /**
   * Calculate confidence level for root cause
   */
  calculateConfidence(
    selfPercentIncrease: number,
    contributionToTotal: number,
    callCount: number,
  ): ConfidenceLevel {
    if (selfPercentIncrease > 50 && contributionToTotal > 30 && callCount >= 5) {
      return 'high';
    } else if (selfPercentIncrease > 20 || contributionToTotal > 15) {
      return 'medium';
    }
    return 'low';
  }
}
