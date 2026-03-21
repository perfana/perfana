/**
 * Script to delete performance test ds_compare_config records
 *
 * This removes all ds_compare_config records associated with the synthetic
 * performance test dashboard (application_dashboard_id = '00000000-0000-0000-0000-000000000001')
 *
 * Run with: npx tsx scripts/delete-perf-test-compare-configs.ts
 */

import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '../../.env.local') });

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'perfana',
    synchronize: false,
    logging: true,
  });

  console.log('🔗 Connecting to database...');
  await dataSource.initialize();

  try {
    const PERF_TEST_APP_DASHBOARD_ID = '00000000-0000-0000-0000-000000000001';

    // First, count the records
    const countResult = await dataSource.query(
      `SELECT COUNT(*) as count FROM ds_compare_config WHERE application_dashboard_id = $1`,
      [PERF_TEST_APP_DASHBOARD_ID]
    );
    const count = parseInt(countResult[0].count);

    console.log(`\n📊 Found ${count} ds_compare_config records to delete`);

    if (count === 0) {
      console.log('✅ No records to delete. Exiting.');
      return;
    }

    // Show sample records
    const sampleRecords = await dataSource.query(
      `SELECT
        id,
        system_under_test_id,
        test_environment,
        workload,
        panel_id,
        metric_name,
        config_data->>'source' as source
       FROM ds_compare_config
       WHERE application_dashboard_id = $1
       LIMIT 5`,
      [PERF_TEST_APP_DASHBOARD_ID]
    );

    console.log('\n📝 Sample records to be deleted:');
    console.table(sampleRecords);

    // Delete the records
    console.log(`\n🗑️  Deleting ${count} records...`);

    const result = await dataSource.query(
      `DELETE FROM ds_compare_config WHERE application_dashboard_id = $1`,
      [PERF_TEST_APP_DASHBOARD_ID]
    );

    console.log(`\n✅ Successfully deleted ${count} ds_compare_config records`);
    console.log(`\nNote: These records will be recreated when the PerformanceTestMetricsPipeline runs next.`);
    console.log(`The new records will have updated aggregation values based on the recent code changes.`);

  } catch (error) {
    console.error('❌ Error deleting records:', error);
    throw error;
  } finally {
    await dataSource.destroy();
    console.log('\n🔌 Database connection closed');
  }
}

main()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
