# Supabase Removal Plan

This document outlines the comprehensive plan to remove all Supabase-related code from the Perfana project.

**Date Created:** 2025-10-12
**Status:** Ready for Execution
**Migration Status:** Already migrated to TypeORM + PostgreSQL + Keycloak

---

## Inventory Summary

### Dependencies to Remove

- `@supabase/supabase-js` (backend: 2.56.0, frontend: 2.38.0)
- `@supabase/auth-helpers-nextjs` (frontend: 0.8.7)

### Files/Directories to Remove or Archive

- `/supabase/` directory (config, migrations, seed files)
- `/supabase_data_dump.sql` (115 MB)
- `/MIGRATION_SUPABASE_TO_POSTGRES.md` (archive this for historical reference)

### Code References Found

25 files contain Supabase references across:
- Auth guards, services, and middleware
- Frontend client initialization
- Environment configuration
- Documentation

---

## Phase 1: Remove Unused Auth Components ✅ SAFE

These files reference Supabase but are unused or have alternatives:

### 1.1 Remove Supabase Auth Guard

**File:** `apps/api/src/guards/supabase-auth.guard.ts`

**Action:** DELETE

**Reason:** Already using `KeycloakEnhancedAuthGuard` in `app.module.ts`

```bash
rm apps/api/src/guards/supabase-auth.guard.ts
```

### 1.2 Remove Supabase Auth Service

**File:** `apps/api/src/modules/auth/auth.service.ts`

**Action:** DELETE

**Reason:** Contains only TODO comments, no implementation. Using `native-auth.service.ts` and `auth-user.service.ts` instead.

```bash
rm apps/api/src/modules/auth/auth.service.ts
```

### 1.3 Clean Up Combined Auth Guard

**File:** `apps/api/src/guards/combined-auth.guard.ts`

**Action:** UPDATE (if applicable)

**Note:** Review if this guard still references Supabase. If using Keycloak exclusively, remove Supabase JWT validation logic.

---

## Phase 2: Update Real-time Implementation ⚠️ NO CHANGES NEEDED

**Finding:** The `RealtimeModule` does NOT use Supabase real-time subscriptions.

**Implementation:** Uses Socket.IO + Redis for pub/sub pattern

**Files:**
- `apps/api/src/modules/realtime/realtime.module.ts`
- `apps/api/src/modules/realtime/realtime.service.ts`
- `apps/api/src/modules/realtime/realtime.gateway.ts`

**Action:** NO CHANGES REQUIRED ✅

---

## Phase 3: Remove Frontend Supabase Client ✅ SAFE

### 3.1 Remove Supabase Client Initialization

**File:** `apps/web/lib/supabase.ts`

**Action:** DELETE

```bash
rm apps/web/lib/supabase.ts
```

### 3.2 Update Auth Context

**File:** `apps/web/contexts/auth-context.tsx`

**Action:** UPDATE

**Tasks:**
- Remove any Supabase session handling imports
- Remove Supabase client usage
- Keep Keycloak authentication logic

### 3.3 Update Environment Configuration

**File:** `apps/web/lib/env.ts`

**Action:** UPDATE

**Tasks:**
- Remove `SUPABASE_URL` validation
- Remove `SUPABASE_ANON_KEY` validation
- Remove `USE_KEYCLOAK_AUTH` flag if no longer needed

---

## Phase 4: Clean Up Backend References ✅ SAFE

### 4.1 Update Database Services

**Files:**
- `apps/api/src/common/database.service.ts`
- `apps/api/src/common/database-factory.service.ts`
- `apps/api/src/common/common.module.ts`

**Action:** UPDATE

**Tasks:**
- Remove Supabase client imports
- Remove any Supabase client fallback logic
- Ensure only TypeORM/native PostgreSQL connections are used

### 4.2 Remove Old Repository Files

**File:** `apps/api/src/modules/dynatrace/dynatrace.repository.old.ts`

**Action:** DELETE (if confirmed as obsolete)

```bash
rm apps/api/src/modules/dynatrace/dynatrace.repository.old.ts
```

### 4.3 Update Auth Controller

**File:** `apps/api/src/modules/auth/auth.controller.ts`

**Action:** UPDATE

**Tasks:**
- Remove Supabase-specific authentication endpoints
- Keep Keycloak and native authentication endpoints

### 4.4 Update Other Service Files

**Files with Supabase References:**
- `apps/api/src/modules/metrics/metrics.service.ts`
- `apps/api/src/modules/auth/native-auth.service.ts`
- `apps/api/src/modules/auth/auth-user.service.ts`
- `apps/api/src/modules/teams/teams.service.ts`
- `apps/api/src/modules/reports/reports.service.ts`
- `apps/api/src/middleware/db-session.middleware.ts`
- `apps/api/src/guards/enhanced-auth.guard.ts`

**Action:** REVIEW & UPDATE

**Tasks:**
- Search for `supabase` references
- Remove unused imports
- Replace with TypeORM/native PostgreSQL queries

### 4.5 Update Configuration

**File:** `apps/api/src/config/database.config.ts`

**Action:** UPDATE

**Tasks:**
- Remove any Supabase connection fallback logic
- Ensure only native PostgreSQL configuration

**File:** `packages/config/src/index.ts`

**Action:** UPDATE

**Tasks:**
- Remove Supabase environment variable exports

---

## Phase 5: Remove Dependencies ✅ SAFE

### 5.1 Remove Backend Dependencies

```bash
cd apps/api
npm uninstall @supabase/supabase-js
```

### 5.2 Remove Frontend Dependencies

```bash
cd apps/web
npm uninstall @supabase/supabase-js @supabase/auth-helpers-nextjs
```

### 5.3 Update Root Package Lock

```bash
cd /Users/daniel/workspace/perfana-next-gen
npm install
```

---

## Phase 6: Archive & Remove Directories ✅ SAFE

### 6.1 Create Archive Directory

```bash
mkdir -p database/archive
```

### 6.2 Archive Migration Documentation

```bash
mv MIGRATION_SUPABASE_TO_POSTGRES.md database/archive/
```

### 6.3 Review & Move SQL Migrations

**Current Location:** `supabase/migrations/*.sql`

**Files:**
- `20251002_add_config_hash_tracking.sql`
- `20251002_auto_mark_results_fresh.sql`
- `20251002_fix_stale_marking_trigger.sql`
- `20251006_add_panel_id_to_dynatrace_query.sql`
- `20251006_create_dynatrace_query_table.sql`
- `20251006_update_dynatrace_query_schema.sql`

**Action:** MOVE (if needed for reference)

```bash
mkdir -p database/migrations
cp -r supabase/migrations/*.sql database/migrations/
```

**Note:** These are PostgreSQL DDL scripts and may be valuable for schema history.

### 6.4 Archive Data Dump

```bash
mv supabase_data_dump.sql database/archive/
```

**Alternative:** Delete if no longer needed (115 MB file)

### 6.5 Remove Supabase Directory

```bash
rm -rf supabase/
```

---

## Phase 7: Update Documentation ✅ IMPORTANT

### 7.1 Update CLAUDE.md

**File:** `CLAUDE.md`

#### Technology Stack Section (Line 15-22)

**Remove:**
```markdown
- **Database**: Supabase (PostgreSQL with real-time subscriptions)
- **Authentication**: Supabase Auth with Row Level Security
```

**Replace with:**
```markdown
- **Database**: PostgreSQL with TypeORM
- **Authentication**: Keycloak JWT + API Keys
```

#### Authentication System Section (Line 34-100)

**Update:**
- Remove "Supabase JWT Authentication" references
- Update to "Keycloak JWT Authentication"
- Remove `perfana_access_token` / `perfana_refresh_token` localStorage references (if using Keycloak tokens)
- Update auth flow documentation

#### Environment Configuration Section (Line 104-112)

**Remove:**
```markdown
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key (frontend)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (backend)
```

**Add (if not present):**
```markdown
- `KEYCLOAK_URL` - Keycloak server URL
- `KEYCLOAK_REALM` - Keycloak realm name
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port
- `DB_USERNAME` - PostgreSQL username
- `DB_PASSWORD` - PostgreSQL password
- `DB_NAME` - PostgreSQL database name
```

#### Update Admin Endpoints Section (Line 100)

**Remove:**
```markdown
#### Admin Only Endpoints (Supabase JWT Required)
```

**Replace with:**
```markdown
#### Admin Only Endpoints (Keycloak JWT Required)
```

#### Update Real-time Features Section (Line 168)

**Remove:**
```markdown
3. **Real-time Features** - Live test monitoring via Supabase subscriptions
```

**Replace with:**
```markdown
3. **Real-time Features** - Live test monitoring via Socket.IO + Redis
```

### 7.2 Update Environment Files

**Files to Update:**
- `.env.example`
- `.env.local.example` (if exists)
- `README.md` (if contains setup instructions)

**Remove from all environment examples:**
```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
USE_KEYCLOAK_AUTH=
```

**Ensure these exist:**
```bash
KEYCLOAK_URL=
KEYCLOAK_REALM=
KEYCLOAK_CLIENT_ID=
KEYCLOAK_CLIENT_SECRET=
DB_HOST=
DB_PORT=
DB_USERNAME=
DB_PASSWORD=
DB_NAME=
```

### 7.3 Update README.md (if applicable)

**Action:** REVIEW & UPDATE

**Tasks:**
- Remove Supabase setup instructions
- Update database setup to reference native PostgreSQL
- Update authentication setup to reference Keycloak

---

## Phase 8: Verify & Test 🧪 CRITICAL

### 8.1 Type Check

```bash
npm run type-check
```

**Expected:** No TypeScript errors related to missing Supabase types

### 8.2 Build Check

```bash
npm run build
```

**Expected:** Clean build without errors

### 8.3 Lint Check

```bash
npm run lint
```

**Expected:** No linting errors

### 8.4 Test Authentication

**Manual Tests:**
1. ✅ Verify Keycloak login works
2. ✅ Verify API key authentication works
3. ✅ Test protected endpoints with JWT token
4. ✅ Test protected endpoints with API key
5. ✅ Verify admin-only endpoints enforce Keycloak JWT

### 8.5 Test Real-time Features

**Manual Tests:**
1. ✅ Verify Socket.IO connections work
2. ✅ Test test run creation broadcasts
3. ✅ Test test run update broadcasts
4. ✅ Test test run deletion broadcasts
5. ✅ Verify Redis pub/sub is functioning

### 8.6 Test Core Functionality

**Manual Tests:**
1. ✅ Create a test run
2. ✅ Update a test run
3. ✅ Delete a test run
4. ✅ List test runs with filters
5. ✅ Access Grafana integration
6. ✅ Access Dynatrace integration

---

## Execution Order

Execute the phases in this order to minimize disruption:

```
✅ 1. Create database/archive directory (Phase 6.1)
✅ 2. Archive MIGRATION_SUPABASE_TO_POSTGRES.md (Phase 6.2)
✅ 3. Copy migration SQL files to database/migrations (Phase 6.3)
✅ 4. Archive supabase_data_dump.sql (Phase 6.4)
⚠️ 5. Remove unused auth files (Phase 1)
⚠️ 6. Update frontend code (Phase 3)
⚠️ 7. Update backend code (Phase 4)
⚠️ 8. Update documentation (Phase 7)
⚠️ 9. Remove dependencies (Phase 5)
⚠️ 10. Remove supabase directory (Phase 6.5)
🧪 11. Run type-check (Phase 8.1)
🧪 12. Run build (Phase 8.2)
🧪 13. Run tests (Phase 8.3-8.6)
✅ 14. Commit changes
```

---

## Important Considerations

### Authentication Strategy

- **Current:** Using Keycloak (`KeycloakEnhancedAuthGuard`)
- **Verify:** All auth flows work without Supabase
- **Ensure:** User management is handled by Keycloak
- **Check:** Token refresh mechanisms are in place

### Database Migrations

- Migration files in `supabase/migrations/` are standard PostgreSQL SQL
- These files document the schema evolution
- Consider moving to `database/migrations/` before deletion
- They may be needed for recreating the schema or auditing

### Real-time Features

- Already using Socket.IO + Redis (NOT Supabase realtime)
- No changes needed to realtime functionality
- Verify Redis connection configuration is correct

### Environment Variables

- Update all deployment configs to remove Supabase vars
- Ensure all Keycloak vars are present in production
- Update CI/CD pipelines if they reference Supabase vars

### Database Schema

- Database schema already exists in PostgreSQL
- TypeORM is configured with `synchronize: false`
- Schema managed through SQL migration files
- No Row Level Security (RLS) - using application-level authorization

---

## Rollback Plan

If issues arise during removal:

1. **Revert Git Changes:**
   ```bash
   git reset --hard HEAD
   ```

2. **Restore Dependencies:**
   ```bash
   npm install
   ```

3. **Check Running Services:**
   - Verify PostgreSQL is running
   - Verify Keycloak is running
   - Verify Redis is running

4. **Review Logs:**
   - Check backend logs for connection errors
   - Check frontend console for auth errors

---

## Post-Removal Checklist

- [ ] All Supabase dependencies removed from package.json files
- [ ] All Supabase imports removed from TypeScript files
- [ ] All environment variable references updated
- [ ] Documentation updated (CLAUDE.md, README.md, .env.example)
- [ ] Type check passes
- [ ] Build succeeds
- [ ] Authentication works (Keycloak + API Keys)
- [ ] Real-time features work (Socket.IO + Redis)
- [ ] Core CRUD operations work
- [ ] Supabase directory removed
- [ ] Changes committed to git

---

## Additional Resources

- [TypeORM Migrations Documentation](https://typeorm.io/migrations)
- [Keycloak Admin API](https://www.keycloak.org/docs-api/latest/rest-api/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Socket.IO Documentation](https://socket.io/docs/)

---

**Last Updated:** 2025-10-12
**Status:** Ready for Execution
