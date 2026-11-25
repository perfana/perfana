/**
 * Trace Formatters
 * Utility functions for formatting trace analysis data
 */

import type { ConfidenceLevel, TraceAnalysisResponse } from '../types';

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

const ms = (v: number) => `${Number.isFinite(v) ? v.toFixed(1) : '-'} ms`;
const pct = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '-');
const list = (xs: string[], max = 5) => xs.slice(0, max).join(', ') + (xs.length > max ? ` (+${xs.length - max} more)` : '');

/**
 * The Compare Traces result as a few plain-text lines, for a comment written on the Traces Diff
 * tab: what an agent or a report reader needs without the card open. Counts and the top root
 * causes only; the per-span tables stay on the card.
 */
export function summarizeTraceAnalysis(a: TraceAnalysisResponse, comparedFor?: string | null): string {
  // The result stays on screen when the filters change, so say which request it is for.
  const head = comparedFor ? `Compare Traces for ${comparedFor}` : 'Compare Traces';
  if (a.error) return `${head} failed: ${a.error}`;
  const s = a.summary;
  const lines = [
    `${head}:`,
    `Traces: ${s.currentTraceCount} current / ${s.baselineTraceCount} baseline`,
    `Avg duration: ${ms(s.avgDurationCurrent)} vs ${ms(s.avgDurationBaseline)} baseline (${pct(s.avgDurationChangePercent)})`,
    `Avg spans: ${s.avgSpanCountCurrent.toFixed(1)} vs ${s.avgSpanCountBaseline.toFixed(1)} baseline`,
  ];
  const causes = a.rootCauses.filter((r) => r.isLikelyRootCause).slice(0, 3);
  if (causes.length) {
    lines.push(`Likely root causes: ${causes.map((r) => `${r.spanName} (${r.serviceName}) ${pct(r.percentIncrease)}, ${r.confidence} confidence`).join('; ')}`);
  }
  if (a.spanComposition.newSpans.length) lines.push(`New spans: ${list(a.spanComposition.newSpans)}`);
  if (a.spanComposition.missingSpans.length) lines.push(`Missing spans: ${list(a.spanComposition.missingSpans)}`);
  if (a.errorAnalysis.newErrors.length) lines.push(`New errors: ${list(a.errorAnalysis.newErrors)}`);
  if (a.warnings?.length) lines.push(`Warnings: ${list(a.warnings, 3)}`);
  return lines.join('\n');
}
