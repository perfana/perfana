// ponytail: pure port of apps/api/src/modules/reports/renderers/comparison-bands.ts
// (bandColor/gatedDiffPercent) + REPORT_COLORS.dot palette. Keep in sync if the
// report's band semantics change.

export interface DiffThresholds {
  good: number;
  warning: number;
  /** Min absolute change before a cell is flagged; |current-baseline| below this = "no difference". */
  minAbsolute?: number;
}

export type Band = 'good' | 'warn' | 'bad' | 'neutral';

export const BAND_COLORS: Record<Band, string> = {
  good: '#43a047',
  warn: '#f59e0b',
  bad: '#e04944',
  neutral: '#bdbdbd',
};

/** If |current-baseline| < minAbsolute, collapse the percentage to 0. */
export function gatedDiffPercent(
  current: number | null,
  baseline: number | null,
  diffPercent: number | null,
  minAbsolute?: number,
): number | null {
  if (minAbsolute != null && minAbsolute > 0 && current != null && baseline != null
      && Math.abs(current - baseline) < minAbsolute) {
    return 0;
  }
  return diffPercent;
}

/** Band for a percentage diff. Any diff <= 0 is "good" (lower/faster is better). Inclusive boundaries. */
export function bandOf(diffPercent: number | null | undefined, thresholds: DiffThresholds): Band {
  if (diffPercent == null) return 'neutral';
  if (diffPercent <= 0) return 'good';
  const abs = Math.abs(diffPercent);
  if (abs <= thresholds.good) return 'good';
  if (abs <= thresholds.warning) return 'warn';
  return 'bad';
}

export function rankOf(band: Band): 0 | 1 | 2 {
  return band === 'bad' ? 2 : band === 'warn' ? 1 : 0;
}

/** Worst band across a row's diffs (drives row accent + group summary counts). */
export function worstBand(diffPercents: (number | null | undefined)[], thresholds: DiffThresholds): Band {
  let worst: Band = 'good';
  for (const d of diffPercents) {
    const b = bandOf(d, thresholds);
    if (rankOf(b) > rankOf(worst)) worst = b;
  }
  return worst;
}
