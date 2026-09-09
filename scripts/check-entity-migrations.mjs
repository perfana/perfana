#!/usr/bin/env node
/**
 * Fails when a column can reach a NEW database but not an EXISTING one.
 *
 * Two independent checks, because the same mistake has two shapes:
 *
 *   1. BRANCH CHECK — this branch adds an entity column and adds no migration file.
 *      Catches the mistake at the moment it is made.
 *
 *   2. PHASE 6 AUDIT — a column in Phase 6 of the consolidated schema that no
 *      incremental migration adds. Repo-wide and branch-independent, so it still
 *      fires after the mistake has been merged.
 *
 * Check 2 exists because check 1 has a one-shot blind spot: it keys off entity files
 * changed IN THE BRANCH, so once a column lands on main without its migration, every
 * later branch reports "no entities changed" and the gap is invisible forever. That is
 * exactly what happened to `dynatrace_entity_mappings.labels` (v0.2.95.7 → v0.2.95.8):
 * the gate was bypassed on the branch that introduced it, and could never flag it again.
 *
 * Phase 6 is the right anchor for check 2. It is the section of the consolidated
 * migration reserved for columns added AFTER the baseline `schema-sql.ts` dump, so
 * every entry in it post-dates the baseline by construction — which is precisely the
 * condition that makes a column present on new databases and absent on old ones.
 * Columns inside the dump itself need no migration and are correctly ignored.
 *
 * Note what neither check does: compare entities against a database migrated from
 * scratch. Such a database is built from the consolidated schema, so it HAS the new
 * column and the check passes. That is why the obvious version of this test would have
 * missed the bug it exists for.
 *
 *   node scripts/check-entity-migrations.mjs [baseRef]     (default: origin/main)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const base = process.argv[2] ?? 'origin/main';
const ENTITY_DIR = 'packages/shared/src/entities/';
const MIGRATION_DIR = 'packages/shared/src/database/migrations/';
const CONSOLIDATED = `${MIGRATION_DIR}1700000000000-ConsolidatedSchema.ts`;
const PHASE_6_MARKER = 'Phase 6:';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

const problems = [];
const notes = [];

// ---------------------------------------------------------------------------
// Check 2 — Phase 6 audit (repo-wide, runs even with no diff)
// ---------------------------------------------------------------------------

/** `ALTER TABLE x ADD COLUMN IF NOT EXISTS "col" ...` → {table, column} */
const addColumns = (sql) => {
  const out = [];
  const re = /ALTER TABLE\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+ADD COLUMN IF NOT EXISTS\s+"?([a-z_][a-z0-9_]*)"?/gi;
  for (const m of sql.matchAll(re)) out.push({ table: m[1], column: m[2] });
  return out;
};

const migrationFiles = readdirSync(MIGRATION_DIR)
  .filter((f) => /^\d+-.*\.ts$/.test(f))
  .sort();

// Everything an EXISTING database can still receive: every incremental migration,
// i.e. every migration that is not the consolidated baseline itself.
const incremental = migrationFiles.filter((f) => !f.startsWith('1700000000000-'));
const covered = new Set();
for (const file of incremental) {
  for (const { table, column } of addColumns(readFileSync(MIGRATION_DIR + file, 'utf8'))) {
    covered.add(`${table}.${column}`);
  }
}

// Phase 6 is everything after the marker comment in the consolidated migration.
const consolidated = readFileSync(CONSOLIDATED, 'utf8');
const phase6Start = consolidated.indexOf(PHASE_6_MARKER);
if (phase6Start === -1) {
  notes.push(
    `could not find the "${PHASE_6_MARKER}" marker in ${CONSOLIDATED} — the Phase 6 audit was skipped. ` +
      'If that section was renamed, update PHASE_6_MARKER in this script.',
  );
} else {
  const uncovered = addColumns(consolidated.slice(phase6Start))
    .filter(({ table, column }) => !covered.has(`${table}.${column}`));

  if (uncovered.length > 0) {
    problems.push({
      heading: 'Phase 6 columns with no incremental migration',
      items: uncovered.map(({ table, column }) => `${table}.${column}`),
      why:
        'Phase 6 is for columns added after the baseline schema dump, so a database provisioned\n' +
        'before one of these lines was written does not have that column — while the entity declares\n' +
        'it and TypeORM names it in every SELECT. Add an incremental migration with the same\n' +
        `ALTER ... ADD COLUMN IF NOT EXISTS, under ${MIGRATION_DIR}.`,
    });
  } else {
    notes.push(
      `Phase 6 audit: ${addColumns(consolidated.slice(phase6Start)).length} column(s), all covered by an incremental migration.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Check 1 — branch diff
// ---------------------------------------------------------------------------

let mergeBase;
try {
  mergeBase = git('merge-base', base, 'HEAD').trim();
} catch {
  notes.push(`branch check: cannot resolve ${base}, skipped.`);
}

if (mergeBase) {
  const changed = git('diff', '--name-only', `${mergeBase}..HEAD`).split('\n').filter(Boolean);
  const touchedEntities = changed.filter((f) => f.startsWith(ENTITY_DIR) && f.endsWith('.ts'));

  if (touchedEntities.length === 0) {
    notes.push('branch check: no entities changed.');
  } else {
    // A migration FILE, not an edit to one: editing an already-released migration does not
    // reach a database that has run it.
    const addedMigrations = git('diff', '--name-only', '--diff-filter=A', `${mergeBase}..HEAD`)
      .split('\n')
      .filter((f) => f.startsWith(MIGRATION_DIR) && f.endsWith('.ts'));

    // Added @Column-ish declarations, by the property they map. Decorator lines carry the
    // options; the property name is on the following line, which is what the message needs.
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
      notes.push(`branch check: ${touchedEntities.length} entity file(s) changed, no columns added.`);
    } else if (addedMigrations.length > 0) {
      notes.push(
        `branch check: ${addedColumns.length} column(s) added, ` +
          `${addedMigrations.length} migration file(s) added — ${addedMigrations
            .map((f) => f.replace(MIGRATION_DIR, ''))
            .join(', ')}.`,
      );
    } else {
      problems.push({
        heading: 'Columns added to entities in this branch, with no migration',
        items: addedColumns,
        why:
          'Adding the column to the consolidated schema is not enough. That schema only ever runs on a\n' +
          'NEW database, so an existing deployment will not have the column — while the entity declares\n' +
          'it, and TypeORM names every declared column in its SELECT. Every read of that table then\n' +
          'fails with "column does not exist", and a UI that turns a failed fetch into an empty list\n' +
          'reports it as missing data. That is the 0.2.68.7 incident, which cost a day, and the\n' +
          `0.2.95.7 one. Add a migration under ${MIGRATION_DIR} (see\n` +
          '1802000000000-AddDynatraceEntityMappingLabels.ts for the shape).',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (problems.length === 0) {
  console.log('entity/migration check OK');
  for (const n of notes) console.log(`  · ${n}`);
  process.exit(0);
}

console.error('\nentity/migration check FAILED\n');
for (const { heading, items, why } of problems) {
  console.error(`${heading}:\n`);
  for (const item of items) console.error(`  - ${item}`);
  console.error(`\n${why}\n`);
}
for (const n of notes) console.error(`  · ${n}`);
console.error('');
process.exit(1);
