// Types re-exported from perfana-client (single source of truth)
import type {
  TransactionStats,
  ErrorSummary,
  ErrorByCode,
  ErrorByTransaction,
  AdaptMetricSummary,
  AdaptConclusion,
  TrackedRegression,
  TrackedRegressionsResponse,
} from './perfana-client.js';

export type {
  TransactionStats,
  ErrorSummary,
  ErrorByCode,
  ErrorByTransaction,
  AdaptMetricSummary,
  AdaptConclusion,
  TrackedRegression,
  TrackedRegressionsResponse,
};

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

// ─── Adapt results summary helper ──────────────────────────────────────────

interface ClassifiedMetric extends AdaptMetricSummary {
  classification: string;
  hypothesis: string;
}

interface DashboardGroup {
  dashboard: string;
  sourceType: string;
  regressionCount: number;
  topMetrics: Array<{ metric_name: string; change_pct: number | null; panel: string }>;
}

interface CausalChain {
  description: string;
  confidence: 'High' | 'Medium' | 'Low';
  sources: string[];
}

export interface AdaptSummary {
  verdict: string;
  controlGroupId: string | null;
  updatedAt: string;
  totalRegressions: number;
  totalImprovements: number;
  totalDifferences: number;
  trackedRegressions: {
    unresolved: number;
    total: number;
    items: TrackedRegression[];
  };
  classifiedRegressions: ClassifiedMetric[];
  classifiedImprovements: ClassifiedMetric[];
  byDashboard: DashboardGroup[];
  causalChains: CausalChain[];
  hypotheses: string[];
}

/** Format a percentage change safely, handling null and NaN. */
function fmtPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return 'unknown change';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function classifyMetric(m: AdaptMetricSummary): { classification: string; hypothesis: string } {
  const mn = m.metric_name.toLowerCase();
  const panel = (m.panel ?? '').toLowerCase();
  const dashboard = (m.dashboard ?? '').toLowerCase();

  if (mn.endsWith('_compute') || mn.endsWith('_processing') || mn.endsWith('_ranking') ||
      mn.endsWith('_engine') || mn.endsWith('_hash') || mn.endsWith('_generate') ||
      mn.includes('/cpu/')) {
    return { classification: 'Computation kernel', hypothesis: `CPU-bound work regression in compute sub-request: ${m.metric_name} (${fmtPct(m.change_pct)})` };
  }
  if (panel.includes('transaction rt') || panel.includes('transaction apdex')) {
    return { classification: 'Transaction latency', hypothesis: `Transaction latency regression: ${m.metric_name} (${fmtPct(m.change_pct)})` };
  }
  if (panel.includes('request rt') || panel.includes('request latency')) {
    return { classification: 'Request latency', hypothesis: `Request latency regression in ${m.metric_name}` };
  }
  if (dashboard.includes('jvm memory') || dashboard.includes('g1gc')) {
    return { classification: 'JVM memory / GC', hypothesis: `JVM GC pressure: ${m.metric_name} (${fmtPct(m.change_pct)})` };
  }
  if (dashboard.includes('jvm') && (panel.includes('cpu') || panel.includes('threads'))) {
    return { classification: 'JVM CPU / threads', hypothesis: `JVM CPU/thread contention: ${m.metric_name}` };
  }
  if (dashboard.includes('docker container')) {
    return { classification: 'Container resources', hypothesis: `Container resource spike: ${m.metric_name} (${fmtPct(m.change_pct)})` };
  }
  if (dashboard.includes('hikari') || dashboard.includes('connection pool')) {
    return { classification: 'DB connection pool', hypothesis: `Connection pool pressure: ${m.metric_name}` };
  }
  if (panel.includes('error rate') || panel.includes('error count')) {
    return { classification: 'Error rates', hypothesis: `Error rate regression: ${m.metric_name}` };
  }
  if (panel.includes('throughput')) {
    return { classification: 'Throughput', hypothesis: `Throughput drop (secondary effect): ${m.metric_name}` };
  }
  return { classification: 'Other', hypothesis: `Regression in ${m.metric_name} on ${m.dashboard}` };
}

function inferSourceType(dashboard: string): string {
  const d = dashboard.toLowerCase();
  if (d.includes('jmeter') || d.includes('gatling') || d.includes('k6') || d.includes('neoload') || d.includes('performance test')) return 'Performance test';
  if (d.includes('jvm') || d.includes('g1gc') || d.includes('micrometer')) return 'JVM monitoring';
  if (d.includes('docker') || d.includes('container') || d.includes('kubernetes')) return 'Infrastructure';
  if (d.includes('hikari') || d.includes('connection pool')) return 'Connection pool';
  if (d.includes('http')) return 'HTTP metrics';
  if (d.includes('dynatrace')) return 'Dynatrace';
  return 'Other';
}

function detectCausalChains(groups: DashboardGroup[]): CausalChain[] {
  const chains: CausalChain[] = [];
  const sourceTypes = new Set(groups.map(g => g.sourceType));

  const hasPerfTest = sourceTypes.has('Performance test');
  const hasInfra = sourceTypes.has('Infrastructure');
  const hasJvm = sourceTypes.has('JVM monitoring');
  const hasConnPool = sourceTypes.has('Connection pool');

  if (hasPerfTest && hasInfra && hasJvm) {
    chains.push({
      description: 'Compute regressions (perf test) -> CPU spike (container) -> GC pressure (JVM)',
      confidence: 'High',
      sources: ['Performance test', 'Infrastructure', 'JVM monitoring'],
    });
  }
  if (hasPerfTest && hasInfra) {
    chains.push({
      description: 'Latency regression (perf test) -> container resource saturation',
      confidence: 'High',
      sources: ['Performance test', 'Infrastructure'],
    });
  }
  if (hasPerfTest && hasConnPool) {
    chains.push({
      description: 'Latency regression (perf test) -> connection pool saturation',
      confidence: 'High',
      sources: ['Performance test', 'Connection pool'],
    });
  }
  if (hasPerfTest && hasJvm && !hasInfra) {
    chains.push({
      description: 'Latency regression (perf test) -> GC pressure (JVM)',
      confidence: 'Medium',
      sources: ['Performance test', 'JVM monitoring'],
    });
  }

  return chains;
}

export function buildAdaptSummary(
  conclusion: AdaptConclusion,
  tracked: TrackedRegressionsResponse,
): AdaptSummary {
  // Defensive: default to empty arrays if API returns null/undefined
  const regressions = conclusion.regressions ?? [];
  const improvements = conclusion.improvements ?? [];
  const differences = conclusion.differences ?? [];

  const classifyAll = (metrics: AdaptMetricSummary[]): ClassifiedMetric[] =>
    metrics.map(m => ({ ...m, ...classifyMetric(m) }));

  const classifiedRegressions = classifyAll(regressions);
  const classifiedImprovements = classifyAll(improvements);

  // Group regressions by dashboard
  const dashboardMap = new Map<string, AdaptMetricSummary[]>();
  for (const r of regressions) {
    const key = r.dashboard || 'Unknown';
    if (!dashboardMap.has(key)) dashboardMap.set(key, []);
    dashboardMap.get(key)!.push(r);
  }

  const byDashboard: DashboardGroup[] = [...dashboardMap.entries()]
    .map(([dashboard, metrics]) => ({
      dashboard,
      sourceType: inferSourceType(dashboard),
      regressionCount: metrics.length,
      topMetrics: [...metrics]
        .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0))
        .slice(0, 5)
        .map(m => ({ metric_name: m.metric_name, change_pct: m.change_pct, panel: m.panel })),
    }))
    .sort((a, b) => b.regressionCount - a.regressionCount);

  const causalChains = detectCausalChains(byDashboard);

  // Deduplicate hypotheses
  const hypothesisSet = new Set<string>();
  for (const r of classifiedRegressions) {
    hypothesisSet.add(r.hypothesis);
  }
  for (const chain of causalChains) {
    hypothesisSet.add(`Causal chain: ${chain.description} [${chain.confidence} confidence]`);
  }

  return {
    verdict: conclusion.conclusion,
    controlGroupId: conclusion.control_group_id ?? null,
    updatedAt: conclusion.updated_at,
    totalRegressions: regressions.length,
    totalImprovements: improvements.length,
    totalDifferences: differences.length,
    trackedRegressions: {
      unresolved: tracked.unresolvedCount,
      total: tracked.totalTracked,
      items: tracked.regressions ?? [],
    },
    classifiedRegressions,
    classifiedImprovements,
    byDashboard,
    causalChains,
    hypotheses: [...hypothesisSet],
  };
}
