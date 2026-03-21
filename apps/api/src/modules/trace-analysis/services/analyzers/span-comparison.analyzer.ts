import { Injectable } from '@nestjs/common';
import { SpanComparison } from '../../dto/trace-analysis.dto';
import { SpanAggregation } from './span-aggregation.service';
import { HierarchyInfo, HierarchyBuilderService } from './hierarchy-builder.service';

/**
 * Service responsible for comparing spans between current and baseline
 * Handles: span comparison, tree ordering, hierarchical sorting
 */
@Injectable()
export class SpanComparisonAnalyzer {
  constructor(private readonly hierarchyBuilder: HierarchyBuilderService) {}

  /**
   * Compare individual spans between current and baseline
   */
  compareSpans(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
    hierarchyInfo?: HierarchyInfo,
  ): SpanComparison[] {
    const comparisons: SpanComparison[] = [];

    // Use provided hierarchy info or build it
    const { parentMap, childrenMap, depthMap, allKeys } = hierarchyInfo ||
      this.hierarchyBuilder.buildHierarchyMaps(current, baseline);

    for (const key of allKeys) {
      const curr = current.get(key);
      const base = baseline.get(key);

      const currAvg = curr ? curr.totalDuration / curr.callCount : 0;
      const baseAvg = base ? base.totalDuration / base.callCount : 0;
      const durationChange = currAvg - baseAvg;
      const durationChangePercent = baseAvg > 0 ? (durationChange / baseAvg) * 100 : 0;

      const parentSpanName = parentMap.get(key);
      const depth = depthMap.get(key) || 0;
      const hasChildren = childrenMap.has(key) && (childrenMap.get(key)?.size || 0) > 0;

      comparisons.push({
        spanName: curr?.spanName || base?.spanName || key,
        serviceName: curr?.serviceName || base?.serviceName || 'unknown',
        currentAvgDuration: Math.round(currAvg * 100) / 100,
        baselineAvgDuration: Math.round(baseAvg * 100) / 100,
        durationChange: Math.round(durationChange * 100) / 100,
        durationChangePercent: Math.round(durationChangePercent * 10) / 10,
        currentCallCount: curr?.callCount || 0,
        baselineCallCount: base?.callCount || 0,
        callCountChange: (curr?.callCount || 0) - (base?.callCount || 0),
        isNewSpan: !base,
        isMissingSpan: !curr,
        parentSpanName,
        depth,
        hasChildren,
      });
    }

    // Sort spans in tree order (parent before children, then by duration change)
    return this.sortSpansInTreeOrder(comparisons);
  }

  /**
   * Sort spans in tree order for hierarchical display
   */
  sortSpansInTreeOrder(comparisons: SpanComparison[]): SpanComparison[] {
    // Build a map for quick lookup
    const spanMap = new Map<string, SpanComparison>();
    for (const span of comparisons) {
      spanMap.set(span.spanName, span);
    }

    // Find root spans (no parent or parent not in list)
    const rootSpans = comparisons.filter(
      (s) => !s.parentSpanName || !spanMap.has(s.parentSpanName),
    );

    // Sort roots by absolute duration change
    rootSpans.sort((a, b) => Math.abs(b.durationChange) - Math.abs(a.durationChange));

    // Build tree recursively
    const result: SpanComparison[] = [];
    const visited = new Set<string>();

    const addWithChildren = (span: SpanComparison): void => {
      if (visited.has(span.spanName)) return;
      visited.add(span.spanName);

      result.push(span);

      // Find and add children
      const children = comparisons.filter(
        (s) => s.parentSpanName === span.spanName && !visited.has(s.spanName),
      );

      // Sort children by absolute duration change
      children.sort((a, b) => Math.abs(b.durationChange) - Math.abs(a.durationChange));

      for (const child of children) {
        addWithChildren(child);
      }
    };

    for (const root of rootSpans) {
      addWithChildren(root);
    }

    // Add any orphan spans not yet added (in case of broken references)
    for (const span of comparisons) {
      if (!visited.has(span.spanName)) {
        result.push(span);
      }
    }

    return result;
  }
}
