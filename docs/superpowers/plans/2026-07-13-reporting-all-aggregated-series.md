# "All aggregated" series in Reporting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Include 'All aggregated' series" toggle to the three performance-test report sections (Graphs, Transaction Response Times, Comparisons) that renders the run-wide aggregate across all transactions.

**Architecture:** Two new query methods on `ReportDataFetcherService` produce run-wide aggregates (a time-series for charts, scalars for the comparison table). Each of the three renderers reads a new `config.includeAggregated` boolean and appends an aggregated chart/line/row. The web config forms gain one MUI `<Switch>` each. `section.config` is schemaless JSON — no DB migration.

**Tech Stack:** NestJS + TypeORM (API, Jest tests), Next.js + MUI (web), raw SQL over TimescaleDB (`transactions` / `requests_raw` tables).

## Global Constraints

- API is Jest; tests live alongside source as `*.spec.ts`. Run from `apps/api`: `npx jest <path>`.
- `apps/api` tsconfig has `noUncheckedIndexedAccess` — array/object index access is `T | undefined`; guard it. Jest does not catch this; run `npm run type-check` explicitly.
- Never push to `main` — work stays on branch `feat/reporting-all-aggregated-series` (already created), ship via PR. Bump `VERSION` (patch) as part of the PR.
- `section.config` is `Record<string, unknown>` on `ReportSectionConfig` — renderers read it untyped; **no migration**.
- Aggregated data carries no unit: supply `ms` for `*_response_time`, `%` for `error_percentage`.
- Org-filter/system-call convention: pass `userId`/`roles` through; `resolveOrgFilter` returns an empty clause for system calls (`userId === ''`) and admins. Report HTML generation runs with empty `userId`.

---

### Task 1: Aggregate query methods on `ReportDataFetcherService`

**Files:**
- Modify: `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` (add two methods after `getScenarioDataFromDatabase`, ~line 518)
- Test: `apps/api/src/modules/reports/services/report-data-fetcher.aggregated.spec.ts` (create)

**Interfaces:**
- Consumes: existing private `getRampUpCutoffTime(testRunId, excludeRampUp, userId, roles)`, `resolveOrgFilter(userId, roles, paramStartIndex, alias)`, and the module-level `withRequestEm(this.testRunRepo).query(sql, params)` helper (already imported).
- Produces (later tasks rely on these exact signatures):
  ```ts
  getAggregatedSeries(
    testRunId: string,
    metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage',
    stat: 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max',
    excludeRampUp?: boolean,   // default true
    userId?: string,           // default ''
    roles?: string[],          // default []
  ): Promise<{ time: Date; value: number }[]>

  getAggregatedScalars(
    testRunId: string,
    userId?: string,           // default ''
    roles?: string[],          // default []
  ): Promise<{ avg: number | null; p95: number | null; p99: number | null; pass: number; fail: number }>
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/reports/services/report-data-fetcher.aggregated.spec.ts`:

```ts
import { ReportDataFetcherService } from './report-data-fetcher.service';

describe('ReportDataFetcherService aggregate methods', () => {
  it('getAggregatedSeries maps rows to {Date,number} and aggregates across all transactions', async () => {
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([
        { time: '2025-06-01T10:00:00.000Z', value: '120.5' },
        { time: '2025-06-01T10:01:00.000Z', value: '130' },
      ]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const series = await svc.getAggregatedSeries('run-1', 'transaction_response_time', 'avg', false, '', []);

    expect(series).toEqual([
      { time: new Date('2025-06-01T10:00:00.000Z'), value: 120.5 },
      { time: new Date('2025-06-01T10:01:00.000Z'), value: 130 },
    ]);
    const [sql, params] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM transactions');
    expect(sql).toContain("date_trunc('minute', t.time)");
    // The whole point: NO per-transaction grouping — one series for the run.
    expect(sql).not.toMatch(/transaction_name/i);
    // excludeRampUp=false → null cutoff; system call → no org params.
    expect(params).toEqual(['run-1', null]);
  });

  it('getAggregatedSeries uses requests_raw + error math for error_percentage', async () => {
    const testRunRepo = { query: jest.fn().mockResolvedValue([]) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    await svc.getAggregatedSeries('run-1', 'error_percentage', 'avg', false, '', []);

    const [sql] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM requests_raw');
    expect(sql).toContain('FILTER (WHERE NOT t.success)');
  });

  it('getAggregatedScalars returns run-wide avg/p95/p99/pass/fail with no GROUP BY', async () => {
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([{ avg: '110', p95: '220', p99: '300', pass: '980', fail: '20' }]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const s = await svc.getAggregatedScalars('run-1', '', []);

    expect(s).toEqual({ avg: 110, p95: 220, p99: 300, pass: 980, fail: 20 });
    const [sql] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM transactions');
    expect(sql).not.toContain('GROUP BY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/services/report-data-fetcher.aggregated.spec.ts`
Expected: FAIL — `getAggregatedSeries is not a function`.

- [ ] **Step 3: Add the two methods**

In `report-data-fetcher.service.ts`, insert after `getScenarioDataFromDatabase` (before `getApdexDataFromDatabase`, ~line 519):

```ts
  /**
   * Run-wide aggregate time-series across ALL transactions (no GROUP BY
   * transaction_name) — the same aggregate the /aggregated-metric-timeseries
   * endpoint produces, for report rendering.
   * // ponytail: SQL copied from TestRunsPerformanceQueryService.getAggregatedMetricTimeseries.
   * Keep in sync if the aggregate definition changes.
   */
  async getAggregatedSeries(
    testRunId: string,
    metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage',
    stat: 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max',
    excludeRampUp: boolean = true,
    userId: string = '',
    roles: string[] = [],
  ): Promise<{ time: Date; value: number }[]> {
    const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp, userId, roles);
    // params: $1 testRunId, $2 cutoff; org params start at $3
    const orgFilter = await this.resolveOrgFilter(userId, roles, 3, 'tr');

    const statExprMap: Record<typeof stat, string> = {
      avg: 'ROUND(AVG(t.response_time)::numeric, 2)',
      p50: 'ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2)',
      p90: 'ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2)',
      p95: 'ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2)',
      p99: 'ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2)',
      max: 'MAX(t.response_time)::numeric',
    };

    let query: string;
    if (metric === 'error_percentage') {
      query = `
        SELECT date_trunc('minute', t.time) AS time,
          ROUND(COUNT(*) FILTER (WHERE NOT t.success)::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS value
        FROM requests_raw t
        JOIN test_runs tr ON tr.test_run_id = t.test_run_id
        WHERE t.test_run_id = $1
          AND ($2::timestamptz IS NULL OR t.time >= $2::timestamptz)
          ${orgFilter.clause}
        GROUP BY 1
        ORDER BY 1
      `;
    } else {
      const table = metric === 'transaction_response_time' ? 'transactions' : 'requests_raw';
      query = `
        SELECT date_trunc('minute', t.time) AS time, ${statExprMap[stat]} AS value
        FROM ${table} t
        JOIN test_runs tr ON tr.test_run_id = t.test_run_id
        WHERE t.test_run_id = $1
          AND ($2::timestamptz IS NULL OR t.time >= $2::timestamptz)
          ${orgFilter.clause}
        GROUP BY 1
        ORDER BY 1
      `;
    }

    const rows: Array<{ time: string; value: string | null }> =
      await withRequestEm(this.testRunRepo).query(query, [testRunId, cutoffTime, ...orgFilter.params]);
    return rows.map((r) => ({ time: new Date(r.time), value: r.value == null ? 0 : Number(r.value) }));
  }

  /**
   * Run-wide scalar aggregate across ALL transactions for the comparison table
   * (single row, no GROUP BY).
   */
  async getAggregatedScalars(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<{ avg: number | null; p95: number | null; p99: number | null; pass: number; fail: number }> {
    const orgFilter = await this.resolveOrgFilter(userId, roles, 2, 'tr');
    const query = `
      SELECT
        ROUND(AVG(t.response_time)::numeric, 2) AS avg,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) AS p95,
        ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) AS p99,
        COUNT(*) FILTER (WHERE t.success) AS pass,
        COUNT(*) FILTER (WHERE NOT t.success) AS fail
      FROM transactions t
      JOIN test_runs tr ON tr.test_run_id = t.test_run_id
      WHERE t.test_run_id = $1
        ${orgFilter.clause}
    `;
    const rows: Array<Record<string, string | null>> =
      await withRequestEm(this.testRunRepo).query(query, [testRunId, ...orgFilter.params]);
    const r = rows[0] ?? {};
    const num = (v: string | null | undefined) => (v == null ? null : Number(v));
    return {
      avg: num(r.avg),
      p95: num(r.p95),
      p99: num(r.p99),
      pass: Number(r.pass ?? 0),
      fail: Number(r.fail ?? 0),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest src/modules/reports/services/report-data-fetcher.aggregated.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

Run: `cd apps/api && npm run type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/reports/services/report-data-fetcher.service.ts \
        apps/api/src/modules/reports/services/report-data-fetcher.aggregated.spec.ts
git commit -m "feat(reports): run-wide aggregate query methods for All-aggregated series"
```

---

### Task 2: Graphs renderer — aggregated line charts

**Files:**
- Modify: `apps/api/src/modules/reports/renderers/graphs-renderer.ts`
- Test: `apps/api/src/modules/reports/renderers/graphs-renderer.spec.ts`

**Interfaces:**
- Consumes: `ReportDataFetcherService.getAggregatedSeries` (Task 1); existing `MetricsTimeSeriesPanel` shape (`{panelTitle, dashboardLabel, metricName, unit, dataPoints:[{time:Date,value:number|null}]}`).
- Produces: aggregated panels rendered via the existing `renderPanelChart`.

- [ ] **Step 1: Write the failing tests**

In `graphs-renderer.spec.ts`, add `getAggregatedSeries: jest.fn().mockResolvedValue([])` to the `ReportDataFetcherService` `useValue` mock (the object at ~lines 65-70). Then add this block after the `panel selection` describe:

```ts
  describe('All aggregated', () => {
    it('appends aggregated panels when includeAggregated is set, even with no ds_metrics panels', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([]);
      dataFetcher.getAvailableMetricsPanels.mockResolvedValue([]);
      (dataFetcher.getAggregatedSeries as jest.Mock).mockResolvedValue([
        { time: new Date('2025-06-01T10:00:00Z'), value: 120 },
        { time: new Date('2025-06-01T10:01:00Z'), value: 130 },
      ]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { includeAggregated: true } }), makeTestRun(),
      );

      expect(html).toContain('All aggregated');
      expect(html).toContain('Transaction response time');
      expect(dataFetcher.getAggregatedSeries).toHaveBeenCalledWith(
        'run-001', 'transaction_response_time', 'avg', true, '', [],
      );
    });

    it('does not fetch aggregated series when the flag is off', async () => {
      await renderer.renderGraphsSection(makeSection(), makeTestRun());
      expect(dataFetcher.getAggregatedSeries).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/renderers/graphs-renderer.spec.ts -t "All aggregated"`
Expected: FAIL — aggregated panel not in HTML.

- [ ] **Step 3: Implement**

In `graphs-renderer.ts`, add a static spec list inside the class (below `CHART_COLORS`, ~line 31):

```ts
  private static readonly AGGREGATED_METRICS: ReadonlyArray<{
    metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage';
    title: string;
    unit: string;
  }> = [
    { metric: 'transaction_response_time', title: 'All aggregated — Transaction response time (avg)', unit: 'ms' },
    { metric: 'request_response_time', title: 'All aggregated — Request response time (avg)', unit: 'ms' },
    { metric: 'error_percentage', title: 'All aggregated — Error percentage', unit: '%' },
  ];
```

Replace the panel/time-series block (current lines 58-89, from `// Determine panels to render` through the `const charts = ...` assignment) with:

```ts
    // Determine ds_metrics panels to render
    const includeAggregated = config.includeAggregated === true;
    let panels: MetricsPanelSelector[] = [];

    if (Array.isArray(config.panels) && config.panels.length > 0) {
      panels = (config.panels as Array<Record<string, string>>).map((p) => ({
        dashboardLabel: p.dashboardLabel || p.dashboard_label,
        panelTitle: p.panelTitle || p.panel_title,
        metricName: p.metricName || p.metric_name,
      }));
    } else if (!includeAggregated) {
      // Auto-discover available panels (skip when we're only rendering aggregated series)
      panels = await this.dataFetcher.getAvailableMetricsPanels(testRun.testRunId, userId, roles);
    }

    let timeSeriesData: MetricsTimeSeriesPanel[] = [];
    if (panels.length > 0) {
      timeSeriesData = await this.dataFetcher.getMetricsTimeSeries(
        testRun.testRunId, panels, excludeRampUp, userId, roles,
      );
    }
    if (includeAggregated) {
      timeSeriesData = [
        ...timeSeriesData,
        ...(await this.buildAggregatedPanels(testRun.testRunId, excludeRampUp, userId, roles)),
      ];
    }

    if (timeSeriesData.length === 0) {
      return this.renderNoDataSection(
        title, comment,
        includeAggregated
          ? 'No aggregated performance-test data found for this test run.'
          : 'No metric panels configured or discovered for this test run.',
      );
    }

    const charts = timeSeriesData
      .map((panel, idx) => this.renderPanelChart(panel, idx, chartWidth, chartHeight))
      .join('\n');
```

Add the helper method (after `renderGraphsSection`, before `renderPanelChart`):

```ts
  private async buildAggregatedPanels(
    testRunId: string,
    excludeRampUp: boolean,
    userId: string,
    roles: string[],
  ): Promise<MetricsTimeSeriesPanel[]> {
    const out: MetricsTimeSeriesPanel[] = [];
    for (const spec of GraphsRenderer.AGGREGATED_METRICS) {
      const series = await this.dataFetcher.getAggregatedSeries(
        testRunId, spec.metric, 'avg', excludeRampUp, userId, roles,
      );
      if (series.length === 0) continue;
      out.push({
        panelTitle: spec.title,
        dashboardLabel: 'Performance Test Metrics',
        metricName: spec.metric,
        unit: spec.unit,
        dataPoints: series.map((p) => ({ time: p.time, value: p.value })),
      });
    }
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/reports/renderers/graphs-renderer.spec.ts`
Expected: PASS (all, including the two new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports/renderers/graphs-renderer.ts \
        apps/api/src/modules/reports/renderers/graphs-renderer.spec.ts
git commit -m "feat(reports): render All-aggregated line charts in Graphs section"
```

---

### Task 3: Transaction Response Times renderer — aggregated line + row

**Files:**
- Modify: `apps/api/src/modules/reports/renderers/transaction-response-times-renderer.ts`
- Test: `apps/api/src/modules/reports/renderers/transaction-response-times-renderer.spec.ts`

**Interfaces:**
- Consumes: `getAggregatedSeries` + `getAggregatedScalars` (Task 1); existing `ScenarioData` (`{scenario, transactions: ReportTransaction[], timeSeries: TimeSeriesRow[]}`) and `ReportTransaction` (`{name, avgMs, p95Ms, p99Ms, pass, fail, errPct}`). `timeSeries` rows are `{transaction_name, time_bucket, avg_response_time}`.

- [ ] **Step 1: Write the failing test**

In `transaction-response-times-renderer.spec.ts`, add `getAggregatedSeries: jest.fn().mockResolvedValue([])` and `getAggregatedScalars: jest.fn().mockResolvedValue({ avg: null, p95: null, p99: null, pass: 0, fail: 0 })` to the `ReportDataFetcherService` mock. Then add:

```ts
  describe('All aggregated', () => {
    it('prepends an All aggregated row + line when includeAggregated is set', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue({
        scenario: 'all',
        transactions: [{ name: 'login', avgMs: 100, p95Ms: 200, p99Ms: 300, pass: 50, fail: 0, errPct: 0 }],
        timeSeries: [{ transaction_name: 'login', time_bucket: '2025-06-01T10:00:00Z', avg_response_time: '100' }],
      });
      (dataFetcher.getAggregatedSeries as jest.Mock).mockResolvedValue([
        { time: new Date('2025-06-01T10:00:00Z'), value: 150 },
      ]);
      (dataFetcher.getAggregatedScalars as jest.Mock).mockResolvedValue({
        avg: 150, p95: 250, p99: 300, pass: 980, fail: 20,
      });

      const html = await renderer.renderTransactionResponseTimesSection(
        makeSection({ config: { includeAggregated: true } }), makeTestRun(), 'u', ['user'],
      );

      expect(html).toContain('All aggregated');
    });

    it('does not fetch aggregated data when the flag is off', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue({
        scenario: 'all', transactions: [], timeSeries: [],
      });
      await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun(), 'u', ['user']);
      expect(dataFetcher.getAggregatedScalars).not.toHaveBeenCalled();
    });
  });
```

(If the spec has no `makeSection`/`makeTestRun` helpers, mirror the ones in `graphs-renderer.spec.ts` with `type: 'transaction_response_times'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/renderers/transaction-response-times-renderer.spec.ts -t "All aggregated"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `renderTransactionResponseTimesSection`, after the `scenarioData` is fetched and the `if (!scenarioData)` guard (after line 70), insert:

```ts
    let data = scenarioData;
    if (testRun && config.includeAggregated === true && data) {
      const excludeRampUp = config.excludeRampUp !== false;
      const [series, scalars] = await Promise.all([
        this.dataFetcher.getAggregatedSeries(testRun.testRunId, 'transaction_response_time', 'avg', excludeRampUp, userId, roles),
        this.dataFetcher.getAggregatedScalars(testRun.testRunId, userId, roles),
      ]);
      if (series.length > 0 || scalars.avg != null) {
        const total = scalars.pass + scalars.fail;
        data = {
          ...data,
          transactions: [
            {
              name: 'All aggregated',
              avgMs: scalars.avg ?? 0,
              p95Ms: scalars.p95 ?? 0,
              p99Ms: scalars.p99 ?? 0,
              pass: scalars.pass,
              fail: scalars.fail,
              errPct: total > 0 ? (scalars.fail / total) * 100 : 0,
            },
            ...data.transactions,
          ],
          timeSeries: [
            ...series.map((p) => ({
              transaction_name: 'All aggregated',
              time_bucket: p.time.toISOString(),
              avg_response_time: String(p.value),
            })),
            ...(data.timeSeries ?? []),
          ],
        };
      }
    }
```

Then change the two render calls in the returned template (lines 79 and 82) from `scenarioData` to `data`:

```ts
        ${includeChart ? this.renderResponseTimesChart(data) : ''}
        ...
        ${this.renderTransactionsTable(data)}
```

And change the kicker `sectionHeader(title, { kicker: scenarioData.scenario })` (line 74) to use `data.scenario`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/reports/renderers/transaction-response-times-renderer.spec.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/api && npm run type-check && cd ../..
git add apps/api/src/modules/reports/renderers/transaction-response-times-renderer.ts \
        apps/api/src/modules/reports/renderers/transaction-response-times-renderer.spec.ts
git commit -m "feat(reports): add All-aggregated line + row to Transaction Response Times"
```

---

### Task 4: Comparisons renderer — aggregated row

**Files:**
- Modify: `apps/api/src/modules/reports/renderers/comparisons-renderer.ts`
- Test: `apps/api/src/modules/reports/renderers/comparisons-renderer.spec.ts`

**Interfaces:**
- Consumes: `getAggregatedScalars` (Task 1); `percentDiff(current, baseline)` from `./comparison-bands`; `BaselineComparisonRow` type from `../services/report-data-fetcher.service` (`{group, label, metrics:[{key:'avg'|'p95'|'p99', current, baseline, diffPercent}]}`).

- [ ] **Step 1: Write the failing test**

In `comparisons-renderer.spec.ts`, add `getAggregatedScalars: jest.fn()` to the `ReportDataFetcherService` mock. Add:

```ts
  describe('All aggregated (performance-metrics baseline)', () => {
    it('prepends an All aggregated row when includeAggregated is set', async () => {
      dataFetcher.getBaselineRunComparison.mockResolvedValue({
        source: 'performance-metrics',
        rows: [{
          group: 'checkout', label: 'login',
          metrics: [{ key: 'avg', current: 110, baseline: 100, diffPercent: 10 }],
        }],
      });
      (dataFetcher.getAggregatedScalars as jest.Mock)
        .mockResolvedValueOnce({ avg: 150, p95: 250, p99: 300, pass: 0, fail: 0 })  // current
        .mockResolvedValueOnce({ avg: 120, p95: 200, p99: 250, pass: 0, fail: 0 }); // baseline

      const section = makeSection({
        config: {
          comparisonMode: 'baseline_run', source: 'performance-metrics',
          baselineTestRunId: 'base-1', metrics: ['avg'], includeAggregated: true,
        },
      });
      const html = await renderer.renderComparisonsSection(section, makeTestRun(), 'u', ['user']);

      expect(html).toContain('All aggregated');
      expect(dataFetcher.getAggregatedScalars).toHaveBeenCalledTimes(2);
    });
  });
```

(Match `makeSection`/`makeTestRun`/the render entrypoint name to the existing spec. The public entry is `renderComparisonsSection`; it dispatches to the private `renderBaselineRun` when `comparisonMode === 'baseline_run'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/renderers/comparisons-renderer.spec.ts -t "All aggregated"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `comparisons-renderer.ts`:

1. Ensure `percentDiff` and `BaselineComparisonRow` are imported. Add to the existing `comparison-bands` import: `percentDiff`. Add to the existing `report-data-fetcher.service` import: `BaselineComparisonRow`.

2. In `renderBaselineRun`, change `const data = ...` (line 140) to `let data = ...`, then immediately after the `if (!data || data.rows.length === 0)` guard (after line 149) insert:

```ts
    // "All aggregated" row — run-wide aggregate across all transactions (perf-metrics only).
    if (source === 'performance-metrics' && config.includeAggregated === true && testRun && baselineId) {
      const [curS, baseS] = await Promise.all([
        this.dataFetcher.getAggregatedScalars(testRun.testRunId, userId, roles),
        this.dataFetcher.getAggregatedScalars(baselineId, userId, roles),
      ]);
      const byKey: Record<BaselineMetricKey, [number | null, number | null]> = {
        avg: [curS.avg, baseS.avg],
        p95: [curS.p95, baseS.p95],
        p99: [curS.p99, baseS.p99],
      };
      const aggRow: BaselineComparisonRow = {
        group: 'All aggregated',
        label: 'All aggregated',
        metrics: metrics.map((k) => {
          const [cv, bv] = byKey[k];
          return { key: k, current: cv, baseline: bv, diffPercent: percentDiff(cv, bv) };
        }),
      };
      data = { ...data, rows: [aggRow, ...data.rows] };
    }
```

(`metrics` and `BaselineMetricKey` are already in scope in `renderBaselineRun`. The perf-metrics branch groups rows by `row.group`, so this renders as its own "All aggregated" group at the top.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/reports/renderers/comparisons-renderer.spec.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/api && npm run type-check && cd ../..
git add apps/api/src/modules/reports/renderers/comparisons-renderer.ts \
        apps/api/src/modules/reports/renderers/comparisons-renderer.spec.ts
git commit -m "feat(reports): add All-aggregated row to Comparisons baseline table"
```

---

### Task 5: Web UI toggles + config types

**Files:**
- Modify: `apps/web/components/reports/report-generation/SectionConfigs.tsx`
- Modify: `packages/shared/src/types/reports.types.ts`

**Interfaces:**
- Produces the `includeAggregated` boolean into `section.config`, consumed by Tasks 2–4.

- [ ] **Step 1: Add the config field to the three interfaces**

In `SectionConfigs.tsx`:
- `GraphsConfig` (~line 651): add `includeAggregated?: boolean;`
- `TransactionResponseTimesConfig` (~line 433): add `includeAggregated?: boolean;`
- `ComparisonsConfig` (~line 888): add `includeAggregated?: boolean;`

- [ ] **Step 2: Add the toggle to `GraphsConfigForm`**

Inside `GraphsConfigForm`'s `<SectionConfigShell>` children (after the "Show Legends" `FormControlLabel`, ~line 697), add:

```tsx
      <FormControlLabel
        control={
          <Switch
            checked={config.includeAggregated ?? false}
            onChange={(e) => onChange({ ...config, includeAggregated: e.target.checked })}
          />
        }
        label="Include 'All aggregated' series (performance test metrics)"
      />
```

- [ ] **Step 3: Add the toggle to `TransactionResponseTimesConfigForm`**

After the scenario Select/TextField block (before the dev-only debug `Typography`, ~line 551), add the same `FormControlLabel` with label `"Include 'All aggregated' series"`.

- [ ] **Step 4: Add the toggle to `ComparisonsConfigForm`**

Inside the `comparisonMode === 'baseline_run'` block, in the `source === 'performance-metrics'` case — place it right after the Metric checkboxes `<Box>` (~line 1210), gated so it only shows for perf-metrics:

```tsx
          {source === 'performance-metrics' && (
            <FormControlLabel
              control={
                <Switch
                  checked={config.includeAggregated ?? false}
                  onChange={(e) => onChange({ ...config, includeAggregated: e.target.checked })}
                />
              }
              label="Include 'All aggregated' row"
            />
          )}
```

- [ ] **Step 5: Mirror in shared docs types**

In `packages/shared/src/types/reports.types.ts`, add `includeAggregated?: boolean;` to `GraphsSectionOptions` (~line 171) and `ComparisonsSectionOptions` (~line 157). If a transaction-response-times options interface exists, add it there too (these interfaces are documentary — keep them in sync).

- [ ] **Step 6: Type-check web + shared**

Run: `npm run type-check`
Expected: no errors across the monorepo.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/reports/report-generation/SectionConfigs.tsx \
        packages/shared/src/types/reports.types.ts
git commit -m "feat(reports): 'All aggregated' toggles in Graphs / TRT / Comparisons config forms"
```

---

### Task 6: Full verification + version bump

- [ ] **Step 1: Run the full gate**

Run: `npm run lint && npm run type-check && cd apps/api && npx jest src/modules/reports && cd ../..`
Expected: lint clean, types clean, all reports specs pass.

- [ ] **Step 2: Bump VERSION (patch) and commit**

Edit `VERSION` — increment the patch component. Then:

```bash
git add VERSION
git commit -m "chore: bump version for All-aggregated reporting series"
```

- [ ] **Step 3: Manual smoke (optional but recommended)**

With the app running (`npm run dev`), open a test run with performance-test data → Reporting → build/preview a Graphs section with the "All aggregated" toggle on → confirm the aggregated line chart(s) render in the section preview. Repeat for Transaction Response Times and a baseline-run Comparisons section.

---

## Self-Review

- **Spec coverage:** Data method (§Data layer) → Task 1. Config field + no migration (§Config) → Task 5. UI toggles (§UI) → Task 5. Graphs/TRT/Comparisons renderers (§Renderer, §Scope table) → Tasks 2/3/4. Unit gap (§Global Constraints) → Task 2 (`ms`/`%` in `AGGREGATED_METRICS`). Tests (§Testing) → per-task specs. All spec sections covered.
- **Placeholder scan:** none — every code step shows full code; no TBD/"handle edge cases".
- **Type consistency:** `getAggregatedSeries`/`getAggregatedScalars` signatures identical across Tasks 1→2→3→4. `BaselineComparisonRow` fields (`group/label/metrics[].{key,current,baseline,diffPercent}`) match the renderer usage. `MetricsTimeSeriesPanel` shape matches Task 2's construction. `ReportTransaction` fields match Task 3's synthetic row.
