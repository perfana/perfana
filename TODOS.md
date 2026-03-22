# TODOS

## ~~Pre-Phase 3: Capture ADAPT golden-file test fixtures~~ ✅ DONE

Completed in Phase 3.3.5. Golden-file tests exist at `apps/worker/src/test/golden-files/` with 47 SQL snapshot tests and 891 real data result comparisons.

---

## Fix 2 broken worker unit tests (Phase 3 regression)

**What:** Two worker unit tests fail after Phase 3 MetricsSource changes:

1. `ChecksPipeline.test.ts` — "should execute with metric filter and log appropriately"
   - The test expects a log message matching `StringContaining{...}` but the log format changed when `metricsSourceId` was added to the `ChecksInput` interface and logging in Phase 3.6.
   - Fix: update the expected log message pattern to include `metricsSourceId`.

2. `StatisticsPipeline.test.ts` — "should calculate last_value from most recent timestamp"
   - The test snapshots the SQL string and expects `(array_agg(value ORDER BY time DESC))` but the SQL was modified in Phase 3.3 to include `metrics_source_id` in the column list, shifting the SQL structure.
   - Fix: update the expected SQL substring to match the new column order.

**Why:** Broken tests erode confidence in the test suite. These are unit tests that validate correct behavior — they should pass.

**Pros:** Restores full test suite to green. Prevents the broken window effect.

**Cons:** None — trivial fixes.

**Context:** Both failures are from Phase 3 changes that modified SQL and logging but didn't update the corresponding unit test assertions. The pipeline behavior is correct (validated by golden-file tests and real data); only the test expectations are stale.

**Depends on:** Nothing.

**Blocked by:** Nothing.

---

## Phase 6: CI check for generated API client drift

**What:** Add a CI pipeline step that regenerates the typed API client from the OpenAPI spec and fails if the committed client differs from the freshly generated one.

**Why:** The plan uses a generated typed client (from NestJS Swagger → OpenAPI → codegen) to keep frontend and backend in sync. Without a CI check, developers will change API endpoints and forget to regenerate the client, causing type errors only discovered at runtime.

**Pros:** Catches API/client drift at PR time. Enforces the "single source of truth" pattern for API types.

**Cons:** Adds a CI step (~30s). Developers must run `pnpm generate:api-client` after API changes.

**Context:** The original perfana-next-gen used hand-written Axios wrappers that frequently drifted from the actual API. The generated client eliminates this class of bug, but only if regeneration is enforced.

**Depends on:** Phase 2 (API with Swagger) and Phase 5 (frontend with generated client).

**Blocked by:** Nothing — natural addition during Phase 6 CI setup.
