# TODOS

## ~~Pre-Phase 3: Capture ADAPT golden-file test fixtures~~ ✅ DONE

Completed in Phase 3.3.5. Golden-file tests exist at `apps/worker/src/test/golden-files/` with 47 SQL snapshot tests and 891 real data result comparisons.

---

## ~~Fix 2 broken worker unit tests (Phase 3 regression)~~ ✅ DONE

Already fixed. Worker test suite passes: 904 passed, 0 failures (verified 2026-03-23).

---

## Phase 6: CI check for generated API client drift

**What:** Add a CI pipeline step that regenerates the typed API client from the OpenAPI spec and fails if the committed client differs from the freshly generated one.

**Why:** The plan uses a generated typed client (from NestJS Swagger → OpenAPI → codegen) to keep frontend and backend in sync. Without a CI check, developers will change API endpoints and forget to regenerate the client, causing type errors only discovered at runtime.

**Pros:** Catches API/client drift at PR time. Enforces the "single source of truth" pattern for API types.

**Cons:** Adds a CI step (~30s). Developers must run `pnpm generate:api-client` after API changes.

**Context:** The original perfana-next-gen used hand-written Axios wrappers that frequently drifted from the actual API. The generated client eliminates this class of bug, but only if regeneration is enforced.

**Depends on:** Phase 2 (API with Swagger) and Phase 5 (frontend with generated client).

**Blocked by:** Nothing — natural addition during Phase 6 CI setup.
