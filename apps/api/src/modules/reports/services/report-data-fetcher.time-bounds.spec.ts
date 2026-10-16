import { ReportDataFetcherService } from './report-data-fetcher.service';
import { TestRun } from '@perfana/shared';

/**
 * Issue #674: a read on `requests_raw`, `transactions`, `requests_error` or
 * `virtual_users` filtered on `test_run_id` alone locks EVERY chunk of the table plus
 * every compressed twin plus the indexes on both — 136 relation locks where 21 cover the
 * same rows, growing ~365 per table per year at daily chunks.
 *
 * No behavioural test can see this: the result set is identical either way. So the guard
 * is on the emitted SQL text, the same shape as the `cr.average_all` assertion in
 * report-data-fetcher.service.spec.ts.
 *
 * It also guards the trap. Reaching into `test_runs` for `start_time`/`end_time` inside
 * the same statement looks like the fix and is worse — chunk exclusion for locking
 * happens at plan time, so a correlated subquery excludes nothing and adds the
 * `test_runs` relations on top (150 locks). The window must be fetched first and bound
 * as parameters. A `JOIN test_runs` for the ORG FILTER is fine and expected; reading a
 * timestamp column off it is not.
 */

const HYPERTABLE = /(?:FROM|JOIN)\s+(?:requests_raw|transactions|requests_error|virtual_users)\b(?!_5s)/;
const READS_RUN_TIMES = /tr\.(?:start_time|end_time|ramp_up|ramp_down)/;

const RUN_WINDOW_ROW = [{
  start_time: '2026-01-01T10:00:00.000Z',
  ramp_up: '60',
  end_time: '2026-01-01T11:00:00.000Z',
  ramp_down: '60',
}];

/** The padded run window (toggle off) and the analysis window (toggle on). */
const WINDOW_START = new Date('2026-01-01T09:00:00.000Z');
const WINDOW_END = new Date('2026-01-01T12:00:00.000Z');
const ANALYSIS_START = new Date('2026-01-01T10:01:00.000Z');
const ANALYSIS_END = new Date('2026-01-01T10:59:00.000Z');

const testRun = {
  id: 'uuid-1',
  testRunId: 'run-001',
  testEnvironment: 'acc',
  workload: 'load',
  systemUnderTestId: 'sut-1',
  startTime: new Date('2026-01-01T10:00:00Z'),
  endTime: new Date('2026-01-01T11:00:00Z'),
  analysisStartOffset: 60,
  analysisEndOffset: 60,
} as unknown as TestRun;

/** Answers whatever each query needs by SQL text, so call order never matters. */
function makeRepo() {
  const query = jest.fn(async (sql: string) => {
    if (/tr\.ramp_up[\s\S]*tr\.ramp_down/.test(sql)) return RUN_WINDOW_ROW;
    if (/has_cagg/.test(sql)) return [];
    // One row, not []. getScenarioDataFromDatabase early-returns on an empty first
    // result, which left its SECOND read (the time-series query) never emitted and so
    // never asserted — a bound could be deleted from it with every test green.
    if (/FROM transactions txn/.test(sql)) return [{ transaction_name: 'checkout', avg_ms: '1', p95_ms: '1', p99_ms: '1', pass: '1', fail: '0', total: '1' }];
    return [];
  });
  return { query, findOne: jest.fn().mockResolvedValue({ id: 'uuid-1' }) } as never;
}

describe('ReportDataFetcherService raw-hypertable time bounds (#674)', () => {
  let repo: { query: jest.Mock };
  let service: ReportDataFetcherService;

  beforeEach(() => {
    repo = makeRepo() as unknown as { query: jest.Mock };
    service = new ReportDataFetcherService(
      repo as never,
      { isGlobalAdmin: () => true, getAccessibleOrganizations: jest.fn().mockResolvedValue([]) } as never,
      { query: jest.fn().mockResolvedValue([]) } as never,
    );
  });

  const hypertableReads = () =>
    (repo.query.mock.calls as [string, unknown[]][]).filter(([sql]) => HYPERTABLE.test(sql));

  /**
   * @param expected the exact bounds every read must carry. Asserting merely that
   * *some* parameter is a Date lets a wrong-but-present window through, which is the
   * failure this whole file exists to catch — so the window is pinned by value.
   */
  /**
   * Count, do not merely match. A single statement can read the hypertable more than
   * once — the per-scenario throughput query has two bounded CTEs, the errors modal has
   * a `requests_error` arm beside a `requests_raw` one, the summary-timeseries fallback
   * is a UNION. A first-match `toMatch(/time >= \$\d+/)` passes while one of those
   * bounds is missing; a 46-mutation sweep proved five such bounds were deletable with
   * the whole suite green. So require one `time >=` per hypertable read in the same SQL.
   */
  const boundsRequiredIn = (sql: string): number =>
    (sql.match(new RegExp(HYPERTABLE.source, 'g')) ?? []).length;

  const assertBounded = (expected: [Date, Date] = [WINDOW_START, WINDOW_END]) => {
    const reads = hypertableReads();
    expect(reads.length).toBeGreaterThan(0);
    for (const [sql, params] of reads) {
      expect(sql).toMatch(/time >= \$\d+/);
      // One bound per hypertable read in this statement, not just the first.
      expect((sql.match(/time >= \$\d+/g) ?? []).length).toBeGreaterThanOrEqual(boundsRequiredIn(sql));
      expect(sql).not.toMatch(READS_RUN_TIMES);
      // Both fold-to-TRUE spellings: `= false OR` and the `$n IS NULL OR` form.
      expect(sql).not.toMatch(/(?:= false|IS NULL) OR/);
      // …and the bound is the real window, not a NULL the planner folds away.
      const dates = (params ?? []).filter((p): p is Date => p instanceof Date);
      expect(dates.map((d) => d.toISOString()))
        .toEqual(expect.arrayContaining(expected.map((d) => d.toISOString())));
    }
  };

  // Each case drives one method and asserts every hypertable read it emitted. Both
  // toggle positions, because the lock bound is NOT the analysis-window toggle: the
  // reads used to carry `($2::boolean = false OR time >= $3)`, which folds to TRUE —
  // no bound at all — on the default path.
  // getScenarioDataFromDatabase takes no excludeRampUp parameter — it is always the
  // run's own window. One case, not a two-case `it.each` whose parameter goes unused.
  it('getScenarioDataFromDatabase', async () => {
    await service.getScenarioDataFromDatabase(testRun, 'checkout', '', []);
    assertBounded();
  });

  it.each([false, true])('getErrorAnalysis (excludeRampUp=%s)', async (excludeRampUp) => {
    await service.getErrorAnalysis(testRun, [], excludeRampUp, '', []);
    assertBounded(excludeRampUp ? [ANALYSIS_START, ANALYSIS_END] : [WINDOW_START, WINDOW_END]);
  });

  /**
   * #674 regression guard, and the reason it is not `[ANALYSIS_START, ANALYSIS_END]`.
   *
   * Before #674 these three readers carried `AND ($2::boolean = false OR t.time >= $3)` —
   * a START cutoff and NO end. Handing them an analysis end re-cuts the default report:
   * measured on a real run, the Apdex table lost 131 of 275 rows and its average moved
   * 282.41 → 286.58 ms, on 58 of 60 runs on the dev database. The toggle still trims the
   * head; the end is the padded run window and exists only to bound the locks.
   */
  it.each([false, true])('getApdexDataFromDatabase keeps its pre-#674 head-only trim (excludeRampUp=%s)', async (excludeRampUp) => {
    await service.getApdexDataFromDatabase(testRun, 500, excludeRampUp, '', []);
    assertBounded([excludeRampUp ? ANALYSIS_START : WINDOW_START, WINDOW_END]);
  });

  it.each([false, true])('getThroughputStatsForReport (excludeRampUp=%s)', async (excludeRampUp) => {
    await service.getThroughputStatsForReport('run-001', excludeRampUp, null, '', []);
    // Head-only trim, as before #674 — see getApdexDataFromDatabase above.
    assertBounded([excludeRampUp ? ANALYSIS_START : WINDOW_START, WINDOW_END]);
  });

  it.each([false, true])('getVirtualUserStatsForReport (excludeRampUp=%s)', async (excludeRampUp) => {
    await service.getVirtualUserStatsForReport('run-001', excludeRampUp, null, '', []);
    // Head-only trim, as before #674 — see getApdexDataFromDatabase above.
    assertBounded([excludeRampUp ? ANALYSIS_START : WINDOW_START, WINDOW_END]);
  });

  it.each([false, true])('getAggregatedSeries (excludeRampUp=%s)', async (excludeRampUp) => {
    await service.getAggregatedSeries('run-001', 'transaction_response_time', 'avg', excludeRampUp, '', []);
    assertBounded(excludeRampUp ? [ANALYSIS_START, ANALYSIS_END] : [WINDOW_START, WINDOW_END]);
  });

  it('getAggregatedScalars', async () => {
    await service.getAggregatedScalars('run-001', '', []);
    assertBounded();
  });

  it('listScenarioNames', async () => {
    await service.listScenarioNames(testRun, '', []);
    assertBounded();
  });

  it('getSamplerControllerChains', async () => {
    await service.getSamplerControllerChains('run-001', ['checkout'], '', []);
    assertBounded();
  });

  it('getBaselineRunComparison spans both runs rather than subquerying either', async () => {
    await service.getBaselineRunComparison('cur', 'base', 'performance-metrics',
      { metrics: ['avg'], userId: '', roles: [] });
    assertBounded();
  });

  it('getTrendsData reads the per-run stats in one bounded query, not a correlated lateral', async () => {
    repo.query.mockImplementation(async (sql: string) => {
      if (/tr\.ramp_up[\s\S]*tr\.ramp_down/.test(sql)) return RUN_WINDOW_ROW;
      if (/FROM test_runs tr/.test(sql) && /JOIN systems_under_test/.test(sql)) {
        return [{
          test_run_id: 'run-001',
          start_time: '2026-01-01T10:00:00.000Z',
          end_time: '2026-01-01T11:00:00.000Z',
          application_release: 'v1', duration: '600', consolidated_result: null, annotations: [],
        }];
      }
      return [];
    });

    await service.getTrendsData(testRun, 10, '', []);

    const reads = hypertableReads();
    expect(reads).toHaveLength(1);
    expect(reads[0]![0]).toContain('t.test_run_id = ANY($1)');
    expect(reads[0]![0]).not.toMatch(/LATERAL/);
    assertBounded();
  });
});
