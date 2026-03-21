/**
 * Fetch Specific Dashboard Data
 *
 * Fetches real Grafana data from specific dashboards:
 * - gatling-overview-influxdb (Gatling load test metrics)
 * - spring-boot-kubernetes-jvm-mimir (JVM metrics with Prometheus/Mimir)
 */

import axios from 'axios';
import { Pool } from 'pg';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Target dashboards
const TARGET_DASHBOARDS = [
  'gatling-overview-influxdb',
  'spring-boot-kubernetes-jvm-mimir'
];

const GRAFANA_URLS = [
  'http://localhost:3000',
  'http://grafana:3000',
  'http://host.docker.internal:3000',
  'http://127.0.0.1:3000'
];

const GRAFANA_CONFIG = {
  apiKey: process.env.GRAFANA_API_KEY || '',
  orgId: process.env.GRAFANA_ORG_ID || '1'
};

const TEST_RUN_ID = 'MyAfterburner-acc-loadTest-00002';

async function fetchSpecificDashboards() {
  console.log('🚀 Starting Specific Dashboard Data Fetch');
  console.log('==========================================');

  if (!GRAFANA_CONFIG.apiKey) {
    throw new Error('GRAFANA_API_KEY environment variable is required');
  }

  // Setup database connection
  const db = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres',
    max: 5
  });

  // Find working Grafana URL
  let grafanaClient: any = null;
  let workingUrl: string = '';

  for (const url of GRAFANA_URLS) {
    try {
      console.log(`🔗 Testing Grafana connection to ${url}...`);

      const testClient = axios.create({
        baseURL: url,
        headers: {
          'Authorization': `Bearer ${GRAFANA_CONFIG.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      const healthCheck = await testClient.get('/api/health');
      console.log(`✅ Grafana connection successful to ${url}`);

      grafanaClient = testClient;
      workingUrl = url;
      break;
    } catch (error: any) {
      console.log(`❌ Failed to connect to ${url}: ${error.message}`);
    }
  }

  if (!grafanaClient) {
    throw new Error('Could not connect to Grafana on any URL');
  }

  try {
    // Get the actual test run time range
    console.log('⏰ Loading test run time range...');
    const testRunResult = await db.query(`
      SELECT
        start_time,
        end_time,
        EXTRACT(EPOCH FROM start_time) * 1000 as start_timestamp_ms,
        EXTRACT(EPOCH FROM end_time) * 1000 as end_timestamp_ms
      FROM test_runs
      WHERE test_run_id = $1
    `, [TEST_RUN_ID]);

    const testRun = testRunResult.rows[0];
    const TEST_TIME_RANGE = {
      from: testRun.start_time,
      to: testRun.end_time,
      from_ms: Math.floor(testRun.start_timestamp_ms),
      to_ms: Math.floor(testRun.end_timestamp_ms)
    };

    console.log(`✅ Test run time range: ${TEST_TIME_RANGE.from} to ${TEST_TIME_RANGE.to}`);

    // Get panels from target dashboards
    console.log('📊 Loading panels from target dashboards...');
    const panelResult = await db.query(`
      SELECT DISTINCT
        panel_id,
        panel_title,
        dashboard_label,
        dashboard_uid
      FROM ds_panels
      WHERE test_run_id = $1
        AND dashboard_uid = ANY($2)
      ORDER BY dashboard_uid, panel_id
    `, [TEST_RUN_ID, TARGET_DASHBOARDS]);

    const panels = panelResult.rows;
    console.log(`📋 Found ${panels.length} panels from target dashboards`);

    const dashboardData: any = {};

    // Process each target dashboard
    for (const dashboardUid of TARGET_DASHBOARDS) {
      console.log(`\n📊 Processing Dashboard: ${dashboardUid}`);

      try {
        // Fetch the dashboard definition
        const dashboardResponse = await grafanaClient.get(`/api/dashboards/uid/${dashboardUid}`);
        const dashboard = dashboardResponse.data.dashboard;

        console.log(`✅ Fetched dashboard: ${dashboard.title}`);
        console.log(`   Panels: ${dashboard.panels?.length || 0}`);

        dashboardData[dashboardUid] = {
          dashboard_info: {
            uid: dashboardUid,
            title: dashboard.title,
            tags: dashboard.tags || [],
            panel_count: dashboard.panels?.length || 0
          },
          panels: {},
          panel_queries: {}
        };

        // Get panels from this dashboard in our test run
        const dashboardPanels = panels.filter(p => p.dashboard_uid === dashboardUid);
        console.log(`   Found ${dashboardPanels.length} panels from this dashboard in test run`);

        // Process each panel
        for (const panel of dashboardPanels.slice(0, 5)) { // Limit to 5 panels per dashboard
          console.log(`\n   📊 Panel ${panel.panel_id}: ${panel.panel_title}`);

          // Find matching panel in dashboard
          const dashboardPanel = dashboard.panels?.find((p: any) => p.id === panel.panel_id);

          if (dashboardPanel?.targets) {
            console.log(`     Found panel with ${dashboardPanel.targets.length} targets`);

            // Get metrics from database for this panel
            const metricsResult = await db.query(`
              SELECT DISTINCT
                metric_name,
                unit,
                COUNT(*) as data_points,
                MIN(value) as min_value,
                MAX(value) as max_value,
                AVG(value) as avg_value
              FROM ds_metrics
              WHERE test_run_id = $1 AND panel_id = $2 AND value IS NOT NULL
              GROUP BY metric_name, unit
              ORDER BY data_points DESC
            `, [TEST_RUN_ID, panel.panel_id]);

            // Create query request with proper time formatting
            const queryRequest = {
              queries: dashboardPanel.targets.map((target: any, index: number) => ({
                ...target,
                refId: target.refId || String.fromCharCode(65 + index),
                intervalMs: 15000,
                maxDataPoints: 300
              })),
              range: {
                from: new Date(TEST_TIME_RANGE.from_ms).toISOString(),
                to: new Date(TEST_TIME_RANGE.to_ms).toISOString(),
                raw: {
                  from: new Date(TEST_TIME_RANGE.from_ms).toISOString(),
                  to: new Date(TEST_TIME_RANGE.to_ms).toISOString()
                }
              },
              from: new Date(TEST_TIME_RANGE.from_ms).toISOString(),
              to: new Date(TEST_TIME_RANGE.to_ms).toISOString(),
              interval: "15s"
            };

            try {
              // Query Grafana
              console.log(`     🔄 Querying Grafana API...`);
              const queryResponse = await grafanaClient.post('/api/ds/query', queryRequest);

              dashboardData[dashboardUid].panels[panel.panel_id] = {
                panel_info: {
                  panel_id: panel.panel_id,
                  panel_title: panel.panel_title,
                  dashboard_label: panel.dashboard_label,
                  targets: dashboardPanel.targets
                },
                grafana_query: queryRequest,
                grafana_response: queryResponse.data,
                database_metrics: metricsResult.rows
              };

              const resultCount = Object.keys(queryResponse.data.results || {}).length;
              console.log(`     ✅ Successfully fetched ${resultCount} result sets`);

              // Check if we got actual data
              let hasData = false;
              for (const [refId, result] of Object.entries(queryResponse.data.results || {})) {
                const frames = (result as any).frames || [];
                if (frames.length > 0 && frames[0].data?.values?.[0]?.length > 0) {
                  hasData = true;
                  console.log(`     📊 RefId ${refId}: ${frames[0].data.values[0].length} data points`);
                }
              }

              if (!hasData) {
                console.log(`     ⚠️ No time series data in response`);
              }

            } catch (error: any) {
              console.log(`     ❌ Grafana query failed: ${error.message}`);

              // Log the full request details for debugging
              console.log(`     🔍 Query details:`);
              console.log(`       Targets: ${dashboardPanel.targets.length}`);
              console.log(`       First target datasource: ${JSON.stringify(dashboardPanel.targets[0]?.datasource)}`);
              console.log(`       Time range: ${queryRequest.from} to ${queryRequest.to}`);

              dashboardData[dashboardUid].panels[panel.panel_id] = {
                panel_info: {
                  panel_id: panel.panel_id,
                  panel_title: panel.panel_title,
                  dashboard_label: panel.dashboard_label,
                  targets: dashboardPanel.targets
                },
                grafana_query: queryRequest,
                error: error.message,
                database_metrics: metricsResult.rows
              };
            }

          } else {
            console.log(`     ⚠️ No targets found for panel`);
          }
        }

      } catch (error: any) {
        console.log(`❌ Failed to fetch dashboard ${dashboardUid}: ${error.message}`);
        dashboardData[dashboardUid] = {
          error: error.message
        };
      }
    }

    // Save the data
    console.log('\n💾 Saving dashboard data...');
    const outputDir = join(process.cwd(), 'src/test/fixtures/real-world');
    mkdirSync(outputDir, { recursive: true });

    const outputFile = join(outputDir, 'specific-dashboards.json');
    writeFileSync(outputFile, JSON.stringify({
      test_run_id: TEST_RUN_ID,
      time_range: TEST_TIME_RANGE,
      grafana_config: {
        working_url: workingUrl,
        org_id: GRAFANA_CONFIG.orgId
      },
      target_dashboards: TARGET_DASHBOARDS,
      fetched_at: new Date().toISOString(),
      dashboards: dashboardData
    }, null, 2));

    console.log(`✅ Dashboard data saved to: ${outputFile}`);

    // Summary
    console.log('\n📈 Summary:');
    Object.entries(dashboardData).forEach(([uid, data]: [string, any]) => {
      console.log(`   ${uid}: ${data.dashboard_info?.title || 'Error'}`);
      if (data.panels) {
        const panelCount = Object.keys(data.panels).length;
        const successCount = Object.values(data.panels).filter((p: any) => !p.error).length;
        console.log(`     Panels: ${successCount}/${panelCount} successful`);
      }
    });

    console.log('\n🎉 Specific dashboard fetch completed successfully!');

  } catch (error) {
    console.error('❌ Failed to fetch dashboard data:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchSpecificDashboards()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { fetchSpecificDashboards };