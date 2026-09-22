export const formatNumber = (value: number): string => {
  return value.toFixed(2);
};

export const formatApdex = (value: number): string => {
  return value.toFixed(3);
};

export const getApdexColor = (score: number): string => {
  if (score >= 0.94) return '#4caf50'; // Excellent - green
  if (score >= 0.85) return '#66bb6a'; // Good - light green
  if (score >= 0.70) return '#ff9800'; // Fair - orange
  if (score >= 0.50) return '#f57c00'; // Poor - dark orange
  return '#f44336'; // Unacceptable - red
};

export const getApdexLabel = (score: number): string => {
  if (score >= 0.94) return 'Excellent';
  if (score >= 0.85) return 'Good';
  if (score >= 0.70) return 'Fair';
  if (score >= 0.50) return 'Poor';
  return 'Unacceptable';
};

/** Apdex is meaningless below a handful of samples; same floor as the Apdex SLO default. */
export const APDEX_MIN_SAMPLES = 50;

const APDEX_UNAVAILABLE_COLOR = '#9e9e9e';

export interface ApdexRating {
  /** Chip text: a rating word, or why there is no rating. */
  label: string;
  /** Score text for tooltips/tiles: '0.942', or an em dash when not scoreable. */
  score: string;
  /** The numeric score, or null when not scoreable. */
  scoreValue: number | null;
  color: string;
  /** Non-null when the score was suppressed — render it as the explanation. */
  reason: string | null;
}

/**
 * A rating only when the score means something.
 *
 * Apdex is computed over successful executions, so a transaction that failed every
 * execution has nothing to score — and the sketch it is read from then rates the
 * failures' (usually fast) response times as "Excellent". Below `minSamples`
 * successful executions the score swings on single requests, which is just as
 * misleading. Both cases say so instead of showing a rating.
 */
export const apdexRating = (
  score: number | null | undefined,
  passedCount: number,
  minSamples: number = APDEX_MIN_SAMPLES,
): ApdexRating => {
  if (passedCount <= 0) {
    return {
      label: 'No data',
      score: '\u2014',
      scoreValue: null,
      color: APDEX_UNAVAILABLE_COLOR,
      reason: 'No successful requests to score',
    };
  }
  if (passedCount < minSamples) {
    return {
      label: 'Too few',
      score: '\u2014',
      scoreValue: null,
      color: APDEX_UNAVAILABLE_COLOR,
      reason: `Only ${passedCount.toLocaleString()} successful request(s); Apdex needs at least ${minSamples}`,
    };
  }
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return {
      label: 'No data',
      score: '\u2014',
      scoreValue: null,
      color: APDEX_UNAVAILABLE_COLOR,
      reason: 'No Apdex score available',
    };
  }
  return {
    label: getApdexLabel(score),
    score: formatApdex(score),
    scoreValue: score,
    color: getApdexColor(score),
    reason: null,
  };
};

export interface ScenarioMetrics {
  totalRequests: number;
  totalFailed: number;
  errorRate: number;
  weightedAvgResponseTime: number;
  weightedP95ResponseTime: number;
  weightedP99ResponseTime: number;
  weightedApdexScore: number;
  /** Successful executions behind `weightedApdexScore`; 0 means it is not a score. */
  apdexSampleCount: number;
}

export interface TransactionStatLike {
  total_count: number;
  passed_count: number;
  failed_count: number;
  avg_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  apdex_score: number;
}

export const calculateScenarioMetrics = (transactions: TransactionStatLike[]): ScenarioMetrics => {
  const totalRequests = transactions.reduce((sum, t) => sum + t.total_count, 0);
  const totalFailed = transactions.reduce((sum, t) => sum + t.failed_count, 0);
  const errorRate = totalRequests > 0 ? (totalFailed / totalRequests) * 100 : 0;

  const weightedAvgResponseTime = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.avg_response_time * t.total_count), 0) / totalRequests
    : 0;
  const weightedP95ResponseTime = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.p95_response_time * t.total_count), 0) / totalRequests
    : 0;
  const weightedP99ResponseTime = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.p99_response_time * t.total_count), 0) / totalRequests
    : 0;
  // Only transactions whose own score is meaningful contribute; otherwise one all-failing
  // transaction's "Excellent" would lift the scenario average it has no business in.
  const scoreable = transactions.filter((t) => apdexRating(t.apdex_score, t.passed_count).reason === null);
  const apdexSampleCount = scoreable.reduce((sum, t) => sum + t.passed_count, 0);
  const weightedApdexScore = apdexSampleCount > 0
    ? scoreable.reduce((sum, t) => sum + (t.apdex_score * t.passed_count), 0) / apdexSampleCount
    : 0;

  return {
    totalRequests,
    totalFailed,
    errorRate,
    weightedAvgResponseTime,
    weightedP95ResponseTime,
    weightedP99ResponseTime,
    weightedApdexScore,
    apdexSampleCount,
  };
};

export const maskUrlDynamicData = (url: string): string => {
  if (!url || url === 'N/A') return url;

  return url
    // Mask UUIDs (8-4-4-4-12 format)
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '{uuid}')
    // Mask long hex strings (likely hashes) - 16+ hex characters
    .replace(/\/[0-9a-fA-F]{16,}/g, '/{hash}')
    // Mask numeric IDs in paths (e.g., /user/123 → /user/{id})
    .replace(/\/\d+(?=\/|$)/g, '/{id}')
    // Mask query parameter values with numbers
    .replace(/([?&][^=]+)=\d+/g, '$1={id}')
    // Mask query parameter values with UUIDs
    .replace(/([?&][^=]+)=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '$1={uuid}');
};
