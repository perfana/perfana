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

export interface ScenarioMetrics {
  totalRequests: number;
  totalFailed: number;
  errorRate: number;
  weightedAvgResponseTime: number;
  weightedP95ResponseTime: number;
  weightedP99ResponseTime: number;
  weightedApdexScore: number;
}

export interface TransactionStatLike {
  total_count: number;
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
  const weightedApdexScore = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.apdex_score * t.total_count), 0) / totalRequests
    : 0;

  return {
    totalRequests,
    totalFailed,
    errorRate,
    weightedAvgResponseTime,
    weightedP95ResponseTime,
    weightedP99ResponseTime,
    weightedApdexScore,
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
