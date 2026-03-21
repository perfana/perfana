/**
 * Trace Formatters
 * Utility functions for formatting trace analysis data
 */

import type { ConfidenceLevel } from '../types';

/**
 * Format a numeric value based on the specified format type
 */
export function formatValue(value: number, format: 'number' | 'ms' | 'percent' = 'number'): string {
  switch (format) {
    case 'ms':
      return `${value.toFixed(1)}ms`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    default:
      return value.toLocaleString();
  }
}

/**
 * Get color for change value based on direction and whether to invert
 */
export function getChangeColor(
  changePercent: number | undefined,
  invertColors: boolean = false
): string {
  if (changePercent === undefined || changePercent === 0) return 'text.secondary';
  const isPositive = changePercent > 0;
  if (invertColors) {
    return isPositive ? 'error.main' : 'success.main';
  }
  return isPositive ? 'success.main' : 'error.main';
}

/**
 * Get chip color for confidence level
 */
export function getConfidenceColor(confidence: ConfidenceLevel): 'error' | 'warning' | 'default' {
  switch (confidence) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    default:
      return 'default';
  }
}

/**
 * Get text color based on duration change percentage
 */
export function getDurationChangeColor(changePercent: number): string {
  if (changePercent > 10) return 'error.main';
  if (changePercent < -10) return 'success.main';
  return 'text.primary';
}

/**
 * Get sampler change color based on percentage
 */
export function getSamplerChangeColor(changePercent: number): string {
  if (changePercent > 20) return 'error.main';
  if (changePercent < -20) return 'success.main';
  return 'text.primary';
}

/**
 * Get contribution color based on percentage
 */
export function getContributionColor(contribution: number): string {
  return contribution > 25 ? 'error.main' : 'text.secondary';
}

/**
 * Get row background color based on span state
 */
export function getSpanRowBackgroundColor(
  isNewSpan: boolean,
  isMissingSpan: boolean,
  depth: number
): string {
  if (isNewSpan) return 'rgba(25, 118, 210, 0.05)';
  if (isMissingSpan) return 'rgba(211, 47, 47, 0.05)';
  if (depth > 0) return `rgba(0, 0, 0, ${0.01 * depth})`;
  return 'transparent';
}

/**
 * Get root cause row background color
 */
export function getRootCauseBackgroundColor(isLikelyRootCause: boolean, depth: number): string {
  if (isLikelyRootCause) return 'rgba(211, 47, 47, 0.03)';
  if (depth > 0) return `rgba(0, 0, 0, ${0.01 * depth})`;
  return 'transparent';
}

/**
 * Get contention row background color
 */
export function getContentionBackgroundColor(isContentionIndicator: boolean, depth: number): string {
  if (isContentionIndicator) return 'rgba(255, 152, 0, 0.05)';
  if (depth > 0) return `rgba(0, 0, 0, ${0.01 * depth})`;
  return 'transparent';
}

/**
 * Get sampler row background color
 */
export function getSamplerRowBackgroundColor(
  isLikelyProblem: boolean,
  currentTraceCount: number,
  baselineTraceCount: number
): string {
  if (isLikelyProblem) return 'rgba(255, 152, 0, 0.08)';
  if (currentTraceCount === 0 || baselineTraceCount === 0) return 'rgba(25, 118, 210, 0.05)';
  return 'transparent';
}

/**
 * Format change value with sign
 */
export function formatChangeValue(change: number, format: 'number' | 'ms' | 'percent' = 'ms'): string {
  const sign = change > 0 ? '+' : '';
  return `${sign}${formatValue(change, format)}`;
}

/**
 * Format percentage with sign
 */
export function formatPercentChange(percent: number): string {
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}

/**
 * Calculate maximum width based on depth for tree visualization
 */
export function calculateMaxWidth(baseWidth: number, depth: number, depthMultiplier: number = 16): number {
  return baseWidth - depth * depthMultiplier;
}
