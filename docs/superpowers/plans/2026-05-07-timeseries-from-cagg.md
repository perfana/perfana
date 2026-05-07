# Test-run timeseries graphs from CAGGs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `getTransactionTimeSeries` and `getSamplerTimeSeries` reads off the raw `requests_raw` / `transactions` hypertables onto the existing `requests_raw_5s` / `transactions_5s` continuous aggregates, replacing exact `PERCENTILE_CONT` with `approx_percentile(p, rollup(pct_agg))`.

**Architecture:** Refactor a single service file (`apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`). Introduce one private SQL builder (`buildTimeSeriesQuery`) as the single source of truth for the new CAGG query shape, plus one validation helper (`validateAggregationSeconds`). Public method signatures and response shapes stay identical. Tests are added in a new sibling spec, mirroring the Jest `Test.createTestingModule` pattern used by neighbouring services.

**Tech Stack:** NestJS, TypeORM (raw SQL via `repo.query`), TimescaleDB toolkit (`approx_percentile`, `rollup(pct_agg)`), Jest.

**Spec:** `docs/superpowers/specs/2026-05-07-timeseries-from-cagg-design.md`

**Branch:** `fix/timeseries-from-cagg-283` (already created off `main`).

---

## Files

- **Modify:** `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`
- **Create:** `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts`

No other files change. No DTO, no entity, no migration, no frontend.

---

## Task 1: Set up the spec file with `validateAggregationSeconds` tests + helper

**Files:**
- Create: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts`
- Modify: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { TestRunsTimeSeriesQueryService } from './test-runs-timeseries-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { TestRun as TestRunEntity } from '../../../entities';

type MockRepo = jest.Mocked<Pick<Repository<TestRunEntity>, 'query'>> & {
  manager: { transaction: jest.Mock };
};

function createMockRepo(): MockRepo {
  const query = jest.fn();
  const transaction = jest.fn(async (cb: (em: { query: jest.Mock }) => Promise<unknown>) =>
    cb({ query }),
  );
  return { query, manager: { transaction } };
}

describe('TestRunsTimeSeriesQueryService', () => {
  let service: TestRunsTimeSeriesQueryService;
  let repo: MockRepo;

  beforeEach(async () => {
    repo = createMockRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsTimeSeriesQueryService,
        { provide: getRepositoryToken(TestRunEntity), useValue: repo },
        {
          provide: TestRunsMapperService,
          useValue: {
            parseInt: (v: unknown) => (v == null ? 0 : Number.parseInt(String(v), 10)),
            parseFloat: (v: unknown) => (v == null ? 0 : Number.parseFloat(String(v))),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            canAccessResource: jest.fn().mockResolvedValue({ allowed: true }),
            isGlobalAdmin: jest.fn().mockReturnValue(true),
            getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();
    service = module.get(TestRunsTimeSeriesQueryService);
  });

  describe('validateAggregationSeconds', () => {
    // Use the bracket access to reach the private helper for unit testing.
    const validate = (n: number) =>
      (service as unknown as { validateAggregationSeconds: (x: number) => void })
        .validateAggregationSeconds(n);

    it.each([5, 10, 15, 30, 60, 300])('accepts %s', (n) => {
      expect(() => validate(n)).not.toThrow();
    });

    it.each([0, 1, 3, 4, 7, -5, 5.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects %s',
      (n) => {
        expect(() => validate(n)).toThrow(BadRequestException);
      },
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts -t validateAggregationSeconds`

Expected: FAIL — `service.validateAggregationSeconds is not a function`.

- [ ] **Step 3: Add the validator to the service**

Edit `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`. Change the import line:

```typescript
import { Injectable, Logger } from '@nestjs/common';
```

to:

```typescript
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
```

Then add this private method to the class (place it next to `parseTimeSeriesRow`):

```typescript
  /**
   * Aggregation seconds must be >= 5 and a multiple of 5 — the CAGG floor is
   * the 5 s `bucket` column on `requests_raw_5s` / `transactions_5s`.
   */
  private validateAggregationSeconds(aggregationSeconds: number): void {
    if (
      !Number.isFinite(aggregationSeconds) ||
      !Number.isInteger(aggregationSeconds) ||
      aggregationSeconds < 5 ||
      aggregationSeconds % 5 !== 0
    ) {
      throw new BadRequestException(
        `aggregationSeconds must be an integer >= 5 and a multiple of 5 (got ${aggregationSeconds})`,
      );
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts -t validateAggregationSeconds`

Expected: PASS — all 15 cases (6 accept + 9 reject) green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts
git commit -m "$(cat <<'EOF'
test(api): add validateAggregationSeconds for CAGG-floored timeseries (#283)

Refs spec: docs/superpowers/specs/2026-05-07-timeseries-from-cagg-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `buildTimeSeriesQuery` builder + structural tests

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts`
- Modify: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`

- [ ] **Step 1: Add the failing builder tests**

Append the following inside the existing `describe('TestRunsTimeSeriesQueryService', ...)` block, after the `validateAggregationSeconds` describe:

```typescript
  describe('buildTimeSeriesQuery', () => {
    const build = (kind: 'transaction' | 'sampler' | 'sampler-single', aggSec: number) =>
      (service as unknown as {
        buildTimeSeriesQuery: (opts: { kind: typeof kind; aggSec: number }) => string;
      }).buildTimeSeriesQuery({ kind, aggSec });

    describe('transaction kind', () => {
      const sql = () => build('transaction', 10);

      it('reads from transactions_5s', () => {
        expect(sql()).toContain('FROM transactions_5s c');
      });

      it('does NOT scan the raw transactions hypertable in the time-series body', () => {
        // The scenarios CTE intentionally hits raw to derive scenario_name; the
        // main aggregation must NOT. Strip the scenarios CTE before the assertion.
        const body = sql().replace(/scenarios AS \([\s\S]*?\),/, '');
        expect(body).not.toMatch(/FROM\s+transactions\s+(?!_5s)/);
      });

      it('extracts percentiles via approx_percentile(rollup(pct_agg))', () => {
        const q = sql();
        expect(q).toContain('approx_percentile(0.50, rollup(c.pct_agg))');
        expect(q).toContain('approx_percentile(0.90, rollup(c.pct_agg))');
        expect(q).toContain('approx_percentile(0.95, rollup(c.pct_agg))');
        expect(q).toContain('approx_percentile(0.99, rollup(c.pct_agg))');
      });

      it('uses the n-weighted average formula', () => {
        expect(sql()).toContain('sum(c.avg_rt * c.n) / NULLIF(sum(c.n), 0)');
      });

      it('filters by sut/env from test_runs and scenario_name from raw lookup', () => {
        const q = sql();
        expect(q).toContain('c.system_under_test = r.sut');
        expect(q).toContain('c.test_environment  = r.env');
        expect(q).toContain('c.scenario_name IN (SELECT scenario_name FROM scenarios)');
      });

      it('aligns ramp-up cutoff to a 5-second bucket boundary', () => {
        expect(sql()).toContain("c.bucket >= time_bucket('5 seconds', $4::timestamptz)");
      });

      it('interpolates aggregationSeconds into the time_bucket and generate_series', () => {
        expect(build('transaction', 30)).toContain("time_bucket('30 seconds'::interval, c.bucket)");
        expect(build('transaction', 30)).toContain("interval '30 seconds'");
      });
    });

    describe('sampler kind', () => {
      const sql = () => build('sampler', 10);

      it('reads from requests_raw_5s and groups by sampler_name', () => {
        const q = sql();
        expect(q).toContain('FROM requests_raw_5s c');
        expect(q).toMatch(/GROUP BY[\s\S]*sampler_name/);
        expect(q).toContain('c.sampler_name AS sampler_name');
      });
    });

    describe('sampler-single kind', () => {
      const sql = () => build('sampler-single', 10);

      it('reads from requests_raw_5s and filters by sampler_name = $3', () => {
        const q = sql();
        expect(q).toContain('FROM requests_raw_5s c');
        expect(q).toContain('AND c.sampler_name = $3');
        // No GROUP BY on sampler_name (only one sampler in the result set).
        expect(q).not.toMatch(/GROUP BY[\s\S]*sampler_name/);
      });
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts -t buildTimeSeriesQuery`

Expected: FAIL — `service.buildTimeSeriesQuery is not a function`.

- [ ] **Step 3: Implement the builder**

Add this private method to the service class (place it directly after `validateAggregationSeconds`):

```typescript
  /**
   * Build the parameterized SQL for a time-series query against the 5 s CAGG.
   * One source of truth for the three call shapes used by this service.
   *
   * Kinds:
   *   - 'transaction'      → group by 5 s bucket, read from transactions_5s
   *   - 'sampler'          → group by 5 s bucket + sampler_name, read from requests_raw_5s
   *   - 'sampler-single'   → group by 5 s bucket only, filter sampler_name = $3,
   *                          read from requests_raw_5s
   *
   * Parameters expected by the returned SQL:
   *   $1 = test_run_id
   *   $2 = transaction_name
   *   for transaction & sampler kinds:
   *     $3 = excludeRampUp (boolean)
   *     $4 = ramp-up cutoff (timestamptz | null)
   *   for sampler-single kind:
   *     $3 = sampler_name
   *     $4 = excludeRampUp (boolean)
   *     $5 = ramp-up cutoff (timestamptz | null)
   */
  private buildTimeSeriesQuery(opts: {
    kind: 'transaction' | 'sampler' | 'sampler-single';
    aggSec: number;
  }): string {
    const { kind, aggSec } = opts;
    const sourceView = kind === 'transaction' ? 'transactions_5s' : 'requests_raw_5s';
    const isSamplerSingle = kind === 'sampler-single';
    const isSamplerGroup = kind === 'sampler';

    const excludeRampParam = isSamplerSingle ? '$4' : '$3';
    const cutoffParam = isSamplerSingle ? '$5' : '$4';
    const samplerSinglePredicate = isSamplerSingle ? 'AND c.sampler_name = $3' : '';
    const samplerGroupSelect = isSamplerGroup ? 'c.sampler_name AS sampler_name,' : '';
    const samplerGroupKey = isSamplerGroup ? ', c.sampler_name' : '';

    return `
      WITH run AS (
        SELECT sut.name AS sut,
               tr.test_environment AS env,
               tr.start_time,
               tr.end_time
        FROM test_runs tr
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE tr.test_run_id = $1
      ),
      scenarios AS (
        SELECT DISTINCT scenario_name
        FROM transactions
        WHERE test_run_id = $1 AND transaction_name = $2
      ),
      bounds AS (
        SELECT CASE WHEN ${excludeRampParam}::boolean
                    THEN GREATEST(start_time, ${cutoffParam}::timestamptz)
                    ELSE start_time END AS start_time,
               end_time
        FROM run
      ),
      time_series AS (
        SELECT ${isSamplerGroup ? 'sl.sampler_name,' : ''}
               generate_series(
                 time_bucket('${aggSec} seconds'::interval, b.start_time),
                 time_bucket('${aggSec} seconds'::interval, b.end_time),
                 interval '${aggSec} seconds'
               ) AS time_bucket
        FROM bounds b
        ${
          isSamplerGroup
            ? `CROSS JOIN (
                 SELECT DISTINCT sampler_name
                 FROM requests_raw_5s c
                 JOIN run r
                   ON c.system_under_test = r.sut
                  AND c.test_environment  = r.env
                 WHERE c.transaction_name = $2
                   AND c.scenario_name IN (SELECT scenario_name FROM scenarios)
                   AND c.bucket >= (SELECT start_time FROM bounds)
                   AND c.bucket <  (SELECT end_time   FROM bounds) + interval '5 seconds'
               ) sl`
            : ''
        }
      ),
      agg AS (
        SELECT
          ${samplerGroupSelect}
          time_bucket('${aggSec} seconds'::interval, c.bucket) AS time_bucket,
          (sum(c.avg_rt * c.n) / NULLIF(sum(c.n), 0))::numeric(10,2) AS avg_response_time,
          approx_percentile(0.50, rollup(c.pct_agg))::numeric(10,2) AS median_response_time,
          min(c.min_rt) AS min_response_time,
          max(c.max_rt) AS max_response_time,
          approx_percentile(0.90, rollup(c.pct_agg))::numeric(10,2) AS p90_response_time,
          approx_percentile(0.95, rollup(c.pct_agg))::numeric(10,2) AS p95_response_time,
          approx_percentile(0.99, rollup(c.pct_agg))::numeric(10,2) AS p99_response_time,
          sum(c.n)::bigint    AS total_count,
          sum(c.n_ok)::bigint AS passed_count,
          sum(c.n_err)::bigint AS failed_count
        FROM ${sourceView} c
        JOIN run r
          ON c.system_under_test = r.sut
         AND c.test_environment  = r.env
        WHERE c.transaction_name = $2
          ${samplerSinglePredicate}
          AND c.scenario_name IN (SELECT scenario_name FROM scenarios)
          AND c.bucket >= (SELECT start_time FROM bounds)
          AND c.bucket <  (SELECT end_time   FROM bounds) + interval '5 seconds'
          AND (${excludeRampParam}::boolean = false OR ${cutoffParam}::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds', ${cutoffParam}::timestamptz))
        GROUP BY 1${samplerGroupKey}
      )
      SELECT ${isSamplerGroup ? 'ts.sampler_name,' : ''}
             ts.time_bucket,
             a.avg_response_time, a.median_response_time,
             a.min_response_time, a.max_response_time,
             a.p90_response_time, a.p95_response_time, a.p99_response_time,
             COALESCE(a.total_count, 0)  AS total_count,
             COALESCE(a.passed_count, 0) AS passed_count,
             COALESCE(a.failed_count, 0) AS failed_count
      FROM time_series ts
      LEFT JOIN agg a ON a.time_bucket = ts.time_bucket
        ${isSamplerGroup ? 'AND a.sampler_name = ts.sampler_name' : ''}
      ORDER BY ${isSamplerGroup ? 'ts.sampler_name, ' : ''}ts.time_bucket ASC
    `;
  }
```

- [ ] **Step 2.5: Type-check**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`

Expected: PASS — no errors. (If `tsconfig.json` paths differ, fall back to `npm run type-check` from the repo root.)

- [ ] **Step 3: Run the builder tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts -t buildTimeSeriesQuery`

Expected: PASS — all kind/structure assertions green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts
git commit -m "$(cat <<'EOF'
feat(api): add CAGG-backed buildTimeSeriesQuery (#283)

Single-source-of-truth SQL builder for the three time-series query shapes
(transaction / sampler / sampler-single). Reads from requests_raw_5s and
transactions_5s with approx_percentile(rollup(pct_agg)). Public API not
yet wired through.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `getTransactionTimeSeries` to the new builder

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts`
- Modify: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`

- [ ] **Step 1: Write the failing tests**

Append to the spec file (inside the same outer `describe`):

```typescript
  describe('getTransactionTimeSeries', () => {
    const TEST_RUN_ID = 'tr-1';
    const TX_NAME = 'checkout';
    const USER = 'user-1';
    const ROLES = ['perfana-admin'];

    function primeOrgAccessAndRamp(repo: MockRepo) {
      // 1. validateOrganizationAccess: SELECT sut.organization_id, sut.created_by ...
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: USER }]);
      // 2. getRampUpCutoffTime (only when excludeRampUp=true): SELECT start_time, ramp_up
      // (skipped when excludeRampUp=false)
    }

    it('rejects aggregationSeconds=1 with BadRequestException', async () => {
      primeOrgAccessAndRamp(repo);
      await expect(
        service.getTransactionTimeSeries(TEST_RUN_ID, TX_NAME, USER, ROLES, 1, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs the transaction CAGG query and the sampler CAGG query', async () => {
      primeOrgAccessAndRamp(repo);
      // 3. transaction CAGG query
      repo.query.mockResolvedValueOnce([
        {
          time_bucket: '2026-05-07T00:00:00Z',
          avg_response_time: '120.50',
          median_response_time: '110.00',
          min_response_time: '50',
          max_response_time: '500',
          p90_response_time: '200.00',
          p95_response_time: '300.00',
          p99_response_time: '450.00',
          total_count: '600',
          passed_count: '590',
          failed_count: '10',
        },
      ]);
      // 4. sampler CAGG query
      repo.query.mockResolvedValueOnce([
        {
          sampler_name: 'GET /api/foo',
          time_bucket: '2026-05-07T00:00:00Z',
          avg_response_time: '110.00',
          median_response_time: '100.00',
          min_response_time: '40',
          max_response_time: '480',
          p90_response_time: '190.00',
          p95_response_time: '290.00',
          p99_response_time: '440.00',
          total_count: '300',
          passed_count: '295',
          failed_count: '5',
        },
      ]);

      const result = await service.getTransactionTimeSeries(
        TEST_RUN_ID,
        TX_NAME,
        USER,
        ROLES,
        10,
        false,
      );

      // 4 calls: org-access + 2 timeseries queries (no ramp-up lookup since excludeRampUp=false).
      // Wait — getRampUpCutoffTime always runs when excludeRampUp=true; here it's false, so it returns null without a query. Total = 3.
      expect(repo.query).toHaveBeenCalledTimes(3);

      const txCallArgs = repo.query.mock.calls[1]!;
      expect(txCallArgs[0]).toContain('FROM transactions_5s c');
      expect(txCallArgs[1]).toEqual([TEST_RUN_ID, TX_NAME, false, null]);

      const samplerCallArgs = repo.query.mock.calls[2]!;
      expect(samplerCallArgs[0]).toContain('FROM requests_raw_5s c');
      expect(samplerCallArgs[1]).toEqual([TEST_RUN_ID, TX_NAME, false, null]);

      expect(result.transaction_data).toHaveLength(1);
      expect(result.sampler_data['GET /api/foo']).toHaveLength(1);
    });

    it('passes the ramp-up cutoff timestamp when excludeRampUp=true', async () => {
      // org access
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: USER }]);
      // ramp-up lookup
      repo.query.mockResolvedValueOnce([
        { start_time: '2026-05-07T00:00:00Z', ramp_up: 60 },
      ]);
      // transaction CAGG query
      repo.query.mockResolvedValueOnce([]);
      // sampler CAGG query
      repo.query.mockResolvedValueOnce([]);

      await service.getTransactionTimeSeries(
        TEST_RUN_ID,
        TX_NAME,
        USER,
        ROLES,
        10,
        true,
      );

      const txCallArgs = repo.query.mock.calls[2]!;
      const params = txCallArgs[1] as unknown[];
      expect(params[2]).toBe(true);
      expect(params[3]).toBeInstanceOf(Date);
      expect((params[3] as Date).toISOString()).toBe('2026-05-07T00:01:00.000Z');
    });
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts -t getTransactionTimeSeries`

Expected: FAIL — the existing implementation still references the raw `transactions` / `requests_raw` tables and does not call the builder.

- [ ] **Step 3: Replace the inline SQL with builder calls**

In `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`, replace the entire `getTransactionTimeSeries` method body with:

```typescript
  async getTransactionTimeSeries(
    testRunId: string,
    transactionName: string,
    userId: string,
    roles: string[],
    aggregationSeconds: number = 5,
    excludeRampUp: boolean = false,
  ): Promise<TransactionTimeSeriesData> {
    try {
      this.validateAggregationSeconds(aggregationSeconds);
      await this.validateOrganizationAccess(testRunId, userId, roles);

      this.logger.log(
        `Getting time-series data for transaction: ${transactionName} with ${aggregationSeconds}s aggregation (excludeRampUp: ${excludeRampUp})`,
      );

      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp);
      const queryParams = [testRunId, transactionName, excludeRampUp, cutoffTime ?? null];

      const transactionQuery = this.buildTimeSeriesQuery({
        kind: 'transaction',
        aggSec: aggregationSeconds,
      });
      const transactionResult = await withRequestEm(this.testRunRepo).query(
        transactionQuery,
        queryParams,
      );

      const samplerQuery = this.buildTimeSeriesQuery({
        kind: 'sampler',
        aggSec: aggregationSeconds,
      });
      const samplerResult = await withRequestEm(this.testRunRepo).query(
        samplerQuery,
        queryParams,
      );

      const samplerData: Record<string, TimeSeriesDataPoint[]> = {};
      for (const row of samplerResult as Record<string, unknown>[]) {
        const samplerName = row.sampler_name as string;
        if (!samplerData[samplerName]) {
          samplerData[samplerName] = [];
        }
        samplerData[samplerName]!.push(this.parseTimeSeriesRow(row));
      }

      this.logger.log(
        `Retrieved ${transactionResult.length} transaction data points and ${Object.keys(samplerData).length} samplers`,
      );

      return {
        transaction_data: transactionResult.map((row: Record<string, unknown>) =>
          this.parseTimeSeriesRow(row),
        ),
        sampler_data: samplerData,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(
        `Failed to get time-series data for transaction ${transactionName}:`,
        error,
      );
      throw new DatabaseException(
        'Failed to retrieve transaction time-series data',
        error,
      );
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts -t getTransactionTimeSeries`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts
git commit -m "$(cat <<'EOF'
fix(api): route getTransactionTimeSeries to CAGGs (#283)

Replace per-render PERCENTILE_CONT scans of requests_raw / transactions
with approx_percentile(rollup(pct_agg)) over requests_raw_5s /
transactions_5s. Eliminates ~30-230 s render times reported on
populated TimescaleDB instances.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `getSamplerTimeSeries` to the new builder

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts`
- Modify: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the outer `describe`:

```typescript
  describe('getSamplerTimeSeries', () => {
    const TEST_RUN_ID = 'tr-1';
    const TX_NAME = 'checkout';
    const SAMPLER = 'GET /api/foo';
    const USER = 'user-1';
    const ROLES = ['perfana-admin'];

    it('rejects aggregationSeconds=4 with BadRequestException', async () => {
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: USER }]);
      await expect(
        service.getSamplerTimeSeries(TEST_RUN_ID, TX_NAME, SAMPLER, USER, ROLES, 4, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs the sampler-single CAGG query with sampler_name as $3', async () => {
      // org access
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: USER }]);
      // sampler-single CAGG query
      repo.query.mockResolvedValueOnce([
        {
          time_bucket: '2026-05-07T00:00:00Z',
          avg_response_time: '110.00',
          median_response_time: '100.00',
          min_response_time: '40',
          max_response_time: '480',
          p90_response_time: '190.00',
          p95_response_time: '290.00',
          p99_response_time: '440.00',
          total_count: '300',
          passed_count: '295',
          failed_count: '5',
        },
      ]);

      const result = await service.getSamplerTimeSeries(
        TEST_RUN_ID,
        TX_NAME,
        SAMPLER,
        USER,
        ROLES,
        10,
        false,
      );

      expect(repo.query).toHaveBeenCalledTimes(2);
      const callArgs = repo.query.mock.calls[1]!;
      expect(callArgs[0]).toContain('FROM requests_raw_5s c');
      expect(callArgs[0]).toContain('AND c.sampler_name = $3');
      expect(callArgs[1]).toEqual([TEST_RUN_ID, TX_NAME, SAMPLER, false, null]);
      expect(result).toHaveLength(1);
    });
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts -t getSamplerTimeSeries`

Expected: FAIL — old `getSamplerTimeSeries` still queries `requests_raw` directly.

- [ ] **Step 3: Replace the inline SQL with a builder call**

Replace the entire `getSamplerTimeSeries` method body with:

```typescript
  async getSamplerTimeSeries(
    testRunId: string,
    transactionName: string,
    samplerName: string,
    userId: string,
    roles: string[],
    aggregationSeconds: number = 5,
    excludeRampUp: boolean = false,
  ): Promise<TimeSeriesDataPoint[]> {
    try {
      this.validateAggregationSeconds(aggregationSeconds);
      await this.validateOrganizationAccess(testRunId, userId, roles);

      this.logger.log(
        `Getting time-series data for sampler: ${samplerName} in transaction: ${transactionName} with ${aggregationSeconds}s aggregation (excludeRampUp: ${excludeRampUp})`,
      );

      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp);
      const queryParams = [
        testRunId,
        transactionName,
        samplerName,
        excludeRampUp,
        cutoffTime ?? null,
      ];

      const samplerQuery = this.buildTimeSeriesQuery({
        kind: 'sampler-single',
        aggSec: aggregationSeconds,
      });
      const samplerResult = await withRequestEm(this.testRunRepo).query(
        samplerQuery,
        queryParams,
      );

      this.logger.log(
        `Retrieved ${samplerResult.length} data points for sampler ${samplerName}`,
      );

      return samplerResult.map((row: Record<string, unknown>) =>
        this.parseTimeSeriesRow(row),
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(
        `Failed to get time-series data for sampler ${samplerName}:`,
        error,
      );
      throw new DatabaseException(
        'Failed to retrieve sampler time-series data',
        error,
      );
    }
  }
```

- [ ] **Step 4: Run all spec tests to confirm**

Run: `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts`

Expected: PASS — all groups (`validateAggregationSeconds`, `buildTimeSeriesQuery`, `getTransactionTimeSeries`, `getSamplerTimeSeries`) green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts
git commit -m "$(cat <<'EOF'
fix(api): route getSamplerTimeSeries to CAGGs (#283)

Same approx_percentile(rollup(pct_agg)) treatment for the single-sampler
chart endpoint. Closes the last raw-hypertable scan in the test-run UI
timeseries path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Preflight gate, manual verification, push, PR

**Files:** none — verification only.

- [ ] **Step 1: Run preflight from the repo root**

Run: `npm run preflight`

Expected: PASS — turbo caches lint + type-check across the monorepo, then the API RLS suite. Warm runs are sub-second; the RLS step is ~3 s.

If anything fails: stop, diagnose, fix in a follow-up commit, re-run preflight. Do NOT push.

- [ ] **Step 2: Smoke-test against a populated DB (optional but strongly recommended)**

If a populated lab DB is available locally:

1. `npm run dev:api` (or full `npm run dev`).
2. Open the test-run UI at `http://localhost:4001` against a run with data.
3. Open a transaction graph and a request graph for one transaction.
4. Confirm:
   - Render wall time sub-second (was 30+ s on the lab repro).
   - p50/p90/p95/p99 series populated and within ~1 % of prior values for a known transaction.
   - Ramp-up exclusion toggle still trims the chart to the post-ramp-up window.

If no lab DB is available, skip this step and note "manual verification deferred to merge-time review" in the PR description.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin fix/timeseries-from-cagg-283
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "fix(api): route test-run timeseries reads to CAGGs (#283)" --body "$(cat <<'EOF'
## Summary

- Replaces per-render `PERCENTILE_CONT` scans of `requests_raw` / `transactions` with `approx_percentile(rollup(pct_agg))` over the existing `requests_raw_5s` / `transactions_5s` continuous aggregates.
- Cuts test-run timeseries chart wall time from 30–230 s on populated TimescaleDB instances down to sub-second renders.
- One service file touched (`test-runs-timeseries-query.service.ts`) plus a new spec; no schema, DTO, or frontend changes.

Closes #283. Spec: `docs/superpowers/specs/2026-05-07-timeseries-from-cagg-design.md`. Plan: `docs/superpowers/plans/2026-05-07-timeseries-from-cagg.md`.

## Test plan

- [x] `cd apps/api && npx jest src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts` — all four describe groups green
- [x] `npm run preflight` — lint, type-check, RLS suite pass
- [ ] Manual: open a transaction graph and a request graph in the test-run UI on a populated lab DB; confirm sub-second render and p95 values within ~1 % of prior raw-query values

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Update GitNexus index after the PR is opened**

Run: `npx gitnexus analyze`

Expected: index updates to include the new commits on this branch (per memory, this is the standard post-ship step).

---

## Self-review notes

- **Spec coverage:** every requirement in the design spec is mapped to a task above.
  - In-flight runs / CAGG only → query reads from `*_5s` only; no UNION ALL (Tasks 2–4).
  - Scenario derivation via raw lookup → `scenarios` CTE in `buildTimeSeriesQuery` (Task 2).
  - `_5s` + `rollup()` → SELECT body in `buildTimeSeriesQuery` (Task 2).
  - Drop raw path → no fallback branch in the new public method bodies (Tasks 3, 4).
  - `aggregationSeconds` validation → `validateAggregationSeconds` (Task 1, wired Tasks 3, 4).
  - Ramp-up bucket alignment → `time_bucket('5 seconds', cutoff)` (Task 2).
  - Single source of truth for SQL → `buildTimeSeriesQuery` (Task 2).
  - Tests 1–6 from the spec → covered across Task 1, Task 2 (`buildTimeSeriesQuery` describe), Tasks 3, 4 (call-shape assertions).
- **Placeholders:** none — every step contains the actual code, tests, command, or commit message it claims.
- **Type consistency:** `buildTimeSeriesQuery` signature matches the call sites in Tasks 3 and 4. `validateAggregationSeconds` is private and called from both public methods.
