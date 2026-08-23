#!/usr/bin/env node
/**
 * Reports the constraints a database is missing, by diffing it against a freshly
 * migrated one.
 *
 * Why this exists: `1700000000000-ConsolidatedSchema.ts` declares NOT NULL, CHECK,
 * UNIQUE, PRIMARY KEY and FOREIGN KEY constraints that reach a FRESH database only.
 * No incremental migration ever carried them to an existing one, so a long-lived
 * deployment can be missing a constraint the code was then written to assume. That
 * shape has already cost one outage: v0.2.68.7 deleted ~35 `OR organization_id IS
 * NULL` escapes because "the column cannot be null" — true in dev, false in
 * production, and every list came back empty.
 *
 * `assertEntityColumns` (boot) and `check-entity-migrations.mjs` (pre-ship) cover
 * missing *columns*. This covers the constraints on them, which neither sees.
 *
 * Usage (prefer the environment — a URL in argv is visible to every user on the
 * host via `ps`, lands in shell history, and is duplicated into npm's process tree
 * when run through `npm run`):
 *
 *   TARGET_DATABASE_URL=postgres://user:pass@prod-host:5432/perfana \
 *   REFERENCE_DATABASE_URL=postgres://user:pass@localhost:5432/perfana_ref \
 *     node scripts/check-schema-constraints.mjs
 *
 *   TARGET_DATABASE_URL     the database to audit (a real deployment, or a restored dump)
 *   REFERENCE_DATABASE_URL  a database freshly built by running every migration on an
 *                           empty database. This is what the code assumes it has.
 *   --target / --reference  same two values as flags. Convenient locally, but they put
 *                           the password in `ps` — do not use them against production.
 *   --json                  machine-readable output
 *
 * Connection strings are standard libpq URLs. Use a read-only role for --target.
 *
 * Both sessions are set READ ONLY at connect, so the script cannot write to either
 * database even if a query were malformed. It exits 1 when the target is missing
 * anything, 0 when the two agree.
 *
 * ponytail: a reference DATABASE rather than a parser over the migration SQL.
 * Postgres already parses SQL correctly and we would not; the cost is that whoever
 * runs this has to build the reference first (an empty database + the migrations).
 */

import pg from 'pg';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const targetUrl = flag('target') ?? process.env.TARGET_DATABASE_URL;
const referenceUrl = flag('reference') ?? process.env.REFERENCE_DATABASE_URL;
const asJson = args.includes('--json');

if (!targetUrl || !referenceUrl) {
  console.error(
    'usage: node scripts/check-schema-constraints.mjs --target <url> --reference <url> [--json]\n' +
      '\n' +
      '  --reference must point at a database built by running every migration on an\n' +
      '  empty database. Without one there is nothing to diff against.',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// What we compare.
//
// pg_constraint covers CHECK / UNIQUE / PRIMARY KEY / FOREIGN KEY / EXCLUDE, and
// pg_get_constraintdef renders each one back to canonical SQL — so two databases
// that express the same constraint differently still compare equal. NOT NULL is
// not a row in pg_constraint (before PG 17 it is a column attribute), so it is
// collected separately. Unique *indexes* created without a constraint are a third
// case, and the schema uses them: `AddTagsHashUniqueIndex` is one.
// ---------------------------------------------------------------------------

const CONSTRAINT_SQL = `
  SELECT c.relname AS table_name,
         con.conname AS name,
         pg_get_constraintdef(con.oid) AS definition,
         con.contype AS kind
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
`;

const NOT_NULL_SQL = `
  SELECT c.relname AS table_name,
         a.attname AS column_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attnotnull
`;

const UNIQUE_INDEX_SQL = `
  SELECT c.relname AS table_name,
         i.relname AS name,
         pg_get_indexdef(i.oid) AS definition
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class c ON c.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND x.indisunique
     AND NOT x.indisprimary
     -- Indexes backing a UNIQUE constraint are already counted above.
     AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.oid)
`;

const TABLE_SQL = `
  SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
`;

const KIND_LABEL = { c: 'CHECK', u: 'UNIQUE', p: 'PRIMARY KEY', f: 'FOREIGN KEY', x: 'EXCLUDE' };

/**
 * Quote a SQL identifier, doubling any embedded quote.
 *
 * These identifiers come out of the reference database's pg_catalog, not from a
 * user — but `CREATE TABLE "a"" ; DROP TABLE x; --" (...)` is legal Postgres, and
 * a parameterless client.query() goes out on the simple query protocol, which
 * happily runs multiple statements. So the trust direction would be
 * scratch-database -> production. Escape rather than assume.
 */
const quoteIdent = (id) => `"${String(id).replace(/"/g, '""')}"`;

async function readSchema(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // Make the header's "never writes" claim structural rather than a promise.
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    // Sequential: one pg.Client is one connection, and overlapping queries on it are
    // deprecated. Four catalog reads are not worth a pool.
    const constraints = await client.query(CONSTRAINT_SQL);
    const notNulls = await client.query(NOT_NULL_SQL);
    const uniqueIndexes = await client.query(UNIQUE_INDEX_SQL);
    const tables = await client.query(TABLE_SQL);
    return {
      // Keyed on definition, not name: a constraint renamed between schema versions
      // is the same constraint, and reporting it as missing would be noise.
      constraints: new Map(
        constraints.rows.map((r) => [`${r.table_name}|${r.definition}`, r]),
      ),
      notNulls: new Map(
        notNulls.rows.map((r) => [`${r.table_name}|${r.column_name}`, r]),
      ),
      uniqueIndexes: new Map(
        // Strip the index name out of the definition so a rename does not read as a diff.
        uniqueIndexes.rows.map((r) => [
          `${r.table_name}|${r.definition.replace(/^CREATE UNIQUE INDEX \S+ /, '')}`,
          r,
        ]),
      ),
      tables: new Set(tables.rows.map((r) => r.table_name)),
    };
  } finally {
    await client.end();
  }
}

/** Rows in the target that would violate a NOT NULL the reference declares. */
async function countViolations(url, missingNotNulls) {
  if (missingNotNulls.length === 0) return new Map();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const counts = new Map();
  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

    // `col IS NULL` is not indexable here, so on a big table this is a full scan —
    // and the candidates include hypertables and partitioned tables where that means
    // every chunk, for minutes, holding a read snapshot open on a production database.
    // Cap it: an unknown count still prints, and the caller degrades gracefully.
    await client.query("SET statement_timeout = '30s'");

    for (const { table_name, column_name } of missingNotNulls) {
      const sql =
        `SELECT count(*)::bigint AS n FROM ${quoteIdent(table_name)} ` +
        `WHERE ${quoteIdent(column_name)} IS NULL`;
      try {
        const { rows } = await client.query(sql);
        counts.set(`${table_name}|${column_name}`, Number(rows[0].n));
      } catch {
        // Timeout, permission denied, RLS, a view — an unknown count is still worth showing.
        counts.set(`${table_name}|${column_name}`, null);
      }
    }
  } finally {
    await client.end();
  }
  return counts;
}

const missingFrom = (reference, target) =>
  [...reference.entries()].filter(([key]) => !target.has(key)).map(([, row]) => row);

const [reference, target] = await Promise.all([readSchema(referenceUrl), readSchema(targetUrl)]);

// A table the target does not have at all would report every one of its constraints
// as missing, which buries the constraints that are actually the point. Report the
// table once instead — a missing table is a different (larger) problem.
const missingTables = [...reference.tables].filter((t) => !target.tables.has(t)).sort();
const onExistingTable = (row) => target.tables.has(row.table_name);

const missingNotNulls = missingFrom(reference.notNulls, target.notNulls).filter(onExistingTable);
const missingConstraints = missingFrom(reference.constraints, target.constraints).filter(onExistingTable);
const missingUniqueIndexes = missingFrom(reference.uniqueIndexes, target.uniqueIndexes).filter(onExistingTable);

const violations = await countViolations(targetUrl, missingNotNulls);

const total =
  missingTables.length + missingNotNulls.length + missingConstraints.length + missingUniqueIndexes.length;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        missingTables,
        missingNotNulls: missingNotNulls.map((r) => ({
          table: r.table_name,
          column: r.column_name,
          violatingRows: violations.get(`${r.table_name}|${r.column_name}`) ?? null,
        })),
        missingConstraints: missingConstraints.map((r) => ({
          table: r.table_name,
          name: r.name,
          kind: KIND_LABEL[r.kind] ?? r.kind,
          definition: r.definition,
        })),
        missingUniqueIndexes: missingUniqueIndexes.map((r) => ({
          table: r.table_name,
          name: r.name,
          definition: r.definition,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(total === 0 ? 0 : 1);
}

if (total === 0) {
  console.log('schema constraint check: target matches the reference. Nothing missing.');
  process.exit(0);
}

console.log(`schema constraint check: target is missing ${total} thing(s).\n`);

if (missingTables.length > 0) {
  console.log(`Missing tables (${missingTables.length}) — their constraints are not listed below:`);
  for (const t of missingTables) console.log(`  ${t}`);
  console.log('');
}

if (missingNotNulls.length > 0) {
  console.log(`Missing NOT NULL (${missingNotNulls.length}):`);
  for (const r of missingNotNulls) {
    const n = violations.get(`${r.table_name}|${r.column_name}`);
    // The count is the whole decision: 0 means the ALTER is instant and safe, a
    // non-zero count means those rows need an owner before any constraint lands.
    const note =
      n === null
        ? "  [could not count NULLs — timed out, or permissions/RLS]"
        : n === 0
          ? '  [0 NULL rows — safe to apply]'
          : `  [${n} NULL row(s) — BACKFILL FIRST]`;
    console.log(`  ALTER TABLE "${r.table_name}" ALTER COLUMN "${r.column_name}" SET NOT NULL;${note}`);
  }
  console.log('');
}

if (missingConstraints.length > 0) {
  console.log(`Missing constraints (${missingConstraints.length}):`);
  for (const r of missingConstraints) {
    console.log(`  [${KIND_LABEL[r.kind] ?? r.kind}] ${r.table_name}`);
    console.log(`    ALTER TABLE "${r.table_name}" ADD CONSTRAINT "${r.name}" ${r.definition};`);
  }
  console.log('');
}

if (missingUniqueIndexes.length > 0) {
  console.log(`Missing unique indexes (${missingUniqueIndexes.length}):`);
  for (const r of missingUniqueIndexes) console.log(`  ${r.definition};`);
  console.log('');
}

console.log(
  'Review before applying. A UNIQUE or NOT NULL that the target never had may have\n' +
    'accumulated rows that violate it, and adding a FOREIGN KEY takes a lock.',
);
process.exit(1);
