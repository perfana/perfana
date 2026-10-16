import { TestRunsBaselineApdexService } from './test-runs-baseline-apdex.service';
import { BaselineApdexScope } from '../dto/baseline-apdex.dto';

/**
 * Issue #674: a read on `requests_raw`, `transactions`, `requests_error` or
 * `virtual_users` filtered on `test_run_id` alone locks EVERY chunk of the table plus
 * every compressed twin plus the indexes on both — 136 relation locks where 21 cover
 * the same rows, growing ~365 per table per year at daily chunks.
 *
 * Both reads in this service hit `transactions`, and neither is reachable from
 * `test-runs-baseline-apdex.service.spec.ts`, which stubs `getTransactionResponseTimes`
 * away wholesale. No behavioural test can see a bound in any case — the result set is
 * identical either way — so the guard is on the emitted SQL, the same shape as the
 * specs under `benchmarks`, `test-runs` and `reports`.
 *
 * The specific hazard here is that **both bounds are numbered by hand**:
 * `timeBoundsSql(..., 't.time', 5)` after four positional parameters, and
 * `(..., 't.time', 3)` after two. An off-by-one is a runtime bind error that the
 * controller catches and logs — never a failing test — so the indices are asserted
 * literally rather than with `\d+`.
 *
 * It also guards the trap: reaching into the joined `test_runs` for
 * `start_time`/`end_time` inside the same statement looks like the fix and is worse,
 * because chunk exclusion for locking happens at plan time (150 locks against 136 for
 * no predicate at all). The window must come from the row already in hand.
 */

/** The trap: a `time` comparison against a column of a joined `test_runs`. */
const READS_RUN_TIMES = /time\s*(?:>=|<=|>|<|BETWEEN)\s*(?:tr|test_runs)\./i;

const TEST_RUN_ID = 'PerfanaWebshop-acc-loadTest-00012';

/** 10:00-11:00; padded an hour each side by `analysisBoundsFromRow`. */
const RUN_ROW = {
  id: '11111111-2222-3333-4444-555555555555',
  test_run_id: TEST_RUN_ID,
  system_under_test_id: 'sut-1',
  system_name: 'PerfanaWebshop',
  test_environment: 'acc',
  workload: 'loadTest',
  start_time: '2026-01-01T10:00:00.000Z',
  end_time: '2026-01-01T11:00:00.000Z',
};
const WINDOW_START = new Date('2026-01-01T09:00:00.000Z');
const WINDOW_END = new Date('2026-01-01T12:00:00.000Z');

const isRunDetailsLookup = (sql: string) => /FROM test_runs tr\b/.test(sql);

describe('TestRunsBaselineApdexService raw-hypertable time bounds (#674)', () => {
  let query: jest.Mock;
  let service: TestRunsBaselineApdexService;

  beforeEach(() => {
    query = jest.fn(async (sql: string) =>
      isRunDetailsLookup(sql)
        ? [RUN_ROW]
        : [
            {
              transaction_name: 'checkout',
              scenario_name: 'default',
              response_times: [100, 120, 140, 160, 180, 200, 220, 240, 260, 280],
              workload_threshold: 500,
              transaction_threshold: null,
            },
          ],
    );

    service = new TestRunsBaselineApdexService(
      { query } as never, // testRunRepo — withRequestEm is identity outside a request
      { findOne: async () => ({ id: 'sut-1', organization_id: 'org-1', created_by: 'u1' }) } as never,
      {} as never, // apdexService — unused on these two paths
      { canAccessResource: async () => ({ allowed: true }) } as never,
    );
  });

  const hypertableRead = () =>
    (query.mock.calls as [string, unknown[]][]).find(([sql]) => /FROM transactions t\b/.test(sql))!;

  it('binds both `transactions` reads at their hand-written start indices', async () => {
    // 1. getTransactionResponseTimes — startIndex 5, after the four threshold-lookup
    //    positional parameters. Never ramp-trimmed: a baseline is calibrated against
    //    everything the run recorded.
    await service.previewBaselineApdex(
      TEST_RUN_ID,
      { target_apdex: 0.9, scope: BaselineApdexScope.TRANSACTION },
      'user-1',
      [],
    );

    const [listSql, listParams] = hypertableRead();
    expect(listSql).toContain('t.time >= $5');
    expect(listSql).toContain('t.time <= $6');
    expect(listSql).not.toMatch(READS_RUN_TIMES);
    expect(listParams).toEqual([
      'sut-1',
      'acc',
      'loadTest',
      TEST_RUN_ID,
      WINDOW_START,
      WINDOW_END,
    ]);

    // 2. previewTransactionApdex — startIndex 3, after test_run_id + transaction_name.
    query.mockClear();
    await service.previewTransactionApdex(TEST_RUN_ID, 'checkout', 750, 'user-1', []);

    const [oneSql, oneParams] = hypertableRead();
    expect(oneSql).toContain('t.time >= $3');
    expect(oneSql).toContain('t.time <= $4');
    expect(oneSql).not.toMatch(READS_RUN_TIMES);
    expect(oneParams).toEqual([TEST_RUN_ID, 'checkout', WINDOW_START, WINDOW_END]);
  });
});
