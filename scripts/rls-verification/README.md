# RLS Verification Scripts

This directory contains scripts to verify that Row-Level Security (RLS) policies are working correctly.

## Overview

These scripts test that RLS policies correctly:
1. Block access to resources from different organizations
2. Allow global admin access to all resources
3. Allow owner access to their own resources
4. Allow access to resources with NULL organization_id (legacy data)

## Prerequisites

- PostgreSQL database with RLS migrations applied (1776000000005-1776000000007)
- Database credentials (default: perfana/perfana@localhost:5432/perfana_native)

## Usage

### Option 1: SQL Script (psql)

```bash
PGPASSWORD=perfana psql -h localhost -p 5432 -U perfana -d perfana_native \
  -f scripts/rls-verification/rls-verification.sql
```

### Option 2: Node.js Script

```bash
# From project root
DB_HOST=localhost DB_PORT=5432 DB_USERNAME=perfana DB_PASSWORD=perfana DB_NAME=perfana_native \
  node scripts/rls-verification/rls-verification.js

# Or from packages/shared
cd packages/shared
node ../../scripts/rls-verification/rls-verification.js
```

## Test Scenarios

| Scenario | Session Variables | Expected Result |
|----------|-------------------|-----------------|
| User in Org 1 | `app.current_user_organizations='["org1-uuid"]'` | See only Org 1 + NULL org data |
| User in Org 2 | `app.current_user_organizations='["org2-uuid"]'` | See only Org 2 + NULL org data |
| Global Admin (super-admin) | `app.current_user_roles='["super-admin"]'` | See ALL data |
| Global Admin (system-admin) | `app.current_user_roles='["system-admin"]'` | See ALL data |
| Global Admin (perfana-admin) | `app.current_user_roles='["perfana-admin"]'` | See ALL data |
| User with No Org | `app.current_user_organizations='[]'` | See only NULL org data |
| Resource Owner | `app.current_user_id='owner-id'` | See own resources + NULL org |
| Unauthenticated | (no session vars) | See 0 rows (fail-safe) |

## RLS Helper Functions

The scripts verify these PostgreSQL functions:

| Function | Description |
|----------|-------------|
| `current_user_id()` | Returns `app.current_user_id` session variable |
| `is_global_admin()` | Checks for super-admin, system-admin, or perfana-admin roles |
| `current_user_organizations()` | Returns UUID[] of user's organizations |
| `current_user_teams()` | Returns UUID[] of user's teams |
| `can_access_resource(UUID, UUID, TEXT)` | Read access check |
| `can_modify_resource(UUID, UUID, TEXT)` | Write access check |

## Expected Output

Successful verification should show:
- RLS enabled on all tables (with FORCE)
- 4 policies per table (select, insert, update, delete)
- All test scenarios passing as expected

## Troubleshooting

If tests fail:
1. Verify RLS migrations were applied: `SELECT * FROM migrations WHERE name LIKE '%RLS%'`
2. Check RLS is enabled: `SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'test_runs'`
3. Check policies exist: `SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid WHERE c.relname = 'test_runs'`
