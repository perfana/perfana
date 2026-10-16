// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, ormconfig.ts and apps/api/src/data-source.ts —
// a compiled *.spec.js there gets require()d as a migration and dies on describe().
import { ShortenRawIngestCompression1815000000000 as M } from '../migrations/1815000000000-ShortenRawIngestCompression';

describe('migration 1815 compress_after', () => {
  it('defaults to 2 days', () => {
    expect(M.resolveCompressAfter(undefined)).toBe('2 days');
    expect(M.resolveCompressAfter('')).toBe('2 days');
  });

  it('honours a whole number of hours or days, normalising whitespace', () => {
    expect(M.resolveCompressAfter('4 days')).toBe('4 days');
    expect(M.resolveCompressAfter('1 day')).toBe('1 day');
    expect(M.resolveCompressAfter('36 hours')).toBe('36 hours');
    expect(M.resolveCompressAfter('  3 days  ')).toBe('3 days');
  });

  it('falls back with a warning on anything it cannot put in SQL as a literal', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The value is interpolated into the DO block, so the pattern is the guard.
    expect(M.resolveCompressAfter("2 days'; DROP TABLE requests_raw; --")).toBe('2 days');
    expect(M.resolveCompressAfter('1 week')).toBe('2 days'); // real interval, deliberately not accepted
    expect(M.resolveCompressAfter('2.5 days')).toBe('2 days'); // fractional
    expect(M.resolveCompressAfter('0 days')).toBe('2 days'); // would compress the open chunk
    expect(M.resolveCompressAfter('-1 days')).toBe('2 days');
    expect(M.resolveCompressAfter('soon')).toBe('2 days');
    expect(M.resolveCompressAfter('99999 days')).toBe('2 days'); // beyond the 4-digit guard
    expect(M.resolveCompressAfter('400 days')).toBe('2 days'); // in range of the pattern, out of range of sense
    expect(warn).toHaveBeenCalledTimes(8);
    warn.mockRestore();
  });

  it('accepts the soak-test boundaries exactly', () => {
    expect(M.resolveCompressAfter('365 days')).toBe('365 days');
    expect(M.resolveCompressAfter('8760 hours')).toBe('8760 hours');
  });
});

describe('migration 1815 initial_start', () => {
  // 03:00, not 1805's 02:00: a deploy applying both must not stack four backlog compressions.
  it('defaults to the next 03:00 UTC', () => {
    expect(M.resolveInitialStart(undefined, new Date('2026-10-16T13:00:00Z'))).toBe('2026-10-17T03:00:00.000Z');
    expect(M.resolveInitialStart(undefined, new Date('2026-10-16T01:30:00Z'))).toBe('2026-10-16T03:00:00.000Z');
    expect(M.resolveInitialStart(undefined, new Date('2026-10-16T03:00:00Z'))).toBe('2026-10-17T03:00:00.000Z');
  });

  it('stays an hour clear of migration 1805, which uses 02:00', () => {
    const now = new Date('2026-10-16T13:00:00Z');
    expect(M.resolveInitialStart(undefined, now)).not.toBe('2026-10-17T02:00:00.000Z');
    expect(new Date(M.resolveInitialStart(undefined, now)).getUTCHours()).toBe(3);
  });

  it('honours a valid override and falls back (with a warning) on a broken, past, zone-less or absurd one', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = new Date('2026-10-16T13:00:00Z');
    const fallback = '2026-10-17T03:00:00.000Z';
    expect(M.resolveInitialStart('2026-10-18T22:00:00Z', now)).toBe('2026-10-18T22:00:00.000Z');
    expect(M.resolveInitialStart('2026-10-18T22:00:00+02:00', now)).toBe('2026-10-18T20:00:00.000Z');
    expect(warn).not.toHaveBeenCalled();
    expect(M.resolveInitialStart('tonight', now)).toBe(fallback);
    expect(M.resolveInitialStart('2020-01-01T03:00:00Z', now)).toBe(fallback); // past: runs on the next tick
    expect(M.resolveInitialStart('2026-10-18 22:00', now)).toBe(fallback); // no zone: local-time ambiguity
    expect(M.resolveInitialStart('+275760-09-13T00:00:00.000Z', now)).toBe(fallback); // JS-only extended year
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('rolls over month and year', () => {
    expect(M.resolveInitialStart(undefined, new Date('2026-12-31T13:00:00Z'))).toBe('2027-01-01T03:00:00.000Z');
  });
});

describe('migration 1815 up()', () => {
  const runUp = async (env: Record<string, string | undefined> = {}) => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      prev[k] = process.env[k];
      if (v === undefined) {delete process.env[k];} else {process.env[k] = v;}
    }
    try {
      await new M().up(runner as never);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) {delete process.env[k];} else {process.env[k] = v;}
      }
      log.mockRestore();
      warn.mockRestore();
    }
    expect(queries).toHaveLength(1);
    return queries[0]!;
  };

  it('shortens compress_after on the three ingest tables and re-chunks only the two on 7-day chunks', async () => {
    const sql = await runUp({ RAW_COMPRESS_AFTER: undefined, RAW_COMPRESS_INITIAL_START: '2999-10-18T22:00:00Z' });

    // compress_after covers requests_raw too, which 1804 already put on 1-day chunks.
    expect(sql).toContain("ARRAY['requests_raw', 'transactions', 'requests_error']");
    expect(sql).toContain("compress_after    => INTERVAL '2 days'");
    expect(sql).toContain("schedule_interval => INTERVAL '24 hours'"); // one run a day, at initial_start's hour
    expect(sql).toContain("'2999-10-18T22:00:00.000Z'");

    // set_chunk_time_interval must NOT touch requests_raw (already 1 day) or virtual_users.
    expect(sql).toContain("set_chunk_time_interval(t::regclass, INTERVAL '1 day')");
    const rechunkLoops = sql.match(/FOREACH t IN ARRAY ARRAY\['transactions', 'requests_error'\] LOOP/g);
    expect(rechunkLoops).not.toBeNull();
    expect(sql).not.toContain('virtual_users');
  });

  it('replaces the policy rather than keeping a surviving 7-day one', async () => {
    const sql = await runUp({ RAW_COMPRESS_INITIAL_START: '2999-10-18T22:00:00Z' });
    expect(sql).toContain('remove_compression_policy(t::regclass, if_exists => true)');
    expect(sql).not.toMatch(/add_compression_policy\([^)]*if_not_exists\s*=>/);
  });

  it('skips cleanly when timescaledb, the hypertable, or compression is absent', async () => {
    const sql = await runUp({ RAW_COMPRESS_INITIAL_START: '2999-10-18T22:00:00Z' });
    expect(sql).toContain("extname = 'timescaledb'");
    expect(sql).toContain('is not a hypertable, skipping its compress_after change');
    expect(sql).toContain('compression not enabled on %, skipping its compress_after change');
  });

  it('requires ownership before set_chunk_time_interval, like 1804', async () => {
    const sql = await runUp({ RAW_COMPRESS_INITIAL_START: '2999-10-18T22:00:00Z' });
    expect(sql).toContain('migration 1815 must run as the owner of');
    expect(sql).toContain('WHEN insufficient_privilege THEN RAISE');
  });

  it('does NOT demand the 1804 decompress wrapper, because nothing decompresses these tables', async () => {
    // 1805 refuses without it because ds_metrics is rewritten in place. These four are only
    // written live and deleted on test_run_id (the segmentby column), so a wrapper
    // precondition here would be a spurious deploy blocker. Audited at the call sites.
    const sql = await runUp({ RAW_COMPRESS_INITIAL_START: '2999-10-18T22:00:00Z' });
    expect(sql).not.toContain('perfana_decompress_chunk');
    expect(sql).not.toContain('has_function_privilege');
  });

  it('warns on the lock-table PRODUCT, not just max_locks_per_transaction', async () => {
    const sql = await runUp({ RAW_COMPRESS_INITIAL_START: '2999-10-18T22:00:00Z' });
    // The budget is per-transaction x (connections + prepared), so a low max_connections
    // shrinks it — the counterintuitive case the warning has to catch.
    expect(sql).toContain("current_setting('max_locks_per_transaction')::bigint");
    expect(sql).toContain("current_setting('max_connections')::bigint");
    expect(sql).toContain("current_setting('max_prepared_transactions')::bigint");
    expect(sql).toContain('LOWERING max_connections shrinks this table');
    // 2 tables x 365 chunks x 11 locks, measured on the deploy.
    expect(sql).toContain('projected_locks := 2 * 365\n                           * 11');
    expect(sql).toContain('max_locks_per_transaction is %'); // 1804's floor, still reported
  });

  it('carries an operator-supplied RAW_COMPRESS_AFTER into the SQL, and only a safe one', async () => {
    expect(await runUp({ RAW_COMPRESS_AFTER: '4 days', RAW_COMPRESS_INITIAL_START: '2999-10-18T22:00:00Z' }))
      .toContain("compress_after    => INTERVAL '4 days'");

    const injected = await runUp({
      RAW_COMPRESS_AFTER: "2 days'; DROP TABLE requests_raw; --",
      RAW_COMPRESS_INITIAL_START: '2999-10-18T22:00:00Z',
    });
    expect(injected).toContain("compress_after    => INTERVAL '2 days'");
    expect(injected).not.toContain('DROP TABLE');
  });
});

describe('migration 1815 down()', () => {
  it('restores 7-day chunk intervals and 7-day policies on the tables it changed', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
    await new M().down(runner as never);
    expect(queries).toHaveLength(1);
    const sql = queries[0]!;
    expect(sql).toContain("set_chunk_time_interval(t::regclass, INTERVAL '7 days')");
    expect(sql).toContain("add_compression_policy(t::regclass, INTERVAL '7 days')");
    expect(sql).toContain("ARRAY['requests_raw', 'transactions', 'requests_error']");
    expect(sql).not.toContain('virtual_users');
    expect(sql).toContain("extname = 'timescaledb'");
  });
});
