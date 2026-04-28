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

---

## Completed

(none yet)
