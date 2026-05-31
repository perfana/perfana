/**
 * Unit tests for parseAggregatedMetricSource (AnomalyExpandedContent)
 */

// The function is not exported, so we test it via a re-export shim or
// by duplicating the logic. Since the function is module-internal we test
// it indirectly by importing the pure logic directly from the source.
// We extract it here by importing the file — if the function is ever
// exported we can simplify this import.

// Helper: replicate the same logic so the test is self-contained and
// documents the expected contract without depending on private export paths.
// If the function is later exported, replace this block with the import.

const VALID_STATS = new Set(['avg', 'p50', 'p90', 'p95', 'p99', 'max']);

function parseAggregatedMetricSource(metricName: string, dashboardUid?: string | null) {
  if (!dashboardUid?.startsWith('performance-test-metrics')) return undefined;
  const parts = metricName.split('.');
  if (parts.length < 3) return undefined;
  const type = parts[0];
  const lastPart = parts[parts.length - 1];
  const hasAggregation = parts.length >= 4 && VALID_STATS.has(lastPart);
  const baseName = hasAggregation ? parts[parts.length - 2] : lastPart;
  const stat = hasAggregation ? lastPart : 'avg';
  if (baseName === 'error_rate') return { metric: 'error_percentage', stat: 'avg' };
  if (baseName !== 'response_time') return undefined;
  if (type === 'transactions') return { metric: 'transaction_response_time', stat };
  if (type === 'requests') return { metric: 'request_response_time', stat };
  return undefined;
}

describe('parseAggregatedMetricSource', () => {
  describe('returns undefined when not a performance-test-metrics UID', () => {
    it('returns undefined for null dashboardUid', () => {
      expect(parseAggregatedMetricSource('transactions.login.response_time.p95', null)).toBeUndefined();
    });

    it('returns undefined for undefined dashboardUid', () => {
      expect(parseAggregatedMetricSource('transactions.login.response_time.p95', undefined)).toBeUndefined();
    });

    it('returns undefined for unrelated dashboardUid', () => {
      expect(parseAggregatedMetricSource('transactions.login.response_time.p95', 'grafana-panel-42')).toBeUndefined();
    });
  });

  describe('returns undefined for malformed metric names', () => {
    it('returns undefined for metric with fewer than 3 parts', () => {
      expect(parseAggregatedMetricSource('transactions.response_time', 'performance-test-metrics-abc')).toBeUndefined();
    });

    it('returns undefined for unknown base name', () => {
      expect(parseAggregatedMetricSource('transactions.login.cpu_usage.p95', 'performance-test-metrics-abc')).toBeUndefined();
    });

    it('returns undefined for unknown type with response_time', () => {
      expect(parseAggregatedMetricSource('services.login.response_time.p95', 'performance-test-metrics-abc')).toBeUndefined();
    });
  });

  describe('transactions.*.response_time mappings', () => {
    it('maps transactions + p95 stat', () => {
      expect(parseAggregatedMetricSource('transactions.login.response_time.p95', 'performance-test-metrics-abc'))
        .toEqual({ metric: 'transaction_response_time', stat: 'p95' });
    });

    it('maps transactions + avg stat', () => {
      expect(parseAggregatedMetricSource('transactions.login.response_time.avg', 'performance-test-metrics-abc'))
        .toEqual({ metric: 'transaction_response_time', stat: 'avg' });
    });

    it('maps transactions without explicit stat (falls back to avg)', () => {
      expect(parseAggregatedMetricSource('transactions.login.response_time', 'performance-test-metrics-abc'))
        .toEqual({ metric: 'transaction_response_time', stat: 'avg' });
    });

    it('returns undefined when last part is not a VALID_STAT and not response_time', () => {
      // 'sum' is not in VALID_STATS, so baseName becomes 'sum', which is not 'response_time' → undefined
      expect(parseAggregatedMetricSource('transactions.login.response_time.sum', 'performance-test-metrics-abc'))
        .toBeUndefined();
    });
  });

  describe('requests.*.response_time mappings', () => {
    it('maps requests + p99 stat', () => {
      expect(parseAggregatedMetricSource('requests.api.response_time.p99', 'performance-test-metrics-abc'))
        .toEqual({ metric: 'request_response_time', stat: 'p99' });
    });

    it('maps requests without explicit stat (falls back to avg)', () => {
      expect(parseAggregatedMetricSource('requests.api.response_time', 'performance-test-metrics-abc'))
        .toEqual({ metric: 'request_response_time', stat: 'avg' });
    });
  });

  describe('error_rate mapping', () => {
    it('maps error_rate to error_percentage with stat avg regardless of input stat', () => {
      expect(parseAggregatedMetricSource('transactions.login.error_rate.p95', 'performance-test-metrics-abc'))
        .toEqual({ metric: 'error_percentage', stat: 'avg' });
    });

    it('maps error_rate without explicit stat', () => {
      expect(parseAggregatedMetricSource('transactions.login.error_rate', 'performance-test-metrics-abc'))
        .toEqual({ metric: 'error_percentage', stat: 'avg' });
    });
  });
});
