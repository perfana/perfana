# Organization Filtering Comprehensive Audit

## Executive Summary

### Current Architecture
**test_runs table does NOT have organization_id** - All filtering works through:
- JOIN with `systems_under_test` table (which HAS organization_id)
- Filter: `sut.organization_id IN (user's organizations)`

### Tables with organization_id Column (6 tables)
| Table | Status | Notes |
|-------|--------|-------|
| ✅ `api_keys` | **IMPLEMENTED** | Direct organization_id filtering |
| ✅ `systems_under_test` | **IMPLEMENTED** | Core table for all test_run filtering |
| ✅ `audit_logs` | N/A | Admin-only, no filtering needed |
| ✅ `data_sources` | TBD | Need to verify usage |
| ✅ `organization_members` | N/A | Membership table |
| ✅ `teams` | **IMPLEMENTED** | Belongs to organization |

### Critical Services - Organization Filtering Status

#### ✅ FULLY IMPLEMENTED (via systems_under_test JOIN)

**Test Runs Module** (All services filter via sut.organization_id):
- ✅ test-runs-query.service.ts
- ✅ test-runs-dashboard-query.service.ts
- ✅ test-runs-crud-query.service.ts
- ✅ test-runs-performance-query.service.ts
- ✅ test-runs-timeseries-query.service.ts
- ✅ test-runs-anomaly.service.ts
- ✅ test-runs-apdex.service.ts
- ✅ test-runs-baseline-apdex.service.ts
- ✅ test-runs-changepoint.service.ts
- ✅ test-runs-config.service.ts
- ✅ test-runs-metrics.service.ts
- ✅ test-runs-stale-detection.service.ts
- ✅ test-runs-mutation.service.ts

**Core Resource Services** (Direct organization_id filtering):
- ✅ systems-under-test.service.ts
- ✅ api-keys.service.ts
- ✅ teams.service.ts
- ✅ organizations.service.ts
- ✅ organization-members.service.ts
- ✅ team-members.service.ts

**Integration Services** (Filter via systems_under_test):
- ✅ grafana-dashboards.service.ts
- ✅ grafana-instances.service.ts
- ✅ application-dashboards.service.ts
- ✅ tracing-instances.service.ts
- ✅ tracing-services.service.ts
- ✅ pyroscope-instances.service.ts
- ✅ dynatrace.service.ts

**Other Services** (Filter via systems_under_test):
- ✅ profiles.service.ts
- ✅ deep-links.service.ts
- ✅ compare-presets.service.ts
- ✅ graph-presets.service.ts
- ✅ reports (report-generation.service.ts)
- ✅ adapt.service.ts

**Benchmarks** (Filter via system_under_test.organization_id):
- ✅ benchmark-query.service.ts - **FIXED** - Filters via sut.organization_id
- ✅ benchmark-mutation.service.ts - **FIXED** - Validates system access before create/update/delete
- ✅ benchmark-calculator.service.ts - Works on already-filtered data

#### ⚠️ TODO: Need organization_id Column (Phase 4)

These services have TODO comments indicating filtering will be added when entity gets organization_id:

**Other Resources Without organization_id**:
- ⚠️ notification-channels (notifications.service.ts)
- ⚠️ trends-presets (trends-presets.service.ts)
- ⚠️ report-templates (report-template.service.ts)
- ⚠️ generic-deep-links
- ⚠️ url-patterns
- ⚠️ dynatrace-configs/queries/mappings (partially implemented via sut)
- ⚠️ expected-config-changes

#### ℹ️ N/A - No Filtering Needed

**Analysis/Calculation Services** (Work on already-filtered data):
- data-science services (bullmq-client, job-progress)
- awr services (awr-analysis, awr-parser, etc.)
- trace-analysis services
- tempo.service.ts
- pyroscope-analysis.service.ts
- metrics.service.ts

**Infrastructure Services** (Not resource-specific):
- auth services (keycloak-admin, keycloak-jwt)
- queue.service.ts
- realtime.service.ts
- audit.service.ts

## Critical Findings

### ✅ GOOD NEWS
1. **All test_runs queries properly filter** via sut.organization_id JOIN
2. **Dashboard fixed** - The critical `.where()` → `.andWhere()` bug is resolved
3. **API keys now filter** by organization_id
4. **Core resources filter** (systems, teams, orgs)
5. **Benchmarks now filter** via sut.organization_id JOIN - **JUST FIXED** ✅

### ⚠️ SECURITY GAPS (Non-Critical)

**Notification Channels** - No filtering yet:
- **Risk**: Low - Only admins can create/modify
- **Mitigation**: Protected by @AdminOnly decorator
- **Fix**: Phase 4 - Add organization_id

**Report Templates** - Global templates:
- **Risk**: None - Templates are meant to be shared
- **Design**: Intentionally global per comments in entity

## Verification Commands

### Check Test Runs Filtering
```sql
-- User's organizations
SELECT organization_id FROM organization_members WHERE user_id = 'YOUR_USER_ID';

-- Systems in user's orgs
SELECT id, name, organization_id FROM systems_under_test
WHERE organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = 'YOUR_USER_ID');

-- Test runs via systems (should match systems above)
SELECT DISTINCT tr.id, tr.test_run_id, sut.name, sut.organization_id
FROM test_runs tr
JOIN systems_under_test sut ON tr.system_under_test_id = sut.id
WHERE sut.organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = 'YOUR_USER_ID')
LIMIT 10;
```

### Check API Keys Filtering
```sql
SELECT id, description, organization_id
FROM api_keys
WHERE organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = 'YOUR_USER_ID');
```

### Check Benchmarks (Currently NOT filtered - known gap)
```sql
-- This shows ALL benchmarks (Phase 4 will fix)
SELECT id, name, system_under_test_id FROM benchmarks;
```

## Recommendations

### Immediate (Already Done)
- ✅ Test Runs - All services filter via sut.organization_id
- ✅ API Keys - Direct organization_id filtering
- ✅ Systems Under Test - Direct organization_id filtering
- ✅ Dashboard - Fixed .where() → .andWhere() bug
- ✅ Benchmarks - Filter via sut.organization_id - **JUST COMPLETED** 🎉

### Phase 4 (Database Schema Changes Required)
1. **Add organization_id to notification_channels table**
   - Currently admin-only, low priority

3. **Add organization_id to other resource tables**
   - trends_filter_presets
   - dynatrace_configs/queries/mappings
   - expected_config_changes

## Testing Checklist

Test with non-admin user in single organization:

- [ ] Dashboard shows only org's test runs (0 if org is empty)
- [ ] Test runs list shows only org's test runs
- [ ] Systems list shows only org's systems
- [ ] API keys list shows only org's keys
- [ ] Team list shows only org's teams
- [ ] Grafana dashboards filtered by org's systems
- [ ] Reports filtered by org's systems
- [ ] Deep links filtered by org's systems
- [ ] Cannot access other org's resources via direct ID

Test with admin user:
- [ ] Can see all organizations' data
- [ ] Can access any resource by ID
