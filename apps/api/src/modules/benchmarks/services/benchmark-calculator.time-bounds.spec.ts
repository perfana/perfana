import { BenchmarkCalculatorService } from './benchmark-calculator.service';
import { DataSource } from 'typeorm';

/**
 * Issue #674: a read on `requests_raw`, `transactions`, `requests_error` or
 * `virtual_users` filtered on `test_run_id` alone locks EVERY chunk of the table plus
 * every compressed twin plus the indexes on both — 136 relation locks where 21 cover
 * the same rows, growing ~365 per table per year at daily chunks.
 *
 * Both reads in this service are on the SLO-configuration UI's path, so they run
 * interactively against `requests_raw`. No behavioural test can see the bound — the
 * result set is identical either way — so the guard is on the emitted SQL, the same
 * shape as the two dedicated specs under `test-runs` and `reports`.
 *
 * It also guards the trap: reaching into `test_runs` for `start_time`/`end_time` inside
 * the same statement looks like the fix and is worse, because chunk exclusion for
 * locking happens at plan time (150 locks against 136 for no predicate at all). The
 * window must be fetched first and bound as parameters.
 */

/** The trap: a `time` comparison against a column of a joined `test_runs`. */
const READS_RUN_TIMES = /time\s*(?:>=|<=|>|<|BETWEEN)\s*(?:tr|test_runs)\./i;

const TEST_RUN_ID = 'PerfanaWebshop-acc-loadTest-00012';

/** 10:00-11:00, 120 s ramp-up, 60 s ramp-down. */
const RUN_WINDOW_ROW = [{
  start_time: '2026-01-01T10:00:00.000Z',
  ramp_up: '120',
  end_time: '2026-01-01T11:00:00.000Z',
  ramp_down: '60',
}];
const WINDOW_START = new Date('2026-01-01T09:00:00.000Z');
const WINDOW_END = new Date('2026-01-01T12:00:00.000Z');
const ANALYSIS_START = new Date('2026-01-01T10:02:00.000Z');
const ANALYSIS_END = new Date('2026-01-01T10:59:00.000Z');

const isRunWindowLookup = (sql: unknown) =>
  typeof sql === 'string' && /SELECT start_time, ramp_up, end_time, ramp_down FROM test_runs/.test(sql);

describe('BenchmarkCalculatorService raw-hypertable time bounds (#674)', () => {
  let query: jest.Mock;
  let service: BenchmarkCalculatorService;

  beforeEach(() => {
    query = jest.fn(async (sql: unknown) =>
      isRunWindowLookup(sql)
        ? RUN_WINDOW_ROW
        : [{ transaction_name: 'checkout', satisfied_count: '1', tolerating_count: '0', frustrated_count: '0', total_count: '1' }],
    );
    service = new BenchmarkCalculatorService({ query } as unknown as DataSource);
  });

  const hypertableRead = () =>
    (query.mock.calls as [string, unknown[]][]).find(([sql]) => /FROM requests_raw\b/.test(sql))!;

  it('bounds the transaction list by the run window, from parameters', async () => {
    await service.getAvailableTransactions(TEST_RUN_ID);

    const [sql, params] = hypertableRead();
    expect(sql).toMatch(/time >= \$2/);
    expect(sql).toContain('time <= $3');
    expect(sql).not.toMatch(READS_RUN_TIMES);
    // Never ramp-trimmed: the picker lists every transaction the run recorded.
    expect(params).toEqual([TEST_RUN_ID, WINDOW_START, WINDOW_END]);
  });

  it('bounds the Apdex preview scan in BOTH toggle positions', async () => {
    // The toggle narrows the window; it does not decide whether there is one. This is the
    // whole bug class: the predicate these replaced folded to TRUE on the default path,
    // so an unbounded read looked bounded to any grep for `time >=`.
    for (const [excludeRampUp, start, end] of [
      [false, WINDOW_START, WINDOW_END],
      [true, ANALYSIS_START, ANALYSIS_END],
    ] as [boolean, Date, Date][]) {
      query.mockClear();
      await service.previewApdex({ testRunId: TEST_RUN_ID, thresholdMs: 500, excludeRampUp });

      const [sql, params] = hypertableRead();
      expect(sql).toMatch(/time >= \$\d+/);
      expect(sql).not.toMatch(READS_RUN_TIMES);
      expect(params).toContainEqual(start);
      expect(params).toContainEqual(end);
      // The threshold params must still land after the bounds, or the FILTERs compare a date.
      expect(params.slice(-2)).toEqual([500, 2000]);
    }
  });
});
