#!/usr/bin/env ts-node
/**
 * Script to fix duplicate application_dashboards and add unique constraint
 *
 * This fixes the issue where auto-config creates duplicate dashboards every minute
 * when create_separate_dashboard_for_variable is null/undefined.
 */

import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../apps/api/.env') });

async function fixDuplicateDashboards() {
  console.log('Connecting to database...');
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'perfana',
    password: process.env.DB_PASSWORD || 'perfana',
    database: process.env.DB_NAME || 'perfana_native',
    synchronize: false,
  });
  await dataSource.initialize();

  try {
    console.log('Connected to database');

    // 1. Check current duplicates
    console.log('\n1. Checking for duplicate application dashboards...');
    const duplicates = await dataSource.query(`
      SELECT
        system_under_test_id,
        test_environment,
        grafana_instance_id,
        dashboard_uid,
        dashboard_label,
        COUNT(*) as count
      FROM application_dashboards
      GROUP BY system_under_test_id, test_environment, grafana_instance_id, dashboard_uid, dashboard_label
      HAVING COUNT(*) > 1
    `);

    console.log(`Found ${duplicates.length} groups with duplicates:`);
    duplicates.forEach((dup: any) => {
      console.log(`  - ${dup.dashboard_label}: ${dup.count} duplicates`);
    });

    // 2. Delete duplicates, keeping only the oldest one per group
    console.log('\n2. Deleting duplicate records (keeping oldest)...');
    const deleteResult = await dataSource.query(`
      WITH ranked_dashboards AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY system_under_test_id, test_environment, grafana_instance_id, dashboard_uid, dashboard_label
            ORDER BY created_at ASC
          ) as rn
        FROM application_dashboards
      )
      DELETE FROM application_dashboards
      WHERE id IN (
        SELECT id FROM ranked_dashboards WHERE rn > 1
      )
    `);
    console.log(`Deleted ${deleteResult[1]} duplicate records`);

    // 3. Verify no duplicates remain
    console.log('\n3. Verifying no duplicates remain...');
    const remainingDuplicates = await dataSource.query(`
      SELECT
        system_under_test_id,
        test_environment,
        grafana_instance_id,
        dashboard_uid,
        dashboard_label,
        COUNT(*) as count
      FROM application_dashboards
      GROUP BY system_under_test_id, test_environment, grafana_instance_id, dashboard_uid, dashboard_label
      HAVING COUNT(*) > 1
    `);

    if (remainingDuplicates.length > 0) {
      console.error('WARNING: Still found duplicates after cleanup!');
      console.log(remainingDuplicates);
    } else {
      console.log('✓ No duplicates found');
    }

    // 4. Add unique constraint
    console.log('\n4. Adding unique constraint...');
    try {
      await dataSource.query(`
        CREATE UNIQUE INDEX "idx_application_dashboards_unique"
        ON "application_dashboards" (
          "system_under_test_id",
          "test_environment",
          "grafana_instance_id",
          "dashboard_uid",
          "dashboard_label"
        )
      `);
      console.log('✓ Unique constraint added successfully');
    } catch (error: any) {
      if (error.code === '42P07') {
        console.log('✓ Unique constraint already exists');
      } else {
        throw error;
      }
    }

    // 5. Verify constraint exists
    console.log('\n5. Verifying constraint...');
    const indexes = await dataSource.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'application_dashboards'
      AND indexname = 'idx_application_dashboards_unique'
    `);

    if (indexes.length > 0) {
      console.log('✓ Constraint verified:');
      console.log(`  ${indexes[0].indexdef}`);
    } else {
      console.error('✗ Constraint not found!');
    }

    console.log('\n✅ Fix completed successfully!');
    console.log('\nThe auto-config service will now update existing dashboards instead of creating duplicates.');

  } catch (error) {
    console.error('Error fixing duplicate dashboards:', error);
    throw error;
  } finally {
    await dataSource.destroy();
  }
}

// Run the script
fixDuplicateDashboards()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
