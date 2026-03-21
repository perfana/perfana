/**
 * Test Variable Substitution Implementation
 *
 * This test verifies that the template variable substitution logic works correctly
 * by running the PanelsPipeline and checking the generated query_variables and requests.
 */

import { Pool } from 'pg';
import { PanelsPipeline } from '../pipelines/PanelsPipeline.js';
import { loadConfig, getConfig } from '../config/environment.js';

const TEST_RUN_ID = 'MyAfterburner-acc-loadTest-00002';

async function testVariableSubstitution() {
  console.log('🧪 Testing Variable Substitution Implementation');
  console.log('=============================================');

  // Load configuration first
  await loadConfig();
  const config = getConfig();
  const db = new Pool({ connectionString: config.DATABASE_URL });

  try {
    // Step 1: Run PanelsPipeline to generate panel documents with variable substitution
    console.log(`🔄 Running PanelsPipeline for test run: ${TEST_RUN_ID}`);

    const panelsPipeline = new PanelsPipeline(db);
    const result = await panelsPipeline.execute({
      testRunId: TEST_RUN_ID,
      includeDynatrace: false
    });

    if (!result.success) {
      throw new Error(`PanelsPipeline failed: ${result.error?.message}`);
    }

    console.log('✅ PanelsPipeline completed successfully');
    console.log(`📊 Generated ${result.data?.panelDocuments} panel documents`);

    // Step 2: Query the database to check the generated query_variables
    console.log('\n🔍 Checking generated query_variables...');

    const panelsResult = await db.query(`
      SELECT
        panel_id,
        panel_title,
        dashboard_label,
        dashboard_uid,
        query_variables,
        array_length(requests, 1) as request_count
      FROM ds_panels
      WHERE test_run_id = $1
        AND dashboard_uid IN ('gatling-overview-influxdb', 'spring-boot-kubernetes-jvm-mimir')
      ORDER BY dashboard_uid, panel_id
      LIMIT 5
    `, [TEST_RUN_ID]);

    console.log(`📋 Found ${panelsResult.rows.length} panel documents:`);

    for (const panel of panelsResult.rows) {
      console.log(`\n📊 Panel ${panel.panel_id}: ${panel.panel_title}`);
      console.log(`   Dashboard: ${panel.dashboard_label} (${panel.dashboard_uid})`);
      console.log(`   Query Variables:`, panel.query_variables);
      console.log(`   Request Count: ${panel.request_count || 0}`);
    }

    // Step 3: Check if variables were properly substituted
    console.log('\n🎯 Variable Substitution Analysis:');

    const hasVariables = panelsResult.rows.some(panel =>
      panel.query_variables && Object.keys(panel.query_variables).length > 0
    );

    const hasRequests = panelsResult.rows.some(panel =>
      panel.request_count && panel.request_count > 0
    );

    if (hasVariables) {
      console.log('✅ Query variables were generated successfully');
    } else {
      console.log('❌ No query variables found - substitution may have failed');
    }

    if (hasRequests) {
      console.log('✅ Grafana requests were generated successfully');
    } else {
      console.log('❌ No requests found - request generation may have failed');
    }

    // Step 4: Show sample request with substituted variables
    console.log('\n📡 Sample Request Analysis:');

    const requestResult = await db.query(`
      SELECT
        panel_id,
        panel_title,
        dashboard_label,
        requests->>0 as first_request
      FROM ds_panels
      WHERE test_run_id = $1
        AND dashboard_uid IN ('gatling-overview-influxdb', 'spring-boot-kubernetes-jvm-mimir')
        AND jsonb_array_length(requests) > 0
      LIMIT 2
    `, [TEST_RUN_ID]);

    for (const panel of requestResult.rows) {
      console.log(`\n🔍 Panel ${panel.panel_id}: ${panel.panel_title}`);
      console.log(`   Dashboard: ${panel.dashboard_label}`);

      try {
        const request = JSON.parse(panel.first_request);
        const queries = request?.request_body?.queries || [];

        if (queries.length > 0) {
          console.log('   Sample Query:', JSON.stringify(queries[0], null, 2));

          // Check if variables are still unsubstituted
          const queryStr = JSON.stringify(queries[0]);
          const unsubstitutedVars = queryStr.match(/\$\w+/g);

          if (unsubstitutedVars) {
            console.log('   ⚠️ Unsubstituted variables found:', unsubstitutedVars);
          } else {
            console.log('   ✅ No unsubstituted variables detected');
          }
        }
      } catch (error) {
        console.log('   ❌ Failed to parse request:', error);
      }
    }

    console.log('\n🎉 Variable Substitution Test Completed');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testVariableSubstitution()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { testVariableSubstitution };