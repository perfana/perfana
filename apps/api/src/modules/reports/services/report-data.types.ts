/**
 * Shapes the report renderers consume.
 *
 * Split out of report-data-fetcher.service.ts, where 26 exported types sat above the class and
 * accounted for a sixth of the file. They are the contract between the fetcher and the ten
 * renderers that read it, so they are worth reading without scrolling past a query service.
 */

export interface SloSummary {
  passed: number;
  failed: number;
  total: number;
}

/** Individual SLO check result for the SLO renderer */
export interface SloCheckResult {
  benchmark_id: string;
  panel_title: string | null;
  metric_name: string | null;
  metric_unit: string | null;
  evaluate_type: string;
  source: string;
  /** The benchmark's own source — what the SLO card shows as the source chip. */
  benchmark_source: string | null;
  dashboard_label: string | null;
  /** Series filter of a metric check, shown under the metric name like the SLO card does. */
  match_pattern: string | null;
  requirement_operator: string | null;
  requirement_value: number | null;
  panel_average: number | null;
  meets_requirement: boolean | null;
  /** The whole requirement object — apdex and aggregated checks carry fields no operator/value pair can express. */
  requirement: Record<string, unknown> | null;
  /** Per-target outcomes: the transactions/series behind a single pass/fail verdict. */
  targets: SloCheckTarget[] | null;
  /** The checker's own summary line, e.g. "2 of 15 transactions below minimum Apdex 0.85: …". */
  message: string | null;
}

/** One target inside a check — a transaction, a series, a host. */
export interface SloCheckTarget {
  target: string;
  value: number | null;
  meets_requirement: boolean | null;
  /** apdex checks only */
  scenario_name?: string | null;
  threshold_ms?: number | null;
  avg_response_time_ms?: number | null;
  satisfied_count?: number | null;
  tolerating_count?: number | null;
  frustrated_count?: number | null;
  total_count?: number | null;
}

/** Anomaly detection summary for header renderer */
export interface AnomalySummary {
  conclusion: string;
  regressionCount: number;
  improvementCount: number;
}

/** Transaction summary for report rendering */
export interface ReportTransaction {
  name: string;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  pass: number;
  fail: number;
  errPct: number;
}

/** Transaction with Apdex score for apdex rendering */
export interface ApdexTransaction extends ReportTransaction {
  apdex: number;
  threshold: number;
}

/** Scenario data with transactions and optional time series */
export interface ScenarioData {
  scenario: string;
  transactions: ReportTransaction[];
  timeSeries?: Record<string, unknown>[];
  summary?: {
    peakTxnsPerSec: number;
    peakReqsPerSec: number;
    peakVu: number;
    avgVu?: number;
    errors: number;
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
    apdex: number;
  };
}

/** Apdex scenario data with summary and apdex transactions */
export interface ApdexScenarioData {
  scenario: string;
  summary: {
    peakTxnsPerSec: number;
    peakReqsPerSec: number;
    peakVu: number;
    avgVu?: number;
    errors: number;
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
    apdex: number;
  };
  transactions: ApdexTransaction[];
}

/** Overall Apdex metrics */
export interface ApdexOverallData {
  peakTxnsPerSec: number;
  peakReqsPerSec: number;
  peakActiveUsers: number;
  avgActiveUsers: number;
  errorRate: number;
  failedCount: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  apdex: number;
  threshold: number | null;
  thresholdVaries: boolean;
}

/** Full Apdex data returned by getApdexDataFromDatabase */
export interface ApdexData {
  overall: ApdexOverallData;
  scenarios: Record<string, ApdexScenarioData>;
}

/** Throughput statistics (overall and per-scenario) */
export interface ThroughputStats {
  overall: {
    peak_transactions_per_second: number;
    peak_requests_per_second: number;
  };
  by_scenario: Array<{
    scenario_name: string;
    peak_transactions_per_second: number;
    peak_requests_per_second: number;
  }>;
}

/** Virtual user statistics (overall and per-scenario) */
export interface VirtualUserStats {
  overall: {
    peak_active_threads: number;
    avg_active_threads: number;
  };
  by_scenario: Array<{
    scenario_name: string;
    peak_active_threads: number;
    avg_active_threads: number;
  }>;
}

/** AWR report summary for report rendering */
export interface AwrReportSummary {
  id: string;
  dbName: string | null;
  instanceName: string | null;
  dbEdition: string | null;
  dbRelease: string | null;
  hostName: string | null;
  platform: string | null;
  cpus: number | null;
  cores: number | null;
  memoryGb: number | null;
  beginTime: string | null;
  endTime: string | null;
  elapsedMinutes: number | null;
  dbTimeMinutes: number | null;
  parsedData: Record<string, unknown> | null;
}

/** AWR insight for report rendering */
export interface AwrInsightSummary {
  severity: string;
  category: string;
  title: string;
  description: string;
  recommendation: string | null;
  value: number | null;
  unit: string | null;
}

/** Full AWR data for report rendering */
export interface AwrData {
  reports: AwrReportSummary[];
  insights: AwrInsightSummary[];
  severitySummary: { critical: number; warning: number; info: number; total: number };
}

/**
 * One dashboard/panel/series scope for a baseline comparison.
 *
 * Omitting `panelId` selects every panel on the dashboard; omitting `metricNames`
 * selects every series in the panel. A section can hold many of these, which is how
 * one comparison spans several dashboards.
 */
export interface BaselineComparisonSelection {
  dashboardLabel: string;
  panelId?: number;
  metricNames?: string[];
}

/** A single row in a baseline comparison result */
export interface BaselineComparisonRow {
  group: string;    // scenario_name (perf) | dashboard/panel (grafana) | host (dynatrace)
  label: string;    // transaction_name | metric_name
  /** Which dashboard the row came from — a section can span several, so it gets its own table. */
  dashboardLabel?: string;
  panelTitle?: string;
  /** Normalized URL behind a request row (Request RT panels only) — shown as sub-text under the label. */
  url?: string;
  metrics: {        // one entry per selected metric key
    key: 'avg' | 'p90' | 'p95' | 'p99';
    current: number | null;
    baseline: number | null;
    diffPercent: number | null;
  }[];
}

/** Full baseline comparison data returned by getBaselineRunComparison */
export interface BaselineComparisonData {
  source: 'performance-metrics' | 'grafana' | 'dynatrace';
  rows: BaselineComparisonRow[];
}

/** Per-metric regression/improvement detail for report rendering (regressions section) */
export interface RegressionsMetric {
  dashboardLabel: string;
  panelTitle: string;
  metricName: string;
  unit: string | null;
  conclusionLabel: string;
  testValue: number | null;
  controlValue: number | null;
  difference: number | null;
  differencePercent: number | null;
}

/** Full regressions data for report rendering */
export interface RegressionsData {
  conclusion: string;
  regressionCount: number;
  improvementCount: number;
  totalMetrics: number;
  regressions: RegressionsMetric[];
  improvements: RegressionsMetric[];
  noDifference?: RegressionsMetric[];
  /** The runs ADAPT compared this run against. Absent when the control group row is gone. */
  controlGroup?: ControlGroupSummary;
}

/** The set of past runs ADAPT used as the baseline for this run's verdict. */
export interface ControlGroupSummary {
  id: string;
  testRuns: string[];
  /** ADAPT's own count — kept separate from testRuns.length, which can lag it. */
  nTestRuns: number;
  firstDatetime: string | null;
  lastDatetime: string | null;
}

/** Raw ADAPT result row from database query */
export interface AdaptResultRow {
  dashboard_label: string;
  panel_title: string;
  metric_name: string;
  unit: string | null;
  conclusion: Record<string, unknown> | null;
  statistic: Record<string, unknown> | null;
}

/** Raw transaction row from database query */
export interface TransactionRow {
  transaction_name: string;
  avg_ms: string;
  p95_ms: string;
  p99_ms: string;
  pass: string;
  fail: string;
  total: string;
}

/** Raw transaction row with Apdex columns from database query */
export interface ApdexTransactionRow extends TransactionRow {
  scenario_name: string;
  satisfied: string;
  tolerating: string;
  active_threshold: string;
}

/** A single historical test run summary for trends */
export interface TrendRunSummary {
  testRunId: string;
  startTime: Date;
  applicationRelease: string | null;
  duration: number | null;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
  totalTransactions: number;
  consolidatedResult: unknown | null;
  /** Free-text notes attached to the run — what a reader needs to explain a jump. */
  annotations: string[];
}

/** Trends data: current run + historical runs for comparison */
export interface TrendsData {
  currentRun: TrendRunSummary;
  previousRuns: TrendRunSummary[];
}

/** One series' value in every run of a trend window, keyed by test run id. */
export interface MetricTrendSeries {
  dashboardLabel: string;
  panelTitle: string;
  metricName: string;
  unit: string | null;
  valuesByRun: Record<string, number | null>;
}

/** Panel selector for metrics time-series queries */
export interface MetricsPanelSelector {
  dashboardLabel?: string;
  panelTitle?: string;
  metricName?: string;
}

/** A single data point in a metrics time series */
export interface MetricsDataPoint {
  time: Date;
  value: number | null;
}

/** Time-series data for one panel/metric combination */
export interface MetricsTimeSeriesPanel {
  panelTitle: string;
  dashboardLabel: string;
  metricName: string;
  unit: string;
  dataPoints: MetricsDataPoint[];
}

/** Raw metrics row from database query */
export interface MetricsTimeSeriesRow {
  time: string;
  value: number | null;
  metric_name: string;
  panel_title: string;
  dashboard_label: string;
  unit: string;
}

/** Raw throughput scenario row from database query */
export interface ThroughputScenarioRow {
  scenario_name: string;
  peak_transactions_per_second: string;
  peak_requests_per_second: string;
}

/** Raw virtual user scenario row from database query */
export interface VirtualUserScenarioRow {
  scenario_name: string;
  peak_active_threads: string;
  avg_active_threads: string;
}

/** A single ranked row for the Top 10 Lists report section. */
export interface Top10Row {
  label: string;
  secondaryLabel?: string;
  scenarioName: string;
  avgResponseTime: number;
  callCount: number;
  errorCount: number;
  errorRate: number;
  throughput: number;
  impact: number;
}

/** Raw stat-table row shared by all three Top 10 scopes. */
export interface RawTop10Row {
  label: string;
  secondary_label: string | null;
  scenario_name: string | null;
  avg_response_time: string | number | null;
  total_count: string | number | null;
  failed_count: string | number | null;
}
