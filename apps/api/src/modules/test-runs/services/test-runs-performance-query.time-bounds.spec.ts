import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { TestRun as TestRunEntity } from '../../../entities';
import { JobProgressService } from '../../data-science/services/job-progress.service';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';

/**
 * Issue #674: a read on `requests_raw`, `transactions`, `requests_error` or
 * `virtual_users` filtered on `test_run_id` alone locks EVERY chunk of the table plus
 * every compressed twin plus the indexes on both — 136 relation locks where 21 cover
 * the same rows, growing ~365 per table per year at daily chunks.
 *
 * This file's two jobs, neither of which a behavioural test can do:
 *
 * 1. **Every hypertable read carries a parameterised `time` bound**, in BOTH toggle
 *    positions. The predicate these replaced — `($2::boolean = false OR …)` — folds to
 *    TRUE at plan time whenever `excludeRampUp` is false, which is the default, so it
 *    read as bounded to any grep for `time >=` and was not. Hence the assertion that no
 *    hypertable read contains `= false OR` at all.
 * 2. **The window is never read off `test_runs` inside the same statement.** That looks
 *    like the fix and is worse: chunk exclusion for locking happens at plan time, so a
 *    correlated subquery excludes nothing and adds the `test_runs` relations on top
 *    (150 locks against 136 for no predicate whatsoever). A `JOIN test_runs` for the
 *    ORG FILTER is fine and expected; reading a timestamp column off it is not.
 */

const HYPERTABLE = /(?:FROM|JOIN)\s+(?:requests_raw|transactions|requests_error|virtual_users)\b(?!_5s|_passed)/;
/** The trap: a `time` comparison against a column of the joined `test_runs`. */
const READS_RUN_TIMES = /time\s*(?:>=|<=|>|<|BETWEEN)\s*tr\./i;

const TEST_RUN_ID = 'PerfanaWebshop-acc-loadTest-00012';
const TRANSACTION = 'checkout';

/** 10:00-11:00, 120s ramp-up, 60s ramp-down. */
const RUN_WINDOW_ROW = [{
  start_time: '2025-01-01T10:00:00.000Z',
  ramp_up: '120',
  end_time: '2025-01-01T11:00:00.000Z',
  ramp_down: '60',
}];
const WINDOW_START = new Date('2025-01-01T09:00:00.000Z');
const WINDOW_END = new Date('2025-01-01T12:00:00.000Z');
const ANALYSIS_START = new Date('2025-01-01T10:02:00.000Z');
const ANALYSIS_END = new Date('2025-01-01T10:59:00.000Z');

const isRunWindowLookup = (sql: unknown) =>
  typeof sql === 'string' && /SELECT start_time, ramp_up, end_time, ramp_down FROM test_runs/.test(sql);

describe('TestRunsPerformanceQueryService raw-hypertable time bounds (#674)', () => {
  let service: TestRunsPerformanceQueryService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn(async (sql: unknown) => (isRunWindowLookup(sql) ? RUN_WINDOW_ROW : []));
    const repo = { query, manager: { transaction: (cb: (em: unknown) => unknown) => cb({ query }) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsPerformanceQueryService,
        TestRunsMapperService,
        { provide: getRepositoryToken(TestRunEntity), useValue: repo },
        { provide: JobProgressService, useValue: { getActiveJobForScope: jest.fn().mockResolvedValue(null) } },
        { provide: BullMQClientService, useValue: { enqueue: jest.fn() } },
      ],
    }).compile();

    service = module.get(TestRunsPerformanceQueryService);
  });

  const hypertableReads = () =>
    (query.mock.calls as [string, unknown[]][]).filter(([sql]) => HYPERTABLE.test(sql));

  /** @param expected the bounds every read should carry, or null to only check shape. */
  const assertBounded = (expected: [Date, Date] | null = null) => {
    const reads = hypertableReads();
    expect(reads.length).toBeGreaterThan(0);
    for (const [sql, params] of reads) {
      expect(sql).toMatch(/time >= \$\d+/);
      expect(sql).not.toContain('= false OR');
      expect(sql).not.toMatch(READS_RUN_TIMES);
      const dates = (params ?? []).filter((p): p is Date => p instanceof Date);
      expect(dates.length).toBeGreaterThan(0);
      if (expected) {
        expect(dates).toContainEqual(expected[0]);
        expect(dates).toContainEqual(expected[1]);
      }
    }
  };

  it.each([
    [false, [WINDOW_START, WINDOW_END] as [Date, Date]],
    [true, [ANALYSIS_START, ANALYSIS_END] as [Date, Date]],
  ])('getTransactionStats (excludeRampUp=%s)', async (excludeRampUp, expected) => {
    await service.getTransactionStats(TEST_RUN_ID, excludeRampUp, true, []);
    assertBounded(expected);
  });

  it.each([
    [false, [WINDOW_START, WINDOW_END] as [Date, Date]],
    [true, [ANALYSIS_START, ANALYSIS_END] as [Date, Date]],
  ])('getTransactionSamples (excludeRampUp=%s)', async (excludeRampUp, expected) => {
    await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, excludeRampUp, true, []);
    assertBounded(expected);
  });

  /**
   * The parallel-group decoration is a second `requests_raw` read, and its LIMIT bounds
   * rows RETURNED, not chunks locked. It uses the run window rather than the analysis
   * one: it asks where a sampler first fired, not how it performed.
   */
  it('bounds the parallel-group decoration too', async () => {
    query.mockImplementation(async (sql: unknown) => {
      if (isRunWindowLookup(sql)) return RUN_WINDOW_ROW;
      if (typeof sql === 'string' && /approx_percentile/.test(sql)) {
        return [{ sampler_name: 'POST /checkout', total_count: '1' }];
      }
      return [];
    });

    await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, true, []);

    const chainRead = hypertableReads().find(([sql]) => sql.includes('source_element_path'));
    expect(chainRead).toBeDefined();
    expect(chainRead![0]).toMatch(/time >= \$\d+/);
    expect(chainRead![1]).toEqual([TEST_RUN_ID, TRANSACTION, WINDOW_START, WINDOW_END]);
  });

  it.each([
    [false, [WINDOW_START, WINDOW_END] as [Date, Date]],
    [true, [ANALYSIS_START, ANALYSIS_END] as [Date, Date]],
  ])('getVirtualUserStats (excludeRampUp=%s)', async (excludeRampUp, expected) => {
    await service.getVirtualUserStats(TEST_RUN_ID, excludeRampUp, true, []);
    assertBounded(expected);
  });

  it.each([false, true])('getThroughputStats (excludeRampUp=%s)', async (excludeRampUp) => {
    query.mockImplementation(async (sql: unknown) => {
      if (isRunWindowLookup(sql)) return RUN_WINDOW_ROW;
      if (typeof sql === 'string' && /AS has_cagg/.test(sql)) {
        // No CAGG → the raw-scan fallback, which is the arm that reads the hypertables.
        return [{
          sut: 'webshop', system_under_test_id: 'sut-1', env: 'acc', workload: 'load',
          start_time: '2025-01-01T10:00:00.000Z', end_time: '2025-01-01T11:00:00.000Z',
          ramp_up: '120', ramp_down: '60', has_cagg: false,
        }];
      }
      return [];
    });

    await service.getThroughputStats(TEST_RUN_ID, excludeRampUp, true, []);
    assertBounded(excludeRampUp ? [ANALYSIS_START, ANALYSIS_END] : [WINDOW_START, WINDOW_END]);
  });

  it.each([false, true])('getAggregatedMetricTimeseries (applyAnalysisWindow=%s)', async (apply) => {
    await service.getAggregatedMetricTimeseries(
      TEST_RUN_ID, 'transaction_response_time', 'avg', apply, true, []);
    assertBounded(apply ? [ANALYSIS_START, ANALYSIS_END] : [WINDOW_START, WINDOW_END]);
  });

  it('getTransactionErrors bounds both the error list and the legacy sampler scan', async () => {
    await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, true, []);
    // Never ramp-trimmed: the modal lists every error in the run.
    assertBounded([WINDOW_START, WINDOW_END]);
  });

  it('getSummaryTimeseries bounds both branches of the raw UNION fallback', async () => {
    query.mockImplementation(async (sql: unknown) => {
      if (isRunWindowLookup(sql)) return RUN_WINDOW_ROW;
      if (typeof sql === 'string' && /sut\.name AS sut_name/.test(sql)) {
        return [{
          start_time: '2025-01-01T10:00:00.000Z', end_time: '2025-01-01T11:00:00.000Z',
          duration: 3600, sut_name: 'webshop', test_environment: 'acc',
        }];
      }
      return []; // the CAGG path returns nothing, so the raw fallback runs
    });

    await service.getSummaryTimeseries(TEST_RUN_ID);

    const reads = hypertableReads();
    expect(reads).toHaveLength(1); // one statement, both UNION branches inside it
    const [sql] = reads[0]!;
    // Both branches, not just the first.
    expect(sql.match(/time >= \$\d+/g)).toHaveLength(2);
    assertBounded([WINDOW_START, WINDOW_END]);
  });

  /**
   * The repair probe used to argue for being unbounded, because a row arriving past
   * `end_time` (observed 36 s late) is the case it exists to detect. The hour of padding
   * covers that, so it is bounded like everything else — and it is on a read path.
   */
  it('repairEmptySamplerRollup bounds both EXISTS probes', async () => {
    await (service as unknown as {
      repairEmptySamplerRollup: (
        id: string, isAdmin: boolean, orgs: string[], bounds: unknown,
      ) => Promise<void>;
    }).repairEmptySamplerRollup(
      TEST_RUN_ID, true, [], { startCutoff: WINDOW_START, endCutoff: WINDOW_END });

    const reads = hypertableReads();
    expect(reads).toHaveLength(1);
    const [sql, params] = reads[0]!;
    expect(sql).toContain('t.time >= $2');
    expect(sql).toContain('r.time >= $2');
    expect(sql).not.toMatch(READS_RUN_TIMES);
    expect(params).toEqual([TEST_RUN_ID, WINDOW_START, WINDOW_END]);
  });
});
