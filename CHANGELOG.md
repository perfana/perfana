# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.4] - 2026-03-25

### Fixed
- Apdex report card now uses per-transaction threshold overrides from `workload_transaction_apdex_thresholds` instead of a single default threshold
- Apdex report transactions table displays the actual threshold used per transaction
- Overall Apdex threshold display shows "varies per txn" when different transactions use different thresholds

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
