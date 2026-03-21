import type { Theme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import type { MetricTarget, MetricSeriesResult, SortConfig } from '../types/metric-series-table.types';
import {
  formatMetricUnit,
  formatApdexScore,
  isApdexResult,
} from './slo-formatters';

/**
 * Sorts metric targets based on the provided sort configuration.
 * Default sort: failed first, then passed, then unknown.
 */
export function sortMetricTargets(
  targets: MetricTarget[] | undefined,
  sortConfig: Map<string, SortConfig>,
  resultKey: string
): MetricTarget[] {
  if (!targets) return [];

  return [...targets].sort((a, b) => {
    const sortSettings = sortConfig.get(resultKey);

    // If no sort config, default to result: failed first, then passed, then unknown
    if (!sortSettings) {
      const aStatus = getStatusPriority(a.meets_requirement);
      const bStatus = getStatusPriority(b.meets_requirement);
      return aStatus - bStatus;
    }

    const { field, direction } = sortSettings;
    let comparison = 0;

    switch (field) {
      case 'series':
        const aName = a.target || '';
        const bName = b.target || '';
        comparison = aName.localeCompare(bName);
        break;

      case 'value':
        const aValue = Number(a.value) || 0;
        const bValue = Number(b.value) || 0;
        comparison = aValue - bValue;
        break;

      case 'result':
        const aStatus = getStatusPriority(a.meets_requirement);
        const bStatus = getStatusPriority(b.meets_requirement);
        comparison = aStatus - bStatus;
        break;
    }

    return direction === 'desc' ? -comparison : comparison;
  });
}

/**
 * Gets the sort priority for a given meets_requirement value.
 * Failed (false) = 0 (highest priority), Passed (true) = 1, Unknown (undefined) = 2
 */
export function getStatusPriority(meetsRequirement: boolean | undefined): number {
  if (meetsRequirement === false) return 0;
  if (meetsRequirement === true) return 1;
  return 2;
}

/**
 * Formats the metric value for display.
 */
export function formatMetricValue(target: MetricTarget, result: MetricSeriesResult): string {
  if (target.value === null || target.value === undefined) {
    return 'N/A';
  }

  let displayValue = Number(target.value);

  // Handle Apdex scores (show 3 decimal places)
  if (isApdexResult(result)) {
    return formatApdexScore(displayValue);
  }

  const unitSuffix = result.metric_unit ? ' ' + formatMetricUnit(result.metric_unit) : '';

  // Handle percentunit conversion (0.0-1.0 to percentage)
  if (result.metric_unit === 'percentunit') {
    displayValue = Math.round(displayValue * 10000) / 100;
  }

  return `${displayValue.toFixed(2)}${unitSuffix}`;
}

// Common styles for sortable column headers (theme-aware via sx callback)
export const getSortableColumnSx = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  borderRight: '1px solid',
  borderColor: alpha(theme.palette.primary.main, 0.2),
  pr: 2,
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.06),
    transform: 'translateY(-1px)'
  }
});

// Static fallback for components that pass sx directly (backward compat)
export const sortableColumnSx = {
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  borderRight: '1px solid',
  borderColor: 'divider',
  pr: 2,
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: 'action.hover',
    transform: 'translateY(-1px)'
  }
};

export const headerTextSx = {
  fontWeight: 700,
  color: 'primary.dark',
  fontSize: '0.85rem',
  letterSpacing: '0.5px',
  textTransform: 'uppercase' as const
};

// Status chip base styles
export const statusChipBaseSx = {
  height: '28px',
  fontWeight: 700,
  backdropFilter: 'blur(12px)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  '& .MuiChip-label': {
    px: 1.5,
    py: 0.5,
    fontSize: '0.75rem',
    letterSpacing: '0.5px'
  }
};

// Theme-aware color definitions for status chips
export function getChipColorsForTheme(theme: Theme) {
  return {
    warning: {
      background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.warning.main, 0.08)} 50%, ${alpha(theme.palette.warning.main, 0.06)} 100%)`,
      backgroundHover: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.15)} 0%, ${alpha(theme.palette.warning.main, 0.12)} 50%, ${alpha(theme.palette.warning.main, 0.1)} 100%)`,
      border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
      borderHover: `1px solid ${alpha(theme.palette.warning.main, 0.5)}`,
      shadow: `0 2px 8px ${alpha(theme.palette.warning.main, 0.15)}`,
      shadowHover: `0 6px 20px ${alpha(theme.palette.warning.main, 0.25)}, 0 2px 8px ${alpha(theme.palette.warning.main, 0.15)}`,
      color: theme.palette.warning.dark,
    },
    success: {
      background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.1)} 0%, ${alpha(theme.palette.success.main, 0.08)} 50%, ${alpha(theme.palette.success.light, 0.06)} 100%)`,
      backgroundHover: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.15)} 0%, ${alpha(theme.palette.success.main, 0.12)} 50%, ${alpha(theme.palette.success.light, 0.1)} 100%)`,
      border: `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
      borderHover: `1px solid ${alpha(theme.palette.success.main, 0.5)}`,
      shadow: `0 2px 8px ${alpha(theme.palette.success.main, 0.15)}`,
      shadowHover: `0 6px 20px ${alpha(theme.palette.success.main, 0.25)}, 0 2px 8px ${alpha(theme.palette.success.main, 0.15)}`,
      color: theme.palette.success.dark,
    },
    error: {
      background: `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.1)} 0%, ${alpha(theme.palette.error.main, 0.08)} 50%, ${alpha(theme.palette.error.light, 0.06)} 100%)`,
      backgroundHover: `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.15)} 0%, ${alpha(theme.palette.error.main, 0.12)} 50%, ${alpha(theme.palette.error.light, 0.1)} 100%)`,
      border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
      borderHover: `1px solid ${alpha(theme.palette.error.main, 0.5)}`,
      shadow: `0 2px 8px ${alpha(theme.palette.error.main, 0.15)}`,
      shadowHover: `0 6px 20px ${alpha(theme.palette.error.main, 0.25)}, 0 2px 8px ${alpha(theme.palette.error.main, 0.15)}`,
      color: theme.palette.error.main,
    },
  };
}

/**
 * Get chip styles based on status and staleness (theme-aware)
 */
export function getThemedChipStyles(status: 'pass' | 'fail' | 'error', isStale: boolean, theme: Theme) {
  const chipColors = getChipColorsForTheme(theme);
  const colors = status === 'pass' ? chipColors.success : status === 'fail' ? chipColors.error : chipColors.warning;
  const staleColors = chipColors.warning;

  return {
    ...statusChipBaseSx,
    background: isStale ? staleColors.background : colors.background,
    border: isStale ? staleColors.border : colors.border,
    color: isStale ? theme.palette.text.primary : colors.color,
    boxShadow: isStale ? staleColors.shadow : colors.shadow,
    cursor: status === 'error' ? 'help' : 'default',
    '&:hover': {
      transform: 'translateY(-1px) scale(1.02)',
      boxShadow: isStale ? staleColors.shadowHover : colors.shadowHover,
      border: isStale ? staleColors.borderHover : colors.borderHover,
      background: isStale ? staleColors.backgroundHover : colors.backgroundHover,
    },
  };
}

/**
 * @deprecated Use getThemedChipStyles with theme parameter instead
 */
export function getChipStyles(status: 'pass' | 'fail' | 'error', isStale: boolean) {
  // Fallback using static colors - components should migrate to getThemedChipStyles
  return {
    ...statusChipBaseSx,
    cursor: status === 'error' ? 'help' : 'default',
  };
}
