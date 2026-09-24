// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, ormconfig.ts and apps/api/src/data-source.ts —
// a compiled *.spec.js there gets require()d as a migration and dies on describe().
import { readFileSync } from 'fs';
import { join } from 'path';
import type { QueryRunner } from 'typeorm';
import {
  ConstrainDuplicateMetricBenchmarks1812000000000,
  UQ_BENCHMARKS_ACTIVE_METRIC_TARGET,
} from '../migrations/1812000000000-ConstrainDuplicateMetricBenchmarks';

/**
 * Migration 1812 dedupes before it builds a unique index, so its two halves have to agree,
 * its result handling has to survive what TypeORM actually returns, and it has to refuse
 * rather than half-apply when RLS hides the rows from it. None of that is observable from the
 * SQL alone and there is no database in unit tests — these drive it with a recording runner.
 */

type Recorded = { sql: string; params?: unknown[] };

function recordingRunner(results: unknown[]): { runner: QueryRunner; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let i = 0;
  const runner = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const result = results[i];
      i += 1;
      return result ?? [];
    }),
  } as unknown as QueryRunner;
  return { runner, calls };
}

/** What `up()` reads back: the disabled rows, then the leftover-duplicate-group count. */
const upResults = (disabled: unknown[] = [], remainingGroups = '0') => [
  disabled,
  [{ groups: remainingGroups }],
];

const migration = new ConstrainDuplicateMetricBenchmarks1812000000000();
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const sqlOf = (calls: Recorded[], i: number) => squash(calls[i]?.sql ?? '');

const KEY_COLUMNS = [
  'system_under_test_id',
  'test_environment',
  'workload',
  'application_dashboard_id',
  "(configuration->>'id')",
  "COALESCE(NULLIF(configuration->>'matchPattern', ''), NULLIF(match_pattern, ''), '')",
  "COALESCE(configuration->>'invertMatchPattern', 'false')",
  'average_all',
  "COALESCE(evaluate_type, '')",
];

const SCOPE =
  "valid AND enabled AND COALESCE(benchmark_type, 'metric') = 'metric' " +
  "AND application_dashboard_id IS NOT NULL AND configuration ? 'id'";

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('up()', () => {
  it('dedupes on exactly the key the index then enforces', async () => {
    const { runner, calls } = recordingRunner(upResults());
    await migration.up(runner);

    const dedupe = sqlOf(calls, 0);
    const index = sqlOf(calls, calls.length - 1);

    // Drift here means the UPDATE dedupes on one key while CREATE UNIQUE INDEX enforces
    // another — and the index build then fails *after* rows have already been disabled.
    for (const column of KEY_COLUMNS) {
      expect(dedupe).toContain(squash(column));
      expect(index).toContain(squash(column));
    }
    expect(dedupe).toContain(squash(SCOPE));
    expect(index).toContain(squash(SCOPE));
  });

  // `configuration->>'id'` is NULL when the key is absent and a btree unique never collides
  // NULLs — the same trap that made uq_benchmarks_unique inert — while PARTITION BY *does*
  // group them. Dropping this clause from the dedupe would disable rows the index would have
  // accepted: destructive over-reach with no benefit.
  it("restricts both halves to rows that actually carry a panel id", async () => {
    const { runner, calls } = recordingRunner(upResults());
    await migration.up(runner);

    expect(sqlOf(calls, 0)).toContain("configuration ? 'id'");
    expect(squash(UQ_BENCHMARKS_ACTIVE_METRIC_TARGET)).toContain("configuration ? 'id'");
  });

  // Two SLOs that differ only in these still collapse to one check-result key, which is the
  // bug — the stricter one just hides the other. Keying on them would let the pair exist.
  it('keys on neither the requirement nor the ramp-up flag', () => {
    const index = squash(UQ_BENCHMARKS_ACTIVE_METRIC_TARGET);
    expect(index).not.toContain('requirement_operator');
    expect(index).not.toContain('requirement_value');
    expect(index).not.toContain('exclude_ramp_up_time');
  });

  it('creates the index IF NOT EXISTS, so a re-run is a no-op', () => {
    expect(squash(UQ_BENCHMARKS_ACTIVE_METRIC_TARGET)).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_benchmarks_active_metric_target',
    );
  });

  // TypeORM's PostgresQueryRunner returns [rows, rowCount] when the TOP-LEVEL command is
  // UPDATE or DELETE, so a bare `UPDATE ... RETURNING` hands back a 2-element array whose
  // `.map(r => r.id)` is `[undefined, undefined]`.
  it('wraps the writable CTE in an outer SELECT', async () => {
    const { runner, calls } = recordingRunner(upResults());
    await migration.up(runner);

    const dedupe = sqlOf(calls, 0);
    expect(dedupe).toMatch(/^WITH ranked AS/);
    expect(dedupe).toContain('SELECT id, config_title FROM upd');
  });

  // Deliberately non-destructive: check_results are per-run history and
  // test_runs.consolidated_result is a stored verdict derived from them that nothing here
  // recomputes. Deleting them would leave a finished run whose header says FAILED with every
  // SLO row green.
  it('never deletes check results, and never deletes a benchmark', async () => {
    const { runner, calls } = recordingRunner(upResults([{ id: 'bm-a', config_title: 'A' }]));
    await migration.up(runner);

    expect(calls.some((c) => /DELETE\s+FROM/i.test(c.sql))).toBe(false);
    expect(sqlOf(calls, 0)).toContain('SET enabled = false');
  });

  it('disables every redundant row but the oldest of each group', async () => {
    const { runner, calls } = recordingRunner(upResults());
    await migration.up(runner);

    expect(sqlOf(calls, 0)).toContain('ORDER BY created_at, id');
    expect(sqlOf(calls, 0)).toContain('WHERE b.id = r.id AND r.rn > 1');
  });

  it('builds the index once the dedupe left no duplicate groups', async () => {
    const { runner, calls } = recordingRunner(upResults([{ id: 'bm-a', config_title: 'A' }], '0'));
    await migration.up(runner);

    expect(calls).toHaveLength(3); // dedupe, leftover-group check, create index
    expect(sqlOf(calls, 2)).toContain('CREATE UNIQUE INDEX');
  });

  // `benchmarks` is FORCE ROW LEVEL SECURITY and the migration runner sets none of the
  // `app.current_user_*` GUCs, so a non-superuser owner updates zero rows and would then hit
  // an opaque 23505 on the index build. This names the cause instead.
  it('refuses with the RLS cause named when duplicate groups survive the dedupe', async () => {
    const { runner, calls } = recordingRunner(upResults([], '4'));

    await expect(migration.up(runner)).rejects.toThrow(/4 duplicate benchmark group\(s\)/);
    await expect(migration.up(recordingRunner(upResults([], '4')).runner)).rejects.toThrow(
      /BYPASSRLS/,
    );
    // And it must not have attempted the index build.
    expect(calls.some((c) => c.sql.includes('CREATE UNIQUE INDEX'))).toBe(false);
  });

  // The guard reads a count from a query that may come back empty; it must treat that as
  // "no duplicates" rather than throwing on a property of undefined.
  it('tolerates an empty result from the leftover-group check', async () => {
    const { runner, calls } = recordingRunner([[], []]);

    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(calls.some((c) => c.sql.includes('CREATE UNIQUE INDEX'))).toBe(true);
  });

  // Defence for the [rows, rowCount] shape: a non-row element must not reach the log as
  // `undefined (untitled)` or crash the migration.
  it('ignores non-row elements the driver may hand back', async () => {
    const { runner } = recordingRunner(upResults([undefined, 2]));
    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('logs the rows it disabled, with their titles', async () => {
    const { runner } = recordingRunner(
      upResults([
        { id: 'bm-a', config_title: 'Front end - Error Rate' },
        { id: 'bm-b', config_title: null },
      ]),
    );
    await migration.up(runner);

    const logged = (console.log as jest.Mock).mock.calls[0]?.[0] as string;
    expect(logged).toContain('disabled 2 duplicate SLO(s)');
    expect(logged).toContain('bm-a (Front end - Error Rate)');
    expect(logged).toContain('bm-b (untitled)'); // a null title must not print as "null"
  });
});

describe('down()', () => {
  it('drops the index and switches the rows it disabled back on', async () => {
    const { runner, calls } = recordingRunner([[], []]);

    await migration.down(runner);

    expect(sqlOf(calls, 0)).toContain('DROP INDEX IF EXISTS public.uq_benchmarks_active_metric_target');
    expect(sqlOf(calls, 1)).toContain('SET enabled = true');
  });

  // The marker in `description` is the only record of which rows up() touched — without the
  // predicate, a rollback would switch on every SLO the user had deliberately disabled.
  it('only restores rows carrying the 1812 marker, and strips the marker', async () => {
    const { runner, calls } = recordingRunner([[], []]);

    await migration.down(runner);

    const restore = sqlOf(calls, 1);
    expect(restore).toContain('WHERE NOT enabled');
    expect(restore).toContain("description LIKE '%Disabled by migration 1812:");
    expect(restore).toContain('regexp_replace');
    // An empty description after stripping becomes NULL again, not ''.
    expect(restore).toContain('NULLIF(');
  });
});

/**
 * A greenfield install never runs 1812 — it gets the index from the consolidated schema. Two
 * hand-maintained copies would mean new installs and existing deploys enforcing different
 * invariants, and nothing fails at boot: `SCHEMA_DRIFT_CHECK` compares columns, not indexes.
 */
describe('the greenfield copy in ConsolidatedSchema', () => {
  const consolidated = readFileSync(
    join(__dirname, '..', 'migrations', '1700000000000-ConsolidatedSchema.ts'),
    'utf8',
  );

  it('imports the index SQL from 1812 instead of retyping it', () => {
    expect(consolidated).toContain('UQ_BENCHMARKS_ACTIVE_METRIC_TARGET');
    expect(consolidated).toContain("from './1812000000000-ConstrainDuplicateMetricBenchmarks'");
  });

  it('does not carry a second, retyped CREATE INDEX for the same name', () => {
    const retyped = squash(consolidated).match(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_benchmarks_active_metric_target/g,
    );
    expect(retyped).toBeNull();
  });
});
