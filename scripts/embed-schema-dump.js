#!/usr/bin/env node
/**
 * Reads database/schema_dump.sql and embeds it as a TypeScript string constant
 * in packages/shared/src/database/migrations/schema-sql.ts.
 *
 * Usage: node scripts/embed-schema-dump.js
 *
 * Run this after regenerating database/schema_dump.sql (e.g., via pg_dump --schema-only).
 */

const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '..', 'database', 'schema_dump.sql');
const outPath = path.join(
  __dirname,
  '..',
  'packages',
  'shared',
  'src',
  'database',
  'migrations',
  'schema-sql.ts',
);

if (!fs.existsSync(sqlPath)) {
  console.error(`Error: ${sqlPath} not found.`);
  console.error('Generate it first with: pg_dump --schema-only -d perfana > database/schema_dump.sql');
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const escaped = sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const output = `/**
 * Embedded schema SQL - generated from database/schema_dump.sql
 *
 * This module embeds the complete database schema as a string constant so that
 * the ConsolidatedSchema and SyncSchemaState migrations are self-contained and
 * do not depend on an external .sql file at runtime.
 *
 * To regenerate: run pg_dump --schema-only against a fully migrated database,
 * then run: node scripts/embed-schema-dump.js
 */
export const SCHEMA_SQL = \`${escaped}\`;
`;

fs.writeFileSync(outPath, output, 'utf8');
console.log(`Embedded ${sql.length} bytes of SQL into ${path.relative(process.cwd(), outPath)}`);
