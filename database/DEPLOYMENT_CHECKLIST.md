# Migration Consolidation Deployment Checklist

## 🎯 IMPORTANT: Production Impact

**For existing production databases with migrations already applied:**
- ✅ **No changes will occur** - TypeORM will detect no pending migrations
- ✅ **Zero downtime** - perfana-migration container completes immediately
- ✅ **Zero risk** - Production schema remains unchanged
- ℹ️ **Migration history unchanged** - Keeps all 15 existing migrations

**This consolidation only affects:**
- 🆕 Fresh database installations (dev, staging, new deployments)
- 🆕 Developers resetting their local databases

## Pre-Deployment

### 1. Backup Database ⚠️ MANDATORY

```bash
# Create timestamped backup
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U perfana -d perfana_native --clean --if-exists > backup_${DATE}.sql

# Verify backup was created
ls -lh backup_${DATE}.sql

# Test backup can be restored (on test database)
createdb perfana_test_backup
psql -U perfana -d perfana_test_backup < backup_${DATE}.sql
dropdb perfana_test_backup
```

### 2. Test on Staging Clone

```bash
# Clone production database to staging
pg_dump -U perfana -d perfana_native | psql -U perfana -d perfana_staging

# Run migrations on staging
cd apps/api
DB_NAME=perfana_staging npm run migrate

# Verify staging database
psql -U perfana -d perfana_staging -c "SELECT * FROM migrations ORDER BY timestamp;"
psql -U perfana -d perfana_staging -c "\d report_templates"
psql -U perfana -d perfana_staging -c "\d generated_reports" | grep pdf_data
```

### 3. Verify Code Changes

```bash
# Ensure you're on the correct branch
git branch --show-current

# Verify migration files
ls packages/shared/src/database/migrations/
# Should show only:
# - 1700000000000-ConsolidatedSchema.ts
# - 1774000000000-CleanupMigrationHistory.ts

# Verify exports
cat packages/shared/src/database/index.ts
# Should export only ConsolidatedSchema and CleanupMigrationHistory

# Verify build
cd packages/shared && npm run build && cd ../..
ls packages/shared/dist/database/migrations/*.js
# Should show only 2 .js files
```

### 4. Notify Team

- [ ] Post announcement in team chat
- [ ] Estimated downtime: 2-5 minutes
- [ ] Backup location shared with team
- [ ] Rollback procedure documented

## Deployment

### Step 1: Stop Services

```bash
# Stop API service
pm2 stop perfana-api

# Stop worker service
pm2 stop perfana-worker

# Stop web service (if applicable)
pm2 stop perfana-web

# Verify services stopped
pm2 status
```

### Step 2: Pull Code Changes

```bash
cd /path/to/perfana-next-gen

# Fetch latest changes
git fetch origin

# Checkout consolidation branch
git checkout main  # or your deployment branch

# Pull latest code
git pull origin main
```

### Step 3: Install Dependencies & Build

```bash
# Install dependencies
npm install

# Build packages
npm run build
```

### Step 4: Run Migrations

```bash
cd apps/api

# Run migrations with output logging
npm run migrate 2>&1 | tee migration_$(date +%Y%m%d_%H%M%S).log

# Expected output for PRODUCTION (existing database):
# ✅ Database is up to date
# (No migrations run - production already has migrations 1-15)

# Expected output for FRESH database only:
# ✅ Successfully ran 2 migration(s):
#    - ConsolidatedSchema1700000000000
#    - CleanupMigrationHistory1774000000000
```

### Step 5: Verify Migrations

```bash
# Check migration history
psql -U perfana -d perfana_native -c "SELECT * FROM migrations ORDER BY timestamp;"

# Expected result for PRODUCTION:
# Should show all 15 existing migrations (1700000000000 through 1775000000000)
# NO NEW MIGRATIONS ADDED (CleanupMigrationHistory timestamp 1774 is older than existing 1775)

# Expected result for FRESH database only:
# Should show 2 migrations:
#   - ConsolidatedSchema1700000000000
#   - CleanupMigrationHistory1774000000000

# Verify tables exist (production already has these)
psql -U perfana -d perfana_native -c "\\dt" | grep -E "(report_templates|generated_reports)"

# Verify pdf_data column exists (production already has this)
psql -U perfana -d perfana_native -c "\\d generated_reports" | grep pdf_data
```

### Step 6: Start Services

```bash
# Start API service
pm2 start perfana-api

# Start worker service
pm2 start perfana-worker

# Start web service
pm2 start perfana-web

# Verify services started
pm2 status
```

### Step 7: Smoke Tests

```bash
# Test API health
curl http://localhost:3001/api/health

# Test authentication
curl http://localhost:3001/api/auth/health

# Test test-runs endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3001/api/test-runs?limit=5

# Check logs for errors
pm2 logs perfana-api --lines 50
pm2 logs perfana-worker --lines 50
```

## Post-Deployment Verification

### Application Checks

- [ ] API responds to health checks
- [ ] Web application loads successfully
- [ ] User can log in
- [ ] Test runs are visible
- [ ] No errors in application logs

### Database Checks

- [ ] All expected tables exist (65+ tables)
- [ ] New tables have correct schema
- [ ] Foreign keys are intact
- [ ] Triggers are functional
- [ ] No orphaned migration records

### Monitoring

```bash
# Monitor logs for 15 minutes
pm2 logs --lines 100

# Check database connection pool
psql -U perfana -d perfana_native -c "
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE datname = 'perfana_native';
"

# Check for long-running queries
psql -U perfana -d perfana_native -c "
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';
"
```

## Rollback Procedure

### If Issues Occur

#### Option A: Code Rollback (Minor Issues)

```bash
# Stop services
pm2 stop all

# Revert code
git checkout PREVIOUS_COMMIT_HASH

# Rebuild
npm install
npm run build

# Restart services
pm2 restart all
```

#### Option B: Full Rollback (Major Issues)

```bash
# Stop all services
pm2 stop all

# Drop current database
dropdb perfana_native

# Restore from backup
createdb perfana_native
psql -U perfana -d perfana_native < backup_TIMESTAMP.sql

# Revert code
git checkout PREVIOUS_COMMIT_HASH
npm install
npm run build

# Restart services
pm2 restart all

# Verify restoration
curl http://localhost:3001/api/health
```

## Success Criteria

✅ All services running without errors
✅ Migration history shows 2 migrations
✅ All 6 new tables exist
✅ pdf_data column exists in generated_reports
✅ No errors in application logs for 30 minutes
✅ Users can access the application
✅ Test runs display correctly

## Post-Deployment Tasks

- [ ] Archive deployment logs
- [ ] Update team on successful deployment
- [ ] Monitor error rates for 24 hours
- [ ] Schedule backup verification
- [ ] Document any issues encountered

## Emergency Contacts

- **DevOps Lead**: [Contact Info]
- **Database Admin**: [Contact Info]
- **On-Call Engineer**: [Contact Info]

## Notes

- Migration consolidation is a **one-way operation**
- Backup is **mandatory** - do not skip
- Test on staging first - always
- Rollback window: 1 hour (backup must be recent)
- Expected downtime: 2-5 minutes
