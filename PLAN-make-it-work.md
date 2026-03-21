# Plan: Make Perfana Work End-to-End

## Goal

A developer clones this repo, runs 3 commands, and has a working Perfana instance
with sample data they can browse in the UI.

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm install && pnpm build && pnpm migration:run && pnpm seed
pnpm dev
```

## Current State

```
WHAT WORKS                          WHAT DOESN'T
─────────────────────────────────   ─────────────────────────────────
✅ Docker Compose starts infra      ❌ No tables in DB (migration not run)
✅ API boots, health endpoint OK    ❌ Keycloak realm not importing
✅ 100+ routes mapped               ❌ Swagger UI path broken
✅ DB connection succeeds           ❌ No seed data
✅ Worker type-checks               ❌ Frontend not tested against API
✅ 81 pipeline tests pass           ❌ ESLint CI failing
✅ Packages build                   ❌ Worker not tested against real DB
```

## Scoped Areas (in dependency order)

Each area is independent enough to be tackled with `/investigate` after this
plan is reviewed. Order matters — later areas depend on earlier ones.

### Area 1: Database (BLOCKING — everything depends on this)

**Problem:** Migration exists but hasn't been run. No tables in the database.

**Tasks:**
1. Run consolidated schema migration against real TimescaleDB
2. Fix any SQL errors in the 8589-line schema dump
3. Run MetricsSource migration (0002)
4. Verify all 50 entity tables exist
5. Verify TimescaleDB hypertable is created for ds_metrics

**Verification:** `\dt` shows all expected tables, `pnpm migration:run` succeeds cleanly.

**Risk:** The schema dump was copied from perfana-next-gen. It may reference
objects (functions, extensions, roles) that don't exist in our clean DB.
Likely needs iteration to fix.

### Area 2: Keycloak (BLOCKING — auth depends on this)

**Problem:** Realm file exists, docker-compose has `--import-realm`, but
Keycloak container shows no status and realm endpoint is unreachable.

**Tasks:**
1. Debug why Keycloak container isn't running (check docker logs)
2. Fix realm import if needed
3. Verify realm exists at http://localhost:8080/realms/perfana
4. Verify 3 test users can authenticate (admin/user/guest)
5. Verify JWKS endpoint works (API needs this for token validation)

**Verification:** `curl http://localhost:8080/realms/perfana` returns realm config.

### Area 3: API Endpoints (depends on Area 1 + 2)

**Problem:** API boots but most endpoints haven't been tested against real data.

**Tasks:**
1. Fix Swagger UI path (`/api/docs` returns 404 — likely double-prefix issue)
2. Seed sample data (`pnpm seed`)
3. Test CRUD endpoints: organizations, teams, systems, test-runs
4. Test auth flow: get Keycloak token → call protected endpoint
5. Fix any TypeORM query errors found during testing
6. Test integration endpoints: grafana-instances, dynatrace, pyroscope

**Verification:** Each endpoint returns expected data. Swagger UI loads.

### Area 4: Frontend (depends on Area 3)

**Problem:** Pages render but API calls haven't been verified end-to-end.

**Tasks:**
1. Start Next.js dev server
2. Test signin page → Keycloak redirect → callback
3. Test dashboard page → API data loads
4. Test test-runs list → shows seeded data
5. Test test-run detail → shows metrics grouped by source
6. Fix any CORS, auth, or data-fetching issues found

**Verification:** User can sign in and browse seeded test runs.

### Area 5: Worker (depends on Area 1)

**Problem:** Worker hasn't been tested against real database.

**Tasks:**
1. Build and start worker
2. Queue a test analysis job via API (or directly via BullMQ)
3. Verify pipeline stages execute against real DB
4. Fix any SQL errors in pipeline queries

**Verification:** Worker processes a job without errors.

### Area 6: CI (independent — can be done anytime)

**Problem:** ESLint fails, Docker build fails on native deps.

**Tasks:**
1. Fix ESLint for worker (configure eslint or skip properly)
2. Fix ESLint for API (same)
3. Fix Docker build (add python3 + build tools to Alpine stage)
4. Verify all CI jobs pass

**Verification:** All GitHub Actions workflows pass.

## Execution Strategy

Work through areas 1-6 in order. For each area:
1. Use `/investigate` to systematically find and fix issues
2. Verify the area works before moving to the next
3. Commit fixes incrementally

## NOT in scope
- New features beyond what perfana-next-gen has
- Performance optimization
- Production deployment configuration
- Load testing the platform
- Mobile/responsive polish
