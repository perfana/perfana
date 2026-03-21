export function getApdexScoreLabel(score: number): string {
  if (score >= 0.94) return 'Excellent';
  if (score >= 0.85) return 'Good';
  if (score >= 0.7) return 'Fair';
  if (score >= 0.5) return 'Poor';
  return 'Unacceptable';
}

export function getApdexScoreColor(score: number): string {
  if (score >= 0.94) return '#2e8b57';
  if (score >= 0.85) return '#4caf50';
  if (score >= 0.7) return '#ff9800';
  if (score >= 0.5) return '#ff5722';
  return '#f44336';
}

export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 60000;
export const THRESHOLD_STEP = 50;
export const DEFAULT_MIN_APDEX_SCORE = 0.85;
