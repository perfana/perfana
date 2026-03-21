# Test Coverage Implementation Checklist

**Track your progress from 0.9% to 80% coverage**

## Legend
- 🔴 Not Started (0% coverage)
- 🟡 In Progress (1-79% coverage)
- 🟢 Complete (80%+ coverage)
- ⚡ High Priority (P0)
- 🔥 Medium Priority (P1)
- 📝 Low Priority (P2-P3)

---

## Phase 1: Critical Security & Core Logic (Target: 30%)

### Week 1: Authentication & Authorization

#### API Guards (⚡ P0 - CRITICAL)
- [ ] 🔴 `apps/api/src/guards/keycloak-enhanced-auth.guard.spec.ts` (NEW - 200 lines)
  - Test: Valid Keycloak JWT auth
  - Test: Valid API key auth
  - Test: Public route bypass
  - Test: Missing auth header
  - Test: Invalid token
  - Test: Token expiration
  - Test: Role validation
  - Test: Admin role check

- [ ] 🔴 `apps/api/src/guards/api-key.guard.spec.ts` (NEW - 150 lines)
  - Test: Valid API key
  - Test: Invalid API key
  - Test: Expired API key
  - Test: TTL validation
  - Test: Description parsing

- [x] 🟢 `apps/api/src/guards/enhanced-throttler.guard.spec.ts` (EXISTS - Good coverage)

- [x] 🟢 `apps/api/src/guards/throttler-storage-redis.service.spec.ts` (EXISTS - Good coverage)

#### Auth Module (⚡ P0)
- [ ] 🟡 `apps/api/src/modules/auth/auth.controller.spec.ts` (EXISTS - Needs enhancement)
  - Add: Token validation tests
  - Add: User info tests
  - Add: Token refresh tests
  - Add: Logout tests

- [ ] 🔴 `apps/api/src/modules/auth/keycloak-jwt.service.spec.ts` (NEW - 200 lines)
  - Test: Token validation
  - Test: Token refresh
  - Test: User extraction
  - Test: Role extraction
  - Test: Error handling

#### API Keys Module (⚡ P0)
- [x] 🟢 `apps/api/src/modules/api-keys/api-keys.service.spec.ts` (EXISTS - Good coverage)
- [x] 🟢 `apps/api/src/modules/api-keys/api-keys.controller.spec.ts` (EXISTS - Good coverage)
- [x] 🟢 `apps/api/src/modules/api-keys/api-key-cache.service.spec.ts` (EXISTS - Good coverage)

#### Frontend Auth (⚡ P0 - CRITICAL)
- [ ] 🔴 `apps/web/lib/__tests__/keycloak-auth.test.ts` (NEW - 200 lines)
  - Test: Keycloak initialization
  - Test: Login flow
  - Test: Logout flow
  - Test: Token refresh
  - Test: Token storage
  - Test: Auto-refresh on expiry

- [ ] 🟡 `apps/web/lib/__tests__/api.test.ts` (EXISTS - Empty, needs full implementation)
  - Test: authenticatedFetch with token
  - Test: 401 retry logic
  - Test: Token refresh and retry
  - Test: Error handling
  - Test: Request headers

### Week 2: Core Business Logic

#### Test Runs Module (⚡ P0)
- [x] 🟢 `apps/api/src/modules/test-runs/test-runs.service.spec.ts` (EXISTS - Good coverage)
- [x] 🟢 `apps/api/src/modules/test-runs/test-runs.repository.spec.ts` (EXISTS - Good coverage)
- [x] 🟢 `apps/api/src/modules/test-runs/test-runs-config.service.spec.ts` (EXISTS - Good coverage)

- [ ] 🔴 `apps/api/src/modules/test-runs/test-runs.controller.spec.ts` (NEW - 200 lines)
  - Test: GET /test-runs (list)
  - Test: GET /test-runs/:id (single)
  - Test: POST /test (create/update)
  - Test: DELETE /test-runs/:id
  - Test: Query parameters
  - Test: Pagination
  - Test: Filtering

- [ ] 🔴 `apps/api/src/modules/test-runs/test-runs-config.controller.spec.ts` (NEW - 200 lines)
  - Test: POST /test-config (single)
  - Test: POST /test-configs (multiple)
  - Test: POST /test-config-json (import)
  - Test: GET /test-runs/:id/configs
  - Test: Expected config changes
  - Test: Include/exclude patterns

#### DTOs (🟢 Mostly complete)
- [x] 🟢 `apps/api/src/modules/test-runs/dto/test-run-config.dto.spec.ts`
- [x] 🟢 `apps/api/src/modules/test-runs/dto/update-running-test.dto.spec.ts`

### Week 3: Critical Integrations

#### Dynatrace Module (⚡ P0)
- [ ] 🔴 `apps/api/src/modules/dynatrace/dynatrace.service.spec.ts` (NEW - 300 lines)
  - Test: Create config
  - Test: Update config
  - Test: Delete config
  - Test: Test connection
  - Test: Execute query (mocked)
  - Test: URL normalization
  - Test: Error handling
  - Test: Timeout handling

- [ ] 🔴 `apps/api/src/modules/dynatrace/dynatrace.controller.spec.ts` (NEW - 200 lines)
  - Test: All CRUD endpoints
  - Test: Query endpoints
  - Test: Entity mapping endpoints
  - Test: Validation

- [ ] 🔴 `apps/api/src/modules/dynatrace/dynatrace.repository.spec.ts` (NEW - 150 lines)
  - Test: Database operations
  - Test: Query building
  - Test: Error handling

#### Grafana Module (⚡ P0)
- [ ] 🔴 `apps/api/src/modules/grafana/grafana-client.service.spec.ts` (NEW - 200 lines)
  - Test: API communication (mocked)
  - Test: Dashboard operations
  - Test: Authentication
  - Test: Error handling
  - Test: Timeout handling

- [ ] 🔴 `apps/api/src/modules/grafana/grafana-dashboards.service.spec.ts` (NEW - 250 lines)
  - Test: Dashboard sync
  - Test: Dashboard CRUD
  - Test: Filtering
  - Test: Folder operations
  - Test: Tag operations

- [ ] 🔴 `apps/api/src/modules/grafana/grafana-instances.service.spec.ts` (NEW - 150 lines)
  - Test: Instance CRUD
  - Test: Connection testing
  - Test: Instance validation

- [ ] 🔴 `apps/api/src/modules/grafana/application-dashboards.service.spec.ts` (NEW - 200 lines)
  - Test: Application config CRUD
  - Test: Dashboard associations
  - Test: Snapshot generation
  - Test: Auto-configuration

#### Validators (🟢 Excellent coverage!)
- [x] 🟢 `apps/api/src/common/validators/config-key.validator.spec.ts`
- [x] 🟢 `apps/api/src/common/validators/iso-date.validator.spec.ts`
- [x] 🟢 `apps/api/src/common/validators/json-depth.validator.spec.ts`
- [x] 🟢 `apps/api/src/common/validators/safe-regex.validator.spec.ts`
- [x] 🟢 `apps/api/src/common/validators/test-run-id.validator.spec.ts`

#### Common (🟢 Good coverage)
- [x] 🟢 `apps/api/src/common/filters/global-exception.filter.spec.ts`

---

## Phase 2: Data Science & Complex Features (Target: 60%)

### Week 4-5: Data Science & Worker

#### Data Science Module (⚡ P0)
- [ ] 🔴 `apps/api/src/modules/data-science/services/bullmq-client.service.spec.ts` (NEW - 200 lines)
  - Test: Job queue operations
  - Test: Job status tracking
  - Test: Error handling
  - Test: Retry logic

- [ ] 🔴 `apps/api/src/modules/data-science/controllers/data-science.controller.spec.ts` (NEW - 200 lines)
  - Test: Batch processing endpoints
  - Test: Analysis endpoints
  - Test: Re-evaluation endpoints
  - Test: Job status endpoints

#### Worker Service (🔥 P1)
- [x] 🟢 `apps/worker/src/test/unit/lib/grafana-client.test.ts` (EXISTS)
- [x] 🟢 `apps/worker/src/test/unit/metrics-pipeline-validation.test.ts` (EXISTS)
- [x] 🟢 `apps/worker/src/test/unit/metrics-pipeline-with-mock.test.ts` (EXISTS)
- [x] 🟢 `apps/worker/src/test/unit/pipelines/AdaptPipeline.test.ts` (EXISTS)
- [x] 🟢 `apps/worker/src/test/unit/pipelines/PanelsPipeline.test.ts` (EXISTS)
- [x] 🟢 `apps/worker/src/test/unit/pipelines/panels-helpers.test.ts` (EXISTS)
- [x] 🟢 `apps/worker/src/test/unit/queue/pgboss-orchestrator.test.ts` (EXISTS)

- [ ] 🔴 `apps/worker/src/test/unit/pipelines/error-handling.test.ts` (NEW - 200 lines)
  - Test: Pipeline error recovery
  - Test: Partial failure handling
  - Test: Error propagation

- [ ] 🔴 `apps/worker/src/test/integration/queue-failure-recovery.test.ts` (NEW - 150 lines)
  - Test: Job retry logic
  - Test: Dead letter queue
  - Test: Recovery mechanisms

### Week 6: API Supporting Modules

#### Deep Links Module (🔥 P1)
- [ ] 🔴 `apps/api/src/modules/deep-links/deep-links.service.spec.ts` (NEW - 200 lines)
- [ ] 🔴 `apps/api/src/modules/deep-links/deep-links.controller.spec.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/api/src/modules/deep-links/deep-links.repository.spec.ts` (NEW - 100 lines)

#### Benchmarks Module (🔥 P1)
- [ ] 🔴 `apps/api/src/modules/benchmarks/benchmarks.service.spec.ts` (NEW - 200 lines)
- [ ] 🔴 `apps/api/src/modules/benchmarks/benchmarks.controller.spec.ts` (NEW - 150 lines)

#### Profiles Module (🔥 P1)
- [ ] 🔴 `apps/api/src/modules/profiles/profiles.service.spec.ts` (NEW - 200 lines)
- [ ] 🔴 `apps/api/src/modules/profiles/profiles.controller.spec.ts` (NEW - 150 lines)

#### Adapt Module (🔥 P1)
- [ ] 🔴 `apps/api/src/modules/adapt/adapt.service.spec.ts` (NEW - 200 lines)
- [ ] 🔴 `apps/api/src/modules/adapt/adapt.controller.spec.ts` (NEW - 150 lines)

### Week 7: Frontend Core Utilities

#### Critical Libraries (⚡ P0)
- [ ] 🔴 `apps/web/lib/__tests__/socket.test.ts` (NEW - 300 lines)
  - Test: Socket initialization
  - Test: Connection lifecycle
  - Test: Event handling
  - Test: Reconnection logic
  - Test: Error handling
  - Test: Cleanup

- [ ] 🔴 `apps/web/lib/__tests__/dynatrace.test.ts` (NEW - 200 lines)
  - Test: Query building
  - Test: Entity mapping
  - Test: API calls (mocked)
  - Test: Error handling

#### Supporting Libraries (🔥 P1)
- [ ] 🔴 `apps/web/lib/__tests__/errors.test.ts` (NEW - 150 lines)
  - Test: Error formatting
  - Test: Error extraction
  - Test: Type guards

- [ ] 🔴 `apps/web/lib/__tests__/profiles.test.ts` (NEW - 150 lines)
  - Test: Profile API calls
  - Test: Data transformation
  - Test: Error handling

---

## Phase 3: Comprehensive Coverage (Target: 80%)

### Week 8-9: React Component Testing

#### Test Infrastructure Setup
- [ ] 🔴 Create `apps/web/test/utils/test-utils.tsx`
  - Render with providers
  - Mock utilities
  - Custom matchers

- [ ] 🔴 Create `apps/web/jest.setup.js`
  - Configure testing-library
  - Set up mocks
  - Global setup

#### Test Run Components (🔥 P1)
- [ ] 🔴 `apps/web/app/test-runs/[id]/components/anomaly-detection/__tests__/TrackedRegressionsTab.test.tsx`
- [ ] 🔴 `apps/web/app/test-runs/[id]/components/anomaly-detection/__tests__/TrackedRegressionTable.test.tsx`
- [ ] 🔴 `apps/web/app/test-runs/[id]/components/anomaly-detection/__tests__/FilterControls.test.tsx`
- [ ] 🔴 `apps/web/app/test-runs/[id]/components/anomaly-detection/__tests__/TrendChart.test.tsx`
- [ ] 🔴 `apps/web/app/test-runs/[id]/components/anomaly-detection/__tests__/DetailDrawer.test.tsx`
- [ ] 🔴 `apps/web/app/test-runs/[id]/components/dynatrace/__tests__/DynatraceCard.test.tsx`
- [ ] 🔴 `apps/web/app/test-runs/[id]/components/deep-links/__tests__/DeepLinksCard.test.tsx`

#### Profile Components (🔥 P1)
- [ ] 🔴 `apps/web/app/settings/profiles/[id]/components/__tests__/ProfileDashboardsTable.test.tsx`
- [ ] 🔴 `apps/web/app/settings/profiles/[id]/components/__tests__/ProfileBenchmarksTable.test.tsx`
- [ ] 🔴 `apps/web/app/settings/profiles/[id]/components/__tests__/DashboardFormDialog.test.tsx`
- [ ] 🔴 `apps/web/app/settings/profiles/[id]/components/__tests__/BenchmarkFormDialog.test.tsx`

### Week 10: API Supporting Modules

#### Organizations & Teams (📝 P2)
- [ ] 🔴 `apps/api/src/modules/organizations/organizations.service.spec.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/api/src/modules/organizations/organizations.controller.spec.ts` (NEW - 100 lines)
- [ ] 🔴 `apps/api/src/modules/teams/teams.service.spec.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/api/src/modules/teams/teams.controller.spec.ts` (NEW - 100 lines)

#### Systems Under Test (📝 P2)
- [ ] 🔴 `apps/api/src/modules/systems-under-test/systems-under-test.service.spec.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/api/src/modules/systems-under-test/systems-under-test.controller.spec.ts` (NEW - 100 lines)

#### Presets (📝 P2)
- [ ] 🔴 `apps/api/src/modules/compare-presets/compare-presets.service.spec.ts` (NEW - 200 lines)
- [ ] 🔴 `apps/api/src/modules/compare-presets/compare-presets.controller.spec.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/api/src/modules/trends-presets/trends-presets.service.spec.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/api/src/modules/trends-presets/trends-presets.controller.spec.ts` (NEW - 100 lines)

#### Other Modules (📝 P2)
- [ ] 🔴 `apps/api/src/modules/benchmark-results/benchmark-results.service.spec.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/api/src/modules/reports/reports.service.spec.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/api/src/modules/reports/reports.controller.spec.ts` (NEW - 100 lines)

#### Low Priority (📝 P3)
- [ ] 🔴 `apps/api/src/modules/health/health.controller.spec.ts` (NEW - 50 lines)
- [ ] 🔴 `apps/api/src/modules/queue/queue.service.spec.ts` (NEW - 100 lines)
- [ ] 🔴 `apps/api/src/modules/realtime/realtime.service.spec.ts` (NEW - 100 lines)

### Week 11-12: Frontend Supporting Code

#### Remaining Libraries (📝 P2)
- [ ] 🔴 `apps/web/lib/__tests__/compare-presets.test.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/web/lib/__tests__/profile-benchmarks.test.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/web/lib/__tests__/grafana-instances.test.ts` (NEW - 150 lines)
- [ ] 🔴 `apps/web/lib/__tests__/units.test.ts` (NEW - 100 lines)
- [ ] 🔴 `apps/web/lib/__tests__/api-keys.test.ts` (NEW - 100 lines)
- [ ] 🔴 `apps/web/lib/__tests__/trends-presets.test.ts` (NEW - 100 lines)
- [ ] 🔴 `apps/web/lib/__tests__/config-hash.test.ts` (NEW - 100 lines)
- [ ] 🔴 `apps/web/lib/__tests__/theme.test.ts` (NEW - 50 lines)

#### UI Components (📝 P2)
- [ ] 🔴 Create tests for components in `apps/web/components/ui/`
- [ ] 🔴 Create tests for components in `apps/web/components/layout/`
- [ ] 🔴 Create tests for components in `apps/web/components/providers/`

#### Custom Hooks (📝 P2)
- [ ] 🔴 Create tests for hooks in `apps/web/hooks/`

---

## Grafana Sync (🟢 Excellent Coverage - Maintain)

- [x] 🟢 `apps/grafana-sync/src/modules/auto-config/auto-config.service.spec.ts`
- [x] 🟢 `apps/grafana-sync/src/modules/auto-config/dashboard-uid.util.spec.ts`
- [x] 🟢 `apps/grafana-sync/src/modules/auto-config/variable-discovery.service.spec.ts`
- [x] 🟢 `apps/grafana-sync/src/modules/grafana-api/grafana-api.service.spec.ts`
- [x] 🟢 `apps/grafana-sync/src/modules/grafana-sync/grafana-sync.service.spec.ts`
- [x] 🟢 `apps/grafana-sync/src/modules/grafana-sync/restore-dashboard.service.spec.ts`
- [x] 🟢 `apps/grafana-sync/src/modules/grafana-sync/store-dashboard.service.spec.ts`
- [x] 🟢 `apps/grafana-sync/src/modules/grafana-sync/update-dashboards.service.spec.ts`
- [x] 🟢 `apps/grafana-sync/src/modules/sanity-checker/test-run-sanity-checker.service.spec.ts`
- [x] 🟢 `apps/grafana-sync/test/integration/grafana-sync.integration.spec.ts`

**Action:** Add integration tests only

---

## Metrics Module (🟢 Good Coverage - Enhance)

- [x] 🟢 `apps/api/src/modules/metrics/metrics.controller.spec.ts`
- [x] 🟢 `apps/api/src/modules/metrics/metrics.service.spec.ts`

---

## Progress Summary

### By Priority
- ⚡ P0 (Critical): 0 of 18 complete (0%)
- 🔥 P1 (High): 10 of 35 complete (29%)
- 📝 P2-P3 (Medium-Low): 0 of 30 complete (0%)

### By Application
- **API**: 20 of 80+ files (25% file coverage, ~16% line coverage)
- **Web**: 1 of 30+ files (3% file coverage, ~0.8% line coverage)
- **Worker**: 7 of 15+ files (47% file coverage, ~15% line coverage)
- **Grafana Sync**: 10 of 10 files (100% file coverage, ~112% line coverage)

### Total
- **Test Files**: 43
- **Source Files**: 453
- **Coverage**: 0.9% → Target: 80%
- **Estimated Test Files Needed**: ~120-150

---

## Weekly Milestones

### Week 1 Target (End of week)
- [ ] 10%+ coverage
- [ ] 8-10 new test files
- [ ] All authentication flows tested
- [ ] CI/CD configured

### Week 2 Target (End of week)
- [ ] 20%+ coverage
- [ ] 15-18 new test files
- [ ] Test runs fully tested
- [ ] Coverage reports active

### Week 3 Target (End of week)
- [ ] 30%+ coverage
- [ ] 22-25 new test files
- [ ] Critical integrations tested
- [ ] Phase 1 complete ✅

### Week 7 Target (End of Phase 2)
- [ ] 60%+ coverage
- [ ] 60-70 total test files
- [ ] All P0 and P1 modules tested
- [ ] Phase 2 complete ✅

### Week 12 Target (End of Phase 3)
- [ ] 80%+ coverage
- [ ] 120-150 total test files
- [ ] Comprehensive coverage
- [ ] Phase 3 complete ✅

---

## How to Use This Checklist

1. **Daily:** Mark tests as in-progress (🟡) when you start, complete (🟢) when done
2. **Weekly:** Review progress against milestones
3. **Bi-weekly:** Update coverage percentages
4. **Monthly:** Reassess priorities based on business needs

---

**Last Updated:** 2025-11-11
**Owner:** Engineering Team
**Next Review:** Weekly on Mondays
