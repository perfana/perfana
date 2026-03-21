/**
 * Fetch Reference Metrics Data from Database
 *
 * This script fetches existing ds_metrics records that correspond to our
 * mock Grafana data, so we can use them as reference data for validating
 * the MetricsPipeline output.
 */

import { Pool } from 'pg';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEST_RUN_ID = 'MyAfterburner-acc-loadTest-00002';

// Dashboard UIDs we have mock data for
const DASHBOARD_UIDS = [
  'gatling-overview-influxdb',
  'spring-boot-kubernetes-jvm-mimir'
];

async function fetchReferenceMetrics() {
  console.log('🔍 Fetching Reference Metrics Data');
  console.log('==================================');

  const db = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres',
    max: 5
  });

  try {
    // First, get the panels we have mock data for
    console.log('📊 Finding panels with mock data...');
    const panelsResult = await db.query(`
      SELECT
        panel_id,
        panel_title,
        dashboard_uid,
        dashboard_label,
        application_dashboard_id
      FROM ds_panels
      WHERE test_run_id = $1
        AND dashboard_uid = ANY($2)
      ORDER BY dashboard_uid, panel_id
    `, [TEST_RUN_ID, DASHBOARD_UIDS]);

    console.log(`✅ Found ${panelsResult.rows.length} panels with mock data`);

    const referenceData: any = {
      test_run_id: TEST_RUN_ID,
      dashboard_uids: DASHBOARD_UIDS,
      fetched_at: new Date().toISOString(),
      panels: {},
      metrics: {}
    };

    // Store panel information
    for (const panel of panelsResult.rows) {
      const panelKey = `${panel.dashboard_uid}_${panel.panel_id}`;
      referenceData.panels[panelKey] = {
        panel_id: panel.panel_id,
        panel_title: panel.panel_title,
        dashboard_uid: panel.dashboard_uid,
        dashboard_label: panel.dashboard_label,
        application_dashboard_id: panel.application_dashboard_id
      };
    }

    // Now fetch existing ds_metrics for these panels
    console.log('📈 Fetching existing ds_metrics...');

    const panelIds = panelsResult.rows.map(p => p.panel_id);
    const metricsResult = await db.query(`
      SELECT
        m.test_run_id,
        m.application_dashboard_id,
        m.dashboard_uid,
        m.panel_id,
        m.panel_title,
        m.dashboard_label,
        m.benchmark_ids,
        m.errors,
        m.metric_name,
        m.time,
        m.timestep,
        m.ramp_up,
        m.value,
        m.unit,
        m.updated_at,
        m.created_at
      FROM ds_metrics m
      WHERE m.test_run_id = $1
        AND m.dashboard_uid = ANY($2)
        AND m.panel_id = ANY($3)
      ORDER BY m.dashboard_uid, m.panel_id, m.time
    `, [TEST_RUN_ID, DASHBOARD_UIDS, panelIds]);

    console.log(`📊 Found ${metricsResult.rows.length} existing metrics records`);

    // Organize metrics by panel
    for (const metric of metricsResult.rows) {
      const panelKey = `${metric.dashboard_uid}_${metric.panel_id}`;

      if (!referenceData.metrics[panelKey]) {
        referenceData.metrics[panelKey] = [];
      }

      referenceData.metrics[panelKey].push({
        test_run_id: metric.test_run_id,
        application_dashboard_id: metric.application_dashboard_id,
        dashboard_uid: metric.dashboard_uid,
        panel_id: metric.panel_id,
        panel_title: metric.panel_title,
        dashboard_label: metric.dashboard_label,
        benchmark_ids: metric.benchmark_ids,
        errors: metric.errors,
        metric_name: metric.metric_name,
        time: metric.time,
        timestep: metric.timestep,
        ramp_up: metric.ramp_up,
        value: metric.value,
        unit: metric.unit,
        updated_at: metric.updated_at,
        created_at: metric.created_at
      });
    }

    // Save reference data
    console.log('\n💾 Saving reference metrics data...');
    const outputDir = join(process.cwd(), 'src/test/fixtures/real-world');
    mkdirSync(outputDir, { recursive: true });

    const outputFile = join(outputDir, 'reference-metrics.json');
    writeFileSync(outputFile, JSON.stringify(referenceData, null, 2));

    console.log(`✅ Reference data saved to: ${outputFile}`);

    // Summary
    console.log('\n📈 Summary:');
    console.log(`   📋 Panels tracked: ${Object.keys(referenceData.panels).length}`);
    console.log(`   📊 Metrics records: ${metricsResult.rows.length}`);

    // Show metrics breakdown by panel
    console.log('\n📊 Metrics per Panel:');
    for (const [panelKey, metrics] of Object.entries(referenceData.metrics)) {
      const panel = referenceData.panels[panelKey];
      const metricsArray = metrics as any[];
      console.log(`   ${panel.panel_title} (${panel.dashboard_uid}): ${metricsArray.length} records`);

      if (metricsArray.length > 0) {
        console.log(`     └─ Total data points: ${metricsArray.length}`);
      }
    }

    // Show sample data structure
    const firstPanel = Object.keys(referenceData.metrics)[0];
    if (firstPanel && referenceData.metrics[firstPanel].length > 0) {
      const sampleMetric = referenceData.metrics[firstPanel][0];
      console.log('\n🔍 Sample Metric Record Structure:');
      console.log(`   Panel: ${sampleMetric.panel_title}`);
      console.log(`   Metric name: ${sampleMetric.metric_name}`);
      console.log(`   Time: ${sampleMetric.time}`);
      console.log(`   Value: ${sampleMetric.value}`);
      console.log(`   Unit: ${sampleMetric.unit || 'N/A'}`);
      console.log(`   Errors: ${sampleMetric.errors ? 'Yes' : 'No'}`);
    }

    console.log('\n🎉 Reference metrics data fetch completed successfully!');

  } catch (error) {
    console.error('❌ Failed to fetch reference metrics:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchReferenceMetrics()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { fetchReferenceMetrics };