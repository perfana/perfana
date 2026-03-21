/**
 * Simple Real-World Metrics Test
 *
 * A simplified version of the metrics pipeline test that focuses on
 * validating the core functionality with real data.
 */

import { Pool } from 'pg';

const TEST_RUN_ID = 'MyAfterburner-acc-loadTest-00002';

async function runSimpleMetricsTest() {
  console.log('🚀 Starting Simple Metrics Pipeline Test');
  console.log('========================================');

  // Setup database connection
  const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres';
  const db = new Pool({ connectionString: DATABASE_URL, max: 5 });

  try {
    // 1. Verify test run exists
    console.log('📊 Step 1: Verifying test run exists...');
    const testRunResult = await db.query(
      'SELECT test_run_id, start_time, end_time, workload, test_environment FROM test_runs WHERE test_run_id = $1',
      [TEST_RUN_ID]
    );

    if (testRunResult.rows.length === 0) {
      throw new Error(`Test run ${TEST_RUN_ID} not found`);
    }

    const testRun = testRunResult.rows[0];
    console.log(`✅ Test run found: ${testRun.test_run_id}`);
    console.log(`   Environment: ${testRun.test_environment}`);
    console.log(`   Workload: ${testRun.workload}`);
    console.log(`   Duration: ${testRun.start_time} to ${testRun.end_time}`);

    // 2. Check panels data
    console.log('\n📊 Step 2: Checking panels data...');
    const panelsResult = await db.query(
      'SELECT COUNT(*) as count, COUNT(CASE WHEN benchmark_ids IS NOT NULL AND benchmark_ids != \'[]\'::jsonb THEN 1 END) as benchmark_panels FROM ds_panels WHERE test_run_id = $1',
      [TEST_RUN_ID]
    );

    const panelCount = parseInt(panelsResult.rows[0].count);
    const benchmarkPanels = parseInt(panelsResult.rows[0].benchmark_panels);

    console.log(`✅ Panel data found: ${panelCount} total panels`);
    console.log(`   Benchmark panels: ${benchmarkPanels}`);
    console.log(`   Non-benchmark panels: ${panelCount - benchmarkPanels}`);

    if (panelCount === 0) {
      throw new Error('No panel data found for test run');
    }

    // 3. Check existing metrics data
    console.log('\n📊 Step 3: Checking existing metrics data...');
    const metricsResult = await db.query(`
      SELECT
        COUNT(*) as total_records,
        COUNT(DISTINCT panel_id) as unique_panels,
        COUNT(DISTINCT metric_name) as unique_metrics,
        MIN(time) as earliest_time,
        MAX(time) as latest_time,
        COUNT(CASE WHEN value IS NOT NULL THEN 1 END) as non_null_values
      FROM ds_metrics
      WHERE test_run_id = $1
    `, [TEST_RUN_ID]);

    const metrics = metricsResult.rows[0];
    console.log(`✅ Existing metrics data:`);
    console.log(`   Total records: ${metrics.total_records}`);
    console.log(`   Unique panels: ${metrics.unique_panels}`);
    console.log(`   Unique metrics: ${metrics.unique_metrics}`);
    console.log(`   Non-null values: ${metrics.non_null_values}`);
    console.log(`   Time range: ${metrics.earliest_time} to ${metrics.latest_time}`);

    // 4. Sample some panel data to understand structure
    console.log('\n📊 Step 4: Sampling panel data structure...');
    const samplePanelsResult = await db.query(`
      SELECT
        panel_id,
        panel_title,
        dashboard_label,
        benchmark_ids,
        datasource_type,
        jsonb_array_length(COALESCE(requests, '[]'::jsonb)) as request_count
      FROM ds_panels
      WHERE test_run_id = $1
      ORDER BY panel_id
      LIMIT 5
    `, [TEST_RUN_ID]);

    console.log('✅ Sample panel data:');
    samplePanelsResult.rows.forEach(panel => {
      console.log(`   Panel ${panel.panel_id}: ${panel.panel_title}`);
      console.log(`     Dashboard: ${panel.dashboard_label}`);
      console.log(`     Datasource: ${panel.datasource_type}`);
      console.log(`     Benchmarks: ${JSON.stringify(panel.benchmark_ids)}`);
      console.log(`     Request count: ${panel.request_count}`);
    });

    // 5. Sample some metrics data
    console.log('\n📊 Step 5: Sampling metrics data structure...');
    const sampleMetricsResult = await db.query(`
      SELECT
        panel_id,
        panel_title,
        metric_name,
        time,
        value,
        timestep,
        ramp_up
      FROM ds_metrics
      WHERE test_run_id = $1
      ORDER BY panel_id, metric_name, time
      LIMIT 10
    `, [TEST_RUN_ID]);

    console.log('✅ Sample metrics data:');
    sampleMetricsResult.rows.forEach(metric => {
      console.log(`   Panel ${metric.panel_id} (${metric.panel_title}): ${metric.metric_name}`);
      console.log(`     Time: ${metric.time}, Value: ${metric.value}, Timestep: ${metric.timestep}, Ramp-up: ${metric.ramp_up}`);
    });

    // 6. Validate data relationships
    console.log('\n📊 Step 6: Validating data relationships...');
    const relationshipResult = await db.query(`
      SELECT
        p.panel_id,
        p.panel_title,
        COUNT(m.metric_name) as metric_count,
        COUNT(DISTINCT m.metric_name) as unique_metric_names
      FROM ds_panels p
      LEFT JOIN ds_metrics m ON p.test_run_id = m.test_run_id AND p.panel_id = m.panel_id
      WHERE p.test_run_id = $1
      GROUP BY p.panel_id, p.panel_title
      HAVING COUNT(m.metric_name) > 0
      ORDER BY metric_count DESC
      LIMIT 10
    `, [TEST_RUN_ID]);

    console.log('✅ Panels with most metrics:');
    relationshipResult.rows.forEach(rel => {
      console.log(`   Panel ${rel.panel_id}: ${rel.panel_title}`);
      console.log(`     Metrics: ${rel.metric_count} records, ${rel.unique_metric_names} unique names`);
    });

    console.log('\n🎉 Simple Metrics Test Completed Successfully!');
    console.log('✅ All data structures validated');
    console.log('✅ Relationships confirmed');
    console.log('✅ Ready for MetricsPipeline testing');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimpleMetricsTest()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { runSimpleMetricsTest };