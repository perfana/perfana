import { formatValueWithUnit } from '@/lib/units';
import { DrawerData } from './types';

export const getConfigSourceInfo = (configSource?: string) => {
  switch (configSource) {
    case 'metric-specific':
      return { label: 'Metric-Specific', color: 'primary' as const, description: 'Configuration specific to this metric' };
    case 'panel-level':
      return { label: 'Panel-Level', color: 'secondary' as const, description: 'Configuration inherited from panel settings' };
    default:
      return { label: 'Default', color: 'default' as const, description: 'Using default system configuration' };
  }
};

export const getConclusionColor = (conclusion: string) => {
  switch (conclusion.toLowerCase()) {
    case 'regression':
      return 'error';
    case 'improvement':
      return 'success';
    case 'increase':
      return 'warning';
    case 'decrease':
      return 'info';
    case 'no difference':
      return 'default';
    case 'incomparable':
      return 'warning';
    default:
      return 'default';
  }
};

export const getClassificationDisplayInfo = (classification: string) => {
  const normalizedClassification = classification?.toLowerCase();
  switch (normalizedClassification) {
    case 'red_duration':
      return { label: 'RED Duration', color: 'error' as const };
    case 'red_rate':
      return { label: 'RED Rate', color: 'error' as const };
    case 'red_errors':
      return { label: 'RED Errors', color: 'error' as const };
    case 'use_saturation':
      return { label: 'USE Saturation', color: 'warning' as const };
    case 'use_utilization':
      return { label: 'USE Utilization', color: 'warning' as const };
    case 'use_errors':
      return { label: 'USE Errors', color: 'warning' as const };
    case 'business_metric':
      return { label: 'Business Metric', color: 'primary' as const };
    case 'infrastructure_metric':
      return { label: 'Infrastructure Metric', color: 'info' as const };
    case 'application_metric':
      return { label: 'Application Metric', color: 'secondary' as const };
    default:
      return { label: 'Unclassified', color: 'default' as const };
  }
};

export const formatNumber = (value: number | string | null | undefined) => {
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
  }
  return roundedToTwoDecimals.toString();
};

export const formatDifference = (testValue?: number, controlValue?: number, diff?: number, percentageChange?: number, unit?: string) => {
  if (testValue === undefined || testValue === null || controlValue === undefined || controlValue === null) {
    return '-';
  }

  if (diff === undefined || diff === null || percentageChange === undefined || percentageChange === null) {
    return '-';
  }

  const sign = diff > 0 ? '+' : '';

  // Use the shared utility function for consistent unit formatting including percentunit conversion
  const formattedDiffWithUnit = formatValueWithUnit(Math.abs(diff), unit || undefined);

  // Format percentage using the custom number formatter (keep periods for decimals)
  const formattedPercentage = formatNumber(Math.abs(percentageChange));

  return `${sign}${formattedDiffWithUnit} (${formattedPercentage}%)`;
};

// Generate threshold comparison data
export const generateThresholdData = (drawerData: DrawerData, unit?: string) => {
  const thresholds = [];

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
      pctValidRange = `± ${formatNumber(pctThreshold)}%`;
    }

    thresholds.push({
      threshold: 'Percent',
      configuredValue: hasPercentageThreshold ? `${formatNumber(pctThreshold)}%` : 'Not set',
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
        thresholdValue,
        source: 'Legacy',
        observedDifference: formatValueWithUnit(testValue, unit),
        result: isWithinThreshold ? 'passed' : 'failed',
        enabled: true
      });
    }
  }

  return thresholds;
};