-- =============================================================================
-- RLS Verification Script: Cross-Organization Access Blocking
-- =============================================================================
-- This script verifies that Row-Level Security (RLS) policies correctly:
-- 1. Block access to resources from different organizations
-- 2. Allow global admin access to all resources
-- 3. Allow owner access to their own resources
-- 4. Allow access to resources with NULL organization_id (legacy data)
--
-- USAGE:
--   PGPASSWORD=perfana psql -h localhost -p 5432 -U perfana -d perfana_native -f rls-verification.sql
--
-- Or run each section manually in psql/pgAdmin
-- =============================================================================

\echo '============================================================================='
\echo 'RLS VERIFICATION TEST SUITE'
\echo '============================================================================='
\echo ''

-- =============================================================================
-- SECTION 1: Setup Test Data
-- =============================================================================
\echo 'SECTION 1: Setting up test data...'
\echo ''

-- Create test organizations
INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Test Org 1', 'test-org-1', NOW(), NOW()),
  ('22222222-2222-2222-2222-222222222222', 'Test Org 2', 'test-org-2', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create test test_runs in each organization
INSERT INTO test_runs (
  id, test_run_id, test_environment, workload,
  system_under_test_id, start_time, end_time, status,
  organization_id, created_by, created_at, updated_at
)
VALUES
  (
    '10000001-0000-0000-0000-000000000001',
    'rls-test-run-org1-1',
    'rls-test',
    'verification',
    '00000000-0000-0000-0000-000000000001',
    NOW() - INTERVAL '1 hour',
    NOW(),
    'COMPLETED',
    '11111111-1111-1111-1111-111111111111',  -- Org 1
    'user-org1',
    NOW(), NOW()
  ),
  (
    '10000001-0000-0000-0000-000000000002',
    'rls-test-run-org1-2',
    'rls-test',
    'verification',
    '00000000-0000-0000-0000-000000000001',
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '1 hour',
    'COMPLETED',
    '11111111-1111-1111-1111-111111111111',  -- Org 1
    'user-org1',
    NOW(), NOW()
  ),
  (
    '20000001-0000-0000-0000-000000000001',
    'rls-test-run-org2-1',
    'rls-test',
    'verification',
    '00000000-0000-0000-0000-000000000001',
    NOW() - INTERVAL '30 minutes',
    NOW(),
    'COMPLETED',
    '22222222-2222-2222-2222-222222222222',  -- Org 2
    'user-org2',
    NOW(), NOW()
  ),
  (
    '30000001-0000-0000-0000-000000000001',
    'rls-test-run-no-org',
    'rls-test',
    'verification',
    '00000000-0000-0000-0000-000000000001',
    NOW() - INTERVAL '15 minutes',
    NOW(),
    'COMPLETED',
    NULL,  -- No organization (legacy data)
    'legacy-user',
    NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;

\echo 'Test data setup complete.'
\echo ''

-- =============================================================================
-- SECTION 2: Verify RLS is enabled
-- =============================================================================
\echo '============================================================================='
\echo 'SECTION 2: Verify RLS is enabled on test_runs table'
\echo '============================================================================='

SELECT
  relname as table_name,
  relrowsecurity as rls_enabled,
  relforcerowsecurity as rls_forced
FROM pg_class
WHERE relname = 'test_runs';

-- Count policies on test_runs
SELECT
  polname as policy_name,
  CASE polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    ELSE polcmd::text
  END as operation
FROM pg_policy p
JOIN pg_class c ON p.polrelid = c.oid
WHERE c.relname = 'test_runs'
ORDER BY polname;

\echo ''

-- =============================================================================
-- SECTION 3: Test as Regular User in Org 1 (should only see Org 1 data)
-- =============================================================================
\echo '============================================================================='
\echo 'SECTION 3: Test as Regular User in Org 1'
\echo '============================================================================='
\echo 'User: user-org1'
\echo 'Roles: ["user", "org-member"]'
\echo 'Organizations: ["11111111-1111-1111-1111-111111111111"]'
\echo ''

-- Set session variables for User in Org 1
SET LOCAL app.current_user_id = 'user-org1';
SET LOCAL app.current_user_roles = '["user", "org-member"]';
SET LOCAL app.current_user_organizations = '["11111111-1111-1111-1111-111111111111"]';
SET LOCAL app.current_user_teams = '[]';

\echo 'Session variables set. Querying test_runs...'
\echo ''

-- Query test_runs - should only see Org 1 test runs + legacy (NULL org) test runs
SELECT
  id,
  test_run_id,
  organization_id,
  created_by,
  CASE
    WHEN organization_id = '11111111-1111-1111-1111-111111111111' THEN 'Org 1 (Expected: ✓)'
    WHEN organization_id = '22222222-2222-2222-2222-222222222222' THEN 'Org 2 (Expected: ✗)'
    WHEN organization_id IS NULL THEN 'No Org (Expected: ✓)'
    ELSE 'Other'
  END as expected_access
FROM test_runs
WHERE test_run_id LIKE 'rls-test-run%'
ORDER BY organization_id NULLS LAST, test_run_id;

\echo ''
\echo 'Expected: Should see 3 rows (2 from Org 1 + 1 with NULL org)'
\echo 'If you see 4 rows (including Org 2), RLS is NOT working!'
\echo ''

-- Reset session variables
RESET app.current_user_id;
RESET app.current_user_roles;
RESET app.current_user_organizations;
RESET app.current_user_teams;

-- =============================================================================
-- SECTION 4: Test as Regular User in Org 2 (should only see Org 2 data)
-- =============================================================================
\echo '============================================================================='
\echo 'SECTION 4: Test as Regular User in Org 2'
\echo '============================================================================='
\echo 'User: user-org2'
\echo 'Roles: ["user", "org-member"]'
\echo 'Organizations: ["22222222-2222-2222-2222-222222222222"]'
\echo ''

-- Set session variables for User in Org 2
SET LOCAL app.current_user_id = 'user-org2';
SET LOCAL app.current_user_roles = '["user", "org-member"]';
SET LOCAL app.current_user_organizations = '["22222222-2222-2222-2222-222222222222"]';
SET LOCAL app.current_user_teams = '[]';

\echo 'Session variables set. Querying test_runs...'
\echo ''

-- Query test_runs - should only see Org 2 test runs + legacy (NULL org) test runs
SELECT
  id,
  test_run_id,
  organization_id,
  created_by,
  CASE
    WHEN organization_id = '11111111-1111-1111-1111-111111111111' THEN 'Org 1 (Expected: ✗)'
    WHEN organization_id = '22222222-2222-2222-2222-222222222222' THEN 'Org 2 (Expected: ✓)'
    WHEN organization_id IS NULL THEN 'No Org (Expected: ✓)'
    ELSE 'Other'
  END as expected_access
FROM test_runs
WHERE test_run_id LIKE 'rls-test-run%'
ORDER BY organization_id NULLS LAST, test_run_id;

\echo ''
\echo 'Expected: Should see 2 rows (1 from Org 2 + 1 with NULL org)'
\echo 'If you see more rows (including Org 1), RLS is NOT working!'
\echo ''

-- Reset session variables
RESET app.current_user_id;
RESET app.current_user_roles;
RESET app.current_user_organizations;
RESET app.current_user_teams;

-- =============================================================================
-- SECTION 5: Test as Global Admin (should see ALL data)
-- =============================================================================
\echo '============================================================================='
\echo 'SECTION 5: Test as Global Admin (super-admin)'
\echo '============================================================================='
\echo 'User: super-admin-user'
\echo 'Roles: ["super-admin", "user"]'
\echo 'Organizations: []  (global admins do not need org membership)'
\echo ''

-- Set session variables for Global Admin
SET LOCAL app.current_user_id = 'super-admin-user';
SET LOCAL app.current_user_roles = '["super-admin", "user"]';
SET LOCAL app.current_user_organizations = '[]';
SET LOCAL app.current_user_teams = '[]';

\echo 'Session variables set. Querying test_runs...'
\echo ''

-- Query test_runs - should see ALL test runs
SELECT
  id,
  test_run_id,
  organization_id,
  created_by,
  CASE
    WHEN organization_id = '11111111-1111-1111-1111-111111111111' THEN 'Org 1 (Expected: ✓)'
    WHEN organization_id = '22222222-2222-2222-2222-222222222222' THEN 'Org 2 (Expected: ✓)'
    WHEN organization_id IS NULL THEN 'No Org (Expected: ✓)'
    ELSE 'Other (Expected: ✓)'
  END as expected_access
FROM test_runs
WHERE test_run_id LIKE 'rls-test-run%'
ORDER BY organization_id NULLS LAST, test_run_id;

\echo ''
\echo 'Expected: Should see ALL 4 rows (2 Org 1 + 1 Org 2 + 1 NULL org)'
\echo 'If you see fewer rows, global admin bypass is NOT working!'
\echo ''

-- Reset session variables
RESET app.current_user_id;
RESET app.current_user_roles;
RESET app.current_user_organizations;
RESET app.current_user_teams;

-- =============================================================================
-- SECTION 6: Test as User with No Organization (should only see NULL org data)
-- =============================================================================
\echo '============================================================================='
\echo 'SECTION 6: Test as User with No Organization Membership'
\echo '============================================================================='
\echo 'User: no-org-user'
\echo 'Roles: ["user"]'
\echo 'Organizations: []'
\echo ''

-- Set session variables for User with no org
SET LOCAL app.current_user_id = 'no-org-user';
SET LOCAL app.current_user_roles = '["user"]';
SET LOCAL app.current_user_organizations = '[]';
SET LOCAL app.current_user_teams = '[]';

\echo 'Session variables set. Querying test_runs...'
\echo ''

-- Query test_runs - should ONLY see legacy (NULL org) test runs
SELECT
  id,
  test_run_id,
  organization_id,
  created_by,
  CASE
    WHEN organization_id = '11111111-1111-1111-1111-111111111111' THEN 'Org 1 (Expected: ✗)'
    WHEN organization_id = '22222222-2222-2222-2222-222222222222' THEN 'Org 2 (Expected: ✗)'
    WHEN organization_id IS NULL THEN 'No Org (Expected: ✓)'
    ELSE 'Other'
  END as expected_access
FROM test_runs
WHERE test_run_id LIKE 'rls-test-run%'
ORDER BY organization_id NULLS LAST, test_run_id;

\echo ''
\echo 'Expected: Should see ONLY 1 row (NULL org)'
\echo 'If you see more rows, RLS is NOT working!'
\echo ''

-- Reset session variables
RESET app.current_user_id;
RESET app.current_user_roles;
RESET app.current_user_organizations;
RESET app.current_user_teams;

-- =============================================================================
-- SECTION 7: Test as Resource Owner (should see own resources)
-- =============================================================================
\echo '============================================================================='
\echo 'SECTION 7: Test as Resource Owner (created_by match)'
\echo '============================================================================='
\echo 'User: user-org2  (owns resources in Org 2)'
\echo 'Roles: ["user"]  (no org membership)'
\echo 'Organizations: []  (not in any org)'
\echo ''
\echo 'Testing if owner can access their own resources even without org membership'
\echo ''

-- Set session variables for Owner without org membership
SET LOCAL app.current_user_id = 'user-org2';
SET LOCAL app.current_user_roles = '["user"]';
SET LOCAL app.current_user_organizations = '[]';  -- No org membership
SET LOCAL app.current_user_teams = '[]';

\echo 'Session variables set. Querying test_runs...'
\echo ''

-- Query test_runs - owner should see their own resources + NULL org
SELECT
  id,
  test_run_id,
  organization_id,
  created_by,
  CASE
    WHEN created_by = 'user-org2' THEN 'Owner (Expected: ✓)'
    WHEN organization_id IS NULL THEN 'No Org (Expected: ✓)'
    ELSE 'Not Owner (Expected: ✗)'
  END as expected_access
FROM test_runs
WHERE test_run_id LIKE 'rls-test-run%'
ORDER BY organization_id NULLS LAST, test_run_id;

\echo ''
\echo 'Expected: Should see 2 rows (1 owned by user-org2 + 1 NULL org)'
\echo ''

-- Reset session variables
RESET app.current_user_id;
RESET app.current_user_roles;
RESET app.current_user_organizations;
RESET app.current_user_teams;

-- =============================================================================
-- SECTION 8: Test Unauthenticated Access (no session variables)
-- =============================================================================
\echo '============================================================================='
\echo 'SECTION 8: Test Unauthenticated Access (no session variables)'
\echo '============================================================================='
\echo 'No session variables set - simulating unauthenticated request'
\echo ''

-- Ensure no session variables are set
RESET app.current_user_id;
RESET app.current_user_roles;
RESET app.current_user_organizations;
RESET app.current_user_teams;

\echo 'Session variables cleared. Querying test_runs...'
\echo ''

-- Query test_runs - should see NOTHING (fail-safe behavior)
SELECT
  id,
  test_run_id,
  organization_id,
  created_by
FROM test_runs
WHERE test_run_id LIKE 'rls-test-run%'
ORDER BY organization_id NULLS LAST, test_run_id;

\echo ''
\echo 'Expected: Should see 0 rows (unauthenticated access denied)'
\echo 'If you see any rows, RLS fail-safe is NOT working!'
\echo ''

-- =============================================================================
-- SECTION 9: Cleanup Test Data
-- =============================================================================
\echo '============================================================================='
\echo 'SECTION 9: Cleanup Test Data'
\echo '============================================================================='

-- Delete test runs
DELETE FROM test_runs WHERE test_run_id LIKE 'rls-test-run%';

-- Delete test organizations (only if no other resources reference them)
DELETE FROM organizations WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

\echo 'Test data cleaned up.'
\echo ''

-- =============================================================================
-- SUMMARY
-- =============================================================================
\echo '============================================================================='
\echo 'RLS VERIFICATION SUMMARY'
\echo '============================================================================='
\echo ''
\echo 'Test scenarios verified:'
\echo '  1. User in Org 1: Can only see Org 1 data + NULL org data'
\echo '  2. User in Org 2: Can only see Org 2 data + NULL org data'
\echo '  3. Global Admin: Can see ALL data (bypass)'
\echo '  4. User with no org: Can only see NULL org data'
\echo '  5. Resource Owner: Can see own resources + NULL org data'
\echo '  6. Unauthenticated: Cannot see any data (fail-safe)'
\echo ''
\echo 'If all tests passed as expected, RLS is working correctly!'
\echo '============================================================================='
