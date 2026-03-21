import { Injectable } from '@nestjs/common';
import { SpanAggregation } from './span-aggregation.service';

/**
 * Hierarchy information for span relationships
 */
export interface HierarchyInfo {
  parentMap: Map<string, string | undefined>;
  childrenMap: Map<string, Set<string>>;
  depthMap: Map<string, number>;
  allKeys: Set<string>;
}

/**
 * Service responsible for building span hierarchy relationships
 * Handles: parent-child relationships, depth calculations, tree structure
 */
@Injectable()
export class HierarchyBuilderService {
  /**
   * Build hierarchy information maps for span relationships
   * Returns maps for parent-child relationships and depth information
   */
  buildHierarchyMaps(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
  ): HierarchyInfo {
    const allKeys = new Set([...current.keys(), ...baseline.keys()]);

    // Build parent-child relationships map
    // Key format is "serviceName::spanName", parentSpanName is just the operation name
    const parentMap = new Map<string, string | undefined>();
    const childrenMap = new Map<string, Set<string>>();

    for (const key of allKeys) {
      const curr = current.get(key);
      const base = baseline.get(key);
      const parentSpanName = curr?.parentSpanName || base?.parentSpanName;

      parentMap.set(key, parentSpanName);

      // Find parent key by matching the span name
      if (parentSpanName) {
        for (const potentialParentKey of allKeys) {
          const potentialParent = current.get(potentialParentKey) || baseline.get(potentialParentKey);
          if (potentialParent?.spanName === parentSpanName) {
            const children = childrenMap.get(potentialParentKey) || new Set();
            children.add(key);
            childrenMap.set(potentialParentKey, children);
            break;
          }
        }
      }
    }

    // Calculate depth for each span
    const depthMap = new Map<string, number>();
    const calculateDepth = (key: string, visited: Set<string> = new Set()): number => {
      if (visited.has(key)) return 0; // Prevent cycles
      if (depthMap.has(key)) return depthMap.get(key)!;

      visited.add(key);
      const parentSpanName = parentMap.get(key);

      if (!parentSpanName) {
        depthMap.set(key, 0);
        return 0;
      }

      // Find parent key
      for (const potentialParentKey of allKeys) {
        const potentialParent = current.get(potentialParentKey) || baseline.get(potentialParentKey);
        if (potentialParent?.spanName === parentSpanName) {
          const parentDepth = calculateDepth(potentialParentKey, visited);
          const depth = parentDepth + 1;
          depthMap.set(key, depth);
          return depth;
        }
      }

      depthMap.set(key, 0);
      return 0;
    };

    // Calculate depths for all spans
    for (const key of allKeys) {
      calculateDepth(key);
    }

    return { parentMap, childrenMap, depthMap, allKeys };
  }
}
