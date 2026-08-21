#!/usr/bin/env node
/**
 * Fails when a branch adds a column to an entity without adding a migration.
 *
 * The boot check (`assertEntityColumns`) catches this on a database that already diverged. This
 * catches it before it ships, which is cheaper: on 2026-08-21 an upgrade left production asking
 * for `application_dashboards.deletion_status`, a column that had been added to the entity and to
 * the consolidated schema — the schema only NEW databases are built from — and to no incremental
 * migration. Every dashboard read failed, the page showed an empty list, and it was reported as
 * deleted data.
 *
 * Note what this deliberately does NOT do: compare entities against a database migrated from
 * scratch. Such a database is built from the consolidated schema, so it HAS the new column and
 * the check passes. That is why the obvious version of this test would have missed the bug it
 * exists for.
 *
 * The rule is blunt on purpose: entity columns added in this branch, and no migration file added
 * in this branch, is a mistake worth interrupting for. Renames and drops are not modelled — they
 * need a migration too, but a false negative there is a smaller loss than a rule nobody trusts.
 *
 *   node scripts/check-entity-migrations.mjs [baseRef]     (default: origin/main)
 */

import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'origin/main';
const ENTITY_DIR = 'packages/shared/src/entities/';
const MIGRATION_DIR = 'packages/shared/src/database/migrations/';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

let mergeBase;
try {
  mergeBase = git('merge-base', base, 'HEAD').trim();
} catch {
  console.log(`entity/migration check: cannot resolve ${base}, skipping.`);
  process.exit(0);
}

const changed = git('diff', '--name-only', `${mergeBase}..HEAD`).split('\n').filter(Boolean);
const touchedEntities = changed.filter((f) => f.startsWith(ENTITY_DIR) && f.endsWith('.ts'));

if (touchedEntities.length === 0) {
  console.log('entity/migration check: no entities changed.');
  process.exit(0);
}

// A migration FILE, not an edit to one: editing an already-released migration does not reach a
// database that has run it.
const addedMigrations = git('diff', '--name-only', '--diff-filter=A', `${mergeBase}..HEAD`)
  .split('\n')
  .filter((f) => f.startsWith(MIGRATION_DIR) && f.endsWith('.ts'));

// Added @Column-ish declarations, by the property they map. Decorator lines carry the options;
// the property name is on the following line, which is what the message needs to be useful.
const addedColumns = [];
for (const file of touchedEntities) {
  const diff = git('diff', '-U1', `${mergeBase}..HEAD`, '--', file).split('\n');
  diff.forEach((line, i) => {
    if (!/^\+\s*@(Column|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn)\(/.test(line)) return;
    const next = diff.slice(i + 1, i + 4).find((l) => /^\+\s*[a-zA-Z_]\w*[?!]?\s*:/.test(l));
    const property = next?.replace(/^\+\s*/, '').split(/[?!:]/)[0]?.trim() ?? '(unnamed)';
    const named = line.match(/name:\s*['"]([^'"]+)['"]/)?.[1];
    addedColumns.push(`${file.replace(ENTITY_DIR, '')} → ${named ?? property}`);
  });
}

if (addedColumns.length === 0) {
  console.log('entity/migration check: entities changed, but no columns added.');
  process.exit(0);
}

if (addedMigrations.length > 0) {
  console.log(
    `entity/migration check: ${addedColumns.length} column(s) added, ` +
      `${addedMigrations.length} migration file(s) added. OK.`,
  );
  process.exit(0);
}

console.error(`
entity/migration check FAILED

This branch adds columns to entities and adds no migration:

${addedColumns.map((c) => `  - ${c}`).join('\n')}

Adding the column to the consolidated schema is not enough. That schema only ever runs on a NEW
database, so an existing deployment will not have the column — while the entity declares it, and
TypeORM names every declared column in its SELECT. Every read of that table then fails with
"column does not exist", and a UI that turns a failed fetch into an empty list reports it as
missing data. That is the 0.2.68.7 incident, which cost a day.

Add a migration under ${MIGRATION_DIR} (see 1795000000000-AddApplicationDashboardDeletionStatus.ts
for the shape), or, if the column really needs no migration, say why in the commit and re-run
with the check skipped.
`);
process.exit(1);
