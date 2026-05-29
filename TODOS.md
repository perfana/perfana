# TODOS

Cross-PR follow-up work. Items here are real backlog — captured because
they came up during a planning or review session and shouldn't get lost,
but aren't tied to a single in-flight PR. Format: one entry per item with
priority (P0–P4), origin, and enough context that someone picking it up in
3 months can act without re-deriving the motivation.

When an item ships, move it to the `## Completed` section at the bottom
with the version it landed in.

---

## RBAC

### Add Grafana panel for `auth_capability_denied_total`

**Priority:** P3
**Origin:** /plan-eng-review on `docs/superpowers/plans/2026-04-27-rbac-completion.md` (2026-04-28).
**Depends on:** Phase 3c shipping the metric counter inside `CapabilityGuard`.
**Why:** A spike in capability denials is real ops signal — misconfigured
user, attack, deployment regression, missing membership backfill. Without a
dashboard, the counter is dead data; with one, ops can spot patterns and
alert on per-capability or per-org spikes.
**What:** A Grafana panel in the existing observability dashboard (or a new
RBAC-focused dashboard) showing:
- `rate(auth_capability_denied_total[5m])` per capability, over time.
- Top denied capabilities in the last 24h.
- Per-organization denial counts (label slice).
**Where to start:** confirm Phase 3c has shipped the counter (grep
`auth_capability_denied_total` in `apps/api/src`); decide whether to extend
an existing dashboard or create a new one (check `infra/grafana/dashboards/`
for the pattern); add an alert rule on per-user denial rate >10/min for
attack detection.

### Cold-cache p99 benchmark for `/api/users/me/permissions`

**Priority:** P3
**Origin:** /plan-eng-review on `docs/superpowers/plans/2026-04-27-rbac-completion.md` (2026-04-28).
**Depends on:** Phase 3a deployed (the endpoint must exist).
**Why:** The plan parallelizes per-org capability lookups via `Promise.all`
and uses a versioned cache key strategy to avoid `redis.keys()`. Both should
keep cold-cache p99 at one round-trip's latency regardless of org count, but
neither has been verified empirically. For a user with 20+ orgs (a realistic
admin or support user scenario), a regression could quietly add hundreds of
ms of session-startup latency.
**What:** Hit `/api/users/me/permissions` 100 times for a seeded user with
20 orgs against an empty Redis (cold cache); record p50/p95/p99/max. Repeat
warm cache. Pass criterion: cold p99 < 200ms; warm p99 < 30ms.
**Where to start:** if perfana has a load-test rig (k6, artillery), add a
scenario; if not, a `bun run scripts/bench-me-permissions.ts` ad-hoc script
that fires 100 sequential requests and prints the histogram is enough for
a one-off check.

### Extend `_permissions` enrichment to Dynatrace sub-resources

**Priority:** P3
**Origin:** PR #187 / v0.2.47.8 (RBAC Phase 3 follow-up).
**Depends on:** Nothing — sub-resources already have `organizationId` on the
DTO (added in this PR) and `getCapabilities` is in place.
**Why:** PR #187 closed the *backend* authz bypass on `dynatrace_queries` and
`dynatrace_entity_mappings` — non-admins now correctly get 403 on PATCH/DELETE.
But the *frontend* doesn't know to disable those buttons, so the user only
discovers the denial after clicking and seeing an error. Same UX gap that
Phase 3b closed for the parent `DynatraceConfig`.
**What:** Mirror the Phase 3b pattern on the read endpoints for queries and
entity mappings: `attachPermissions(row, { update: …, delete: … })` with the
booleans computed from `getCapabilities(userId, roles, row.organizationId)`.
Frontend already has `<RequiresPermission>` wired — wrap the
update/delete buttons in the query editor and entity-mapping list.
**Where to start:** `apps/api/src/modules/dynatrace/dynatrace.service.ts` —
the read methods (`findAllQuery`, `findQueryById`, `findQueryBySystemAndEnvironment`,
`getEntityMappings`, `getEntityMappingById`) still have stale "treated as
legacy data" TODO comments. Reuse the batched `capsByOrg` pattern from
`findAll` (lines 105-121). Frontend wrappers go in the same place that
already handles the parent config — `apps/web/app/integrations/components/`
and any DQL query / entity-mapping editor pages.

---

## Tests

### Fix pre-existing web test failures (socket + TestRunDetailsCard)

**Priority:** P0
**Origin:** Noticed during /ship on `fix/websocket-hoist-nestjs-websockets` (2026-05-29). Pre-existing failures, unrelated to this branch.
**What:**
1. `__tests__/lib/socket.test.ts` — `SocketManager.connect()` test expects `mockIo` called with `ws://localhost:3001/test-runs` and specific params; expectation no longer matches the implementation.
2. `__tests__/app/test-runs/test-run-details/TestRunDetailsCard.test.tsx` — expects text `'Yes - Test was aborted'` but the component renders it differently now.
**How:** Read the current `lib/socket.ts` and `TestRunDetailsCard` implementations and update the test expectations to match.

---

### Regenerate ADAPT golden-file snapshot

**Priority:** P0
**Origin:** Noticed during /ship on `fix/websocket-hoist-nestjs-websockets` (2026-05-29). Pre-existing failure, unrelated to this branch.
**What:** `apps/worker/src/test/golden-files/adapt-real-golden.test.ts` compares ADAPT output against a stored snapshot. The local DB now has 1,041 results vs the golden file's expected 950 (diff: +91 rows, different conclusion distribution). Golden file needs to be regenerated to match current DB state.
**How:** With the dev DB running, run `cd apps/worker && npx vitest run src/test/golden-files/adapt-real-golden.test.ts -- --update` or update the golden JSON files in `apps/worker/src/test/golden-files/` manually against current output.
**Note:** Only do this against a stable/representative DB, not a transient dev snapshot — the golden file is the regression baseline.

---

## Completed

(none yet)
