import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffConfigs,
  buildComparison,
  buildPerformanceRanking,
  buildErrorAnalysis,
  pctChange,
  regression,
} from './helpers.js';
import type { TransactionStats } from './helpers.js';

// ─── pctChange ───────────────────────────────────────────────────────────────

describe('pctChange', () => {
  it('returns 0 when base is 0', () => {
    assert.equal(pctChange(0, 100), 0);
  });

  it('calculates positive change', () => {
    assert.equal(pctChange(100, 120), 20);
  });

  it('calculates negative change', () => {
    assert.equal(pctChange(100, 80), -20);
  });

  it('returns 0 for no change', () => {
    assert.equal(pctChange(100, 100), 0);
  });

  it('rounds to one decimal', () => {
    assert.equal(pctChange(100, 133), 33);
    assert.equal(pctChange(3, 4), 33.3);
  });
});

// ─── regression ──────────────────────────────────────────────────────────────

describe('regression', () => {
  it('returns regression when p95 increase > 20%', () => {
    assert.equal(regression(25, 0), 'regression');
  });

  it('returns regression when apdex drops > 0.05', () => {
    assert.equal(regression(0, -0.1), 'regression');
  });

  it('returns improvement when p95 decrease > 10%', () => {
    assert.equal(regression(-15, 0), 'improvement');
  });

  it('returns improvement when apdex improves > 0.05', () => {
    assert.equal(regression(0, 0.1), 'improvement');
  });

  it('returns stable for small changes', () => {
    assert.equal(regression(5, -0.01), 'stable');
  });

  it('regression takes precedence over improvement thresholds', () => {
    assert.equal(regression(25, 0.1), 'regression');
  });
});

// ─── diffConfigs ─────────────────────────────────────────────────────────────

describe('diffConfigs', () => {
  it('detects added keys', () => {
    const current = [{ key: 'threads', value: '10' }];
    const baseline: typeof current = [];
    const diff = diffConfigs(current, baseline);

    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0].key, 'threads');
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.changed.length, 0);
    assert.equal(diff.unchanged, 0);
  });

  it('detects removed keys', () => {
    const current: { key: string; value: string }[] = [];
    const baseline = [{ key: 'threads', value: '10' }];
    const diff = diffConfigs(current, baseline);

    assert.equal(diff.removed.length, 1);
    assert.equal(diff.removed[0].key, 'threads');
    assert.equal(diff.added.length, 0);
  });

  it('detects changed values', () => {
    const current = [{ key: 'threads', value: '20' }];
    const baseline = [{ key: 'threads', value: '10' }];
    const diff = diffConfigs(current, baseline);

    assert.equal(diff.changed.length, 1);
    assert.equal(diff.changed[0].baseline, '10');
    assert.equal(diff.changed[0].current, '20');
  });

  it('counts unchanged keys', () => {
    const current = [{ key: 'threads', value: '10' }];
    const baseline = [{ key: 'threads', value: '10' }];
    const diff = diffConfigs(current, baseline);

    assert.equal(diff.unchanged, 1);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.changed.length, 0);
  });

  it('handles a mix of added, removed, changed, and unchanged', () => {
    const baseline = [
      { key: 'threads', value: '10' },
      { key: 'pool_size', value: '5' },
      { key: 'timeout', value: '30' },
    ];
    const current = [
      { key: 'threads', value: '10' },
      { key: 'pool_size', value: '10' },
      { key: 'retries', value: '3' },
    ];
    const diff = diffConfigs(current, baseline);

    assert.equal(diff.unchanged, 1);
    assert.equal(diff.changed.length, 1);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.removed.length, 1);
    assert.equal(diff.removed[0].key, 'timeout');
    assert.equal(diff.added[0].key, 'retries');
  });

  it('preserves category in output', () => {
    const current = [{ key: 'jvm.heap', value: '2g', category: 'jvm' }];
    const baseline: typeof current = [];
    const diff = diffConfigs(current, baseline);

    assert.equal(diff.added[0].category, 'jvm');
  });

  it('handles empty inputs', () => {
    const diff = diffConfigs([], []);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.changed.length, 0);
    assert.equal(diff.unchanged, 0);
  });
});

// ─── buildComparison ─────────────────────────────────────────────────────────

function makeTxnStats(overrides: Partial<TransactionStats> = {}): TransactionStats {
  return {
    transaction_name: '/api/checkout',
    scenario_name: 'default',
    avg_response_time: 100,
    p95_response_time: 200,
    p99_response_time: 300,
    passed_count: 990,
    failed_count: 10,
    total_count: 1000,
    ranking: 1,
    apdex_score: 0.9,
    active_threshold: 500,
    ...overrides,
  };
}

describe('buildComparison', () => {
  it('marks new transactions (in current but not baseline)', () => {
    const current = [makeTxnStats({ transaction_name: '/api/new' })];
    const baseline: TransactionStats[] = [];
    const result = buildComparison(current, baseline);

    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'new');
    assert.deepEqual(result[0].current, current[0]);
  });

  it('detects regression when p95 increases > 20%', () => {
    const baseline = [makeTxnStats({ p95_response_time: 100 })];
    const current = [makeTxnStats({ p95_response_time: 130 })];
    const result = buildComparison(current, baseline);

    assert.equal(result[0].status, 'regression');
    assert.equal(result[0].p95!.changePct, 30);
  });

  it('detects regression when apdex drops significantly', () => {
    const baseline = [makeTxnStats({ apdex_score: 0.95 })];
    const current = [makeTxnStats({ apdex_score: 0.85 })];
    const result = buildComparison(current, baseline);

    assert.equal(result[0].status, 'regression');
  });

  it('detects improvement when p95 decreases > 10%', () => {
    const baseline = [makeTxnStats({ p95_response_time: 200 })];
    const current = [makeTxnStats({ p95_response_time: 170 })];
    const result = buildComparison(current, baseline);

    assert.equal(result[0].status, 'improvement');
  });

  it('returns stable for small changes', () => {
    const baseline = [makeTxnStats({ p95_response_time: 200, apdex_score: 0.9 })];
    const current = [makeTxnStats({ p95_response_time: 205, apdex_score: 0.89 })];
    const result = buildComparison(current, baseline);

    assert.equal(result[0].status, 'stable');
  });

  it('handles null apdex_score safely', () => {
    const baseline = [makeTxnStats({ apdex_score: null as unknown as number })];
    const current = [makeTxnStats({ apdex_score: null as unknown as number })];
    const result = buildComparison(current, baseline);

    assert.equal(result[0].apdex!.delta, 0);
  });

  it('compares multiple transactions', () => {
    const baseline = [
      makeTxnStats({ transaction_name: '/api/a', p95_response_time: 100 }),
      makeTxnStats({ transaction_name: '/api/b', p95_response_time: 200 }),
    ];
    const current = [
      makeTxnStats({ transaction_name: '/api/a', p95_response_time: 130 }),
      makeTxnStats({ transaction_name: '/api/b', p95_response_time: 170 }),
    ];
    const result = buildComparison(current, baseline);

    assert.equal(result.length, 2);
    assert.equal(result[0].status, 'regression');
    assert.equal(result[1].status, 'improvement');
  });

  it('includes error rate comparison', () => {
    const baseline = [makeTxnStats({ failed_count: 10, total_count: 1000 })];
    const current = [makeTxnStats({ failed_count: 20, total_count: 1000 })];
    const result = buildComparison(current, baseline);

    assert.equal(result[0].errors!.changePct, 100); // doubled
  });
});

// ─── buildPerformanceRanking ─────────────────────────────────────────────────

describe('buildPerformanceRanking', () => {
  const transactions: TransactionStats[] = [
    makeTxnStats({ transaction_name: 'fast', avg_response_time: 50, total_count: 100, failed_count: 0 }),
    makeTxnStats({ transaction_name: 'slow', avg_response_time: 500, total_count: 50, failed_count: 5 }),
    makeTxnStats({ transaction_name: 'medium', avg_response_time: 200, total_count: 200, failed_count: 2 }),
  ];

  it('ranks by slowest', () => {
    const result = buildPerformanceRanking(transactions, 300, 'slowest', 10);
    assert.equal(result.items[0].transaction_name, 'slow');
    assert.equal(result.items[0].rank, 1);
    assert.equal(result.items.length, 3);
  });

  it('ranks by highest_impact', () => {
    const result = buildPerformanceRanking(transactions, 300, 'highest_impact', 10);
    // medium: 200*200=40000, slow: 500*50=25000, fast: 50*100=5000
    assert.equal(result.items[0].transaction_name, 'medium');
  });

  it('ranks by highest_error_rate', () => {
    const result = buildPerformanceRanking(transactions, 300, 'highest_error_rate', 10);
    // slow: 5/50=10%, medium: 2/200=1%, fast: 0%
    assert.equal(result.items[0].transaction_name, 'slow');
  });

  it('ranks by highest_throughput', () => {
    const result = buildPerformanceRanking(transactions, 300, 'highest_throughput', 10);
    // medium: 200/300=0.67, fast: 100/300=0.33, slow: 50/300=0.17
    assert.equal(result.items[0].transaction_name, 'medium');
  });

  it('respects limit', () => {
    const result = buildPerformanceRanking(transactions, 300, 'slowest', 2);
    assert.equal(result.items.length, 2);
  });

  it('reports totalTransactions', () => {
    const result = buildPerformanceRanking(transactions, 300, 'slowest', 10);
    assert.equal(result.totalTransactions, 3);
  });

  it('computes throughput from duration', () => {
    const result = buildPerformanceRanking(transactions, 100, 'highest_throughput', 1);
    // medium: 200/100 = 2.0
    assert.equal(result.items[0].throughput_per_sec, 2);
  });
});

// ─── buildErrorAnalysis ──────────────────────────────────────────────────────

describe('buildErrorAnalysis', () => {
  it('assembles error analysis result', () => {
    const summary = {
      totalErrors: 10,
      uniqueResponseCodes: 2,
      transactionsWithErrors: 3,
      uniqueErrorUrls: 4,
      totalRequests: 1000,
      errorRate: 1.0,
    };
    const byCode = [
      { responseCode: '500', errorCount: 7, avgResponseTime: 200 },
      { responseCode: '404', errorCount: 3, avgResponseTime: 50 },
    ];
    const byTransaction = [
      { transactionName: 'T01', samplerName: 's1', url: '/api/a', responseCode: '500', errorCount: 5, avgResponseTime: 200 },
    ];

    const result = buildErrorAnalysis('run-1', summary, byCode, byTransaction);

    assert.equal(result.testRunId, 'run-1');
    assert.equal(result.summary.totalErrors, 10);
    assert.equal(result.errorsByCode.length, 2);
    assert.equal(result.topErrorsByTransaction.length, 1);
  });

  it('truncates transactions to 20', () => {
    const summary = {
      totalErrors: 100,
      uniqueResponseCodes: 1,
      transactionsWithErrors: 25,
      uniqueErrorUrls: 25,
      totalRequests: 10000,
      errorRate: 1.0,
    };
    const byTransaction = Array.from({ length: 25 }, (_, i) => ({
      transactionName: `T${i}`,
      samplerName: 's',
      url: `/api/${i}`,
      responseCode: '500',
      errorCount: 1,
      avgResponseTime: 100,
    }));

    const result = buildErrorAnalysis('run-1', summary, [], byTransaction);
    assert.equal(result.topErrorsByTransaction.length, 20);
  });
});
