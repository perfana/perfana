# Engineering Plan: Perfana Rebuild

## Problem Statement

Recreate the Perfana performance analysis platform (currently in `~/workspace/perfana-next-gen`)
in this repository. Two priorities beyond a straight port:

1. **AI-agent friendly** — Easy for anyone to clone and contribute with Claude Code
2. **Fix worker/analysis technical debt** — Address the artificial dashboard pattern and pipeline issues

## Core Principle

**Copy working code first. Refactor working code second. Never rewrite from scratch.**

Every phase starts with working software and ends with working software.

---

## Phase 1: Copy and Run

Copy perfana-next-gen wholesale into this repo. Verify it runs.

**Tasks:**
1. Copy all source code from `~/workspace/perfana-next-gen/`
2. Install dependencies (keep original package manager initially)
3. `docker compose up -d` — start Postgres, Redis, Keycloak
4. Run migrations
5. Seed test data (or use existing seed scripts)
6. Start API, worker, frontend — verify all three run
7. Login via Keycloak, browse test runs, verify the app works end-to-end

**Verification:** A developer can clone, start infra, run the app, login, and see data.

**No changes to the code in this phase.** Just copy and verify.

---

## Phase 2: Add Documentation Layer

Add AI-agent friendly documentation on top of the working code.
No code changes — only new .md files.

**Tasks:**
1. Add CLAUDE.md (progressive disclosure entry point)
2. Add ARCHITECTURE.md (system diagrams, data flow)
3. Add CONVENTIONS.md (naming, patterns, testing rules)
4. Add README.md to each API module (progressive disclosure layer 2)
5. Add README.md to worker pipelines
6. Add README.md to packages/shared
7. Update root README.md

**Verification:** An AI agent can read CLAUDE.md and understand how to contribute.

---

## Phase 3: MetricsSource Refactor

Replace the "artificial Grafana dashboard" pattern with a proper MetricsSource
abstraction. This is the most valuable architectural improvement identified.

**The problem:**
- Dynatrace and JMeter metrics forced into fake GrafanaDashboard rows (magic IDs 800000+/900000+)
- String prefix matching is the only way to tell real from fake
- ADAPT pipeline has a commented-out JOIN because it breaks on artificial dashboards
- Frontend filters out ~50% of "dashboards" that are fake

**The fix (applied incrementally, tested at each step):**
1. Create MetricsSource entity with source_type discriminator
2. Create migration to add metrics_sources table
3. Migrate application_dashboards data into metrics_sources
4. Update downstream entities ONE AT A TIME — test after each
5. Update API services — test
6. Update worker pipelines — test
7. Update frontend — test
8. Remove artificial dashboard creation code
9. Clean up GrafanaDashboard table

**Each step is a separate commit. Each step is tested. If a step breaks, revert it.**

---

## Phase 4: Worker Technical Debt (Incremental)

Fix worker issues one at a time on working code.

### 4a. Document algorithms (zero risk — comments only)
### 4b. Fix silent error swallowing (low risk)
### 4c. Extract magic numbers to constants (low risk)
### 4d. Remove dual worker system (medium risk)
### 4e. Implement reevaluate worker (medium risk)
### 4f. Fix incremental collection fallback (medium risk)
### 4g. Pipeline registry pattern (higher risk — only after 4a-4f stable)

**Each sub-task is a separate PR tested against the running app.**

---

## Phase 5: Other Improvements (Only If Justified)

| Improvement | Do when | Skip if |
|-------------|---------|---------|
| pnpm over npm | App stable, want faster CI | npm works fine |
| Vitest over Jest | Writing new tests | Existing tests pass |
| Pino over Logger | Adding observability | Logging works |
| ECharts over Plotly | Frontend refactor | Charts work |
| MUI-only frontend | Frontend redesign | Current UI functional |
| Generated API client | Adding endpoints frequently | Axios works |
| Consolidate controllers (12→4) | Module gets confusing | Current split works |

---

## Phase 6: Frontend Improvements (Future)

After backend stable and MetricsSource complete:
- Metrics grouped by source type
- Source badges with icons and external links
- MUI-only component library
- Consider ECharts for lighter charting

These are design improvements on working software, not rewrites.

---

## Rules

1. **Never rewrite what works.** Copy it, then improve it.
2. **Every change is tested against the running app.** "It compiles" is not a test.
3. **One change at a time.** Not parallel phases. Sequential, verified steps.
4. **Revert if broken.** If a change breaks the app, revert and try smaller.
5. **Read the original code before changing it.** Understand why before changing how.

---

## NOT Building

- MCP integration — defer
- docs-site — defer
- Keycloak theme — defer
- perfana-report — keep as-is
- New features — zero until port is stable
