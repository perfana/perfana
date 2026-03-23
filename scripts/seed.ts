/**
 * Seed script for Perfana local development.
 *
 * Inserts minimal sample data (organization, system-under-test, Grafana instance)
 * using raw SQL via the `pg` driver. Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *
 * Reads DB connection from apps/api/.env (DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

// ---------------------------------------------------------------------------
// Load env vars from apps/api/.env (simple key=value parser, no dotenv needed
// at the top-level since dotenv may not be hoisted for scripts)
// ---------------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  const envPaths = [
    resolve(__dirname, '..', 'apps', 'api', '.env'),
    resolve(__dirname, '..', 'apps', 'api', '.env.local'),
  ];

  const vars: Record<string, string> = {};

  for (const p of envPaths) {
    try {
      const content = readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        vars[key] = value;
      }
    } catch {
      // file may not exist — that's fine
    }
  }

  return vars;
}

// ---------------------------------------------------------------------------
// Seed data — deterministic UUIDs so re-runs are idempotent
// ---------------------------------------------------------------------------

const SEED_ORG_ID = '00000000-0000-4000-a000-000000000001';
const SEED_SUT_ID = '00000000-0000-4000-a000-000000000002';
const SEED_GRAFANA_ID = '00000000-0000-4000-a000-000000000003';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const env = loadEnv();

  const dbConfig = {
    host: process.env.DB_HOST || env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || env.DB_USERNAME || 'perfana',
    password: process.env.DB_PASSWORD || env.DB_PASSWORD || 'perfana',
    database: process.env.DB_NAME || env.DB_NAME || 'perfana',
  };

  console.log(`\n[seed] Connecting to PostgreSQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database} ...`);

  const client = new Client(dbConfig);

  try {
    await client.connect();
  } catch (err) {
    const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : String(err);
    console.error(`[seed] ERROR: Could not connect to database — ${msg}`);
    console.error('[seed] Make sure PostgreSQL is running: docker compose -f docker-compose.infra.yml up -d');
    process.exit(1);
  }

  console.log('[seed] Connected.');

  // Check if migrations have been applied by looking for the TypeORM migrations table
  try {
    const migrationCheck = await client.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = 'migrations'`
    );
    const hasMigrationsTable = Number(migrationCheck.rows[0]?.cnt) > 0;

    if (!hasMigrationsTable) {
      console.warn('[seed] WARNING: No migrations table found. Run migrations first:');
      console.warn('[seed]   npm run migration:run');
    } else {
      const applied = await client.query(`SELECT COUNT(*) AS cnt FROM migrations`);
      console.log(`[seed] Migrations table found (${applied.rows[0]?.cnt} applied).`);
    }
  } catch {
    console.warn('[seed] WARNING: Could not check migrations status.');
  }

  // Check required tables exist
  const requiredTables = ['organizations', 'systems_under_test', 'grafana_instances'];
  for (const table of requiredTables) {
    const res = await client.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    if (Number(res.rows[0]?.cnt) === 0) {
      console.error(`[seed] ERROR: Table "${table}" does not exist. Run migrations first: npm run migration:run`);
      await client.end();
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // Insert seed data (idempotent)
  // ---------------------------------------------------------------------------

  const results: string[] = [];

  // 1. Organization
  const orgResult = await client.query(
    `INSERT INTO organizations (id, name, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [SEED_ORG_ID, 'Perfana Demo', 'Default organization for local development']
  );
  if (orgResult.rowCount && orgResult.rowCount > 0) {
    results.push(`  + Organization "Perfana Demo" (${SEED_ORG_ID})`);
  } else {
    results.push(`  = Organization "Perfana Demo" already exists`);
  }

  // 2. System Under Test
  const sutResult = await client.query(
    `INSERT INTO systems_under_test (id, name, description, organization_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [SEED_SUT_ID, 'afterburner', 'Sample system under test for local development', SEED_ORG_ID]
  );
  if (sutResult.rowCount && sutResult.rowCount > 0) {
    results.push(`  + System Under Test "afterburner" (${SEED_SUT_ID})`);
  } else {
    results.push(`  = System Under Test "afterburner" already exists`);
  }

  // 3. Grafana Instance
  const grafanaResult = await client.query(
    `INSERT INTO grafana_instances (id, label, client_url, org_id, organization_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [SEED_GRAFANA_ID, 'Local Grafana', 'http://localhost:3000', '1', SEED_ORG_ID]
  );
  if (grafanaResult.rowCount && grafanaResult.rowCount > 0) {
    results.push(`  + Grafana Instance "Local Grafana" (${SEED_GRAFANA_ID})`);
  } else {
    results.push(`  = Grafana Instance "Local Grafana" already exists`);
  }

  await client.end();

  console.log('\n[seed] Results:');
  for (const r of results) {
    console.log(r);
  }
  console.log('\n[seed] Done.\n');
}

main().catch((err) => {
  const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : String(err);
  console.error(`[seed] Unexpected error: ${msg}`);
  process.exit(1);
});
