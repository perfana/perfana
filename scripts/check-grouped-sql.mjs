#!/usr/bin/env node
/**
 * Asks Postgres whether each generated SQL statement RESOLVES against the real schema.
 *
 * RUN IT AS `npm run check:grouped-sql`, never as a bare `node scripts/check-grouped-sql.mjs`:
 * the statements are read from `apps/worker/dist`, and the npm script builds that first. A bare
 * invocation against a stale dist would check the LAST build's SQL; the freshness assertion below
 * refuses to run rather than letting that pass.
 *
 * WHY THIS EXISTS. v0.2.97.44 shipped a grouped-statistics statement that projected
 * `bool_or(s.track_member_count)` and `MIN(s.member_count_name)` — two columns the `members` CTE
 * no longer declares. Postgres rejected the whole statement with
 *
 *     column s.track_member_count does not exist
 *
 * which aborted the analytics transaction; the DELETE that precedes the INSERT rolled back with
 * it, so every run silently kept its PREVIOUS statistics. Nothing logged the column at error
 * level. It survived four review cycles, a snapshot test (regenerated over the broken SQL, so it
 * recorded the bug as golden), 12k unit tests and a full `npm run preflight`.
 *
 * No unit test in this repo can catch that class. A text guard checks the statement's SHAPE; only
 * Postgres can say whether a name RESOLVES — and a reviewer measured two shapes that slip past
 * even a careful text guard: `string_agg(track_member_count)` (outside any aggregate whitelist)
 * and a bare `track_member_count AS tmc` (no aggregate at all).
 *
 * HOW. `PREPARE` parses, analyses and rewrites a statement — Postgres defers PLANNING to EXECUTE —
 * which is exactly enough to resolve every relation, column and function name, and takes no
 * per-chunk hypertable locks. Each one runs in its own always-rolled-back transaction.
 *
 * WHAT IT DOES NOT DO. Resolution is not correctness: a statement that resolves can still carry
 * the wrong predicate or the wrong join. This catches the dead-reference class only. It is also
 * local-only — `.githooks/pre-push` is the sole caller and `pr-quality-gate.yml` is
 * `workflow_dispatch`, so `git push --no-verify` skips it and nothing downstream re-runs it.
 */
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const die = (msg, ...rest) => {
  console.error(`grouped-sql check FAILED: ${msg}`);
  for (const r of rest) console.error(r);
  process.exit(1);
};

/**
 * Modules whose SQL we check, each with the dist artifact and the source it must be newer than.
 * A moved or deleted source leaves its dist artifact behind — turbo does not prune outputs on a
 * cache restore and `tsc` never cleans — so `existsSync` alone would import an orphan and report
 * OK on code that is no longer built. Proven, which is why the mtime comparison is not optional.
 */
const MODULES = [
  { dist: 'apps/worker/dist/pipelines/helpers/series-grouping-plan.js', src: 'apps/worker/src/pipelines/helpers/series-grouping-plan.ts' },
  { dist: 'apps/worker/dist/pipelines/helpers/statistics-sql.js', src: 'apps/worker/src/pipelines/helpers/statistics-sql.ts' },
];

for (const { dist, src } of MODULES) {
  const distPath = join(ROOT, dist);
  const srcPath = join(ROOT, src);
  if (!existsSync(srcPath)) {
    die(`${src} is gone.`, '  Update MODULES in this script to match the source tree.');
  }
  if (!existsSync(distPath)) {
    die(`${dist} is missing, so nothing was checked.`, '  Run: npm run check:grouped-sql');
  }
  if (statSync(distPath).mtimeMs < statSync(srcPath).mtimeMs) {
    die(
      `${dist} is OLDER than ${src}, so it holds the previous build's SQL.`,
      '  Run: npm run check:grouped-sql   (it builds the worker first)',
    );
  }
}

const [plan, stats] = await Promise.all(
  MODULES.map(({ dist }) => import(pathToFileURL(join(ROOT, dist)).href)),
);

/**
 * Every exported statement these two modules produce. Read UNCONDITIONALLY: a `typeof` guard would
 * drop a renamed export from coverage and still report OK, one label shorter, which is the
 * omission this explicit list exists to make loud. `STATISTICS_INSERT` is covered transitively —
 * both builders embed it.
 */
const RUNS = "ARRAY['r1']::text[]";
const SPEC = [
  // The GROUPED statement — the one that carried the v0.2.97.44 defect.
  ['buildGroupedStatisticsSQL(1)', () => plan.buildGroupedStatisticsSQL(1)],
  // A second arity: a gap in the `$n` numbering surfaces here as "could not determine data type
  // of parameter $7" rather than silently shifting a bind.
  ['buildGroupedStatisticsSQL(3)', () => plan.buildGroupedStatisticsSQL(3)],
  // The UNGROUPED statement every analysis sends, and the far more common path. A dead column
  // reference here is the identical outage; it was outside this check's first version.
  ['buildStatisticsInsertSQL($1)', () => stats.buildStatisticsInsertSQL('$1')],
  ['buildStatisticsInsertSQL($1,$2,$3)', () => stats.buildStatisticsInsertSQL('$1, $2, $3')],
  ['INSERT_MEMBERSHIP_SQL', () => plan.INSERT_MEMBERSHIP_SQL],
  ['DELETE_MEMBERSHIP_SQL($1)', () => plan.DELETE_MEMBERSHIP_SQL('$1')],
  ['SERIES_GROUPING_RULES_SQL', () => plan.SERIES_GROUPING_RULES_SQL],
  ['SERIES_GROUPING_MEMBERSHIP_EXISTS_SQL', () => plan.SERIES_GROUPING_MEMBERSHIP_EXISTS_SQL],
  ['SERIES_GROUPING_TABLES_PROBE_SQL', () => plan.SERIES_GROUPING_TABLES_PROBE_SQL],
  ['SERIES_OF_DASHBOARDS_SQL', () => plan.SERIES_OF_DASHBOARDS_SQL],
  ['INSERT_DERIVED_COMPARE_CONFIG_SQL', () => plan.INSERT_DERIVED_COMPARE_CONFIG_SQL],
];

const toCheck = [];
for (const [label, get] of SPEC) {
  let sql;
  try {
    sql = get();
  } catch (err) {
    die(`${label} could not be produced: ${err?.message ?? err}`, '  Did the export move or change signature? Update SPEC in this script.');
  }
  if (typeof sql !== 'string' || sql.trim() === '') {
    die(`${label} is not a non-empty SQL string, so it proved nothing.`, '  Update SPEC in this script.');
  }
  toCheck.push({ label, sql });
}

const cfg = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME || 'perfana',
  password: process.env.DB_PASSWORD || 'perfana',
  database: process.env.DB_NAME || 'perfana',
  connectionTimeoutMillis: 5000,
  query_timeout: 15000,
};

// This runs on every `git push`. A shell with staging or production DB_* exported would otherwise
// open an unannounced connection to it, so a non-loopback host needs an explicit opt-in.
if (!['localhost', '127.0.0.1', '::1', ''].includes(cfg.host) && process.env.GROUPED_SQL_ALLOW_REMOTE !== '1') {
  die(
    `DB_HOST is ${cfg.host}, which is not loopback.`,
    '  This check runs on every push; it will not connect to a remote database by accident.',
    '  Set GROUPED_SQL_ALLOW_REMOTE=1 if you meant it.',
  );
}

const client = new pg.Client(cfg);
try {
  await client.connect();
} catch (err) {
  const msg = err?.message || err?.code || 'no detail';
  // Only a genuinely absent database is a skip. Wrong credentials or a wrong database NAME are
  // persistent misconfiguration: skipping them means the developer never runs this check again
  // and learns to scroll past the warning.
  if (['28P01', '28000', '3D000', '42501'].includes(err?.code)) {
    die(
      `the database is reachable but refused us (${msg}), so nothing was checked.`,
      `  Tried ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}; fix DB_USERNAME / DB_PASSWORD / DB_NAME.`,
    );
  }
  console.log(`grouped-sql check SKIPPED: database unreachable (${msg})`);
  console.log(`  Tried ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}.`);
  console.log('  Start the local stack to run it: docker compose -f docker-compose.infra.yml up -d');
  process.exit(0);
}

/**
 * A verdict is only as good as the schema it was taken against. A database still in the
 * v0.2.97.43 state carries the very columns this bug class is about, so the defect would PREPARE
 * cleanly and this check would report OK. Migration 1820's header documents three states in the
 * wild, and `apps/api`'s migration:run is broken in this repo (local schemas are applied by hand),
 * so drift is the normal case rather than the exotic one.
 */
const RETIRED = ['track_member_count', 'member_count_name', 'extra_aggregations'];
const drift = await client.query(
  `SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('series_grouping_rules', 'ds_metric_series_groups')
      AND column_name = ANY($1::text[])
    ORDER BY 1, 2`,
  [RETIRED],
);
if (drift.rows.length > 0) {
  await client.end();
  die(
    `${cfg.database} is behind migration head, so this check would prove nothing.`,
    '  These columns were retired by migration 1820 but still exist here:',
    ...drift.rows.map((r) => `    - ${r.table_name}.${r.column_name}`),
    '  Apply the migrations, then re-run.',
  );
}

const failures = [];
let n = 0;
for (const { label, sql } of toCheck) {
  // A unique name per statement is what prevents a collision: PREPARE is SESSION-scoped and
  // SURVIVES rollback (only DEALLOCATE drops it), so `n += 1` must stay INSIDE the try — a failed
  // PREPARE registers no name and must not consume one. The transaction is here so that a future
  // edit which executes rather than prepares cannot write.
  await client.query('BEGIN');
  try {
    await client.query(`PREPARE grouped_sql_check_${n} AS\n${sql}`);
    n += 1;
  } catch (err) {
    const pos = err?.position ? ` (position ${err.position})` : '';
    failures.push({ label, msg: `${err?.message || err?.code || 'unknown error'}${pos}` });
  } finally {
    await client.query('ROLLBACK');
  }
}
await client.end();

if (failures.length > 0) {
  console.error('grouped-sql check FAILED\n');
  console.error('Postgres refused to prepare these generated statements. A relation, column or');
  console.error('function named in them does not resolve — either the statement names something');
  console.error('the schema does not have, or it names a CTE column the builder no longer');
  console.error('declares (the v0.2.97.44 case, where `members` is a VALUES list built in JS).');
  console.error('At run time this aborts the analytics transaction, the preceding DELETE rolls');
  console.error('back with it, and the run silently keeps its previous statistics.\n');
  for (const f of failures) console.error(`  - ${f.label}: ${f.msg}`);
  console.error('\nIf the schema is what changed, apply the migrations and re-run.');
  process.exit(1);
}

console.log(
  `grouped-sql check OK: ${toCheck.length} statement(s) resolve against ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`,
);
for (const { label } of toCheck) console.log(`  · ${label}`);
console.log('  (resolution only — not a claim that any statement is correct)');
