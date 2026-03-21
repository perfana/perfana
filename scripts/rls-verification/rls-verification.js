/**
 * RLS Verification Script: Cross-Organization Access Blocking
 *
 * This script verifies that Row-Level Security (RLS) policies correctly:
 * 1. Block access to resources from different organizations
 * 2. Allow global admin access to all resources
 * 3. Allow owner access to their own resources
 * 4. Allow access to resources with NULL organization_id (legacy data)
 *
 * USAGE:
 *   cd packages/shared
 *   node ../../.auto-claude/specs/018-0-0-1-1522/rls-verification.js
 *
 * Or from project root:
 *   DB_HOST=localhost DB_PORT=5432 DB_USERNAME=perfana DB_PASSWORD=perfana DB_NAME=perfana_native \
 *   node .auto-claude/specs/018-0-0-1-1522/rls-verification.js
 */

const { Client } = require('pg');

// Database configuration
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USERNAME || 'perfana',
  password: process.env.DB_PASSWORD || 'perfana',
  database: process.env.DB_NAME || 'perfana_native',
};

// Test organization UUIDs
const ORG_1 = '11111111-1111-1111-1111-111111111111';
const ORG_2 = '22222222-2222-2222-2222-222222222222';

// Test helper functions
async function setSessionVariables(client, userId, roles, organizations, teams = []) {
  await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
  await client.query(`SET LOCAL app.current_user_roles = '${JSON.stringify(roles)}'`);
  await client.query(`SET LOCAL app.current_user_organizations = '${JSON.stringify(organizations)}'`);
  await client.query(`SET LOCAL app.current_user_teams = '${JSON.stringify(teams)}'`);
}

async function resetSessionVariables(client) {
  await client.query('RESET app.current_user_id');
  await client.query('RESET app.current_user_roles');
  await client.query('RESET app.current_user_organizations');
  await client.query('RESET app.current_user_teams');
}

async function queryTestRuns(client) {
  const result = await client.query(`
    SELECT id, test_run_id, organization_id, created_by
    FROM test_runs
    WHERE test_run_id LIKE 'rls-test-run%'
    ORDER BY organization_id NULLS LAST, test_run_id
  `);
  return result.rows;
}

// Test cases
const tests = [
  {
    name: 'Regular User in Org 1',
    userId: 'user-org1',
    roles: ['user', 'org-member'],
    organizations: [ORG_1],
    expectedRows: 3, // 2 from Org 1 + 1 NULL org
    description: 'Should only see Org 1 data + NULL org data',
  },
  {
    name: 'Regular User in Org 2',
    userId: 'user-org2',
    roles: ['user', 'org-member'],
    organizations: [ORG_2],
    expectedRows: 2, // 1 from Org 2 + 1 NULL org
    description: 'Should only see Org 2 data + NULL org data',
  },
  {
    name: 'Global Admin (super-admin)',
    userId: 'super-admin-user',
    roles: ['super-admin', 'user'],
    organizations: [], // Global admins don't need org membership
    expectedRows: 4, // ALL rows
    description: 'Should see ALL data (bypass)',
  },
  {
    name: 'Global Admin (system-admin)',
    userId: 'system-admin-user',
    roles: ['system-admin'],
    organizations: [],
    expectedRows: 4, // ALL rows
    description: 'Should see ALL data (bypass)',
  },
  {
    name: 'Global Admin (perfana-admin)',
    userId: 'perfana-admin-user',
    roles: ['perfana-admin'],
    organizations: [],
    expectedRows: 4, // ALL rows
    description: 'Should see ALL data (bypass)',
  },
  {
    name: 'User with No Organization',
    userId: 'no-org-user',
    roles: ['user'],
    organizations: [],
    expectedRows: 1, // Only NULL org
    description: 'Should only see NULL org data',
  },
  {
    name: 'Resource Owner without Org Membership',
    userId: 'user-org2', // Owner of Org 2 resources
    roles: ['user'],
    organizations: [], // No org membership
    expectedRows: 2, // 1 owned + 1 NULL org
    description: 'Owner can access own resources + NULL org',
  },
];

async function setupTestData(client) {
  console.log('\n📋 Setting up test data...');

  // Create test organizations (ignore conflicts)
  try {
    await client.query(`
      INSERT INTO organizations (id, name, slug, created_at, updated_at)
      VALUES
        ('${ORG_1}', 'Test Org 1', 'test-org-1', NOW(), NOW()),
        ('${ORG_2}', 'Test Org 2', 'test-org-2', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
  } catch (e) {
    console.log('  ⚠️  Organizations table may not exist or has different schema');
  }

  // Create test runs
  await client.query(`
    INSERT INTO test_runs (
      id, test_run_id, test_environment, workload,
      system_under_test_id, start_time, end_time, status,
      organization_id, created_by, created_at, updated_at
    )
    VALUES
      (
        '10000001-0000-0000-0000-000000000001',
        'rls-test-run-org1-1', 'rls-test', 'verification',
        '00000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '1 hour', NOW(), 'COMPLETED',
        '${ORG_1}', 'user-org1', NOW(), NOW()
      ),
      (
        '10000001-0000-0000-0000-000000000002',
        'rls-test-run-org1-2', 'rls-test', 'verification',
        '00000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'COMPLETED',
        '${ORG_1}', 'user-org1', NOW(), NOW()
      ),
      (
        '20000001-0000-0000-0000-000000000001',
        'rls-test-run-org2-1', 'rls-test', 'verification',
        '00000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '30 minutes', NOW(), 'COMPLETED',
        '${ORG_2}', 'user-org2', NOW(), NOW()
      ),
      (
        '30000001-0000-0000-0000-000000000001',
        'rls-test-run-no-org', 'rls-test', 'verification',
        '00000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '15 minutes', NOW(), 'COMPLETED',
        NULL, 'legacy-user', NOW(), NOW()
      )
    ON CONFLICT (id) DO NOTHING
  `);

  console.log('  ✅ Test data created');
}

async function cleanupTestData(client) {
  console.log('\n🧹 Cleaning up test data...');

  await client.query(`DELETE FROM test_runs WHERE test_run_id LIKE 'rls-test-run%'`);

  try {
    await client.query(`
      DELETE FROM organizations WHERE id IN ('${ORG_1}', '${ORG_2}')
    `);
  } catch (e) {
    // Ignore if table doesn't exist or other references
  }

  console.log('  ✅ Test data cleaned up');
}

async function verifyRLSEnabled(client) {
  console.log('\n📋 Verifying RLS is enabled on test_runs...');

  const result = await client.query(`
    SELECT relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
    FROM pg_class WHERE relname = 'test_runs'
  `);

  if (result.rows.length === 0) {
    throw new Error('test_runs table not found');
  }

  const { rls_enabled, rls_forced } = result.rows[0];

  if (!rls_enabled) {
    throw new Error('RLS is NOT enabled on test_runs table');
  }

  console.log(`  ✅ RLS enabled: ${rls_enabled}`);
  console.log(`  ✅ RLS forced: ${rls_forced}`);

  // Verify policies exist
  const policies = await client.query(`
    SELECT polname FROM pg_policy p
    JOIN pg_class c ON p.polrelid = c.oid
    WHERE c.relname = 'test_runs'
    ORDER BY polname
  `);

  console.log(`  ✅ Policies found: ${policies.rows.length}`);
  for (const row of policies.rows) {
    console.log(`     - ${row.polname}`);
  }
}

async function runTest(client, test) {
  // Start a transaction to scope session variables
  await client.query('BEGIN');

  try {
    await setSessionVariables(client, test.userId, test.roles, test.organizations);

    const rows = await queryTestRuns(client);
    const passed = rows.length === test.expectedRows;

    if (passed) {
      console.log(`  ✅ PASS: Got ${rows.length} rows (expected ${test.expectedRows})`);
    } else {
      console.log(`  ❌ FAIL: Got ${rows.length} rows (expected ${test.expectedRows})`);
      console.log('     Rows returned:');
      for (const row of rows) {
        console.log(`       - ${row.test_run_id} (org: ${row.organization_id || 'NULL'})`);
      }
    }

    return passed;
  } finally {
    await client.query('ROLLBACK');
  }
}

async function testUnauthenticatedAccess(client) {
  console.log('\n📋 Test: Unauthenticated Access (no session variables)');
  console.log('   Expected: 0 rows (fail-safe behavior)');

  await client.query('BEGIN');

  try {
    await resetSessionVariables(client);

    const rows = await queryTestRuns(client);
    const passed = rows.length === 0;

    if (passed) {
      console.log(`  ✅ PASS: Got ${rows.length} rows (access denied as expected)`);
    } else {
      console.log(`  ❌ FAIL: Got ${rows.length} rows (should be 0 - fail-safe not working!)`);
    }

    return passed;
  } finally {
    await client.query('ROLLBACK');
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('RLS VERIFICATION TEST SUITE');
  console.log('='.repeat(70));
  console.log(`Database: ${config.database}@${config.host}:${config.port}`);

  const client = new Client(config);

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Verify RLS is enabled
    await verifyRLSEnabled(client);

    // Setup test data
    await setupTestData(client);

    // Run tests
    console.log('\n' + '='.repeat(70));
    console.log('RUNNING RLS TESTS');
    console.log('='.repeat(70));

    const results = [];

    for (const test of tests) {
      console.log(`\n📋 Test: ${test.name}`);
      console.log(`   ${test.description}`);
      console.log(`   User: ${test.userId}, Roles: ${JSON.stringify(test.roles)}`);
      console.log(`   Organizations: ${JSON.stringify(test.organizations)}`);
      console.log(`   Expected: ${test.expectedRows} rows`);

      const passed = await runTest(client, test);
      results.push({ name: test.name, passed });
    }

    // Test unauthenticated access
    const unauthPassed = await testUnauthenticatedAccess(client);
    results.push({ name: 'Unauthenticated Access', passed: unauthPassed });

    // Cleanup
    await cleanupTestData(client);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    for (const result of results) {
      console.log(`  ${result.passed ? '✅' : '❌'} ${result.name}`);
    }

    console.log('\n' + '-'.repeat(70));
    console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('='.repeat(70));

    if (failed > 0) {
      console.log('\n❌ RLS VERIFICATION FAILED');
      console.log('   Some tests did not pass. Review the output above.');
      process.exit(1);
    } else {
      console.log('\n✅ RLS VERIFICATION PASSED');
      console.log('   All tests passed. RLS is working correctly.');
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
