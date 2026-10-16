import { DataSource } from 'typeorm';
import { DeleteSystemUnderTestHandler } from './delete-system-under-test.handler';
import { AuditService } from '../../audit/audit.service';

/**
 * Issue #674: a read on `requests_raw`, `transactions`, `requests_error` or
 * `virtual_users` filtered on `test_run_id` alone locks EVERY chunk of the table plus
 * every compressed twin plus the indexes on both — 136 relation locks where 21 cover
 * the same rows, growing ~365 per table per year at daily chunks.
 *
 * `getDeletePreview` is the one converted site with no single run window: its two
 * hypertable COUNTs span every run of the system. The system's OWN span is still a
 * bound — a system that ran for two months in a two-year table locks ~60 chunks
 * instead of ~730 — so the handler fetches `MIN(start_time)` / `MAX(end_time)` first
 * and binds the padded result.
 *
 * No behavioural test can see any of this: the counts are identical bounded or not.
 * The guard is on the emitted SQL, the same shape as the specs under `benchmarks`,
 * `test-runs` and `reports`.
 */

/** The trap: a `time` comparison against a column of a joined/subqueried `test_runs`. */
const READS_RUN_TIMES = /time\s*(?:>=|<=|>|<|BETWEEN)\s*(?:tr|test_runs)\./i;

const SUT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** The system's runs span 10:00-11:00; padded an hour each side. */
const SPAN_START = new Date('2026-01-01T09:00:00.000Z');
const SPAN_END = new Date('2026-01-01T12:00:00.000Z');

const isSpanLookup = (sql: string) => /MIN\(start_time\)/.test(sql);

type Call = [string, unknown[]];

describe('DeleteSystemUnderTestHandler raw-hypertable time bounds (#674)', () => {
  let query: jest.Mock;
  let handler: DeleteSystemUnderTestHandler;

  /** @param span what the MIN/MAX lookup answers for this system. */
  const build = (span: { min_start: string | null; max_end: string | null }) => {
    query = jest.fn(async (sql: string) => {
      if (/FROM systems_under_test WHERE id/.test(sql)) return [{ id: SUT_ID, name: 'webshop' }];
      if (isSpanLookup(sql)) return [span];
      return [{ count: '0' }];
    });
    handler = new DeleteSystemUnderTestHandler(
      { query } as unknown as DataSource,
      {} as unknown as AuditService,
    );
  };

  const hypertableCounts = (): Call[] =>
    (query.mock.calls as Call[]).filter(([sql]) =>
      /FROM (?:requests_raw|transactions) WHERE/.test(sql),
    );

  it('bounds both hypertable counts by the system own span', async () => {
    build({ min_start: '2026-01-01T10:00:00.000Z', max_end: '2026-01-01T11:00:00.000Z' });

    await handler.getDeletePreview(SUT_ID);

    const counts = hypertableCounts();
    expect(counts).toHaveLength(2);
    for (const [sql, params] of counts) {
      expect(sql).toContain('time >= $2');
      expect(sql).toContain('time <= $3');
      expect(sql).not.toMatch(READS_RUN_TIMES);
      // One `timeBoundsSql` result shared by both reads: same clause, same parameters.
      expect(params).toEqual([SUT_ID, SPAN_START, SPAN_END]);
    }
  });

  it('leaves the upper bound OPEN while a run of the system is still in flight', async () => {
    // SQL `MAX` SKIPS NULLs, so a bare `MAX(end_time)` would answer with the newest
    // FINISHED run and silently clip an in-flight run's rows out of the counts behind
    // a destructive-action confirmation dialog — while the cascade itself has no time
    // predicate and deletes them anyway. The CASE/FILTER propagates the NULL instead.
    build({ min_start: '2026-01-01T10:00:00.000Z', max_end: null });

    await handler.getDeletePreview(SUT_ID);

    const [spanSql] = (query.mock.calls as Call[]).find(([sql]) => isSpanLookup(sql))!;
    expect(spanSql).toContain('CASE WHEN count(*) FILTER (WHERE end_time IS NULL) > 0');
    expect(spanSql).toContain('THEN NULL ELSE MAX(end_time) END');

    const counts = hypertableCounts();
    expect(counts).toHaveLength(2);
    for (const [sql, params] of counts) {
      expect(sql).toContain('time >= $2');
      expect(sql).not.toContain('time <=');
      expect(params).toEqual([SUT_ID, SPAN_START]);
    }
  });

  it('KNOWN RESIDUE: a system with no runs at all is counted unbounded', async () => {
    // `MIN`/`MAX` over zero rows are both NULL, so `timeBoundsSql` emits no predicate
    // and the two counts go out in exactly the shape #674 is about. Harmless in
    // practice — a system with no runs has no rows in either hypertable, so the counts
    // are zero whatever they lock — but it is the one input on this path that is not
    // bounded, and it is pinned here so a future reader finds it stated rather than
    // discovering it from a lock-exhaustion incident.
    build({ min_start: null, max_end: null });

    await handler.getDeletePreview(SUT_ID);

    const counts = hypertableCounts();
    expect(counts).toHaveLength(2);
    for (const [sql, params] of counts) {
      expect(sql).not.toContain('time >=');
      expect(params).toEqual([SUT_ID]);
    }
  });
});
