// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, ormconfig.ts and apps/api/src/data-source.ts —
// a compiled *.spec.js there gets require()d as a migration and dies on describe().
import { ShortenDsMetricsCompressAfter1805000000000 as M } from '../migrations/1805000000000-ShortenDsMetricsCompressAfter';

describe('migration 1805 initial_start', () => {
  // The first policy run compresses the previous ~113 GB chunk; it must land in a quiet hour.
  it('defaults to the next 02:00 UTC', () => {
    expect(M.resolveInitialStart(undefined, new Date('2026-09-11T13:00:00Z'))).toBe('2026-09-12T02:00:00.000Z');
    expect(M.resolveInitialStart(undefined, new Date('2026-09-11T01:30:00Z'))).toBe('2026-09-11T02:00:00.000Z');
    expect(M.resolveInitialStart(undefined, new Date('2026-09-11T02:00:00Z'))).toBe('2026-09-12T02:00:00.000Z');
  });

  it('honours a valid override and falls back (with a warning) on a broken, past, zone-less or absurd one', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = new Date('2026-09-11T13:00:00Z');
    const fallback = '2026-09-12T02:00:00.000Z';
    expect(M.resolveInitialStart('2026-09-13T22:00:00Z', now)).toBe('2026-09-13T22:00:00.000Z');
    expect(M.resolveInitialStart('2026-09-13T22:00:00+02:00', now)).toBe('2026-09-13T20:00:00.000Z');
    expect(warn).not.toHaveBeenCalled();
    expect(M.resolveInitialStart('tonight', now)).toBe(fallback);
    expect(M.resolveInitialStart('2020-01-01T02:00:00Z', now)).toBe(fallback);      // past: would run on the next tick
    expect(M.resolveInitialStart('2026-09-13 22:00', now)).toBe(fallback);          // no zone: local-time ambiguity
    expect(M.resolveInitialStart('+275760-09-13T00:00:00.000Z', now)).toBe(fallback); // JS-only extended year
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('rolls over month and year, and treats an empty override as unset', () => {
    expect(M.resolveInitialStart(undefined, new Date('2026-12-31T13:00:00Z'))).toBe('2027-01-01T02:00:00.000Z');
    expect(M.resolveInitialStart('', new Date('2026-09-11T13:00:00Z'))).toBe('2026-09-12T02:00:00.000Z');
  });

  it('up() wires the override into the SQL as a quoted literal with no placeholder left', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const prev = process.env.DS_METRICS_COMPRESS_INITIAL_START;
    process.env.DS_METRICS_COMPRESS_INITIAL_START = '2999-09-13T22:00:00Z';
    try {
      await new M().up(runner as never);
    } finally {
      if (prev === undefined) {delete process.env.DS_METRICS_COMPRESS_INITIAL_START;} else {process.env.DS_METRICS_COMPRESS_INITIAL_START = prev;}
    }
    log.mockRestore();
    expect(queries).toHaveLength(1);
    const sql = queries[0]!;
    expect(sql.match(/'2999-09-13T22:00:00\.000Z'/g)).toHaveLength(2); // initial_start + NOTICE
    expect(sql).toContain("compress_after    => INTERVAL '2 days'");
    expect(sql).toContain("schedule_interval => INTERVAL '24 hours'"); // one run a day, at initial_start's hour
    expect(sql).not.toMatch(/if_not_exists\s*=>/); // replace, never keep a surviving 7-day policy
    expect(sql).toContain("has_function_privilege('perfana_system'");
    expect(sql).toContain('compression_enabled');
  });
});
