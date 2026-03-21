// ─── Config diff helper ───────────────────────────────────────────────────────

export interface ConfigItem {
  key: string;
  value: string;
  category?: string;
}

export interface ConfigDiff {
  added: Array<{ key: string; value: string; category?: string }>;
  removed: Array<{ key: string; value: string; category?: string }>;
  changed: Array<{ key: string; baseline: string; current: string; category?: string }>;
  unchanged: number;
}

export function diffConfigs(current: ConfigItem[], baseline: ConfigItem[]): ConfigDiff {
  const baseMap = new Map(baseline.map((c) => [c.key, c]));
  const currMap = new Map(current.map((c) => [c.key, c]));

  const added: ConfigDiff['added'] = [];
  const removed: ConfigDiff['removed'] = [];
  const changed: ConfigDiff['changed'] = [];
  let unchanged = 0;

  for (const [key, curr] of currMap) {
    const base = baseMap.get(key);
    if (!base) {
      added.push({ key, value: curr.value, category: curr.category });
    } else if (base.value !== curr.value) {
      changed.push({ key, baseline: base.value, current: curr.value, category: curr.category });
    } else {
      unchanged++;
    }
  }

  for (const [key, base] of baseMap) {
    if (!currMap.has(key)) {
      removed.push({ key, value: base.value, category: base.category });
    }
  }

  return { added, removed, changed, unchanged };
}

// ─── Transaction stats (matches API response) ───────────────────────────────

export interface TransactionStats {
  transaction_name: string;
  scenario_name: string;
  avg_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  passed_count: number;
  failed_count: number;
  total_count: number;
  ranking: number;
  apdex_score: number;
  active_threshold: number;
}

// ─── Comparison helper ────────────────────────────────────────────────────────

export interface ComparisonResult {
  transaction: string;
  status: string;
  current?: TransactionStats;
  p95?: { baseline: number; current: number; changePct: number };
  p99?: { baseline: number; current: number; changePct: number };
  apdex?: { baseline: number; current: number; delta: number };
  errors?: { baseline: number; current: number; changePct: number };
}

function errorRate(t: TransactionStats): number {
  return t.total_count > 0 ? (t.failed_count / t.total_count) * 100 : 0;
}

export function buildComparison(
  current: TransactionStats[],
  baseline: TransactionStats[],
): ComparisonResult[] {
  const baselineMap = new Map(baseline.map((t) => [t.transaction_name, t]));

  return current.map((curr) => {
    const base = baselineMap.get(curr.transaction_name);
    if (!base) return { transaction: curr.transaction_name, status: 'new', current: curr };

    const p95Delta = pctChange(base.p95_response_time, curr.p95_response_time);
    const apdexDelta = (curr.apdex_score ?? 0) - (base.apdex_score ?? 0);
    const errorDelta = pctChange(errorRate(base), errorRate(curr));

    return {
      transaction: curr.transaction_name,
      status: regression(p95Delta, apdexDelta),
      p95: { baseline: base.p95_response_time, current: curr.p95_response_time, changePct: p95Delta },
      p99: { baseline: base.p99_response_time, current: curr.p99_response_time, changePct: pctChange(base.p99_response_time, curr.p99_response_time) },
      apdex: { baseline: base.apdex_score, current: curr.apdex_score, delta: apdexDelta },
      errors: {
        baseline: errorRate(base),
        current: errorRate(curr),
        changePct: errorDelta,
      },
    };
  });
}

export function pctChange(base: number, current: number): number {
  if (base === 0) return 0;
  return Math.round(((current - base) / base) * 1000) / 10; // one decimal
}

export function regression(p95Delta: number, apdexDelta: number): 'regression' | 'improvement' | 'stable' {
  if (p95Delta > 20 || apdexDelta < -0.05) return 'regression';
  if (p95Delta < -10 || apdexDelta > 0.05) return 'improvement';
  return 'stable';
}

// ─── Performance rankings helper ─────────────────────────────────────────────

export type RankingDimension = 'slowest' | 'highest_throughput' | 'highest_impact' | 'highest_error_rate';

export interface RankedTransaction {
  rank: number;
  transaction_name: string;
  scenario_name: string;
  avg_response_time_ms: number;
  p95_response_time_ms: number;
  total_count: number;
  error_rate_pct: number;
  throughput_per_sec: number;
  impact: number;
  apdex_score: number;
}

export interface PerformanceRankingResult {
  dimension: RankingDimension;
  testRunId: string;
  items: RankedTransaction[];
  totalTransactions: number;
}

export function buildPerformanceRanking(
  transactions: TransactionStats[],
  durationSeconds: number,
  dimension: RankingDimension,
  limit: number,
): PerformanceRankingResult {
  const enriched = transactions.map((t) => {
    const throughput = durationSeconds > 0 ? t.total_count / durationSeconds : 0;
    const errRate = t.total_count > 0 ? (t.failed_count / t.total_count) * 100 : 0;
    return {
      transaction_name: t.transaction_name,
      scenario_name: t.scenario_name,
      avg_response_time_ms: t.avg_response_time,
      p95_response_time_ms: t.p95_response_time,
      total_count: t.total_count,
      error_rate_pct: Math.round(errRate * 100) / 100,
      throughput_per_sec: Math.round(throughput * 100) / 100,
      impact: Math.round(t.avg_response_time * t.total_count),
      apdex_score: t.apdex_score,
    };
  });

  const sortFn: Record<RankingDimension, (a: typeof enriched[0], b: typeof enriched[0]) => number> = {
    slowest: (a, b) => b.avg_response_time_ms - a.avg_response_time_ms,
    highest_throughput: (a, b) => b.throughput_per_sec - a.throughput_per_sec,
    highest_impact: (a, b) => b.impact - a.impact,
    highest_error_rate: (a, b) => b.error_rate_pct - a.error_rate_pct,
  };

  enriched.sort(sortFn[dimension]);
  const items = enriched.slice(0, limit).map((t, i) => ({ rank: i + 1, ...t }));

  return {
    dimension,
    testRunId: '',
    items,
    totalTransactions: transactions.length,
  };
}

// ─── Error analysis helper ───────────────────────────────────────────────────

export interface ErrorSummary {
  totalErrors: number;
  uniqueResponseCodes: number;
  transactionsWithErrors: number;
  uniqueErrorUrls: number;
  totalRequests: number;
  errorRate: number;
}

export interface ErrorByCode {
  responseCode: string;
  errorCount: number;
  avgResponseTime: number;
  minResponseTime?: number;
  maxResponseTime?: number;
}

export interface ErrorByTransaction {
  transactionName: string;
  samplerName: string;
  url: string;
  responseCode: string;
  errorCount: number;
  avgResponseTime: number;
}

export interface ErrorAnalysisResult {
  testRunId: string;
  summary: ErrorSummary;
  errorsByCode: ErrorByCode[];
  topErrorsByTransaction: ErrorByTransaction[];
}

export function buildErrorAnalysis(
  testRunId: string,
  summary: ErrorSummary,
  byCode: ErrorByCode[],
  byTransaction: ErrorByTransaction[],
): ErrorAnalysisResult {
  return {
    testRunId,
    summary,
    errorsByCode: byCode,
    topErrorsByTransaction: byTransaction.slice(0, 20),
  };
}
