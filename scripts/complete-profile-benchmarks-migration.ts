/**
 * Script to complete the profile_benchmarks migration
 * Drops old columns that should have been removed in migration 1762632700000
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import * as pg from 'pg';

// Load environment variables
config({ path: resolve(__dirname, '../apps/api/.env') });

const { Pool } = pg.default || pg;

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || 'perfana',
    password: process.env.DB_PASSWORD || 'perfana',
    database: process.env.DB_NAME || 'perfana_native',
  });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();

    try {
      console.log('Dropping old profile_benchmarks columns...');

      const sql = `
        ALTER TABLE profile_benchmarks
        DROP COLUMN IF EXISTS check_name,
        DROP COLUMN IF EXISTS profile,
        DROP COLUMN IF EXISTS check_id,
        DROP COLUMN IF EXISTS add_for_workloads_matching_regex,
        DROP COLUMN IF EXISTS dashboard_name,
        DROP COLUMN IF EXISTS dashboard_label,
        DROP COLUMN IF EXISTS grafana_label,
        DROP COLUMN IF EXISTS panel,
        DROP COLUMN IF EXISTS update_test_runs,
        DROP COLUMN IF EXISTS enabled;
      `;

      await client.query(sql);
      console.log('✓ Successfully dropped old columns');

      // Insert migration record
      console.log('Recording migration...');
      await client.query(`
        INSERT INTO migrations (timestamp, name)
        VALUES (1762632900000, 'CompleteProfileBenchmarksMigration1762632900000')
        ON CONFLICT DO NOTHING;
      `);
      console.log('✓ Migration recorded');

      console.log('\n✅ Migration completed successfully!');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
