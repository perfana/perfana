# Migration Consolidation — Second Round

**Date:** 2026-05-14  
**Status:** DRAFT  
**Scope:** Collapse 58 accumulated post-consolidation migrations back into a single
initial schema migration.

---

## Background

This codebase was already consolidated once. `1700000000000-ConsolidatedSchema.ts`
replaced 23 legacy migrations; `schema-sql.ts` (8 630 lines) is the embedded SQL
dump from that earlier consolidation. Since then, 58 more migrations have accumulated
(migrations 01–58, plus `schema-sql.ts`), covering:

- Schema additions (indexes, columns, tables, constraints, RLS policies)
- Performance tuning (autovacuum, TimescaleDB compression)
- Data normalisation (apdex threshold UUID migration, metrics-source backfill)
- Role/RLS infrastructure (perfana\_app, perfana\_system, partitioned audit logs)
- Continuous aggregates and rollup tables

Total: **59 migration files** for what is exclusively a greenfield deployment target.

---

## Feasibility

**Is it possible?** Yes. The precedent is the existing `ConsolidatedSchema` migration.
The approach is identical: dump the live DB schema, embed the SQL in `schema-sql.ts`,
and delete the obsoleted individual migration files.

**Is it good practice for greenfield-only deployments?** Yes, strongly recommended:

| Concern | Without consolidation | With consolidation |
|---|---|---|
| Fresh-install time | Runs 59 migrations sequentially | Runs 1 migration |
| Codebase clarity | 59 files to read when tracing schema | 1 file |
| Dead code | Backfill logic that can never fire | None |
| Upgrade path for existing DBs | N/A (greenfield only) | N/A |

The only scenario where this would be risky is if there are existing production
databases running older migrations. The user confirms there are none — every
deployment is a fresh install.

---

## What NOT to delete / what to keep

Three migrations serve ongoing purposes and must be evaluated carefully:

| Migration | Purpose | Decision |
|---|---|---|
| `1700000000000-ConsolidatedSchema.ts` | **Keep and update.** This becomes the single migration. | UPDATE |
| `1700000000001-CleanupLegacyMigrationRecords.ts` | Removes stale migration records from the previous consolidation. Greenfield DBs won't have these records. | DELETE |
| `1700000000002-SyncSchemaState.ts` | Idempotent re-apply for existing DBs that had partially run migrations. Irrelevant for greenfield. | DELETE |
| All others (03–58) | Pure schema/data changes already reflected in the live DB. | DELETE |

---

## Architecture of the updated ConsolidatedSchema

The existing migration has a clear 4-phase structure that must be preserved:

```
Phase 1: schema-sql.ts  ← REPLACE with new pg_dump output
Phase 2: Create perfana_app / perfana_system roles  ← KEEP (roles are cluster-level,
                                                     not captured by pg_dump)
Phase 3: Seed default organization  ← KEEP
Phase 4: Create TimescaleDB hypertables  ← KEEP (hypertables are API-created,
                                          not in pg_dump DDL)
```

The `schema-sql.ts` is the only thing that changes. Everything else in
`ConsolidatedSchema.ts` stays structurally identical.

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `pg_dump` output references roles (`perfana_app`, `perfana_system`) before they're created | Medium | Phase 2 (role creation) runs before Phase 1 in the migration; keep this order and use `IF NOT EXISTS` |
| `pg_dump` includes `SET` statements or metadata that breaks the embedded SQL | High | Strip `pg_dump` header, `SET` statements, `ALTER SEQUENCE OWNER TO`, and comments before embedding |
| TimescaleDB tables appear as regular tables in the dump | Certain | They will — Phase 4 calls `create_hypertable()` on them. The dump only contains the base table DDL, which is what we want |
| Continuous aggregates (`cagg_*` views/tables) in the dump | Medium | Test that pg_dump captures them correctly; if not, may need explicit `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)` SQL |
| Fresh DB verification fails due to extension order | Low | `CREATE EXTENSION` statements must come first; `pg_dump` preserves this order |
| `DOWN` migration becomes a no-op (drops everything) | Low | This was already the case in `ConsolidatedSchema`; greenfield deployments don't revert |

---

## Implementation Steps

### Step 1: Dump the current schema

```bash
# From the container that has pg_dump available
docker exec perfana-postgres pg_dump \
  -U perfana \
  --schema-only \
  --no-owner \
  --schema=public \
  perfana > /tmp/perfana_schema_dump.sql
```

**Flags:**
- `--schema-only`: no data
- `--no-owner`: omit `ALTER TABLE ... OWNER TO` (irrelevant for app)
- `--schema=public`: only the public schema (not TimescaleDB internal schemas)
- Keep `--acl` (default, not `--no-acl`) to preserve `GRANT` statements for the
  `perfana_app` role

Inspect the dump and remove:
- The `pg_dump` header comment block
- All `SET` statements at the top (`SET statement_timeout = 0`, etc.)
- `SELECT pg_catalog.set_config(...)` lines
- Any `\connect` statements
- `ALTER SEQUENCE ... OWNED BY` (TypeORM manages sequences via entity metadata)

### Step 2: Handle TimescaleDB-specific objects

`pg_dump` captures:
- Base table DDL for hypertables (correct — we want this; Phase 4 calls
  `create_hypertable()` on them, so DDL must NOT include timescaledb options)
- Continuous aggregate views (`cagg_*`) — verify these are captured correctly

Verify by running:
```sql
SELECT view_name FROM timescaledb_information.continuous_aggregates;
```

If continuous aggregates are not correctly captured by `pg_dump`, add explicit SQL
for them at the end of `schema-sql.ts`.

### Step 3: Regenerate schema-sql.ts

Replace the content of `packages/shared/src/database/migrations/schema-sql.ts`
with the cleaned dump, wrapped in the same exported constant:

```typescript
/**
 * Embedded schema SQL — generated from pg_dump on 2026-05-14
 * Contains all schema objects as of v0.2.48.x
 * Regenerate: npm run migration:schema-dump (see scripts/dump-schema.sh)
 */
export const SCHEMA_SQL = `
  -- cleaned pg_dump output here
`;
```

Also add a script `scripts/dump-schema.sh` (or `npm run migration:schema-dump`)
that documents how to regenerate this file in the future, so the next consolidation
is a one-liner.

### Step 4: Update ConsolidatedSchema.ts

- Keep the file, update the JSDoc to reflect the new timestamp/version
- Check that Phase 2 role creation uses `CREATE ROLE IF NOT EXISTS` (or equivalent)
  to survive re-runs gracefully
- Verify the hypertable list in Phase 4 includes any new hypertables added since the
  previous consolidation (check migrations 03–58 for `create_hypertable` calls)

```bash
grep -r "create_hypertable" packages/shared/src/database/migrations/ \
  | grep -v "1700000000000\|schema-sql"
```

### Step 5: Delete the 58 obsolete migrations

```bash
cd packages/shared/src/database/migrations
ls | grep -v "1700000000000-ConsolidatedSchema\|schema-sql" | xargs rm
```

### Step 6: Update the TypeORM migrations array

If the migrations are registered explicitly in a TypeORM config array (rather than
via glob pattern), remove the deleted migrations. Check:

```bash
grep -r "Migration\|migrations" packages/config/src/ apps/api/src/ | grep -v ".spec."
```

### Step 7: Test on a fresh database

```bash
# Create a fresh DB and run the single migration
docker exec perfana-postgres createdb -U perfana perfana_test
DB_NAME=perfana_test npm run migration:run

# Verify table count
docker exec perfana-postgres psql -U perfana perfana_test \
  -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
# Expect: 77 (same as the live DB)

# Schema diff between live DB and fresh DB
docker exec perfana-postgres pg_dump -U perfana --schema-only perfana > /tmp/live.sql
docker exec perfana-postgres pg_dump -U perfana --schema-only perfana_test > /tmp/fresh.sql
diff /tmp/live.sql /tmp/fresh.sql
# Expect: empty diff (or only sequence current_val differences)

# Cleanup
docker exec perfana-postgres dropdb -U perfana perfana_test
```

### Step 8: Run the full test suite

```bash
npm run type-check
npm run lint
npm run test
```

The RLS test suite in `apps/api/src/test/rls/` is especially important — it runs
against the DB and will catch any missing RLS policies or role permissions.

---

## What this does NOT change

- Entity files in `packages/shared/src/entities/` — untouched
- TypeORM entity definitions drive type-safety; `schema-sql.ts` drives the actual DB DDL
- Migration generation commands (`npm run migration:generate`) — still work as before,
  new migrations go in `migrations/` as normal
- The next consolidation pattern — identical process, just run it sooner (every 20–30
  migrations rather than 58)

---

## Future: add a `npm run migration:schema-dump` script

After shipping, add a documented command that:
1. Runs `pg_dump --schema-only` against the local DB
2. Strips the noise (SET statements, header comments)
3. Overwrites `schema-sql.ts`

This makes the next consolidation a 10-minute operation rather than a half-day job.

---

## NOT in scope

- Changing the migration generation strategy
- Adding new database features
- Anything requiring a DB schema change beyond what already exists

---

## Decision Audit Trail

| # | Decision | Rationale |
|---|---|---|
| 1 | Keep `ConsolidatedSchema.ts` (update in place) vs. create new migration | Updating in place preserves the existing migration name/timestamp which is already recorded in DBs that might exist; also cleaner |
| 2 | Delete `CleanupLegacyMigrationRecords` | Greenfield only; no existing migration records to clean up |
| 3 | Delete `SyncSchemaState` | Greenfield only; no partial-migration state to reconcile |
| 4 | Keep Phase 2 (role creation) in the TypeScript migration rather than in the dump | Roles are cluster-level PostgreSQL objects; `pg_dump` with `--schema=public` correctly excludes them |
| 5 | Keep Phase 4 (hypertables) in TypeScript | TimescaleDB hypertable conversion is an API call, not DDL |

## GSTACK REVIEW REPORT

| Run | Skill | Status | Findings |
|-----|-------|--------|----------|
| — | NO REVIEWS YET — run `/autoplan` | — | — |
