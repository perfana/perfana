/**
 * Fetch Real Grafana Data Script
 *
 * This script connects to the actual Grafana instance and fetches real data
 * for test run MyAfterburner-acc-loadTest-00002 to create authentic mock fixtures.
 */

import axios from 'axios';
import { Pool } from 'pg';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Grafana configuration from database - try multiple URLs
const GRAFANA_URLS = [
  'http://localhost:3000',
  'http://grafana:3000',
  'http://host.docker.internal:3000',
  'http://127.0.0.1:3000'
];

const GRAFANA_CONFIG = {
  apiKey: process.env.GRAFANA_API_KEY || '',  // Set via GRAFANA_API_KEY environment variable
  orgId: process.env.GRAFANA_ORG_ID || '1'
};

const TEST_RUN_ID = 'MyAfterburner-acc-loadTest-00002';

interface PanelData {
  panel_id: number;
  panel_title: string;
  dashboard_label: string;
  dashboard_uid: string;
  requests: any[];
}

async function fetchRealGrafanaData() {
  console.log('🚀 Starting Real Grafana Data Fetch');
  console.log('=====================================');

  // Setup database connection
  const db = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres',
    max: 5
  });

  // Try to connect to Grafana on different URLs
  let grafanaClient: any = null;
  let workingUrl: string = '';

  if (!GRAFANA_CONFIG.apiKey) {
    console.log('⚠️ GRAFANA_API_KEY environment variable not set');
    console.log('📊 Will proceed with database-only analysis...');
  } else {
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
        console.log(`✅ Grafana connection successful to ${url}: ${healthCheck.data.database}`);

        grafanaClient = testClient;
        workingUrl = url;
        break;
      } catch (error: any) {
        console.log(`❌ Failed to connect to ${url}: ${error.message}`);
      }
    }

    if (!grafanaClient) {
      console.log('❌ Could not connect to Grafana on any URL');
      console.log('📊 Will proceed with database-only analysis...');
    }
  }

  try {
    // 1. Get the actual test run time range
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

    if (testRunResult.rows.length === 0) {
      throw new Error(`Test run ${TEST_RUN_ID} not found`);
    }

    const testRun = testRunResult.rows[0];
    const TEST_TIME_RANGE = {
      from: testRun.start_time,
      to: testRun.end_time,
      from_ms: Math.floor(testRun.start_timestamp_ms),
      to_ms: Math.floor(testRun.end_timestamp_ms)
    };

    console.log(`✅ Test run time range: ${TEST_TIME_RANGE.from} to ${TEST_TIME_RANGE.to}`);
    console.log(`   Timestamps: ${TEST_TIME_RANGE.from_ms} to ${TEST_TIME_RANGE.to_ms}`);

    // 2. Get sample panels with different characteristics
    console.log('📊 Loading sample panels from database...');
    const panelResult = await db.query(`
      SELECT
        panel_id,
        panel_title,
        dashboard_label,
        dashboard_uid,
        requests
      FROM ds_panels
      WHERE test_run_id = $1
      ORDER BY
        CASE
          WHEN dashboard_label ILIKE '%loki%' THEN 1
          WHEN dashboard_label ILIKE '%jfr%' THEN 2
          WHEN dashboard_label ILIKE '%jvm%' THEN 3
          WHEN dashboard_label ILIKE '%http%' THEN 4
          WHEN dashboard_label ILIKE '%gatling%' THEN 5
          ELSE 6
        END,
        panel_id
      LIMIT 10
    `, [TEST_RUN_ID]);

    const panels = panelResult.rows as PanelData[];
    console.log(`📋 Found ${panels.length} sample panels`);

    // 3. Fetch metrics data for each panel to understand the structure
    console.log('🔍 Analyzing existing metrics for panels...');
    const realGrafanaResponses: any = {};

    for (const panel of panels) {
      console.log(`\n📊 Processing Panel ${panel.panel_id}: ${panel.panel_title}`);
      console.log(`   Dashboard: ${panel.dashboard_label}`);

      // Get actual metrics for this panel
      const metricsResult = await db.query(`
        SELECT DISTINCT metric_name, unit
        FROM ds_metrics
        WHERE test_run_id = $1 AND panel_id = $2
        ORDER BY metric_name
        LIMIT 5
      `, [TEST_RUN_ID, panel.panel_id]);

      if (metricsResult.rows.length === 0) {
        console.log(`   ⚠️ No metrics found for this panel`);
        continue;
      }

      // Try to fetch data from Grafana using dashboard UID if available
      if (grafanaClient && panel.dashboard_uid) {
        try {
          console.log(`   🔍 Attempting to fetch dashboard: ${panel.dashboard_uid}`);

          // First, get the dashboard
          const dashboardResponse = await grafanaClient.get(`/api/dashboards/uid/${panel.dashboard_uid}`);

          if (dashboardResponse.data?.dashboard?.panels) {
            const dashboardPanel = dashboardResponse.data.dashboard.panels.find(
              (p: any) => p.id === panel.panel_id
            );

            if (dashboardPanel?.targets) {
              console.log(`   📋 Found panel with ${dashboardPanel.targets.length} targets`);

              // Create a query request similar to what Grafana would send
              const queryRequest = {
                queries: dashboardPanel.targets.map((target: any, index: number) => ({
                  ...target,
                  refId: target.refId || String.fromCharCode(65 + index), // A, B, C...
                  intervalMs: 15000,
                  maxDataPoints: 300
                })),
                range: {
                  from: TEST_TIME_RANGE.from,
                  to: TEST_TIME_RANGE.to,
                  raw: {
                    from: TEST_TIME_RANGE.from,
                    to: TEST_TIME_RANGE.to
                  }
                },
                from: TEST_TIME_RANGE.from_ms,
                to: TEST_TIME_RANGE.to_ms
              };

              // Make the actual Grafana query
              console.log(`   🔄 Querying Grafana API...`);
              const queryResponse = await grafanaClient.post('/api/ds/query', queryRequest);

              // Store the real response
              realGrafanaResponses[`panel_${panel.panel_id}`] = {
                panel_info: {
                  panel_id: panel.panel_id,
                  panel_title: panel.panel_title,
                  dashboard_label: panel.dashboard_label,
                  dashboard_uid: panel.dashboard_uid
                },
                query_request: queryRequest,
                grafana_response: queryResponse.data,
                metrics_from_db: metricsResult.rows
              };

              console.log(`   ✅ Successfully fetched real Grafana data`);
              console.log(`   📊 Response contains ${Object.keys(queryResponse.data.results || {}).length} result sets`);
            } else {
              console.log(`   ⚠️ Panel found but no targets available`);
            }
          }
        } catch (error: any) {
          console.log(`   ❌ Error fetching from Grafana: ${error.message}`);

          // Store the error info for analysis
          realGrafanaResponses[`panel_${panel.panel_id}_error`] = {
            panel_info: {
              panel_id: panel.panel_id,
              panel_title: panel.panel_title,
              dashboard_label: panel.dashboard_label
            },
            error: error.message,
            metrics_from_db: metricsResult.rows
          };
        }
      } else {
        console.log(`   ⚠️ No dashboard UID available`);
      }

      // Always store the database metrics info
      if (!realGrafanaResponses[`panel_${panel.panel_id}`]) {
        realGrafanaResponses[`panel_${panel.panel_id}_db_only`] = {
          panel_info: {
            panel_id: panel.panel_id,
            panel_title: panel.panel_title,
            dashboard_label: panel.dashboard_label
          },
          metrics_from_db: metricsResult.rows
        };
      }
    }

    // 4. Save the real Grafana responses
    console.log('\n💾 Saving real Grafana responses...');
    const outputDir = join(process.cwd(), 'src/test/fixtures/real-world');
    mkdirSync(outputDir, { recursive: true });

    const outputFile = join(outputDir, 'grafana-responses.json');
    writeFileSync(outputFile, JSON.stringify({
      test_run_id: TEST_RUN_ID,
      time_range: TEST_TIME_RANGE,
      grafana_config: {
        working_url: workingUrl || 'none',
        tried_urls: GRAFANA_URLS,
        org_id: GRAFANA_CONFIG.orgId
      },
      fetched_at: new Date().toISOString(),
      responses: realGrafanaResponses
    }, null, 2));

    console.log(`✅ Real Grafana responses saved to: ${outputFile}`);
    console.log(`📊 Captured ${Object.keys(realGrafanaResponses).length} response sets`);

    // 5. Generate summary
    console.log('\n📈 Summary of captured data:');
    Object.entries(realGrafanaResponses).forEach(([key, data]: [string, any]) => {
      console.log(`   ${key}: ${data.panel_info?.panel_title || 'Unknown'}`);
      if (data.grafana_response) {
        const resultCount = Object.keys(data.grafana_response.results || {}).length;
        console.log(`     - Real Grafana data: ${resultCount} result sets`);
      }
      if (data.metrics_from_db) {
        console.log(`     - DB metrics: ${data.metrics_from_db.length} unique metric names`);
      }
      if (data.error) {
        console.log(`     - Error: ${data.error}`);
      }
    });

    console.log('\n🎉 Real Grafana data fetch completed successfully!');

  } catch (error) {
    console.error('❌ Failed to fetch real Grafana data:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchRealGrafanaData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { fetchRealGrafanaData };