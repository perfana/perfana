export interface DiffThresholds { good: number; warning: number; }

export function percentDiff(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

export function bandColor(diffPercent: number | null, thresholds: DiffThresholds): string {
  if (diffPercent == null) return '#9e9e9e';
  if (diffPercent <= 0) return '#4caf50';        // faster/lower = good
  const abs = Math.abs(diffPercent);
  if (abs < thresholds.good) return '#4caf50';
  if (abs < thresholds.warning) return '#f59e0b';
  return '#db524e';
}
