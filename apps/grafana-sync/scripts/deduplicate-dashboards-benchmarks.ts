/**
 * Script to deduplicate application_dashboards and benchmarks records
 *
 * This script identifies and removes duplicate records based on the unique
 * constraint fields before adding database-level unique constraints.
 *
 * Usage:
 *   Dry run (preview only):  npx tsx scripts/deduplicate-dashboards-benchmarks.ts --dry-run
 *   Execute deletion:        npx tsx scripts/deduplicate-dashboards-benchmarks.ts --execute
 *   Filter by SUT:           npx tsx scripts/deduplicate-dashboards-benchmarks.ts --sut=PerfanaWebshop --dry-run
 */

import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '../../.env.local') });

interface DuplicateGroup {
  ids: string[];
  count: number;
  system_under_test_name?: string;
  test_environment?: string;
  dashboard_uid?: string;
  dashboard_label?: string;
  workload?: string;
}

interface DeduplicationResult {
  totalDuplicatesFound: number;
  recordsToDelete: number;
  recordsToKeep: number;
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || !args.includes('--execute');
const sutFilter = args.find(arg => arg.startsWith('--sut='))?.split('=')[1];

async function findDuplicateApplicationDashboards(
  dataSource: DataSource,
  sutFilter?: string
): Promise<DuplicateGroup[]> {
  console.log('\n📊 Finding duplicate application_dashboards...');

  let query = `
    SELECT
      array_agg(ad.id ORDER BY ad.created_at ASC) as ids,
      COUNT(*) as count,
      sut.name as system_under_test_name,
      ad.test_environment,
      ad.dashboard_uid,
      ad.dashboard_label
    FROM application_dashboards ad
    INNER JOIN systems_under_test sut ON ad.system_under_test_id = sut.id
  `;

  const params: any[] = [];
  if (sutFilter) {
    query += ` WHERE sut.name = $1`;
    params.push(sutFilter);
  }

  query += `
    GROUP BY
      ad.system_under_test_id,
      ad.test_environment,
      ad.grafana_instance_id,
      ad.dashboard_uid,
      ad.dashboard_label,
      sut.name
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `;

  const duplicates = await dataSource.query(query, params);

  console.log(`Found ${duplicates.length} duplicate groups in application_dashboards`);

  return duplicates;
}

async function findDuplicateBenchmarks(
  dataSource: DataSource,
  sutFilter?: string
): Promise<DuplicateGroup[]> {
  console.log('\n📊 Finding duplicate benchmarks...');

  let query = `
    SELECT
      array_agg(b.id ORDER BY b.created_at ASC) as ids,
      COUNT(*) as count,
      sut.name as system_under_test_name,
      b.test_environment,
      b.workload,
      b.application_dashboard_id,
      b.generic_check_id
    FROM benchmarks b
    INNER JOIN systems_under_test sut ON b.system_under_test_id = sut.id
  `;

  const params: any[] = [];
  if (sutFilter) {
    query += ` WHERE sut.name = $1`;
    params.push(sutFilter);
  }

  query += `
    GROUP BY
      b.system_under_test_id,
      b.test_environment,
      b.workload,
      b.application_dashboard_id,
      b.generic_check_id,
      sut.name
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `;

  const duplicates = await dataSource.query(query, params);

  console.log(`Found ${duplicates.length} duplicate groups in benchmarks`);

  return duplicates;
}

async function deduplicateApplicationDashboards(
  dataSource: DataSource,
  duplicates: DuplicateGroup[],
  dryRun: boolean
): Promise<DeduplicationResult> {
  let totalDuplicatesFound = 0;
  let recordsToDelete = 0;
  let recordsToKeep = 0;

  console.log('\n🔍 Processing application_dashboards duplicates...\n');

  for (const group of duplicates) {
    const { ids, count, system_under_test_name, test_environment, dashboard_uid, dashboard_label } = group;

    totalDuplicatesFound += count;
    recordsToKeep += 1;
    recordsToDelete += count - 1;

    const keepId = ids[0]; // Keep oldest (first in array sorted by created_at ASC)
    const deleteIds = ids.slice(1);

    console.log(`  Group: ${system_under_test_name} / ${test_environment} / ${dashboard_uid} / ${dashboard_label}`);
    console.log(`    Total records: ${count}`);
    console.log(`    Keep (oldest):  ${keepId}`);
    console.log(`    Delete:         ${deleteIds.join(', ')}`);

    if (!dryRun) {
      // Update foreign key references in benchmarks
      for (const deleteId of deleteIds) {
        await dataSource.query(
          `UPDATE benchmarks
           SET application_dashboard_id = $1
           WHERE application_dashboard_id = $2`,
          [keepId, deleteId]
        );
      }

      // Update foreign key references in ds_compare_config
      for (const deleteId of deleteIds) {
        await dataSource.query(
          `UPDATE ds_compare_config
           SET application_dashboard_id = $1
           WHERE application_dashboard_id = $2`,
          [keepId, deleteId]
        );
      }

      // Delete duplicate records
      await dataSource.query(
        `DELETE FROM application_dashboards WHERE id = ANY($1)`,
        [deleteIds]
      );

      console.log(`    ✅ Deleted ${deleteIds.length} duplicate(s) and updated references\n`);
    } else {
      console.log(`    🔍 (Dry run - no changes made)\n`);
    }
  }

  return { totalDuplicatesFound, recordsToDelete, recordsToKeep };
}

async function deduplicateBenchmarks(
  dataSource: DataSource,
  duplicates: DuplicateGroup[],
  dryRun: boolean
): Promise<DeduplicationResult> {
  let totalDuplicatesFound = 0;
  let recordsToDelete = 0;
  let recordsToKeep = 0;

  console.log('\n🔍 Processing benchmarks duplicates...\n');

  for (const group of duplicates) {
    const { ids, count, system_under_test_name, test_environment, workload } = group;

    totalDuplicatesFound += count;
    recordsToKeep += 1;
    recordsToDelete += count - 1;

    const keepId = ids[0]; // Keep oldest (first in array sorted by created_at ASC)
    const deleteIds = ids.slice(1);

    console.log(`  Group: ${system_under_test_name} / ${test_environment} / ${workload}`);
    console.log(`    Total records: ${count}`);
    console.log(`    Keep (oldest):  ${keepId}`);
    console.log(`    Delete:         ${deleteIds.join(', ')}`);

    if (!dryRun) {
      // Update foreign key references in test_runs (if any)
      for (const deleteId of deleteIds) {
        await dataSource.query(
          `UPDATE test_runs
           SET benchmark_id = $1
           WHERE benchmark_id = $2`,
          [keepId, deleteId]
        );
      }

      // Delete duplicate records
      await dataSource.query(
        `DELETE FROM benchmarks WHERE id = ANY($1)`,
        [deleteIds]
      );

      console.log(`    ✅ Deleted ${deleteIds.length} duplicate(s) and updated references\n`);
    } else {
      console.log(`    🔍 (Dry run - no changes made)\n`);
    }
  }

  return { totalDuplicatesFound, recordsToDelete, recordsToKeep };
}

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'perfana',
    synchronize: false,
    logging: false,
  });

  console.log('🔗 Connecting to database...');
  await dataSource.initialize();

  try {
    console.log('\n' + '='.repeat(80));
    console.log('  DEDUPLICATION SCRIPT FOR APPLICATION_DASHBOARDS & BENCHMARKS');
    console.log('='.repeat(80));
    console.log(`\nMode: ${dryRun ? '🔍 DRY RUN (preview only)' : '⚠️  EXECUTE (will delete duplicates)'}`);
    if (sutFilter) {
      console.log(`Filter: System Under Test = "${sutFilter}"`);
    }
    console.log();

    // Find duplicates
    const appDashDuplicates = await findDuplicateApplicationDashboards(dataSource, sutFilter);
    const benchmarkDuplicates = await findDuplicateBenchmarks(dataSource, sutFilter);

    if (appDashDuplicates.length === 0 && benchmarkDuplicates.length === 0) {
      console.log('\n✅ No duplicates found! Database is clean.');
      return;
    }

    // Process application_dashboards
    let appDashResult: DeduplicationResult = {
      totalDuplicatesFound: 0,
      recordsToDelete: 0,
      recordsToKeep: 0
    };

    if (appDashDuplicates.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('  APPLICATION_DASHBOARDS DEDUPLICATION');
      console.log('-'.repeat(80));

      appDashResult = await deduplicateApplicationDashboards(
        dataSource,
        appDashDuplicates,
        dryRun
      );
    }

    // Process benchmarks
    let benchmarkResult: DeduplicationResult = {
      totalDuplicatesFound: 0,
      recordsToDelete: 0,
      recordsToKeep: 0
    };

    if (benchmarkDuplicates.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('  BENCHMARKS DEDUPLICATION');
      console.log('-'.repeat(80));

      benchmarkResult = await deduplicateBenchmarks(
        dataSource,
        benchmarkDuplicates,
        dryRun
      );
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('  SUMMARY');
    console.log('='.repeat(80));
    console.log('\nApplication Dashboards:');
    console.log(`  Total duplicate records found: ${appDashResult.totalDuplicatesFound}`);
    console.log(`  Records to keep:               ${appDashResult.recordsToKeep}`);
    console.log(`  Records to delete:             ${appDashResult.recordsToDelete}`);

    console.log('\nBenchmarks:');
    console.log(`  Total duplicate records found: ${benchmarkResult.totalDuplicatesFound}`);
    console.log(`  Records to keep:               ${benchmarkResult.recordsToKeep}`);
    console.log(`  Records to delete:             ${benchmarkResult.recordsToDelete}`);

    console.log('\n' + '='.repeat(80));

    if (dryRun) {
      console.log('\n⚠️  This was a DRY RUN - no changes were made to the database.');
      console.log('To execute the deduplication, run with: --execute');
    } else {
      console.log('\n✅ Deduplication completed successfully!');
      console.log('\nNext steps:');
      console.log('1. Run the database migration to add unique constraints');
      console.log('2. Update the entity files with @Unique decorators');
      console.log('3. Refactor the auto-config service to use upsert pattern');
    }

  } catch (error) {
    console.error('\n❌ Error during deduplication:', error);
    throw error;
  } finally {
    await dataSource.destroy();
    console.log('\n🔌 Database connection closed\n');
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
