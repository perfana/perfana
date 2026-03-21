/**
 * Fetch Prometheus Mock Data from JVM Dashboards
 *
 * This script fetches real Prometheus data from JVM dashboard panels
 * to create authentic Prometheus mock fixtures.
 */

import axios from 'axios';
import { Pool } from 'pg';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

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

interface VariableContext {
  system_under_test: string;
  test_environment: string;
  service?: string;
}

function extractPrometheusVariableContext(testRun: any, systemUnderTestName: string, dashboardLabel?: string): VariableContext {
  const context: VariableContext = {
    system_under_test: systemUnderTestName,
    test_environment: testRun.test_environment
  };

  if (dashboardLabel) {
    // Extract service from JVM dashboard labels (e.g., "JVM afterburner-be" -> service: "afterburner-be")
    if (dashboardLabel.includes('JVM') && dashboardLabel.includes(' ')) {
      const parts = dashboardLabel.split(' ');
      context.service = parts[parts.length - 1];
    }
  }

  return context;
}

function substituteVariables(str: string, context: VariableContext): string {
  let result = str;

  for (const [key, value] of Object.entries(context)) {
    if (value) {
      // Escape regex special characters in key to prevent reDOS attacks
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\$\\{?${escapedKey}\\}?`, 'g');
      result = result.replace(regex, value);
    }
  }

  return result;
}

function substituteQueryVariables(query: any, context: VariableContext): any {
  if (typeof query === 'string') {
    return substituteVariables(query, context);
  } else if (Array.isArray(query)) {
    return query.map(item => substituteQueryVariables(item, context));
  } else if (query && typeof query === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(query)) {
      result[key] = substituteQueryVariables(value, context);
    }
    return result;
  }
  return query;
}

async function fetchPrometheusData() {
  console.log('🚀 Fetching Prometheus Data from JVM Dashboards');
  console.log('==============================================');

  if (!GRAFANA_CONFIG.apiKey) {
    throw new Error('GRAFANA_API_KEY environment variable is required');
  }

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
    // Get test run data and timestamps
    console.log('⏰ Loading test run data...');
    const testRunResult = await db.query(`
      SELECT
        tr.test_run_id,
        tr.start_time,
        tr.end_time,
        tr.test_environment,
        EXTRACT(EPOCH FROM tr.start_time) * 1000 as start_timestamp_ms,
        EXTRACT(EPOCH FROM tr.end_time) * 1000 as end_timestamp_ms,
        s.name as system_under_test_name
      FROM test_runs tr
      LEFT JOIN systems_under_test s ON tr.system_under_test_id = s.id
      WHERE tr.test_run_id = $1
    `, [TEST_RUN_ID]);

    if (testRunResult.rows.length === 0) {
      throw new Error(`Test run ${TEST_RUN_ID} not found`);
    }

    const testRun = testRunResult.rows[0];
    console.log(`✅ Test run loaded: ${testRun.start_time} to ${testRun.end_time}`);

    // Get JVM/Prometheus panel data
    console.log('📊 Loading JVM dashboard panels...');
    const panelsResult = await db.query(`
      SELECT
        panel_id,
        panel_title,
        dashboard_label,
        dashboard_uid,
        requests,
        datasource_type
      FROM ds_panels
      WHERE test_run_id = $1
        AND dashboard_uid = 'spring-boot-kubernetes-jvm-mimir'
        AND jsonb_array_length(requests) > 0
      ORDER BY panel_id
      LIMIT 10
    `, [TEST_RUN_ID]);

    console.log(`📋 Found ${panelsResult.rows.length} JVM panels with requests`);

    const prometheusResults: any = {};

    // Process each JVM panel
    for (const panel of panelsResult.rows) {
      console.log(`\n📊 Processing Panel ${panel.panel_id}: ${panel.panel_title}`);
      console.log(`   Dashboard: ${panel.dashboard_label} (${panel.dashboard_uid})`);
      console.log(`   Datasource: ${panel.datasource_type}`);

      // Extract variable context for this panel
      const variableContext = extractPrometheusVariableContext(
        testRun,
        testRun.system_under_test_name,
        panel.dashboard_label
      );

      console.log(`   Variables:`, variableContext);

      // Process each request in the panel
      for (let requestIndex = 0; requestIndex < panel.requests.length; requestIndex++) {
        const request = panel.requests[requestIndex];

        if (!request.request_body?.queries) {
          console.log(`   ⚠️ No queries in request ${requestIndex}`);
          continue;
        }

        // Apply variable substitution to queries
        const substitutedQueries = request.request_body.queries.map((query: any) =>
          substituteQueryVariables(query, variableContext)
        );

        // Build Grafana API request
        const grafanaRequest = {
          queries: substitutedQueries,
          range: {
            from: testRun.start_time,
            to: testRun.end_time,
            raw: {
              from: testRun.start_time,
              to: testRun.end_time
            }
          },
          from: testRun.start_time,
          to: testRun.end_time,
          interval: "15s"
        };

        console.log(`   🔄 Querying Grafana for request ${requestIndex}...`);
        console.log(`   📝 Sample query:`, JSON.stringify(substitutedQueries[0], null, 2));

        try {
          const response = await grafanaClient.post('/api/ds/query', grafanaRequest);

          const resultKey = `panel_${panel.panel_id}_${panel.dashboard_label.split(' ')[1]}_request_${requestIndex}`;
          prometheusResults[resultKey] = {
            panel_info: {
              panel_id: panel.panel_id,
              panel_title: panel.panel_title,
              dashboard_label: panel.dashboard_label,
              dashboard_uid: panel.dashboard_uid,
              datasource_type: panel.datasource_type
            },
            variable_context: variableContext,
            original_request: request,
            substituted_request: grafanaRequest,
            grafana_response: response.data,
            timestamp: new Date().toISOString()
          };

          const resultCount = Object.keys(response.data.results || {}).length;
          console.log(`   ✅ Success: ${resultCount} result sets received`);

          // Check for actual data
          let hasData = false;
          for (const [refId, result] of Object.entries(response.data.results || {})) {
            const frames = (result as any).frames || [];
            if (frames.length > 0 && frames[0].data?.values?.[0]?.length > 0) {
              hasData = true;
              console.log(`   📊 RefId ${refId}: ${frames[0].data.values[0].length} data points`);
            }
          }

          if (!hasData) {
            console.log(`   ⚠️ No time series data in response`);
          }

        } catch (error: any) {
          console.log(`   ❌ Grafana query failed: ${error.response?.status} ${error.message}`);

          const resultKey = `panel_${panel.panel_id}_${panel.dashboard_label.split(' ')[1]}_request_${requestIndex}_error`;
          prometheusResults[resultKey] = {
            panel_info: {
              panel_id: panel.panel_id,
              panel_title: panel.panel_title,
              dashboard_label: panel.dashboard_label,
              dashboard_uid: panel.dashboard_uid,
              datasource_type: panel.datasource_type
            },
            variable_context: variableContext,
            original_request: request,
            substituted_request: grafanaRequest,
            error: error.message,
            error_status: error.response?.status,
            error_data: error.response?.data,
            timestamp: new Date().toISOString()
          };
        }
      }
    }

    // Save the Prometheus results
    console.log('\n💾 Saving Prometheus mock data...');
    const outputDir = join(process.cwd(), 'src/test/fixtures/real-world');
    mkdirSync(outputDir, { recursive: true });

    const outputFile = join(outputDir, 'prometheus-mock-data.json');
    writeFileSync(outputFile, JSON.stringify({
      test_run_id: TEST_RUN_ID,
      datasource_type: 'prometheus',
      test_run_data: {
        start_time: testRun.start_time,
        end_time: testRun.end_time,
        system_under_test: testRun.system_under_test_name,
        test_environment: testRun.test_environment
      },
      grafana_config: {
        working_url: workingUrl,
        org_id: GRAFANA_CONFIG.orgId
      },
      fetched_at: new Date().toISOString(),
      results: prometheusResults
    }, null, 2));

    console.log(`✅ Prometheus mock data saved to: ${outputFile}`);
    console.log(`📊 Captured ${Object.keys(prometheusResults).length} query results`);

    // Summary
    console.log('\n📈 Summary:');
    const successCount = Object.keys(prometheusResults).filter(key => !key.includes('_error')).length;
    const errorCount = Object.keys(prometheusResults).filter(key => key.includes('_error')).length;
    console.log(`   ✅ Successful queries: ${successCount}`);
    console.log(`   ❌ Failed queries: ${errorCount}`);

    // Show sample Prometheus queries captured
    console.log('\n🔍 Sample Prometheus Queries Captured:');
    Object.entries(prometheusResults).slice(0, 3).forEach(([key, data]: [string, any]) => {
      if (!key.includes('_error')) {
        console.log(`   ${data.panel_info?.panel_title}: ${data.substituted_request?.queries[0]?.expr || 'N/A'}`);
      }
    });

    console.log('\n🎉 Prometheus mock data fetch completed successfully!');

  } catch (error) {
    console.error('❌ Failed to fetch Prometheus data:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchPrometheusData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { fetchPrometheusData };