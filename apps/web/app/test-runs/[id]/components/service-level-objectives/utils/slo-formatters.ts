import type { Theme } from '@mui/material/styles';
import { readableShade } from './metric-series-table-utils';

import { getUnit } from '@/lib/units';
import { CheckResult, CheckResultRequirement, Benchmark } from '@/lib/types';

// Helper function to format metric unit to human readable format
export function formatMetricUnit(metricUnit?: string): string {
  if (!metricUnit) return '';

  const unit = getUnit(metricUnit);
  // Return the format if it exists (works for both known units and unknown fallback)
  // For units like 'short' or 'none' with empty format, returns empty string
  return unit.format || '';
}

/**
 * Whether a check result is an Apdex SLO. Takes only the two fields it reads so
 * the narrower per-table views (MetricSeriesResult, ApdexResult) can be passed
 * without being widened to a full CheckResult.
 */
export function isApdexResult(result: Partial<Pick<CheckResult, 'panel_type' | 'evaluate_type'>>): boolean {
  return result.panel_type === 'apdex' || result.evaluate_type === 'apdex';
}

// Helper function to format Apdex requirement
export function formatApdexRequirement(requirement: CheckResultRequirement | undefined): string {
  if (!requirement || typeof requirement !== 'object') {
    return 'No requirement specified';
  }

  const { min_score } = requirement;
  const minScoreFormatted = min_score !== undefined ? min_score.toFixed(2) : '?';

  return `Apdex ≥ ${minScoreFormatted}`;
}

// Apdex score colour. The two extreme bands used to return the `.dark` tokens
// unconditionally, which MUI resolves mode-blind: in dark mode that is ~3.3:1
// against background.paper, below AA for the 0.8rem value text.
export function getApdexScoreColor(
  score: number | string | null | undefined,
  theme: Theme
): string {
  if (score === null || score === undefined) return 'text.secondary';
  const numScore = typeof score === 'string' ? parseFloat(score) : score;
  if (isNaN(numScore)) return 'text.secondary';
  if (numScore >= 0.94) return readableShade(theme, 'success'); // Excellent - green
  if (numScore >= 0.85) return 'success.main'; // Good - lighter green
  if (numScore >= 0.7) return 'warning.main'; // Fair - orange
  if (numScore >= 0.5) return readableShade(theme, 'warning'); // Poor - deep orange
  return 'error.main'; // Unacceptable - red
}

// Helper function to format Apdex score with color indicator
export function formatApdexScore(score: number | string | null | undefined): string {
  if (score === null || score === undefined) return 'N/A';
  const numScore = typeof score === 'string' ? parseFloat(score) : score;
  if (isNaN(numScore)) return 'N/A';
  return numScore.toFixed(3);
}

// Helper function to determine if a check result is stale
export function isCheckResultStale(
  checkResult: Partial<Pick<CheckResult, 'created_at'>>,
  benchmark: Partial<Pick<Benchmark, 'updated_at'>> | undefined,
): boolean {
  if (!checkResult.created_at || !benchmark?.updated_at) {
    return false;
  }

  const checkResultDate = new Date(checkResult.created_at);
  const benchmarkUpdatedDate = new Date(benchmark.updated_at);

  // Check result is stale if the benchmark was updated after the check result was created
  return benchmarkUpdatedDate > checkResultDate;
}

// Helper function to format aggregated SLO metric label from requirement JSON
export function formatAggregatedMetricLabel(requirement: CheckResultRequirement | undefined): string {
  if (!requirement || typeof requirement !== 'object') return 'Aggregated Metric';
  const req = requirement as { aggregate_metric?: string; aggregate_stat?: string };

  if (req.aggregate_metric === 'error_percentage') return 'Error Percentage';

  const statLabel = req.aggregate_stat
    ? req.aggregate_stat.charAt(0).toUpperCase() + req.aggregate_stat.slice(1)
    : '';
  const metricLabel = req.aggregate_metric === 'transaction_response_time'
    ? 'Transaction Response Times'
    : 'Request Response Times';

  return statLabel ? `${statLabel} ${metricLabel}` : metricLabel;
}

// Helper function to format requirement as human readable text
export function formatRequirement(requirement: CheckResultRequirement | undefined, evaluateType?: string, metricUnit?: string): string {
  if (!requirement || typeof requirement !== 'object') {
    return 'No requirement specified';
  }

  // Aggregated SLO: return just the operator+value expression (e.g. "<= 2000 ms")
  if ((requirement as { type?: string }).type === 'aggregated') {
    const req = requirement as { operator?: string; value?: number };
    const op = req.operator ?? '<=';
    let val = String(req.value ?? 0);
    let unitSuffix = '';
    if (metricUnit) {
      const unit = getUnit(metricUnit);
      if (unit.format) unitSuffix = ` ${unit.format}`;
      if (metricUnit === 'percentunit') {
        val = String(Math.round(Number(req.value) * 10000) / 100);
      }
    }
    return `${op} ${val}${unitSuffix}`;
  }

  const { operator, value } = requirement as { operator?: string; value?: unknown };
  const operatorMap: Record<string, string> = {
    'lt': 'should be less than',
    'le': 'should be less than or equal to',
    'lte': 'should be less than or equal to',
    'gt': 'should be greater than',
    'ge': 'should be greater than or equal to',
    'gte': 'should be greater than or equal to',
    'eq': 'should equal',
    'ne': 'should not equal'
  };

  // Convert evaluate_type to human readable format
  const evaluateTypeMap: Record<string, string> = {
    'avg': 'Average value',
    'max': 'Maximum value',
    'min': 'Minimum value',
    'last': 'Last value',
    'trend': 'Drift over the analysis window',
    'sum': 'Sum value',
    'count': 'Count value',
    'median': 'Median value',
    'q50': '50th percentile',
    'q90': '90th percentile',
    'q95': '95th percentile',
    'q99': '99th percentile'
  };

  const evaluateText = evaluateTypeMap[evaluateType || ''] || 'Value';
  const operatorText = operatorMap[operator ?? ''] || `should ${operator}`;

  // Format the unit using the same logic as config SLO table
  let displayValue = String(value);
  let unitSuffix = '';

  if (metricUnit) {
    const unit = getUnit(metricUnit);
    // If unit has a format, use it (works for both known units and unknown fallback)
    // For units like 'short' or 'none' with empty format, no suffix is added
    if (unit.format) {
      unitSuffix = ` ${unit.format}`;
    }

    // Handle percentunit conversion (0.0-1.0 to percentage)
    if (metricUnit === 'percentunit') {
      displayValue = String(Math.round(Number(value) * 10000) / 100);
    }
  }

  return `${evaluateText} ${operatorText} ${displayValue}${unitSuffix}`;
}

/**
 * A trend SLO's `%/h`, signed, one decimal.
 *
 * Rounds BEFORE testing the sign so -0.04 reads `0.0`, not `-0.0`. Shared by
 * the series table and the chart's fitted-line legend: they sit one above the
 * other, so a second copy of this rule shows up as the same number formatted
 * two ways.
 */
export function formatTrendPctPerHour(pctPerHour: number): string {
  const rounded = Number(pctPerHour.toFixed(1));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} %/h`;
}

/**
 * The identity of one SLO row: its React key, its entry in `expandedSloRows`, and the key
 * its sort and selected-target maps are stored under.
 *
 * `benchmark_id` is in it because two SLOs really can share a dashboard, panel and metric
 * name — nothing stopped that before `uq_benchmarks_active_metric_target` (migration 1812),
 * and SUT-imported and pre-1812 data still carries such pairs. Two rows with one key means
 * React drops the duplicate sibling on the first re-render, so neither row expands, and one
 * row's expand toggles the other's.
 *
 * It is NOT just `result.id`: a re-evaluate rewrites `check_results` with fresh uuids, and
 * the open rows would collapse under the user.
 */
export function getCheckResultKey(
  result: Pick<
    CheckResult,
    'panel_type' | 'evaluate_type' | 'benchmark_id' | 'panel_title' | 'application_dashboard_id' | 'panel_id' | 'metric_name'
  >,
): string {
  const benchmarkId = result.benchmark_id || 'unknown';
  if (isApdexResult(result)) {
    return `apdex_${benchmarkId}_${result.panel_title || 'unknown'}`;
  }
  const dashboardId = result.application_dashboard_id || benchmarkId;
  const panelId = result.panel_id ?? 'unknown';
  const metricName = result.metric_name || 'unknown';
  return `${dashboardId}_${panelId}_${metricName}_${benchmarkId}`;
}
