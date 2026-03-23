# Engineering Plan: Perfana

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Copy and Run | ✅ Done |
| 2 | Documentation Layer | ✅ Done |
| 3 | MetricsSource Refactor | ✅ Done |
| 4 | Worker Technical Debt | ✅ Done |
| 5 | Optional Improvements | Deferred (not needed yet) |
| 6 | Frontend Improvements | ✅ Partially done |
| OS | Open Source Launch | ✅ Done |

---

## ✅ Phase 1: Copy and Run (Done)

Copied perfana-next-gen into this repo. App runs end-to-end: API, worker, frontend, Keycloak login, test run browsing.

## ✅ Phase 2: Documentation Layer (Done)

- CLAUDE.md with progressive disclosure, 4 how-to tutorials
- ARCHITECTURE.md with system diagrams and data flow
- CONVENTIONS.md with naming and patterns
- README.md per service (API, worker, shared, grafana-sync)
- CODING_RULES.md per app (API, web, grafana-sync)

## ✅ Phase 3: MetricsSource Refactor (Done)

Replaced artificial Grafana dashboard pattern with MetricsSource entity:
- MetricsSource entity with `source_type` discriminator (grafana, dynatrace, prometheus, influxdb, performance_test)
- 1:1 granularity eliminating synthetic GrafanaDashboard rows
- ADAPT JOINs on `metrics_source_id` for cross-source regression detection
- Frontend source_type utility for consistent display
- Dynatrace pipeline wired end-to-end through `metrics_source_id`

## ✅ Phase 4: Worker Technical Debt (Done)

- **4a-c**: Documented algorithms, extracted magic numbers to constants, fixed silent error swallowing
- **4d**: Removed dead worker code (960 lines)
- **4e-f**: Panels in reevaluate flow, incremental collection resilience
- **4g**: Pipeline registry pattern replacing per-source worker wrappers (1,413 lines removed)

## Phase 5: Optional Improvements (Deferred)

Only pursue when justified by a specific need:

| Improvement | Do when | Skip if |
|-------------|---------|---------|
| pnpm over npm | Want faster CI | npm works fine |
| Vitest over Jest | Writing new tests | Existing tests pass |
| Pino over Logger | Adding observability | Logging works |
| ECharts over Plotly | Frontend refactor | Charts work |
| MUI-only frontend | Frontend redesign | Current UI functional |
| Generated API client | Adding endpoints frequently | Axios works |
| Consolidate controllers (12→4) | Module gets confusing | Current split works |

## ✅ Phase 6: Frontend Improvements (Partially Done)

Completed:
- Grouped dashboard dropdown with source badges
- SLO dialog fetches all dashboard sources
- Dark mode fix for Dynatrace graphs
- Synthetic dashboard filtering using `source_type`

Remaining (tracked as GitHub issues):
- Dashboard search/filter (#24)
- Dark/light mode persistence (#26)
- Test run duration display (#27)
- Metric unit formatting (#23)

## ✅ Open Source Launch (Done)

- LICENSE (Apache 2.0), CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- `scripts/setup.sh` one-command bootstrap + `scripts/seed.ts` sample data
- Makefile, .env.example files
- CLAUDE.md tutorials (metrics source, pipeline, common tasks, testing)
- 8 curated `good-first-issue-for-ai` GitHub issues (#21-#28)
- CHANGELOG.md, README.md with badges
- Dependabot config, Claude Code PR review workflow
- 125+ stale internal docs removed (-72,698 lines)

---

## What's Next

### Near-term: Community Readiness
- Make repo public on GitHub
- Enable branch protection (TODO in TODOS.md)
- Add `ANTHROPIC_API_KEY` secret for automated PR reviews
- Monitor first AI-contributed PRs

### Future: Phase 2 of Design Doc (MCP + Jupyter + Obsidian)
- Polish MCP server documentation and setup
- Create example Jupyter notebooks (query ds_metrics, visualize trends)
- Polish perfana-report skill for Obsidian
- Demo video: "Claude, analyze my test run"
- Submit to Claude MCP marketplace

---

## Rules

1. **Never rewrite what works.** Copy it, then improve it.
2. **Every change is tested against the running app.** "It compiles" is not a test.
3. **One change at a time.** Not parallel phases. Sequential, verified steps.
4. **Revert if broken.** If a change breaks the app, revert and try smaller.
5. **Read the original code before changing it.** Understand why before changing how.
