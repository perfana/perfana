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
    // A deploy without these CAGGs must still boot: one failing view cannot abort the
    // loop and leave the remaining 14 policies un-widened. Containment is now a property
    // of the SQL rather than of this loop — each policy is ONE self-contained statement
    // whose plpgsql EXCEPTION handler swallows its own failure — so the assertion is
    // structural. Verified against a real Postgres: a DO block naming a non-existent view
    // emits `WARNING: could not set refresh window for ...` and the NEXT statement still
    // runs, both inside and outside a transaction block.
    const { runner, sql } = recordingRunner();
    await new WidenCaggRefreshWindows1799000000000().up(runner);

    expect(sql).toHaveLength(15);
    for (const [i, q] of sql.entries()) {
      // Each statement must carry its own handler naming its own view. A shared handler,
      // or one policy emitted without one, is a view that can still abort the batch.
      expect(q).toMatch(/EXCEPTION WHEN OTHERS THEN/);
      expect(q).toContain(`could not set refresh window for ${POLICIES[i]!.view}`);
      expect(q).toContain(`'${POLICIES[i]!.view}'`);
    }
  });

  it('contains each failure in a plpgsql block and never issues a SAVEPOINT', async () => {
    // REGRESSION GUARD, and the reason this migration does not use the obvious tool.
    //
    // A failed statement aborts the surrounding transaction (25P02) and everything after
    // it — including TypeORM's INSERT into the migrations table — dies with "current
    // transaction is aborted", so a bare try/catch cannot keep the loop going. SAVEPOINT
    // fixes that INSIDE a transaction and is a hard error outside one:
    //
    //   25P01  SAVEPOINT can only be used in transaction blocks
    //
    // On a GREENFIELD install there is no transaction here. The runner uses
    // transaction: "all", and 1791 issues a bare COMMIT (it needs CREATE INDEX
    // CONCURRENTLY, which forbids a transaction), which ends the whole BATCH's
    // transaction — not just its own — several migrations before this one. An incremental
    // deploy never reaches that state, because 1799 landed in a batch of its own; so this
    // failed on fresh installs only, and every existing deploy was fine. Observed
    // 2026-11-03: a wiped dev stack stopped dead at 1799 with 20 migrations unapplied.
    //
    // A plpgsql EXCEPTION handler is an implicit subtransaction and is legal either way,
    // which is the only shape that survives both.
    const { runner, sql } = recordingRunner();
    await new WidenCaggRefreshWindows1799000000000().up(runner);

    expect(sql.join('\n')).not.toMatch(/SAVEPOINT/i);
    expect(sql.filter((q) => /DO \$\$/.test(q))).toHaveLength(15);
  });

  it('emits a well-formed, self-closing plpgsql block per policy', async () => {
    // An unbalanced block takes the rest of the migration's SQL into its own body, and
    // the failure is a syntax error hundreds of lines away from the cause.
    const { runner, sql } = recordingRunner();
    await new WidenCaggRefreshWindows1799000000000().up(runner);

    for (const q of sql) {
      expect((q.match(/\$\$/g) ?? []).length).toBe(2);
      expect(q).toMatch(/DO \$\$\s*BEGIN[\s\S]*EXCEPTION WHEN OTHERS THEN[\s\S]*END \$\$/);
      // PERFORM, not SELECT: a bare SELECT of a set-returning policy call is a syntax
      // error inside plpgsql, and that is only reachable at migrate time.
      expect(q).toMatch(/PERFORM remove_continuous_aggregate_policy/);
      expect(q).toMatch(/PERFORM add_continuous_aggregate_policy/);
    }
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
