# ADAPT Module

API layer for the ADAPT (Automated Difference Analysis for Performance Testing) regression detection system.

## Key Files

| File | Purpose |
|---|---|
| `adapt.module.ts` | Module definition |
| `adapt.service.ts` | Business logic — query ADAPT results, tracked regressions, conclusions |
| `adapt.controller.ts` | REST endpoints for ADAPT data |
| `dto/` | Request/response DTOs for tracked regressions |

## What ADAPT Does

ADAPT compares performance metrics between test runs and a control group (baseline) to detect regressions, improvements, and differences. The actual algorithm runs in the **worker service** (`apps/worker/src/pipelines/AdaptPipeline.ts`). This module provides the API to query results.

## Key Entities

- `DsAdaptResults` — individual metric comparison results
- `DsAdaptConclusion` — overall conclusion per test run (pass/fail/warning)
- `DsAdaptTrackedResults` — tracked regressions that persist across runs

## Endpoints

- Get ADAPT conclusions for test runs
- Get enriched ADAPT results with metric details
- List/resolve tracked regressions
- Get tracked regression chart data (trend over time)

## Related

- Worker pipeline: `apps/worker/src/pipelines/AdaptPipeline.ts`
- Deep reference: `docs-site/content/Features/adapt-algorithm.md`
