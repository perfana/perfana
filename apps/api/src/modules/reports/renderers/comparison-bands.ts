import { REPORT_COLORS, type ReportStatus } from './report-style';

export interface DiffThresholds { good: number; warning: number; }

export function percentDiff(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

/**
 * Band color for bars/dots (magnitude coloring). Any diff <= 0 is "good"
 * here by design — statusFor()/statusFromConclusion() own the LABEL
 * semantics. Boundaries are inclusive (≤ good = good), matching statusFor.
 */
export function bandColor(diffPercent: number | null, thresholds: DiffThresholds): string {
  if (diffPercent == null) return REPORT_COLORS.dot.neutral;
  if (diffPercent <= 0) return REPORT_COLORS.dot.good;   // faster/lower = good
  const abs = Math.abs(diffPercent);
  if (abs <= thresholds.good) return REPORT_COLORS.dot.good;
  if (abs <= thresholds.warning) return REPORT_COLORS.dot.warn;
  return REPORT_COLORS.dot.bad;
}

/**
 * Rule 01 — collapse a data-layer ADAPT conclusion label onto the report's
 * five-state status scale. Judgment lives in this label; raw direction stays
 * in the delta arrow. Handles both snake_case and space-separated variants.
 *
 * ADAPT emits `increase`/`decrease`/`partial increase`/`partial decrease`
 * ONLY when the metric's direction preference is unclassified
 * (higherIsBetter IS NULL) — the engine explicitly declined to judge which
 * direction is bad. Those labels therefore map to WARNING (notable drift,
 * judgment unknown), never to REGRESSION or IMPROVEMENT.
 */
export function statusFromConclusion(conclusion: string | null | undefined): ReportStatus {
  const label = (conclusion ?? '').toLowerCase().replace(/_/g, ' ').trim();
  switch (label) {
    case 'regression':
      return 'regression';
    case 'partial regression':
    case 'increase':
    case 'decrease':
    case 'partial increase':
    case 'partial decrease':
      return 'warning';
    case 'improvement':
    case 'partial improvement':
      return 'improvement';
    case 'no difference':
    case 'passed':
      return 'ok';
    default:
      // incomparable, ignored, skipped, no data, insufficient data, unknown, ''
      return 'na';
  }
}
