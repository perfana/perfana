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

export function validateThreshold(threshold: string): string | null {
  const thresholdValue = parseInt(threshold, 10);
  if (isNaN(thresholdValue) || thresholdValue < 1 || thresholdValue > 60000) {
    return 'Threshold must be between 1 and 60,000 milliseconds';
  }
  return null;
}

export function validateApdexScore(score: number): string | null {
  if (score < 0 || score > 1) {
    return 'Minimum Apdex score must be between 0 and 1';
  }
  return null;
}
