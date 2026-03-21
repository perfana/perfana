/**
 * Thin HTTP client for the Perfana REST API.
 * All methods throw on non-2xx responses.
 */
export class PerfanaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  // ─── Test runs ─────────────────────────────────────────────────────────────

  async getTestRun(testRunId: string): Promise<TestRun> {
    return this.get<TestRun>(`/test-runs/${encodeURIComponent(testRunId)}`);
  }

  async getRecentRuns(
    systemUnderTest: string,
    testEnvironment: string,
    workload: string,
    limit: number = 5,
  ): Promise<TestRunListItem[]> {
    // Fetch a larger page and filter client-side, since the listing endpoint
    // doesn't support systemUnderTest/testEnvironment/workload filters yet.
    const params = new URLSearchParams({
      pageSize: String(Math.min(limit * 10, 100)),
      sortBy: 'startTime',
      sortOrder: 'DESC',
    });
    const result = await this.get<{ data: TestRunListItem[] }>(`/test-runs?${params}`);
    const filtered = (result.data ?? []).filter(
      (r) =>
        r.systems_under_test?.name === systemUnderTest &&
        r.test_environment === testEnvironment &&
        r.workload === workload,
    );
    return filtered.slice(0, limit);
  }

  // ─── Transactions ──────────────────────────────────────────────────────────

  async getTransactionStats(
    testRunId: string,
    sinceMinutes?: number,
  ): Promise<TransactionStats[]> {
    const params = new URLSearchParams({ excludeRampUp: 'true' });
    if (sinceMinutes !== undefined) params.set('sinceMinutes', String(sinceMinutes));
    return this.get<TransactionStats[]>(
      `/test-runs/${encodeURIComponent(testRunId)}/transactions?${params}`,
    );
  }

  // ─── Config & check results ────────────────────────────────────────────────

  async getTestRunConfigs(testRunId: string): Promise<TestRunConfigItem[]> {
    return this.get<TestRunConfigItem[]>(`/test-runs/${encodeURIComponent(testRunId)}/configs`);
  }

  async getCheckResults(testRunId: string): Promise<CheckResult[]> {
    return this.get<CheckResult[]>(`/test-runs/${encodeURIComponent(testRunId)}/check-results`);
  }

  // ─── Metrics time-series ─────────────────────────────────────────────────

  async getAvailableMetrics(testRunId: string): Promise<AvailablePanel[]> {
    return this.get<AvailablePanel[]>(
      `/metrics/ds-metrics/available/${encodeURIComponent(testRunId)}`,
    );
  }

  async getMetricTimeSeries(
    testRunId: string,
    dashboardLabel: string,
    panelTitle: string,
    metricName?: string,
    excludeRampUp: boolean = true,
  ): Promise<MetricDataPoint[]> {
    const params = new URLSearchParams({
      dashboardLabel,
      panelTitle,
      excludeRampUp: String(excludeRampUp),
    });
    if (metricName) params.set('metricName', metricName);
    return this.get<MetricDataPoint[]>(
      `/metrics/ds-metrics/time-series/${encodeURIComponent(testRunId)}?${params}`,
    );
  }

  // ─── Adapt (regression analysis) ──────────────────────────────────────────

  async getAdaptConclusion(testRunId: string): Promise<AdaptConclusion> {
    return this.get<AdaptConclusion>(`/adapt/conclusion/${encodeURIComponent(testRunId)}/enriched`);
  }

  async getTrackedRegressions(testRunId: string): Promise<TrackedRegressionsResponse> {
    const params = new URLSearchParams({ testRunId });
    return this.get<TrackedRegressionsResponse>(`/adapt/tracked-regressions?${params}`);
  }

  // ─── Error analysis ──────────────────────────────────────────────────────

  async getErrorSummary(testRunId: string): Promise<ErrorSummary> {
    return this.get<ErrorSummary>(
      `/test-runs/${encodeURIComponent(testRunId)}/error-analysis/summary`,
    );
  }

  async getErrorsByCode(testRunId: string): Promise<ErrorByCode[]> {
    return this.get<ErrorByCode[]>(
      `/test-runs/${encodeURIComponent(testRunId)}/error-analysis/by-code`,
    );
  }

  async getErrorsByTransaction(testRunId: string): Promise<ErrorByTransaction[]> {
    return this.get<ErrorByTransaction[]>(
      `/test-runs/${encodeURIComponent(testRunId)}/error-analysis/by-transaction`,
    );
  }

  async getErrorDetails(
    testRunId: string,
    transactionName: string,
    samplerName: string,
    url: string,
  ): Promise<ErrorDetail[]> {
    const params = new URLSearchParams({ transaction: transactionName, sampler: samplerName, url });
    return this.get<ErrorDetail[]>(
      `/test-runs/${encodeURIComponent(testRunId)}/error-analysis/details?${params}`,
    );
  }

  // ─── Deep links ────────────────────────────────────────────────────────────

  async getDeepLinks(testRunId: string): Promise<ResolvedDeepLink[]> {
    // First get the test run to extract sut/env/workload
    const run = await this.getTestRun(testRunId);

    const params = new URLSearchParams({
      systemUnderTestId: run.system_under_test_id,
      testEnvironment: run.test_environment,
      workload: run.workload,
    });

    const deepLinks = await this.get<DeepLink[]>(`/deep-links?${params}`);

    // Resolve each link with the testRunId
    const resolved = await Promise.allSettled(
      deepLinks.map((link) =>
        this.get<ResolvedDeepLink>(
          `/deep-links/${link.id}/resolve?testRunId=${encodeURIComponent(testRunId)}`,
        ),
      ),
    );

    return resolved
      .filter((r): r is PromiseFulfilledResult<ResolvedDeepLink> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Perfana API error ${res.status} for ${path}: ${body}`);
    }

    return res.json() as Promise<T>;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TestRun {
  test_run_id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  start_time: string;
  end_time: string | null;
  completed: boolean;
  duration: number | null;
  duration_seconds: number | null;
  annotations: string[] | null;
  tags: string[];
  application_release: string | null;
  ci_build_results_url: string | null;
}

export interface TestRunListItem {
  test_run_id: string;
  system_under_test_id: string;
  systems_under_test?: { name: string };
  test_environment: string;
  workload: string;
  start_time: string;
  end_time: string | null;
  completed: boolean;
  duration_seconds: number | null;
}

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

export interface DeepLink {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

export interface TestRunConfigItem {
  key: string;
  value: string;
  category?: string;
}

export interface CheckResult {
  checkName: string;
  passed: boolean;
  description?: string;
  value?: number | string;
  threshold?: number | string;
}

export interface AdaptMetricSummary {
  metric_name: string;
  dashboard: string;
  panel: string;
  unit: string;
  current: number | null;
  baseline: number | null;
  change_pct: number | null;
  absolute_change: number | null;
  conclusion: string | null;
}

export interface AdaptConclusion {
  test_run_id: string;
  conclusion: string;
  control_group_id?: string;
  updated_at: string;
  regressions: AdaptMetricSummary[];
  improvements: AdaptMetricSummary[];
  differences: AdaptMetricSummary[];
}

export interface TrackedRegressionsResponse {
  regressions: TrackedRegression[];
  unresolvedCount: number;
  totalTracked: number;
}

export interface TrackedRegression {
  id: string;
  metricName: string;
  dashboardLabel?: string;
  panelTitle?: string;
  unit?: string;
  status: 'UNRESOLVED' | 'RESOLVED' | 'ACCEPTED';
  severity: string;
  percentageChange: number;
  conclusion?: {
    label: string;       // e.g. "regression", "improvement", "no_change"
    confidence: number;
  };
  trackedConclusion?: {
    label: string;
    confidence: number;
  };
}

export interface ResolvedDeepLink {
  id: string;
  name: string;
  url: string;
  tags: string[];
  hasUnresolvedVariables: boolean;
}

export interface AvailablePanel {
  dashboard_label: string;
  panel_title: string;
  panel_id: number;
  unit: string | null;
  metric_count: string;
  metric_names: string[];
}

export interface MetricDataPoint {
  time: string;
  metric_name: string;
  value: number | null;
  timestep: number;
  ramp_up: boolean;
  unit: string;
}

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

export interface ErrorDetail {
  time: string;
  transactionName: string;
  samplerName: string;
  responseCode: string;
  responseTime: number;
  url: string;
  responseMessage: string;
  responseData: string;
  requestHeaders: string;
  responseHeaders: string;
}
