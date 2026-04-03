# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.22] - 2026-04-03

### Fixed
- Add accessible labels and tooltips to icon-only delete buttons in profile dashboard forms and alert filters
- Wire showToast through TrackedRegressionsView so batch re-evaluation and ADAPT config updates produce user-visible feedback instead of silent no-ops
- Wrap disabled IconButtons in `<span>` for MUI Tooltip compatibility

### Removed
- 107 lines of debug `console.log` statements across 11 components (SectionConfigs, JobProgressBanner, ActionsMenu, PyroscopeSection, and others)
- Unused `components/members/` directory (4 files, 766 lines) superseded by `components/organizations/`
- Unused `OrganizationSwitcher.tsx` (178 lines) superseded by `OrganizationSelector`
- Placeholder `onLoad` console.log callbacks in ReportCard and test run page

## [0.2.21] - 2026-04-03

### Fixed
- Remove debug logging that wrote request metadata and auth config to localStorage on every API call (security)
- Remove localStorage token fallback, use sessionStorage only to prevent XSS token theft (security)
- Fix `validateApiKey` calling bare `fetch` without authentication headers
- Fix `instanceof Error` checks in GenerateReportDialog and useDeepLinksData to use safe cross-context pattern
- Fix `DeleteSystemDialog` using raw fetch instead of `authenticatedFetch` (missing 401 auto-retry)
- Fix `getPublicReport` and `buildShareUrl` bypassing runtime config (`env.API_URL`) with hardcoded `process.env`

### Changed
- Migrate 5 hooks from direct localStorage token reads to `useAuth()` context (useTrendsPresets, useComparePresets, useSLOSection, useDashboardsData)
- Remove redundant manual auth headers from hooks that already use `authenticatedFetch`
- Update CODING_RULES.md to document correct auth header pattern

### Removed
- Debug console.log statements from systems.ts, profiles.ts, reports.ts, keycloak-auth.ts
- Dead debug tools (`public/debug-logs.js`, `public/jwt-debugger.js`) that referenced removed localStorage logging
- Keycloak init session debug logging from keycloak-auth.ts

## [0.2.20] - 2026-04-03

### Fixed
- Prevent database deadlocks when bulk-deleting test runs with millions of rows in TimescaleDB hypertables
- Add deadlock retry logic (PostgreSQL 40P01) with linear backoff to deletion handler
- Set 30-second lock timeout on deletion transactions to fail fast instead of waiting indefinitely

### Added
- Bulk delete endpoint (`POST /test-runs/bulk-delete`) that queues deletions via BullMQ with concurrency 1
- Async deletion for single `DELETE /test-runs/:id` endpoint (returns 202 Accepted)
- `deletion_status` column on test runs for tracking queued/deleting/failed states
- Deletion status banner on test run detail page for other users viewing a run scheduled for deletion
- Synchronous fallback when Redis is unavailable

### Changed
- Frontend bulk delete now sends a single API call instead of N concurrent DELETE requests
- Test run list automatically filters out runs queued for deletion

## [0.2.19] - 2026-04-01

### Fixed
- Fix REEVALUATE_CHECKS stub pipeline silently returning success without doing any work (now returns failure with warning)
- Replace console.error with structured pino logger in ChecksPipeline realtime publishing
- Fix dead batch progress variables in MetricsPipeline (now actually logs batch progress)

### Removed
- Remove dead createErrorRecord/createEmptyRecord methods from MetricsPipeline
- Remove dead maybeSetAdaptDifferencesAccepted call and method from ChecksPipeline
- Remove dead getSettings method and 56-line migration guide from BasePipelineTypeORM
- Remove dead validateTestRun/hasExistingMetrics exports from worker analyze module
- Remove dead executeBatchProcessing/executeReevaluationBatch stubs from PipelineOrchestrator
- Remove unused imports from ChecksPipeline and MetricsPipeline

## [0.2.18] - 2026-03-31

### Fixed
- Fix ADAPT `computeStatus` algorithm bug where resolved regressions with non-accepted/denied resolution were incorrectly shown as UNRESOLVED
- Fix `verifyTestRunAccess` in data-science controller silently passing when test run does not exist (now throws 404)
- Add admin role check to `DELETE /data/locks` endpoint (any authenticated user could previously force-release job locks)
- Fix compare-presets admin bypass missing in `findAll` (global admins couldn't see non-global presets from other users)
- Fix `ResourceNotFoundException` being swallowed as 500 in compare-presets create/update
- Fix `ForbiddenException` being swallowed as 400 in data-science `releaseLock`
- Fix HttpException swallowing in events and alert-tag-filters controllers (NotFoundException/ForbiddenException now propagate correctly)
- Set `createdBy` field in graph-presets for RBAC Phase 2 consistency

### Removed
- Remove shipped stub endpoint `getTrackedRegressionChart` (returned wrong data with hardcoded zero percentages)
- Replace stub `getTestRunJobs` with proper 400 error (was returning fake empty data with "implementation in progress")
- Delete dead DTO files (`batch-reevaluate.dto.ts`, `batch-refresh.dto.ts`) that duplicated `batch-processing.dto.ts`
- Delete dead entity file `adapt/entities/tracked-regression.entity.ts` (real entity in packages/shared)
- Remove dead test helper and unused variables in events test suite

## [0.2.17] - 2026-03-31

### Fixed
- Fix RBAC bypass in metrics-sources write path — any authenticated user could update/delete other orgs' metrics sources
- Fix RBAC bypass in tracing-instances and pyroscope-instances — organizationId query param not validated against user's accessible orgs
- Fix Dynatrace update endpoint leaking plaintext API token in response (now masked)
- Remove Dynatrace API token prefix from debug logs (partial credential leak)
- Fix unreachable Dynatrace route caused by duplicate parameterized path (`GET :id/request-attributes`)
- Fix Grafana dashboards create endpoint blocking all JWT users (unreliable `ctx.organizationId` guard)
- Fix metrics `validateTestRunAccess` early-exit blocking access to unscoped test runs for users with no org memberships
- Replace bare `throw new Error()` with proper NestJS HTTP exceptions (ForbiddenException, BadRequestException) across 6 services
- Add `@IsUrl()` validation to Pyroscope URL generation DTOs
- Add `@IsDateString()` validation to trace-analysis time fields
- Add `@IsInt() @Min(1)` validation to Tempo search limit
- Add `@IsNotEmpty()` validation to Dynatrace entity mapping DTO fields
- Add missing `@ApiBearerAuth()` Swagger decorator to metrics and grafana/dashboards controllers

### Removed
- Remove 3 dead stub methods (findAll/findOne/create) from MetricsService and dead GET /metrics endpoint
- Remove `getFallbackValues` returning hardcoded demo data (MyAfterburner) on Grafana datasource errors
- Remove dead DTOs (DashboardRenderRequestDto, DashboardVariableValuesDto)
- Remove dead `dateToTimestamp` from PyroscopeUrlService
- Remove dead `getMaxTracesToAnalyze`/`getDefaultSearchLimit` from TraceQueryService
- Remove unused `isAdmin` assignments from TracingServicesService
- Remove orphaned JSDoc block and SQL debug logging

## [0.2.16] - 2026-03-29

### Fixed
- Resolve Next.js binary path in Docker container — start-server.js now tries workspace-level node_modules first with root fallback
- Use application_dashboard_id for ADAPT control group statistics join instead of metrics_source_id

### Added
- /auth-audit skill for multi-tenant authentication and authorization security audits

## [0.2.15] - 2026-03-28

### Changed
- Sparse data warnings no longer invalidate test runs — they are now informational "Data Notices" shown alongside results when all SLO checks completed successfully
- New `data_warnings` column on test runs separates informational warnings from hard validation errors
- Frontend shows sparse data as blue "Data Notices" section (informational) instead of orange "Data Quality Issues" (error)
- Slack and Teams notifications include data warnings as "Data Notices" with info icon

## [0.2.14] - 2026-03-28

### Fixed
- Worker now picks up Grafana instances added after startup instead of permanently caching the empty state from boot time
- Eliminated thundering herd: concurrent jobs waiting for Grafana config share a single database query via promise deduplication

## [0.2.13] - 2026-03-27

### Fixed
- Edit SLO dialog now pre-populates all fields (Source, Dashboard, Metric) from the benchmark's own data instead of relying on a fragile async fetch-and-match chain that failed for non-grafana sources and left the Save button permanently disabled
- Application dashboard API calls across SLO forms now use `?systemId=` (UUID) instead of `?system=` (name), which the backend silently ignored, causing unfiltered results
- `systemName` prop in test run SLO card now resolves to the actual system name instead of passing the UUID

### Added
- 136 unit tests for the Edit SLO form hook, validator utilities, and formatter utilities
- Generic dashboard/metric display in Edit SLO dialog for non-grafana/dynatrace sources (e.g., custom, prometheus)
- `metrics_source_id` field added to frontend Benchmark type for proper type safety
- `getSourceOption` now handles all source types (custom, prometheus, influxdb) instead of defaulting everything to "Grafana"

## [0.2.12] - 2026-03-27

### Fixed
- PostgreSQL autovacuum throttling on `ds_metrics` and `transactions` hypertables causing 68.5s query times on `transaction_buckets` CTE
- `autovacuum_vacuum_cost_delay` reduced from 20ms (set in migration 020) back to 2ms to match global default, preventing dead tuple buildup and stale visibility maps
- Added `autovacuum_analyze_scale_factor` to `transactions` table to keep planner statistics fresh
- Propagated autovacuum settings to all existing TimescaleDB chunks (parent-only ALTER TABLE does not affect existing chunks)

## [0.2.11] - 2026-03-27

### Added
- Centralized metric formatting utility (`apps/web/lib/format-units.ts`) with 11 functions: `formatDuration`, `formatDurationCompact`, `formatDurationClock`, `formatBytes`, `formatPercentage`, `formatRatioAsPercentage`, `formatChangePercentage`, `formatRate`, `formatNumber`, `formatCompactNumber`, `formatInteger`
- New `formatRate` function for rate-based metrics (req/s, ops/s, MB/s)
- 65 unit tests for centralized formatters covering all edge cases (null, undefined, NaN, negative, zero, boundaries)
- 22 unit tests for test-run-utils (formatDuration, calculateElapsedDuration, calculateProgress, isRecentlyActive)

### Changed
- AWR formatters (`awr/utils/formatters.ts`) now re-export shared functions from centralized source, eliminating 311 lines of duplication
- `test-run-utils.ts` and `test-run-formatters.ts` delegate to centralized `formatDurationClock`
- `HostPropertiesSection.tsx` uses centralized `formatBytes` instead of inline implementation

## [0.2.10] - 2026-03-26

### Fixed
- PostgreSQL write starvation prevention — reduced analyze concurrency from 5 to 2, added 120s statement timeout for analytical queries, dedicated write connection pool, backpressure via in-flight job dedup
- Prevent redundant incremental collection jobs via in-flight deduplication in scheduler
- Restore test run ID font size in collapsed card after refactor

### Changed
- Performance analysis collapsed card now shows "Ramp-up" state when test is running and still in ramp-up phase
- Add "Exclude Ramp-up" toggle to collapsed performance analysis card when in ramp-up state
- Move copy icon next to "Test Run ID" label in collapsed test run info card
- Tune PostgreSQL autovacuum for `ds_metrics` table (high-write workload)
- Worker pool size reduced from 100 to 30 connections to match reduced concurrency
- Analytical pipelines (Statistics, ControlGroups, ADAPT) use `withAnalyticsTransaction` with SET LOCAL timeout
- Metric writes (MetricsPipeline, PerformanceTestMetricsPipeline) use dedicated write connection pool

## [0.2.9] - 2026-03-25

### Added
- Copy-to-clipboard icon next to test run ID in both collapsed and expanded test run info cards
- Apdex Threshold column in performance analysis transaction tables and sampler tables
- Per-scenario transaction name filter in performance analysis overview tab
- Organization-scoped Grafana dashboard filtering — non-admin users only see dashboards from their organization's grafana instances

### Changed
- Add `organization_id` to frontend `SystemUnderTest` type for org-aware dashboard management
- Dashboard add dialog now fetches only dashboards from the system's organization grafana instances

## [0.2.8] - 2026-03-25

### Fixed
- Drop narrow unique constraints on `ds_compare_config` that blocked saving compare configs when the same dashboard+panel is used across different workloads (e.g., loadTest vs stressTest)
- Clear `setTimeout` in worker `PipelineOrchestrator.executeStage()` after `Promise.race` completes to prevent unhandled rejection crash 10 minutes after job completion

## [0.2.7] - 2026-03-25

### Fixed
- Propagate config scope (metric vs panel) through save dialog so panel-level ADAPT classification and thresholds are correctly applied

### Changed
- Disable PR Quality Gate, Claude Code Review, and Docker Build CI pipelines on pull requests (manual dispatch only)

## [0.2.6] - 2026-03-25

### Fixed
- Use fixed 1-second bucket size for incremental performance test metrics collection to prevent resolution changing mid-test (was 1s→5s after ~17 minutes)
- Delete old performance_test metrics before force re-fetch to avoid mixed-resolution data from prior incremental collection
- Add `MetricsSource` entity to grafana-sync TypeORM connection to fix startup crash (`ApplicationDashboard#metricsSource was not found`)

## [0.2.5] - 2026-03-25

### Fixed
- Propagate `metrics_source_id` through all metric pipeline paths (Grafana, performance test, incremental) to fix ADAPT regression detection failing with `NO_BASELINES_FOUND`
- Use `IS NOT DISTINCT FROM` for null-safe `metrics_source_id` join in ADAPT validator to prevent false empty control group detection

## [0.2.4] - 2026-03-25

### Fixed
- Apdex report card now uses per-transaction threshold overrides from `workload_transaction_apdex_thresholds` instead of a single default threshold
- Apdex report transactions table displays the actual threshold used per transaction
- Overall Apdex threshold display shows "varies per txn" when different transactions use different thresholds

### Removed
- Stale auto-claude artifacts (`.auto-claude-security.json`, `.auto-claude-status`, `.claude_settings.json`)
- Completed database migration consolidation docs (`database/DEPLOYMENT_CHECKLIST.md`, `MIGRATION_CONSOLIDATION.md`, `PRODUCTION_DEPLOYMENT_SUMMARY.md`)
- Unused SonarQube files (`fix-coverage-paths.sh`, `run-sonar-scan.sh`, `sonar-project.properties`)

### Changed
- Updated `.gitignore` to prevent future accumulation of tool artifacts (`.playwright-mcp/`, `.serena/`, auto-claude files)

## [0.2.3] - 2026-03-24

### Removed
- 53 obsolete files: backup files (.bak/.backup), unused Dockerfiles (optimized/security/simple/slim), superseded SQL migrations, archived TypeORM migrations, stale planning docs, one-time fix scripts, dead utilities, and build artifacts
- Old migration archives (`database/migrations/`, `database/migrations_archive/`)

### Fixed
- Exported previously inert migrations 003 (AddTagsHashUniqueIndex) and 004 (AddAlertsSupport) from `packages/shared/src/database/index.ts`

### Changed
- Upgraded vendored gstack to v0.11.15.0

## [0.2.2] - 2026-03-24

### Added
- Server-side ADAPT regression classification in MCP `get_adapt_results` tool — returns pre-classified regressions, dashboard groupings, causal chains, and hypotheses so Claude doesn't need to parse raw data
- Optional Obsidian output in perfana-report skill — user can choose between Obsidian vault or local `reports/` file

### Changed
- MCP permissions use wildcard `mcp__perfana__*` instead of individual tool entries — eliminates ~20 approval prompts per report
- Updated perfana-report skill Step 3.5 to consume pre-processed ADAPT data directly

### Fixed
- CI Docker build failures (missing curly braces for eslint, dollar escapes in schema-sql)
- Embedded schema SQL in migrations to eliminate Docker build dependency on pg_dump
- Trace and Pyroscope bugfixes from demo testing (scenario/transaction filtering, cross-source correlation)
- Data sources service resilience improvements

## [0.2.1] - 2026-03-23

### Added
- Cross-source root cause investigation in the `perfana-report` Claude Code skill — automatically fetches traces, flamegraphs, and Dynatrace problems when data sources are connected
- Investigation playbook reference mapping 15 hypothesis types to targeted MCP tool calls with evidence quality criteria
- Enhanced report template with Investigation section: distributed traces, CPU profiling hotspots, Dynatrace infrastructure problems, dashboard snapshots, evidence chain, and confidence levels
- Graceful degradation when sources are unavailable — investigation gaps are noted in the report, analysis continues

## [0.2.0] - 2026-03-23

### Added
- 8 new MCP tools for cross-source root cause analysis: `list_connected_sources`, `get_grafana_dashboard_snapshot`, `get_slow_traces`, `get_trace_detail`, `get_error_traces`, `get_flamegraph`, `get_hotspots`, `get_dynatrace_problems`
- Test-run-scoped API endpoints that resolve data source instances automatically from testRunId
- Tempo trace proxy: search slow/error traces and fetch full span breakdowns via TraceQL
- Pyroscope flamegraph proxy: fetch collapsed-stack profiles and hotspot analysis for a service
- Dynatrace problems proxy: fetch infrastructure problems detected during a test run time window
- Dashboard snapshot endpoint: aggregate min/max/avg/last stats for all panels in one call
- Connected data sources discovery: shows which Grafana, Tempo, Pyroscope, and Dynatrace instances are available for a test run
- Input validation for trace IDs (hex format) and service names (TraceQL injection prevention)
- Downstream request timeouts (10s) for all Tempo and Pyroscope proxy calls
- 16 new MCP client tests covering all new methods

## [0.1.0] - 2026-03-23

### Added
- MetricsSource entity unifying Grafana, Dynatrace, InfluxDB, and Prometheus under a single abstraction (Phase 3)
- MetricsSource 1:1 granularity eliminating synthetic GrafanaDashboard rows (Phase 3.7)
- ADAPT algorithm JOINs on `metrics_source_id` for cross-source regression detection (Phase 3.7)
- Frontend `source_type` utility for consistent metrics source display (Phase 3.7)
- Dynatrace WireMock mappings for local development (Phase 3)
- Pipeline registry pattern replacing per-source worker wrappers (Phase 4g)
- Document algorithms, extract magic numbers, and fix error logging (Phase 4a-c)
- Panels in reevaluate flow and incremental collection resilience (Phase 4e-f)
- Grouped dashboard dropdown with source badges in SLO dialog (Phase 6)
- Fetch all SLO dashboard sources on dialog open (Phase 6)
- Open source launch files: LICENSE (Apache 2.0), CONTRIBUTING.md, README, setup script
- GitHub Actions CI workflow (`pr-quality-gate.yml`)
- Dependabot configuration for automated dependency updates

### Changed
- `metrics_source_id` wired end-to-end through DynatracePipeline
- Configuration migration to reference MetricsSource instead of legacy dashboard IDs
- Filter synthetic dashboards from Add Dashboard picker using `source_type`
- Dark mode fix for Dynatrace host performance graphs

### Removed
- Dead worker code totaling ~960 lines (Phase 4d)
- Old worker wrappers replaced by pipeline registry (~1,413 lines)
- Stale Supabase references and unused dev scripts
