import type { ReportStatus } from './report-style';

export interface DiffThresholds { good: number; warning: number; }

export function percentDiff(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

/**
 * Band color for bars/dots (magnitude coloring). Hexes align with
 * REPORT_COLORS.dot from report-style. Any diff <= 0 is "good" here by
 * design — statusFor()/statusFromConclusion() own the LABEL semantics.
 */
export function bandColor(diffPercent: number | null, thresholds: DiffThresholds): string {
  if (diffPercent == null) return '#9e9e9e';
  if (diffPercent <= 0) return '#43a047';        // faster/lower = good
  const abs = Math.abs(diffPercent);
  if (abs < thresholds.good) return '#43a047';
  if (abs < thresholds.warning) return '#f59e0b';
  return '#e04944';
}

/**
 * Rule 01 — collapse a data-layer ADAPT conclusion label onto the report's
 * five-state status scale. Judgment lives in this label; raw direction stays
 * in the delta arrow. Handles both snake_case and space-separated variants.
 */
export function statusFromConclusion(conclusion: string | null | undefined): ReportStatus {
  const label = (conclusion ?? '').toLowerCase().replace(/_/g, ' ').trim();
  switch (label) {
    case 'regression':
    case 'increase':
      return 'regression';
    case 'partial regression':
    case 'partial increase':
      return 'warning';
    case 'improvement':
    case 'decrease':
    case 'partial improvement':
    case 'partial decrease':
      return 'improvement';
    case 'no difference':
    case 'passed':
      return 'ok';
    default:
      // incomparable, ignored, skipped, no data, unknown, ''
      return 'na';
  }
}
