import { formatValueWithUnit } from '@/lib/units';
import { ThresholdComparisonData } from '../types';

/**
 * Format a number for display
 */
export function formatNumber(value: any): string {
  // Handle null, undefined, or non-numeric values
  if (value === null || value === undefined || value === '' || isNaN(Number(value))) {
    return '-';
  }

  const numValue = Number(value);
  if (numValue === 0) {
    return '0';
  }
  if (Math.abs(numValue) < 0.01) {
    return parseFloat(numValue.toFixed(5)).toString();
  }
  const roundedToTwoDecimals = Math.round(numValue * 100) / 100;
  if (roundedToTwoDecimals === 0) {
    return numValue.toFixed(5).toString();
  } else if (Math.floor(roundedToTwoDecimals) === roundedToTwoDecimals) {
    return numValue.toFixed(0);
  } else {
    return numValue.toFixed(2).toString();
  }
}

/**
 * Format the difference between test and control values
 */
export function formatDifference(
  testValue: string,
  controlValue: string,
  difference: string,
  unit?: string
): string {
  if (!difference || !testValue || !controlValue) return '-';
  const diff = parseFloat(difference);
  const control = parseFloat(controlValue);
  const sign = diff > 0 ? '+' : '';

  // Calculate percentage change
  let percentageText = '';
  if (control !== 0 && !isNaN(control)) {
    const percentage = (diff / control) * 100;
    const percentSign = percentage > 0 ? '+' : '';
    percentageText = ` (${percentSign}${formatNumber(Math.abs(percentage))}%)`;
  }

  return `${sign}${formatValueWithUnit(diff, unit)}${percentageText}`;
}

/**
 * Get config source display information
 */
export function getConfigSourceInfo(configSource?: string): {
  label: string;
  color: 'primary' | 'secondary' | 'default';
  description: string;
} {
  switch (configSource) {
    case 'metric-specific':
      return { label: 'Metric-Specific', color: 'primary', description: 'Configuration specific to this metric' };
    case 'panel-level':
      return { label: 'Panel-Level', color: 'secondary', description: 'Configuration inherited from panel settings' };
    default:
      return { label: 'Default', color: 'default', description: 'Using default system configuration' };
  }
}

/**
 * Generate threshold comparison data for display in detail drawer
 */
export function generateThresholdData(drawerData: any, unit?: string): ThresholdComparisonData[] {
  const thresholds: ThresholdComparisonData[] = [];

  if (drawerData.checks && drawerData.statistic && drawerData.compare_config) {
    // Get primary statistic values
    const testValue = drawerData.statistic?.test || 0;
    const _controlValue = drawerData.statistic?.control || 0;
    const _observedDiff = drawerData.statistic?.diff || 0;

    const config = drawerData.compare_config;
    const checks = drawerData.checks || {};

    // Use pre-calculated thresholds from ds_adapt_result instead of calculating ourselves
    const thresholdRanges = drawerData.thresholds || {};
    const lowerThresholds = thresholdRanges.lower || {};
    const upperThresholds = thresholdRanges.upper || {};

    // Always show all three threshold types

    // Percentage threshold
    const pctThreshold = config.thresholds?.percentageThreshold;
    const pctSource = config.source || 'default';
    const hasPercentageThreshold = pctThreshold !== null && pctThreshold !== undefined;

    let pctValidRange = 'Not set';
    if (hasPercentageThreshold && lowerThresholds.pct !== undefined && upperThresholds.pct !== undefined) {
      // Use the calculated thresholds from ds_adapt_result for percentage with proper unit formatting
      const lowerFormatted = formatValueWithUnit(lowerThresholds.pct, unit);
      const upperFormatted = formatValueWithUnit(upperThresholds.pct, unit);
      pctValidRange = `${lowerFormatted} - ${upperFormatted}`;
    } else if (hasPercentageThreshold) {
      pctValidRange = `± ${formatNumber(pctThreshold * 100)}%`;
    }

    thresholds.push({
      threshold: 'Percent',
      configuredValue: hasPercentageThreshold ? `${formatNumber(pctThreshold * 100)}%` : 'Not set',
      thresholdValue: pctValidRange,
      source: pctSource,
      observedDifference: formatValueWithUnit(testValue, unit),
      result: hasPercentageThreshold ? (checks.pct?.isDifference === false ? 'passed' : 'failed') : 'skipped',
      enabled: hasPercentageThreshold
    });

    // IQR threshold
    const iqrThreshold = config.thresholds?.iqrThreshold;
    const iqrSource = config.source || 'default';
    const hasIqrThreshold = iqrThreshold !== null && iqrThreshold !== undefined;

    let iqrValidRange = 'Not set';
    if (hasIqrThreshold && lowerThresholds.iqr !== undefined && upperThresholds.iqr !== undefined) {
      const lowerFormatted = formatValueWithUnit(lowerThresholds.iqr, unit);
      const upperFormatted = formatValueWithUnit(upperThresholds.iqr, unit);
      iqrValidRange = `${lowerFormatted} - ${upperFormatted}`;
    } else if (hasIqrThreshold) {
      iqrValidRange = `IQR Factor: ${formatNumber(iqrThreshold)}`;
    }

    thresholds.push({
      threshold: 'Interquartile Range Factor',
      configuredValue: hasIqrThreshold ? formatNumber(iqrThreshold) : 'Not set',
      thresholdValue: iqrValidRange,
      source: iqrSource,
      observedDifference: formatValueWithUnit(testValue, unit),
      result: hasIqrThreshold ? (checks.iqr?.isDifference === false ? 'passed' : 'failed') : 'skipped',
      enabled: hasIqrThreshold
    });

    // Absolute threshold
    const absThreshold = config.thresholds?.absoluteThreshold;
    const absSource = config.source || 'default';
    const hasAbsoluteThreshold = absThreshold !== null && absThreshold !== undefined;

    let absValidRange = 'Not set';
    if (hasAbsoluteThreshold && lowerThresholds.overall !== undefined && upperThresholds.overall !== undefined) {
      // Use 'overall' thresholds for absolute since it represents the final calculated range
      const lowerFormatted = formatValueWithUnit(lowerThresholds.overall, unit);
      const upperFormatted = formatValueWithUnit(upperThresholds.overall, unit);
      absValidRange = `${lowerFormatted} - ${upperFormatted}`;
    } else if (hasAbsoluteThreshold) {
      const formattedThreshold = formatValueWithUnit(absThreshold, unit);
      absValidRange = `± ${formattedThreshold}`;
    }

    thresholds.push({
      threshold: 'Absolute',
      configuredValue: hasAbsoluteThreshold ? formatNumber(absThreshold) : 'Not set',
      thresholdValue: absValidRange,
      source: absSource,
      observedDifference: formatValueWithUnit(testValue, unit),
      result: hasAbsoluteThreshold ? (checks.abs?.isDifference === false ? 'passed' : 'failed') : 'skipped',
      enabled: hasAbsoluteThreshold
    });
  }

  // Fallback to legacy thresholds if no checks/compare_config available
  if (thresholds.length === 0 && drawerData.thresholds && drawerData.statistic) {
    // Get primary statistic values
    const testValue = drawerData.statistic?.test || 0;
    const controlValue = drawerData.statistic?.control || 0;
    const _observedDiff = drawerData.statistic?.diff || 0;

    // Calculate percentage difference if control value exists
    const _percentageDiff = controlValue !== 0
      ? ((testValue - controlValue) / Math.abs(controlValue)) * 100
      : 0;

    // Legacy Overall threshold (fallback for legacy format)
    if (drawerData.thresholds.lower?.overall !== undefined || drawerData.thresholds.upper?.overall !== undefined) {
      const lowerOverall = drawerData.thresholds.lower?.overall;
      const upperOverall = drawerData.thresholds.upper?.overall;
      const thresholdValue = lowerOverall !== undefined && upperOverall !== undefined
        ? `${formatNumber(lowerOverall)} - ${formatNumber(upperOverall)}`
        : lowerOverall !== undefined ? `> ${formatNumber(lowerOverall)}`
        : `< ${formatNumber(upperOverall)}`;

      const isWithinThreshold = (
        (lowerOverall === undefined || testValue >= lowerOverall) &&
        (upperOverall === undefined || testValue <= upperOverall)
      );

      thresholds.push({
        threshold: 'Overall',
        configuredValue: 'Legacy',
        thresholdValue,
        source: 'Legacy',
        observedDifference: formatValueWithUnit(testValue, unit),
        result: isWithinThreshold ? 'passed' : 'failed',
        enabled: true
      });
    }
  }

  return thresholds;
}

/**
 * Parse request info from metric for drill-down functionality.
 *
 * New architecture (panel-per-metric-type):
 *   dashboard_label: "Performance test metrics <scenario>"
 *   panel_title:     metric-type name, e.g. "Request RT Avg" or "Transaction RT P90"
 *   metric_name:     request-level: "transactionName.samplerName" or just "samplerName"
 *                    transaction-level: "transactionName"
 *
 * Legacy architecture:
 *   dashboard_label: "Performance Test Metrics - <scenario>"
 *   panel_title:     transaction name
 *   metric_name:     "sampler_name.response_time.avg" (3 parts)
 */
export function parseRequestInfoFromMetric(row: {
  dashboard_label?: string;
  panel_title?: string;
  metric_name?: string;
}): { scenario?: string; transaction?: string; sampler?: string } | null {
  const dashboardLabel = row.dashboard_label || '';
  const panelTitle = row.panel_title || '';
  const metricName = row.metric_name || '';

  // Extract scenario name from dashboard label
  // New format: "Performance test metrics <scenario>" (space separator)
  // Legacy format: "Performance Test Metrics - <scenario>" (hyphen/colon separator)
  let scenario: string | undefined;
  const newFormatMatch = dashboardLabel.match(/^Performance test metrics\s+(.+)/i);
  if (newFormatMatch) {
    const candidate = newFormatMatch[1].trim();
    // Exclude if the match is a hyphen/colon separator remnant
    if (candidate && !candidate.startsWith('-') && !candidate.startsWith(':')) {
      scenario = candidate;
    }
  }

  // Determine if this is a new panel-per-metric-type panel
  // New panels have titles like "Request RT Avg", "Transaction RT P90", etc.
  const isMetricTypePanel = /^(Request|Transaction)\s+/i.test(panelTitle);
  const isRequestPanel = /^Request\s+/i.test(panelTitle);

  let transaction: string | undefined;
  let sampler: string | undefined;

  if (isMetricTypePanel && metricName && metricName !== 'N/A') {
    // New architecture: metric_name contains the transaction/sampler info
    if (isRequestPanel) {
      // Request-level: metric_name is "transactionName.samplerName" or just "samplerName"
      const dotIndex = metricName.indexOf('.');
      if (dotIndex > 0) {
        transaction = metricName.substring(0, dotIndex);
        sampler = metricName.substring(dotIndex + 1);
      } else {
        // Single part = sampler name only (transaction equals sampler, was deduplicated)
        sampler = metricName;
      }
    } else {
      // Transaction-level: metric_name is just the transaction name
      transaction = metricName;
    }
  } else {
    // Legacy architecture or non-metric-type panel
    // Transaction name is the panel title
    if (panelTitle && panelTitle !== 'N/A') {
      transaction = panelTitle;
    }

    // Legacy: "sampler_name.response_time.avg" (3 parts) -> sampler = first part
    if (metricName && metricName !== 'N/A') {
      const parts = metricName.split('.');
      if (parts.length === 3) {
        sampler = parts[0];
      }
    }
  }

  // Return filters if we have at least one value
  if (scenario || transaction || sampler) {
    return {
      scenario,
      transaction,
      sampler,
    };
  }

  return null;
}

/**
 * Check if a row is from a Performance Test Metrics dashboard (only these have drill-down)
 */
export function isPerformanceTestMetricsDashboard(row: { dashboard_label?: string }): boolean {
  const dashboardLabel = row.dashboard_label?.toLowerCase() || '';
  return dashboardLabel.includes('performance test metrics');
}
