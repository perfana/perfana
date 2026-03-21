/**
 * Utility functions for Apdex calculations and display
 */

import type { Theme } from '@mui/material/styles';
import type { ApdexTarget, ApdexScenarioSortConfig } from '../types';

/**
 * Get color based on Apdex score category (theme-aware)
 */
export const getThemedApdexColor = (apdex: number | null, theme: Theme): string => {
  if (apdex === null) return theme.palette.grey[500];
  if (apdex >= 0.94) return theme.palette.success.main;
  if (apdex >= 0.85) return theme.palette.info.main;
  if (apdex >= 0.70) return theme.palette.warning.main;
  if (apdex >= 0.50) return theme.palette.warning.main;
  return theme.palette.error.main;
};

/**
 * @deprecated Use getThemedApdexColor with theme parameter instead
 */
export const getApdexColor = (apdex: number | null): string => {
  if (apdex === null) return '#9e9e9e';
  if (apdex >= 0.94) return '#4caf50';
  if (apdex >= 0.85) return '#2196f3';
  if (apdex >= 0.70) return '#ff9800';
  if (apdex >= 0.50) return '#ff9800';
  return '#f44336';
};

/**
 * Get label based on Apdex score category
 */
export const getApdexLabel = (apdex: number): string => {
  if (apdex >= 0.94) return 'Excellent';
  if (apdex >= 0.85) return 'Good';
  if (apdex >= 0.70) return 'Fair';
  if (apdex >= 0.50) return 'Poor';
  return 'Unacceptable';
};

/**
 * Get status order for sorting (failed first, then passed, then unknown)
 */
const getStatusOrder = (meetsRequirement: boolean | undefined): number => {
  if (meetsRequirement === false) return 0;
  if (meetsRequirement === true) return 1;
  return 2;
};

/**
 * Sort Apdex targets based on sort configuration
 * Default sorting: failed first, then passed
 */
export const sortApdexTargets = (
  targets: ApdexTarget[],
  sortConfig?: ApdexScenarioSortConfig
): ApdexTarget[] => {
  return [...targets].sort((a, b) => {
    // Default: failed first, then passed
    if (!sortConfig) {
      return getStatusOrder(a.meets_requirement) - getStatusOrder(b.meets_requirement);
    }

    const { field, direction } = sortConfig;
    let comparison = 0;

    switch (field) {
      case 'series': {
        const aName = a.transaction_name || a.target || '';
        const bName = b.transaction_name || b.target || '';
        comparison = aName.localeCompare(bName);
        break;
      }
      case 'threshold': {
        const aThreshold = Number(a.threshold_ms) || 0;
        const bThreshold = Number(b.threshold_ms) || 0;
        comparison = aThreshold - bThreshold;
        break;
      }
      case 'avgResponseTime': {
        const aAvgRt = Number(a.avg_response_time_ms) || 0;
        const bAvgRt = Number(b.avg_response_time_ms) || 0;
        comparison = aAvgRt - bAvgRt;
        break;
      }
      case 'value': {
        const aValue = Number(a.apdex_score ?? a.value) || 0;
        const bValue = Number(b.apdex_score ?? b.value) || 0;
        comparison = aValue - bValue;
        break;
      }
      case 'result': {
        comparison = getStatusOrder(a.meets_requirement) - getStatusOrder(b.meets_requirement);
        break;
      }
    }

    return direction === 'desc' ? -comparison : comparison;
  });
};

/**
 * Group Apdex targets by scenario name
 */
export const groupTargetsByScenario = (
  targets: ApdexTarget[]
): Map<string, ApdexTarget[]> => {
  const grouped = new Map<string, ApdexTarget[]>();

  targets.forEach(target => {
    const scenario = target.scenario_name || 'Default';
    if (!grouped.has(scenario)) {
      grouped.set(scenario, []);
    }
    grouped.get(scenario)!.push(target);
  });

  return grouped;
};
