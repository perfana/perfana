# Compare by Aggregated Normalized URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users compare performance between two test runs grouped by aggregated normalized URL on the Compare card, alongside the existing transaction and request (sampler) dimensions.

**Architecture:** Re-aggregate the existing `test_run_sampler_stats` rollup by `url_hash` at query time — merging the per-sampler `pct_agg` t-digests with `rollup()` and count-weighting the mean columns — joined to `url_patterns` for the display name. Two thin, test-run-scoped API endpoints return the card's existing `MetricStatistic[]` shape. The frontend injects virtual URL panels (IDs 210–218) into the panel dropdown for performance-metrics dashboards only, and routes URL-panel fetches to the new endpoints. No new table, no worker/pipeline change, no migration, no backfill.

**Tech Stack:** NestJS + TypeORM (API, Jest), Next.js + React (web, Jest), PostgreSQL with the `tdigest`/`percentile_agg` extension (`rollup()`, `approx_percentile()`).

## Global Constraints

- **Data source is the rollup, never `requests_raw`.** URL stats come from `test_run_sampler_stats` (fast, indexed by `test_run_id`). Live scans over `requests_raw` are explicitly rejected (too slow).
- **Reuse existing response shapes.** Endpoints return `MetricStatistic[]` / `string[]` exactly as the Compare card already parses them (`compare.types.ts:48-66`). No frontend parsing changes.
- **URL panels appear for `performance-metrics` dashboards only** — never Grafana or Dynatrace. Panel IDs are not disjoint across sources, so always guard on source type (mirror `shouldOfferAllAggregated`).
- **Org scoping is mandatory and identical to the aggregated path.** Non-admin, no orgs ⇒ empty result. Resolve via `resolveOrganizationIds(userId, roles)`; SQL org clause `AND sut.organization_id = ANY($n::uuid[])`.
- **`test_run_id` strings, not entity UUIDs.** Like `getAggregatedMetricStatistics`, the batch methods take canonical `test_run_id` strings and do NOT `resolveTestRunId`.
- **Ramp-up window:** use `ramp_up_excluded = true` rows (the analysis window), matching the sampler rollup read path.
- **camelCase entity props** if any `repo.create()` is used (none expected here — read-only feature).

## Panel set (locked)

Virtual URL panels mirror the request panels 201–209, minus Apdex:

| ID  | Title            | `metric` param   | yAxesFormat | Notes |
|-----|------------------|------------------|-------------|-------|
| 210 | URL RT Avg       | `response_time`  | `ms`        | statistics = full RT distribution |
| 211 | URL RT P90       | `response_time`  | `ms`        | " |
| 212 | URL RT P95       | `response_time`  | `ms`        | " |
| 213 | URL RT P99       | `response_time`  | `ms`        | " |
| 214 | URL Error Rate   | `error_percentage` | `percent` | statistics.avg = error % |
| 215 | URL Throughput   | `throughput`     | `reqps`     | total_count / window_seconds |
| 217 | URL Latency      | `latency`        | `ms`        | statistics.avg = avg_latency |
| 218 | URL Connect Time | `connect_time`   | `ms`        | statistics.avg = avg_connect_time |

**Accepted redundancy:** panels 210–213 all map to `metric=response_time` and return the same per-URL distribution (`{avg,q50,q90,q95,q99}`); the card shows avg + percentile columns for each. They read identically — this matches the request-panel *list* the user asked to mirror. A follow-up could pass a `stat` hint to make each a single-value panel; out of scope here.

**Apdex (panel 216) deferred:** per-URL Apdex is ill-defined — a normalized URL can span transactions with different Apdex thresholds, so there is no single `active_threshold` to feed `approx_percentile_rank`. Omitted from v1; add only with an agreed threshold rule.

**yAxesFormat:** the values above are the intended units; if the request panels in `apps/worker/src/constants/performance-metrics.ts` use different unit strings (e.g. `s` instead of `ms`), match those verbatim so display formatting is consistent.

---

## Task 1: Backend query methods (`test-runs-performance-query.service.ts`)

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (add two methods near `getAggregatedMetricStatistics`, ~line 2649)
- Test: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts`

**Interfaces:**
- Consumes: `apdexScoreSql` (exported same file, unused here), `withRequestEm(this.testRunRepo)`, `this.mapper.parseFloat/parseInt`, `DatabaseException`.
- Produces:
  - `getUrlMetricStatistics(testRunIds: string[], metric: UrlMetric, isAdmin: boolean, organizationIds: string[]): Promise<MetricStatisticRow[]>`
  - `getUrlDistinctNames(testRunId: string, isAdmin: boolean, organizationIds: string[]): Promise<string[]>`
  - `type UrlMetric = 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time'`
  - `MetricStatisticRow` matches the web `MetricStatistic` shape: `{ test_run_id, panel_title, metric_name, created_at, version, annotations, statistics: { avg?, q50?, q90?, q95?, q99?, count? } }`.

- [ ] **Step 1: Write the failing test**

Add to the spec file. This mocks the query runner and asserts (a) the SQL groups by `url_hash` and merges the t-digest, and (b) row→`MetricStatistic` mapping for both a response-time metric and a scalar metric.

```typescript
describe('getUrlMetricStatistics', () => {
  const runQuery = jest.fn();
  beforeEach(() => {
    runQuery.mockReset();
    // withRequestEm(this.testRunRepo).query(...) → runQuery
    jest.spyOn(service as any, 'testRunRepo', 'get').mockReturnValue({} as any);
    (globalThis as any).__noop; // placeholder to keep block valid
  });

  it('merges tdigests grouped by url_hash and maps response_time rows', async () => {
    // Arrange: spy the em query used inside the method
    const querySpy = jest
      .spyOn(require('@perfana/shared/dist/typeorm/request-context'), 'withRequestEm')
      .mockReturnValue({ query: runQuery } as any);
    runQuery.mockResolvedValue([
      { test_run_id: 'run-1', normalized_url: '/api/user/{id}',
        avg_response_time: '120.5', p50: '100', p90: '200', p95: '260', p99: '400',
        total_count: '3000', error_percentage: '1.50', throughput: '50.00',
        avg_latency: '30.2', avg_connect_time: '5.1' },
    ]);

    const rows = await service.getUrlMetricStatistics(['run-1'], 'response_time', true, []);

    // SQL correctness
    const sql = runQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/FROM\s+test_run_sampler_stats/i);
    expect(sql).toMatch(/rollup\(\s*s\.pct_agg\s*\)/i);
    expect(sql).toMatch(/GROUP BY[^;]*url_hash/i);
    expect(sql).toMatch(/ramp_up_excluded\s*=\s*\$2/);
    // Mapping correctness
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      test_run_id: 'run-1',
      metric_name: '/api/user/{id}',
      statistics: { avg: 120.5, q50: 100, q90: 200, q95: 260, q99: 400 },
    });
    querySpy.mockRestore();
  });

  it('maps a scalar metric (throughput) into statistics.avg only', async () => {
    const querySpy = jest
      .spyOn(require('@perfana/shared/dist/typeorm/request-context'), 'withRequestEm')
      .mockReturnValue({ query: runQuery } as any);
    runQuery.mockResolvedValue([
      { test_run_id: 'run-1', normalized_url: '/orders/{id}',
        avg_response_time: '90', p50: '80', p90: '150', p95: '180', p99: '250',
        total_count: '1200', error_percentage: '0.00', throughput: '20.00',
        avg_latency: '10', avg_connect_time: '2' },
    ]);

    const rows = await service.getUrlMetricStatistics(['run-1'], 'throughput', true, []);
    expect(rows[0].statistics).toEqual({ avg: 20, count: 1200 });
    querySpy.mockRestore();
  });

  it('returns [] for a non-admin with no organizations', async () => {
    const rows = await service.getUrlMetricStatistics(['run-1'], 'response_time', false, []);
    expect(rows).toEqual([]);
  });
});
```

> The exact import path/mocking of `withRequestEm` must match how the existing spec in this file mocks DB access — check the top of `test-runs-performance-query.service.spec.ts` and reuse the same technique (it already exercises `withRequestEm`-backed methods like `getTransactionSamplesFromRollup`). If the spec uses a helper/fixture to stub the query, use that instead of the `require(...)` spy above.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest test-runs-performance-query.service.spec.ts -t getUrlMetricStatistics`
Expected: FAIL — `service.getUrlMetricStatistics is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add near the end of the class (after `getAggregatedMetricStatistics`, before the closing `}` at ~line 2649):

```typescript
  /**
   * Per-normalized-URL statistics for the Compare card's URL dimension.
   * Regroups the pre-computed sampler rollup (`test_run_sampler_stats`) by
   * `url_hash`, merging the per-sampler tdigests with `rollup()` (accurate,
   * unlike averaging percentiles) and count-weighting the mean columns. Reads
   * the analysis-window rows (`ramp_up_excluded = true`). Fast: hits the small
   * rollup table, never `requests_raw`.
   *
   * Contract mirrors getAggregatedMetricStatistics: `testRunIds` are canonical
   * `test_run_id` strings; org scoping via (isAdmin, organizationIds).
   *
   * Caveat: the sampler rollup keeps only the last-seen `url_hash` per sampler,
   * so a sampler that hits multiple normalized URLs in one run attributes all
   * its samples to that last URL. Pre-existing rollup property; degrades
   * gracefully; irrelevant to the primary case (samplers labelled by raw URL).
   */
  async getUrlMetricStatistics(
    testRunIds: string[],
    metric: 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time',
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<Array<{
    test_run_id: string;
    panel_title: string;
    metric_name: string;
    created_at: string;
    version: string | null;
    annotations: string | null;
    statistics: { avg?: number; q50?: number; q90?: number; q95?: number; q99?: number; count?: number };
  }>> {
    const requested = testRunIds ?? [];
    if (requested.length === 0) return [];
    if (!isAdmin && organizationIds.length === 0) return [];

    const orgClause = isAdmin ? '' : 'AND sut.organization_id = ANY($2::uuid[])';

    const query = `
      WITH agg AS (
        SELECT
          s.test_run_id,
          s.url_hash,
          s.system_under_test,
          s.test_environment,
          rollup(s.pct_agg)                                                        AS pct_agg,
          SUM(s.total_count)                                                       AS total_count,
          SUM(s.passed_count)                                                      AS passed_count,
          SUM(s.failed_count)                                                      AS failed_count,
          SUM(s.avg_response_time * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_response_time,
          SUM(s.avg_latency       * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_latency,
          SUM(s.avg_connect_time  * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_connect_time
        FROM test_run_sampler_stats s
        JOIN test_runs tr           ON tr.test_run_id = s.test_run_id
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE s.test_run_id = ANY($1::text[])
          AND s.ramp_up_excluded = true
          AND s.total_count > 0
          ${orgClause}
        GROUP BY s.test_run_id, s.url_hash, s.system_under_test, s.test_environment
      )
      SELECT
        a.test_run_id,
        COALESCE(up.normalized_url, a.url_hash)                                    AS normalized_url,
        a.total_count,
        ROUND(a.avg_response_time::numeric, 2)                                     AS avg_response_time,
        ROUND(approx_percentile(0.50, a.pct_agg)::numeric, 2)                      AS p50,
        ROUND(approx_percentile(0.90, a.pct_agg)::numeric, 2)                      AS p90,
        ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2)                      AS p95,
        ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2)                      AS p99,
        ROUND(a.avg_latency::numeric, 2)                                           AS avg_latency,
        ROUND(a.avg_connect_time::numeric, 2)                                      AS avg_connect_time,
        ROUND(a.failed_count::numeric / NULLIF(a.total_count, 0) * 100, 2)         AS error_percentage,
        ROUND(a.total_count::numeric
              / NULLIF(GREATEST(tr.duration - COALESCE(tr.ramp_up, 0), 0), 0), 2)  AS throughput
      FROM agg a
      JOIN test_runs tr           ON tr.test_run_id = a.test_run_id
      LEFT JOIN url_patterns up
        ON  up.url_hash          = a.url_hash
        AND up.system_under_test = a.system_under_test
        AND up.test_environment  = a.test_environment
      ORDER BY a.total_count DESC
    `;

    const params: unknown[] = isAdmin ? [requested] : [requested, organizationIds];
    const rows: Array<Record<string, unknown>> = await withRequestEm(this.testRunRepo).query(query, params);

    return rows.map(row => {
      const totalCount = this.mapper.parseInt(row.total_count) ?? undefined;
      let statistics: { avg?: number; q50?: number; q90?: number; q95?: number; q99?: number; count?: number };
      if (metric === 'response_time') {
        statistics = {
          avg: this.mapper.parseFloat(row.avg_response_time) ?? undefined,
          q50: this.mapper.parseFloat(row.p50) ?? undefined,
          q90: this.mapper.parseFloat(row.p90) ?? undefined,
          q95: this.mapper.parseFloat(row.p95) ?? undefined,
          q99: this.mapper.parseFloat(row.p99) ?? undefined,
        };
      } else {
        const scalarCol =
          metric === 'error_percentage' ? 'error_percentage'
          : metric === 'throughput'     ? 'throughput'
          : metric === 'latency'        ? 'avg_latency'
          :                               'avg_connect_time';
        statistics = { avg: this.mapper.parseFloat(row[scalarCol]) ?? undefined, count: totalCount };
      }
      return {
        test_run_id: row.test_run_id as string,
        panel_title: 'URL',
        metric_name: row.normalized_url as string,
        created_at: '',
        version: null,
        annotations: null,
        statistics,
      };
    });
  }

  /**
   * Distinct normalized URLs present in a single run's sampler rollup — powers
   * the URL series multi-select. Anchor run only.
   */
  async getUrlDistinctNames(
    testRunId: string,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<string[]> {
    if (!isAdmin && organizationIds.length === 0) return [];
    const orgClause = isAdmin ? '' : 'AND sut.organization_id = ANY($2::uuid[])';
    const query = `
      SELECT DISTINCT COALESCE(up.normalized_url, s.url_hash) AS normalized_url
      FROM test_run_sampler_stats s
      JOIN test_runs tr           ON tr.test_run_id = s.test_run_id
      JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      LEFT JOIN url_patterns up
        ON  up.url_hash          = s.url_hash
        AND up.system_under_test = s.system_under_test
        AND up.test_environment  = s.test_environment
      WHERE s.test_run_id = $1
        AND s.ramp_up_excluded = true
        AND s.total_count > 0
        ${orgClause}
      ORDER BY 1
    `;
    const params: unknown[] = isAdmin ? [testRunId] : [testRunId, organizationIds];
    const rows: Array<{ normalized_url: string }> = await withRequestEm(this.testRunRepo).query(query, params);
    return rows.map(r => r.normalized_url).filter(Boolean);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest test-runs-performance-query.service.spec.ts -t getUrlMetricStatistics`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i performance-query || echo "clean"`
Expected: `clean` (this file has `noUncheckedIndexedAccess`; the `scalarCol` index into `row` is a known-key string, fine).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts \
        apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts
git commit -m "feat(api): per-normalized-URL statistics from sampler rollup"
```

---

## Task 2: Delegation + controller + module wiring

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-query.service.ts` (add two delegating methods after `getAggregatedMetricStatistics`, ~line 359)
- Modify: `apps/api/src/modules/test-runs/test-runs.service.ts` (add two forwarders after `getAggregatedMetricStatistics`, ~line 212)
- Create: `apps/api/src/modules/test-runs/controllers/test-runs-url-metrics.controller.ts`
- Modify: `apps/api/src/modules/test-runs/test-runs.module.ts` (register the controller)
- Test: `apps/api/src/modules/test-runs/controllers/test-runs-url-metrics.controller.spec.ts`

**Interfaces:**
- Consumes: `getUrlMetricStatistics` / `getUrlDistinctNames` (Task 1), `resolveOrganizationIds(userId, roles)` (private in query service — same helper `getAggregatedMetricStatistics` uses).
- Produces:
  - `TestRunsQueryService.getUrlMetricStatistics(testRunIds, userId, roles, metric)` and `.getUrlDistinctNames(testRunId, userId, roles)`
  - `TestRunsService.getUrlMetricStatistics(...)` / `.getUrlDistinctNames(...)` — same signatures, forwarding.
  - `GET /test-runs/:testRunId/url-metric-statistics?metric&testRunIds=csv` → `MetricStatistic[]`
  - `GET /test-runs/:testRunId/url-distinct-names` → `string[]`

- [ ] **Step 1: Write the failing controller test**

Create `test-runs-url-metrics.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TestRunsUrlMetricsController } from './test-runs-url-metrics.controller';
import { TestRunsService } from '../test-runs.service';

describe('TestRunsUrlMetricsController', () => {
  let controller: TestRunsUrlMetricsController;
  const svc = {
    getUrlMetricStatistics: jest.fn(),
    getUrlDistinctNames: jest.fn(),
  };
  const ctx = { userId: 'u1', roles: ['user'] } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [TestRunsUrlMetricsController],
      providers: [{ provide: TestRunsService, useValue: svc }],
    }).compile();
    controller = mod.get(TestRunsUrlMetricsController);
  });

  it('rejects an unknown metric', async () => {
    await expect(
      controller.getUrlMetricStatistics('run-1', 'bogus', 'run-1,run-2', ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('parses testRunIds csv and forwards to the service', async () => {
    svc.getUrlMetricStatistics.mockResolvedValue([{ test_run_id: 'run-1' }]);
    const out = await controller.getUrlMetricStatistics('run-1', 'response_time', 'run-1, run-2', ctx);
    expect(svc.getUrlMetricStatistics).toHaveBeenCalledWith(
      ['run-1', 'run-2'], 'u1', ['user'], 'response_time',
    );
    expect(out).toEqual([{ test_run_id: 'run-1' }]);
  });

  it('defaults testRunIds to the path run when csv is absent', async () => {
    svc.getUrlMetricStatistics.mockResolvedValue([]);
    await controller.getUrlMetricStatistics('run-1', 'throughput', '', ctx);
    expect(svc.getUrlMetricStatistics).toHaveBeenCalledWith(['run-1'], 'u1', ['user'], 'throughput');
  });

  it('forwards distinct names', async () => {
    svc.getUrlDistinctNames.mockResolvedValue(['/api/user/{id}']);
    const out = await controller.getUrlDistinctNames('run-1', ctx);
    expect(svc.getUrlDistinctNames).toHaveBeenCalledWith('run-1', 'u1', ['user']);
    expect(out).toEqual(['/api/user/{id}']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest test-runs-url-metrics.controller.spec.ts`
Expected: FAIL — cannot find module `./test-runs-url-metrics.controller`.

- [ ] **Step 3a: Add the query-service delegation**

In `test-runs-query.service.ts`, after `getAggregatedMetricStatistics` (~line 361):

```typescript
  async getUrlMetricStatistics(
    testRunIds: string[],
    userId: string,
    roles: string[],
    metric: 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time',
  ) {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.performanceService.getUrlMetricStatistics(testRunIds, metric, isAdmin, orgIds);
  }

  async getUrlDistinctNames(testRunId: string, userId: string, roles: string[]) {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.performanceService.getUrlDistinctNames(testRunId, isAdmin, orgIds);
  }
```

- [ ] **Step 3b: Add the service forwarders**

In `test-runs.service.ts`, after `getAggregatedMetricStatistics` (~line 213):

```typescript
  async getUrlMetricStatistics(
    testRunIds: string[],
    userId: string,
    roles: string[],
    metric: 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time',
  ) {
    return this.queryService.getUrlMetricStatistics(testRunIds, userId, roles, metric);
  }

  async getUrlDistinctNames(testRunId: string, userId: string, roles: string[]) {
    return this.queryService.getUrlDistinctNames(testRunId, userId, roles);
  }
```

- [ ] **Step 3c: Create the controller**

Create `controllers/test-runs-url-metrics.controller.ts`:

```typescript
import { Controller, Get, Param, Query, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';

const ALLOWED_URL_METRICS = ['response_time', 'error_percentage', 'throughput', 'latency', 'connect_time'] as const;
type UrlMetric = typeof ALLOWED_URL_METRICS[number];

@ApiTags('test-runs-metrics')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsUrlMetricsController {
  private readonly logger = new Logger(TestRunsUrlMetricsController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  @Get(':testRunId/url-distinct-names')
  @ApiOperation({ summary: 'Distinct normalized URLs in a run (for the Compare card URL dimension)' })
  @ApiParam({ name: 'testRunId', description: 'Anchor test_run_id string', type: String })
  @ApiResponse({ status: 200, description: 'Sorted list of normalized URLs', schema: { type: 'array', items: { type: 'string' } } })
  async getUrlDistinctNames(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<string[]> {
    return this.testRunsService.getUrlDistinctNames(testRunId, ctx.userId, ctx.roles);
  }

  @Get(':testRunId/url-metric-statistics')
  @ApiOperation({ summary: 'Per-normalized-URL statistics across runs (Compare card URL dimension)' })
  @ApiParam({ name: 'testRunId', description: 'Anchor test_run_id string (org-access scope)', type: String })
  @ApiQuery({ name: 'metric', required: true, enum: ALLOWED_URL_METRICS })
  @ApiQuery({ name: 'testRunIds', required: false, type: String, description: 'Comma-separated test_run_id list (defaults to the path run).' })
  @ApiResponse({ status: 200, description: 'One MetricStatistic row per normalized URL per run' })
  @ApiResponse({ status: 400, description: 'Invalid metric parameter' })
  async getUrlMetricStatistics(
    @Param('testRunId') testRunId: string,
    @Query('metric') metric: string,
    @Query('testRunIds') testRunIdsRaw: string,
    @UserCtx() ctx: UserContext,
  ) {
    if (!(ALLOWED_URL_METRICS as readonly string[]).includes(metric)) {
      throw new BadRequestException(`metric must be one of: ${ALLOWED_URL_METRICS.join(', ')}`);
    }
    const testRunIds = (testRunIdsRaw ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);
    const ids = testRunIds.length > 0 ? testRunIds : [testRunId];
    return this.testRunsService.getUrlMetricStatistics(ids, ctx.userId, ctx.roles, metric as UrlMetric);
  }
}
```

- [ ] **Step 3d: Register the controller**

In `test-runs.module.ts`, import `TestRunsUrlMetricsController` and add it to the `controllers: [...]` array next to `TestRunsAggregatedTimeseriesController`.

```typescript
import { TestRunsUrlMetricsController } from './controllers/test-runs-url-metrics.controller';
// ...
  controllers: [
    // ...existing controllers...
    TestRunsUrlMetricsController,
  ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest test-runs-url-metrics.controller.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check the module**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "url-metrics|test-runs.service|test-runs-query" || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-query.service.ts \
        apps/api/src/modules/test-runs/test-runs.service.ts \
        apps/api/src/modules/test-runs/controllers/test-runs-url-metrics.controller.ts \
        apps/api/src/modules/test-runs/controllers/test-runs-url-metrics.controller.spec.ts \
        apps/api/src/modules/test-runs/test-runs.module.ts
git commit -m "feat(api): url-metric-statistics + url-distinct-names endpoints"
```

---

## Task 3: Frontend URL-panel lib (`apps/web/lib/url-perf-panels.ts`)

**Files:**
- Create: `apps/web/lib/url-perf-panels.ts`
- Test: `apps/web/lib/url-perf-panels.test.ts`

**Interfaces:**
- Consumes: `authenticatedFetch` (`@/lib/api`), `Panel` / `MetricStatistic` (`@/app/test-runs/[id]/components/compare/types`).
- Produces:
  - `URL_PANEL_ID_MIN = 210`, `URL_PANEL_ID_MAX = 218`
  - `isUrlPanel(panelId: number): boolean`
  - `getUrlPanelMetric(panelId: number): UrlMetric | null`
  - `buildUrlPanels(applicationDashboardId: string): Panel[]` — the injected dropdown entries
  - `fetchUrlDistinctNames(testRunId: string): Promise<string[]>`
  - `fetchUrlMetricStatistics(anchorTestRunId, testRunIds, metric): Promise<MetricStatistic[]>`
  - `type UrlMetric = 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time'`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/url-perf-panels.test.ts`:

```typescript
import { isUrlPanel, getUrlPanelMetric, buildUrlPanels, URL_PANEL_ID_MIN } from './url-perf-panels';

describe('url-perf-panels', () => {
  it('recognises URL panel ids', () => {
    expect(isUrlPanel(210)).toBe(true);
    expect(isUrlPanel(218)).toBe(true);
    expect(isUrlPanel(202)).toBe(false); // request panel
    expect(isUrlPanel(216)).toBe(false); // apdex is intentionally absent
  });

  it('maps panel ids to the endpoint metric', () => {
    expect(getUrlPanelMetric(210)).toBe('response_time');
    expect(getUrlPanelMetric(213)).toBe('response_time');
    expect(getUrlPanelMetric(214)).toBe('error_percentage');
    expect(getUrlPanelMetric(215)).toBe('throughput');
    expect(getUrlPanelMetric(217)).toBe('latency');
    expect(getUrlPanelMetric(218)).toBe('connect_time');
    expect(getUrlPanelMetric(999)).toBeNull();
  });

  it('builds dropdown panels tagged with the dashboard id', () => {
    const panels = buildUrlPanels('dash-1');
    expect(panels.every(p => p.applicationDashboardId === 'dash-1')).toBe(true);
    expect(panels.map(p => p.id)).toContain(URL_PANEL_ID_MIN);
    expect(panels.find(p => p.id === 211)?.title).toMatch(/P90/i);
    expect(panels.find(p => p.id === 216)).toBeUndefined(); // no apdex
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest lib/url-perf-panels.test.ts`
Expected: FAIL — cannot find module `./url-perf-panels`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/url-perf-panels.ts`:

```typescript
import { authenticatedFetch } from '@/lib/api';
import { Panel, MetricStatistic } from '@/app/test-runs/[id]/components/compare/types';

export type UrlMetric = 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time';

export const URL_PANEL_ID_MIN = 210;
export const URL_PANEL_ID_MAX = 218;

interface UrlPanelSpec { id: number; title: string; metric: UrlMetric; yAxesFormat: string }

// ponytail: 210-213 all map to response_time and return the same distribution;
// distinct titles match the request-panel list. Apdex (216) is omitted — per-URL
// Apdex crosses transaction thresholds and has no single active threshold.
const URL_PANELS: UrlPanelSpec[] = [
  { id: 210, title: 'URL RT Avg',       metric: 'response_time',    yAxesFormat: 'ms' },
  { id: 211, title: 'URL RT P90',       metric: 'response_time',    yAxesFormat: 'ms' },
  { id: 212, title: 'URL RT P95',       metric: 'response_time',    yAxesFormat: 'ms' },
  { id: 213, title: 'URL RT P99',       metric: 'response_time',    yAxesFormat: 'ms' },
  { id: 214, title: 'URL Error Rate',   metric: 'error_percentage', yAxesFormat: 'percent' },
  { id: 215, title: 'URL Throughput',   metric: 'throughput',       yAxesFormat: 'reqps' },
  { id: 217, title: 'URL Latency',      metric: 'latency',          yAxesFormat: 'ms' },
  { id: 218, title: 'URL Connect Time', metric: 'connect_time',     yAxesFormat: 'ms' },
];

const BY_ID = new Map(URL_PANELS.map(p => [p.id, p]));

export function isUrlPanel(panelId: number): boolean {
  return BY_ID.has(panelId);
}

export function getUrlPanelMetric(panelId: number): UrlMetric | null {
  return BY_ID.get(panelId)?.metric ?? null;
}

/** Dropdown entries injected for performance-metrics dashboards. */
export function buildUrlPanels(applicationDashboardId: string): Panel[] {
  return URL_PANELS.map(p => ({
    id: p.id,
    title: p.title,
    type: 'timeseries',
    yAxesFormat: p.yAxesFormat,
    applicationDashboardId,
  }));
}

/** Distinct normalized URLs for the anchor run (series multi-select). [] on error. */
export async function fetchUrlDistinctNames(testRunId: string): Promise<string[]> {
  try {
    const res = await authenticatedFetch(
      `/test-runs/${testRunId}/url-distinct-names`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) { console.error(`Failed to fetch URL distinct names: HTTP ${res.status}`); return []; }
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch URL distinct names:', err);
    return [];
  }
}

/** Per-URL statistics for the given metric across runs. [] on error. */
export async function fetchUrlMetricStatistics(
  anchorTestRunId: string,
  testRunIds: string[],
  metric: UrlMetric,
): Promise<MetricStatistic[]> {
  try {
    const params = new URLSearchParams({ metric, testRunIds: testRunIds.join(',') });
    const res = await authenticatedFetch(
      `/test-runs/${anchorTestRunId}/url-metric-statistics?${params.toString()}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) { console.error(`Failed to fetch URL statistics: HTTP ${res.status}`); return []; }
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch URL statistics:', err);
    return [];
  }
}
```

> `type: 'timeseries'` must be a value in `SUPPORTED_PANEL_TYPES` (`compare/types`) so the panel survives the dropdown filter and the injection (Task 4) isn't filtered out. Check that constant and use whichever supported type the request panels use; adjust if `timeseries` is not listed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx jest lib/url-perf-panels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/url-perf-panels.ts apps/web/lib/url-perf-panels.test.ts
git commit -m "feat(web): url-perf-panels lib (URL panel defs + fetchers)"
```

---

## Task 4: Wire URL panels into the Compare card (`useCompareData.ts` + call sites)

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/compare/hooks/useCompareData.ts`
  - `fetchDashboardPanels` — append URL panels for perf-metrics dashboards
  - `fetchPanelMetrics` — route URL panels to `fetchUrlDistinctNames`
  - `fetchMetricsComparison` — route URL-panel groups to `fetchUrlMetricStatistics`
- Modify: `apps/web/app/test-runs/[id]/components/compare/hooks/useCompareHandlers.ts:162` and `hooks/useComparePresets.ts:122` — pass the perf-metrics flag to `fetchDashboardPanels`
- Test: `apps/web/app/test-runs/[id]/components/compare/hooks/useCompareData.test.ts` (create if absent)

**Interfaces:**
- Consumes: `isUrlPanel`, `getUrlPanelMetric`, `buildUrlPanels`, `fetchUrlDistinctNames`, `fetchUrlMetricStatistics` (Task 3); `isPerformanceTest` (`@/lib/metrics-source-utils`).
- Produces: `fetchDashboardPanels(dashboardUid: string, isPerfMetrics?: boolean): Promise<Panel[]>` (new optional 2nd arg — additive, existing callers still compile).

- [ ] **Step 1: Write the failing test**

Create `useCompareData.test.ts`. Uses `@testing-library/react`'s `renderHook`. Mocks `@/lib/api` and `@/lib/url-perf-panels`.

```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCompareData } from './useCompareData';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/url-perf-panels', () => ({
  ...jest.requireActual('@/lib/url-perf-panels'),
  fetchUrlDistinctNames: jest.fn().mockResolvedValue(['/api/user/{id}']),
  fetchUrlMetricStatistics: jest.fn().mockResolvedValue([]),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchUrlDistinctNames } from '@/lib/url-perf-panels';

const testRun = {
  test_run_id: 'run-1',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  systems_under_test: { name: 'sut' },
} as any;

it('appends URL panels for a performance-metrics dashboard', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => [{ panels: [{ id: 202, title: 'Request RT P90', type: 'timeseries' }] }],
  });
  const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-1', compareExpanded: true }));
  let panels: any[] = [];
  await act(async () => { panels = await result.current.fetchDashboardPanels('perf-uid', true); });
  expect(panels.some(p => p.id === 210)).toBe(true);   // URL panel injected
  expect(panels.some(p => p.id === 202)).toBe(true);   // request panel preserved
});

it('does NOT append URL panels for a non-perf dashboard', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true, json: async () => [{ panels: [{ id: 5, title: 'CPU', type: 'timeseries' }] }],
  });
  const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-1', compareExpanded: true }));
  let panels: any[] = [];
  await act(async () => { panels = await result.current.fetchDashboardPanels('grafana-uid', false); });
  expect(panels.some(p => p.id >= 210 && p.id <= 218)).toBe(false);
});

it('routes URL panel distinct-names to the URL endpoint', async () => {
  const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-1', compareExpanded: true }));
  let names: string[] = [];
  await act(async () => { names = await result.current.fetchPanelMetrics('dash-1', 210); });
  expect(fetchUrlDistinctNames).toHaveBeenCalledWith('run-1');
  expect(names).toEqual(['/api/user/{id}']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest useCompareData.test.ts`
Expected: FAIL — panels don't include 210 / `fetchUrlDistinctNames` not called.

- [ ] **Step 3a: Add imports to `useCompareData.ts`**

After the existing `aggregated-perf-series` import (line 26):

```typescript
import {
  isUrlPanel,
  getUrlPanelMetric,
  buildUrlPanels,
  fetchUrlDistinctNames,
  fetchUrlMetricStatistics,
} from '@/lib/url-perf-panels';
```

- [ ] **Step 3b: Append URL panels in `fetchDashboardPanels`**

Replace the signature and the `setPanels(filteredPanels)` block (lines 178, 192-197):

```typescript
  const fetchDashboardPanels = useCallback(async (dashboardUid: string, isPerfMetrics = false): Promise<Panel[]> => {
    if (!dashboardUid) return [];

    try {
      setPanelsLoading(true);
      const response = await authenticatedFetch(
        `/grafana/dashboards?uid=${dashboardUid}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.ok) {
        const dashboardData = await response.json();
        const dashboard = Array.isArray(dashboardData) ? dashboardData[0] : dashboardData;

        const filteredPanels: Panel[] = dashboard?.panels?.filter((panel: Panel) =>
          SUPPORTED_PANEL_TYPES.includes(panel.type)
        ) || [];

        // Inject virtual URL panels for performance-metrics dashboards only.
        const applicationDashboardId = String(dashboard?.applicationDashboardId ?? filteredPanels[0]?.applicationDashboardId ?? '');
        const withUrl = isPerfMetrics
          ? [...filteredPanels, ...buildUrlPanels(applicationDashboardId)]
          : filteredPanels;

        setPanels(withUrl);
        return withUrl;
      } else {
        setPanels([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching dashboard panels:', error);
      setPanels([]);
      return [];
    } finally {
      setPanelsLoading(false);
    }
  }, []);
```

> If `applicationDashboardId` is not present on the `/grafana/dashboards` payload, derive it from the caller instead — the selected dashboard's `id` is available at the call sites (Task 4 step 3d). Prefer passing it in over guessing. If simpler, add a 3rd arg `applicationDashboardId?: string` and have `buildUrlPanels` use it. Keep whichever is cleaner after inspecting the payload shape.

- [ ] **Step 3c: Route `fetchPanelMetrics` for URL panels**

At the top of `fetchPanelMetrics` (after the guard at line 238), short-circuit URL panels before the `ds-metrics/distinct-names` fetch:

```typescript
      if (isUrlPanel(panelId)) {
        setAvailableMetricsLoading(true);
        try {
          const names = await fetchUrlDistinctNames(testRun.test_run_id);
          setAvailableMetrics(names);
          return names;
        } finally {
          setAvailableMetricsLoading(false);
        }
      }
```

- [ ] **Step 3d: Route `fetchMetricsComparison` for URL-panel groups**

Inside the `for (const [, group] of seriesGroups)` loop (line 313), branch before building the ds-metrics params:

```typescript
      for (const [, group] of seriesGroups) {
        let allData: MetricStatistic[];

        if (isUrlPanel(group.panelId)) {
          const metric = getUrlPanelMetric(group.panelId);
          if (!metric) continue;
          allData = await fetchUrlMetricStatistics(
            testRun.test_run_id,
            [testRun.test_run_id, selectedTestRun.test_run_id],
            metric,
          );
        } else {
          const params = new URLSearchParams({
            applicationDashboardId: group.dashboardId,
            panelId: group.panelId.toString(),
            system: testRun.systems_under_test?.name || '',
            environment: testRun.test_environment || '',
            workload: testRun.workload || '',
          });
          if (group.metricsSourceId) params.set('metricsSourceId', group.metricsSourceId);
          const response = await authenticatedFetch(
            `/metrics/ds-metric-statistics?${params.toString()}`,
            { headers: { 'Content-Type': 'application/json' } },
          );
          if (!response.ok) continue;
          allData = await response.json();
        }

        const relevant = new Set(group.metricNames);
        const filtered = allData.filter(item => relevant.has(item.metric_name));
        // ...unchanged from here down (currentData/selectedData/comparisons)...
```

Leave the rest of the loop body (from `const relevant = ...` onward) exactly as-is.

- [ ] **Step 3e: Pass the perf-metrics flag at the call sites**

In `useCompareHandlers.ts` — update the type (line 49) and call (line 162):

```typescript
// line 49
  fetchDashboardPanels: (uid: string, isPerfMetrics?: boolean) => Promise<Panel[]>;
// line 162 — the handler already has `dashboard`
      fetchDashboardPanels(dashboard.dashboard_uid, isPerformanceTest(dashboard));
```
Add `import { isPerformanceTest } from '@/lib/metrics-source-utils';` if not already imported.

In `useComparePresets.ts` — update the type (line 40) and call (line 122):

```typescript
// line 40
  fetchDashboardPanels: (uid: string, isPerfMetrics?: boolean) => Promise<Panel[]>;
// line 122 — the loop already has `dashboard`
            await fetchDashboardPanels(dashboard.dashboard_uid, isPerformanceTest(dashboard));
```
Add the `isPerformanceTest` import if absent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx jest useCompareData.test.ts url-perf-panels.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check the web app**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "useCompareData|useCompareHandlers|useComparePresets|url-perf-panels" || echo "clean"`
Expected: `clean`.

> Memory note: `apps/web`'s build type-check (`tsconfig.build.json`) EXCLUDES `app/test-runs/**`, so the CI type-check gate will NOT catch errors in these hook files. The full `tsconfig.json` check above is the real gate — do not skip it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/test-runs/\[id\]/components/compare/hooks/useCompareData.ts \
        apps/web/app/test-runs/\[id\]/components/compare/hooks/useCompareHandlers.ts \
        apps/web/app/test-runs/\[id\]/components/compare/hooks/useComparePresets.ts \
        apps/web/app/test-runs/\[id\]/components/compare/hooks/useCompareData.test.ts
git commit -m "feat(web): route Compare URL panels to url-metric endpoints"
```

---

## Task 5: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start the stack**

Run: `lsof -ti:3001,3002,4001 | xargs kill -9 2>/dev/null; npm run dev`
Wait for api :3001, web :4001.

- [ ] **Step 2: Verify the endpoint directly**

Pick a completed JTL/performance-test run id (`run-id`) with sampler data, then:

Run:
```bash
curl -s "http://localhost:3001/api/test-runs/<run-id>/url-distinct-names" \
  -H "Authorization: Bearer <token>" | head
curl -s "http://localhost:3001/api/test-runs/<run-id>/url-metric-statistics?metric=response_time&testRunIds=<run-id>" \
  -H "Authorization: Bearer <token>" | head
```
Expected: distinct-names returns normalized URLs (e.g. `/api/user/{id}`); statistics returns `MetricStatistic` rows with populated `statistics.{avg,q90,q95,q99}`.

- [ ] **Step 3: Verify in the UI**

Open the run's detail page → expand the Compare card → pick a baseline run → Data source auto-selects performance-metrics for a perf dashboard → open the Panel dropdown → confirm `URL RT P90`, `URL Error Rate`, `URL Throughput`, `URL Latency`, `URL Connect Time` appear → select `URL RT P90` → the series list shows normalized URLs → add one → the diff table shows current vs baseline. Confirm the same panels are ABSENT on a Grafana dashboard.

- [ ] **Step 4: Sanity-check the numbers**

For one normalized URL that maps to a single sampler, its URL p95 should equal that sampler's p95 in the transactions/sampler table view (same rollup, same tdigest). For a URL spanning several samplers, its total_count should equal the sum of those samplers' counts.

- [ ] **Step 5: Run the pre-push gate**

Run: `npm run preflight`
Expected: lint + type-check pass across the monorepo; RLS suite passes.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "test: verify Compare normalized-URL end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Re-aggregate sampler rollup by url_hash → Task 1 (`getUrlMetricStatistics`, `rollup(pct_agg)`). ✅
- Two endpoints, existing response shapes → Task 2. ✅
- URL panels 210–218 injected for perf-metrics only → Tasks 3, 4. ✅
- No table/pipeline/migration/backfill → nothing added; verified by absence. ✅
- Freshness inherited (post-analysis) → no change needed; reads the rollup. ✅
- Last-seen-url_hash caveat documented → Task 1 method docstring + `url-perf-panels.ts` comment. ✅
- Apdex per-URL deferral: a deliberate narrowing of "same set as request panels" (Apdex has no single per-URL threshold) — **flagged for the reviewer**, plus the 210–213 redundancy note.

**Placeholder scan:** No TBD/TODO. Two spots defer to codebase inspection with a concrete fallback (spec mocking technique in Task 1; `applicationDashboardId` source + `SUPPORTED_PANEL_TYPES` value in Tasks 3/4) — these are "match the existing pattern you'll see in this exact file," not open questions.

**Type consistency:** `getUrlMetricStatistics(testRunIds, metric, isAdmin, organizationIds)` (perf-query) ← `(testRunIds, userId, roles, metric)` (query-service + service) ← controller. `UrlMetric` union identical across API and web. `MetricStatistic` shape reused verbatim. `fetchDashboardPanels(uid, isPerfMetrics?)` additive signature consistent across all three call sites. ✅
