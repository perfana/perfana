// Lives OUTSIDE src/database/migrations for the same reason as
// consolidated-schema-split.spec.ts: that directory is globbed as migrations by
// Dockerfile.migrations, apps/api/src/data-source.ts and the RLS harness, and a
// compiled *.spec.js there gets require()d as a migration.
import * as fs from 'fs';
import * as path from 'path';
import { QueryRunner } from 'typeorm';
import { WidenCaggRefreshWindows1799000000000 } from '../migrations/1799000000000-WidenCaggRefreshWindows';

type Policy = { view: string; end: string; schedule: string; was: string };

const POLICIES = (
  WidenCaggRefreshWindows1799000000000 as unknown as { POLICIES: Policy[] }
).POLICIES;

/** Records every SQL string the migration issues, in order. */
const recordingRunner = (throwOn?: string) => {
  const sql: string[] = [];
  const runner = {
    query: jest.fn(async (q: string) => {
      sql.push(q);
      if (throwOn && q.includes(`'${throwOn}'`)) throw new Error('boom');
      return [];
    }),
  };
  return { runner: runner as unknown as QueryRunner, sql };
};

const startOffsetsIn = (sql: string[]): string[] =>
  sql
    .map((q) => /start_offset\s*=>\s*INTERVAL '([^']+)'/.exec(q)?.[1])
    .filter((v): v is string => v !== undefined);

/**
 * Parse the refreshPolicies literal out of the consolidated schema source. The
 * array is a local const inside up(), so there is no symbol to import - and it
 * cannot be extracted into a shared module either: Dockerfile.migrations copies
 * only dist/database/migrations into the runtime image, so an import from
 * outside that directory would MODULE_NOT_FOUND at migrate time. Two copies is
 * the correct shape here; this test is what keeps them honest.
 */
const consolidatedPolicies = (): Policy[] => {
  const src = fs.readFileSync(
    path.join(__dirname, '../migrations/1700000000000-ConsolidatedSchema.ts'),
    'utf8',
  );
  const block = /const refreshPolicies = \[([\s\S]*?)\n {4}\];/.exec(src);
  if (!block) throw new Error('refreshPolicies literal not found in ConsolidatedSchema');
  const rows = [
    ...block[1].matchAll(
      /view:\s*'([^']+)',\s*start:\s*'([^']+)',\s*end:\s*'([^']+)',\s*schedule:\s*'([^']+)'/g,
    ),
  ];
  return rows.map((m) => ({ view: m[1], was: m[2], end: m[3], schedule: m[4] }));
};

describe('WidenCaggRefreshWindows', () => {
  it('covers every CAGG the consolidated schema creates a policy for', () => {
    const greenfield = consolidatedPolicies()
      .map((p) => p.view)
      .sort();
    expect(greenfield).toHaveLength(15);
    expect(POLICIES.map((p) => p.view).sort()).toEqual(greenfield);
  });

  it('preserves each policy end_offset and schedule_interval', () => {
    // Only start_offset moves. A drifted schedule here would silently re-tune
    // refresh cadence on every existing deploy.
    const greenfield = new Map(consolidatedPolicies().map((p) => [p.view, p]));
    for (const p of POLICIES) {
      const shipped = greenfield.get(p.view);
      expect(shipped).toBeDefined();
      expect({ end: p.end, schedule: p.schedule }).toEqual({
        end: shipped!.end,
        schedule: shipped!.schedule,
      });
    }
  });

  it('up() widens every policy to 7 days', async () => {
    const { runner, sql } = recordingRunner();
    await new WidenCaggRefreshWindows1799000000000().up(runner);

    expect(sql.filter((q) => q.includes('remove_continuous_aggregate_policy'))).toHaveLength(15);
    const offsets = startOffsetsIn(sql);
    expect(offsets).toHaveLength(15);
    expect(new Set(offsets)).toEqual(new Set(['7 days']));
  });

  it('down() restores each policy to its own shipped offset, not a blanket value', async () => {
    const { runner, sql } = recordingRunner();
    await new WidenCaggRefreshWindows1799000000000().down(runner);

    // Tiered: 5s => 1 hour, 1m => 2 hours, 5m => 1 day. A blanket restore would
    // silently re-tune the 1m/5m tiers that were never the problem.
    expect(startOffsetsIn(sql)).toEqual(POLICIES.map((p) => p.was));
    expect(new Set(startOffsetsIn(sql))).toEqual(new Set(['1 hour', '2 hours', '1 day']));
  });

  it('keeps going when one view is missing or TimescaleDB is absent', async () => {
    // A deploy without these CAGGs must still boot: one failing view cannot
    // abort the loop and leave the remaining 14 policies un-widened.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runner, sql } = recordingRunner('requests_raw_5s');

    await expect(new WidenCaggRefreshWindows1799000000000().up(runner)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('requests_raw_5s'), 'boom');
    // 14 survivors still got their add; the failing view got its remove only.
    expect(startOffsetsIn(sql)).toHaveLength(14);
    warn.mockRestore();
  });

  it('rolls the failing view back to a savepoint so the transaction stays usable', async () => {
    // Migrations run under transaction: 'each'. A failed statement aborts the
    // whole transaction (25P02) and everything after it — including TypeORM's
    // INSERT into the migrations table — dies with "current transaction is
    // aborted". A bare try/catch does NOT survive that; only the savepoint does.
    // Verified against Postgres directly, not just this mock.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runner, sql } = recordingRunner('requests_raw_5s');

    await new WidenCaggRefreshWindows1799000000000().up(runner);

    expect(sql.filter((q) => q === 'SAVEPOINT cagg_refresh_policy')).toHaveLength(15);
    // The one failure rolls back; the 14 successes release.
    expect(sql.filter((q) => q === 'ROLLBACK TO SAVEPOINT cagg_refresh_policy')).toHaveLength(1);
    expect(sql.filter((q) => q === 'RELEASE SAVEPOINT cagg_refresh_policy')).toHaveLength(14);

    // The rollback must land before the next policy's savepoint, or the next
    // statement runs inside the still-aborted transaction.
    const rollbackAt = sql.indexOf('ROLLBACK TO SAVEPOINT cagg_refresh_policy');
    const nextAdd = sql.findIndex((q, i) => i > rollbackAt && q.includes('add_continuous_aggregate_policy'));
    expect(rollbackAt).toBeGreaterThan(-1);
    expect(nextAdd).toBeGreaterThan(rollbackAt);
    warn.mockRestore();
  });

  it('always pairs every savepoint with a release or a rollback', async () => {
    // A leaked savepoint holds locks for the rest of the migration.
    const { runner, sql } = recordingRunner();
    await new WidenCaggRefreshWindows1799000000000().up(runner);

    const opened = sql.filter((q) => q === 'SAVEPOINT cagg_refresh_policy').length;
    const closed = sql.filter(
      (q) =>
        q === 'RELEASE SAVEPOINT cagg_refresh_policy' ||
        q === 'ROLLBACK TO SAVEPOINT cagg_refresh_policy',
    ).length;
    expect(closed).toBe(opened);
  });

  it('never lets a refresh window fall back below a full day', () => {
    // REGRESSION GUARD. The shipped 5 s policies used start_offset '1 hour', so a
    // run longer than an hour - or any result ingested after the run finished -
    // was never materialised. Nothing errored: the real-time aggregate silently
    // scanned the raw hypertable instead, and /test-runs/:id/throughput went from
    // 577 ms to 2766 ms. Shorten these again and the page gets slow, not broken.
    for (const p of consolidatedPolicies()) {
      expect(p.was).toBe('7 days');
    }
  });
});
