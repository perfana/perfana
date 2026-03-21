# TODOS

## Pre-Phase 3: Capture ADAPT golden-file test fixtures

**What:** Run perfana-next-gen's ADAPT pipeline against known test data and capture inputs + outputs as JSON fixtures for the rebuild's test suite.

**Why:** The ADAPT algorithm is the core IP with 1000+ LOC of complex SQL generation and statistical analysis. Golden-file tests are the only reliable way to verify the rebuilt pipeline produces identical results. This data can ONLY be captured while perfana-next-gen is still the running system.

**Pros:** Guarantees parity between old and new implementations. Catches subtle regressions in statistical calculations that unit tests alone would miss.

**Cons:** Requires a working perfana-next-gen instance with representative test data. Fixtures may need updating if ADAPT logic is intentionally changed.

**Context:** The original ADAPT pipeline has minimal test coverage. The rebuild will add documentation and type safety, but without golden-file fixtures we can't verify the refactored code produces the same results. Capture at minimum: threshold calculations (percentage, IQR, absolute), conclusion generation (improved/degraded/unchanged), and tracked results for trend detection.

**Depends on:** Working perfana-next-gen instance with test data loaded.

**Blocked by:** Nothing — can be done independently before Phase 3 starts.

---

## Phase 6: CI check for generated API client drift

**What:** Add a CI pipeline step that regenerates the typed API client from the OpenAPI spec and fails if the committed client differs from the freshly generated one.

**Why:** The plan uses a generated typed client (from NestJS Swagger → OpenAPI → codegen) to keep frontend and backend in sync. Without a CI check, developers will change API endpoints and forget to regenerate the client, causing type errors only discovered at runtime.

**Pros:** Catches API/client drift at PR time. Enforces the "single source of truth" pattern for API types.

**Cons:** Adds a CI step (~30s). Developers must run `pnpm generate:api-client` after API changes.

**Context:** The original perfana-next-gen used hand-written Axios wrappers that frequently drifted from the actual API. The generated client eliminates this class of bug, but only if regeneration is enforced.

**Depends on:** Phase 2 (API with Swagger) and Phase 5 (frontend with generated client).

**Blocked by:** Nothing — natural addition during Phase 6 CI setup.
