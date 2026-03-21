# Duplicate Application Dashboards & Benchmarks Fix

## 📋 Overview

This document describes the comprehensive fix for duplicate `application_dashboards` and `benchmarks` records in the PerfanaWebshop system (and potentially other systems).

**Issue**: The auto-configuration service was creating duplicate records because:
1. No database-level unique constraints existed
2. Application-layer deduplication was insufficient
3. Benchmark insertion used direct INSERT without checking for existing records
4. Cron jobs running every minute increased collision probability

---

## ✅ Implemented Solutions

### 1. Cron Schedule Adjustment (COMPLETED)

**Changed**: Auto-config and Grafana sync cron schedules from every 1 minute → every 2 minutes

**Files Modified**:
- `apps/grafana-sync/src/modules/auto-config/auto-config.service.ts:47`
- `apps/grafana-sync/src/modules/grafana-sync/grafana-sync.service.ts:73`

**Impact**: Reduces the frequency of auto-config runs, decreasing the likelihood of race conditions.

---

### 2. Deduplication Script (COMPLETED)

**Created**: `apps/grafana-sync/scripts/deduplicate-dashboards-benchmarks.ts`

**Purpose**: One-time cleanup script to remove existing duplicates before applying database constraints.

**Features**:
- Finds duplicate records based on unique constraint fields
- Keeps the OLDEST record (earliest `created_at`)
- Updates foreign key references before deletion
- Supports dry-run mode for safe preview
- Can filter by specific System Under Test

**Usage**:
```bash
# Preview duplicates (dry run - safe)
cd apps/grafana-sync
npx tsx scripts/deduplicate-dashboards-benchmarks.ts --dry-run

# Filter by specific SUT
npx tsx scripts/deduplicate-dashboards-benchmarks.ts --sut=PerfanaWebshop --dry-run

# Execute deletion (after reviewing dry-run results)
npx tsx scripts/deduplicate-dashboards-benchmarks.ts --execute
```

---

### 3. Database Migration with Unique Constraints (COMPLETED)

**Created**: `database/migrations/add-unique-constraints-dashboards-benchmarks.sql`

**Constraints Added**:

#### Application Dashboards
```sql
CREATE UNIQUE INDEX uq_application_dashboards_unique ON application_dashboards (
  system_under_test_id,
  test_environment,
  grafana_instance_id,
  dashboard_uid,
  dashboard_label
);
```

#### Benchmarks
```sql
CREATE UNIQUE INDEX uq_benchmarks_unique ON benchmarks (
  system_under_test_id,
  test_environment,
  workload,
  COALESCE(application_dashboard_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(generic_check_id, '')
);
```

**Note**: COALESCE handles nullable fields in benchmarks table.

**Prerequisites**: MUST run deduplication script first!

**Usage**:
```bash
# Run migration
psql -h localhost -U postgres -d perfana < database/migrations/add-unique-constraints-dashboards-benchmarks.sql
```

---

### 4. Entity Constraint Updates (COMPLETED)

**Modified Files**:
- `packages/shared/src/entities/application-dashboard.entity.ts`
- `packages/shared/src/entities/benchmark.entity.ts`

**Changes**:
```typescript
// ApplicationDashboard
@Unique('uq_application_dashboards_unique', [
  'systemUnderTestId',
  'testEnvironment',
  'grafanaInstanceId',
  'dashboardUid',
  'dashboardLabel'
])

// Benchmark
@Unique('uq_benchmarks_unique', [
  'system_under_test_id',
  'test_environment',
  'workload',
  'application_dashboard_id',
  'generic_check_id'
])
```

---

### 5. Upsert Pattern for Benchmarks (COMPLETED)

**Modified**: `apps/grafana-sync/src/modules/auto-config/auto-config-updates.service.ts:290-412`

**Changes**:
- Added existence check before insertion
- If benchmark exists → UPDATE with new data
- If benchmark doesn't exist → INSERT new record
- Returns `{ insertedId, wasCreated }` for tracking

**Logic Flow**:
```typescript
1. Find existing benchmark by unique constraint fields
2. IF exists:
     UPDATE existing record with id preserved
     return { insertedId, wasCreated: false }
3. ELSE:
     INSERT new record
     return { insertedId, wasCreated: true }
```

---

## 🚀 Deployment Instructions

### Step 1: Run Deduplication Script (REQUIRED FIRST)

```bash
cd apps/grafana-sync

# 1. Preview duplicates
npx tsx scripts/deduplicate-dashboards-benchmarks.ts --dry-run

# 2. Review the output carefully

# 3. Execute deduplication
npx tsx scripts/deduplicate-dashboards-benchmarks.ts --execute
```

**Expected Output**:
```
================================================================================
  DEDUPLICATION SCRIPT FOR APPLICATION_DASHBOARDS & BENCHMARKS
================================================================================

Mode: ⚠️  EXECUTE (will delete duplicates)

📊 Finding duplicate application_dashboards...
Found 5 duplicate groups in application_dashboards

📊 Finding duplicate benchmarks...
Found 12 duplicate groups in benchmarks

--------------------------------------------------------------------------------
  APPLICATION_DASHBOARDS DEDUPLICATION
--------------------------------------------------------------------------------

  Group: PerfanaWebshop / production / dashboard-uid-123 / Performance Dashboard
    Total records: 3
    Keep (oldest):  uuid-1
    Delete:         uuid-2, uuid-3
    ✅ Deleted 2 duplicate(s) and updated references

...

================================================================================
  SUMMARY
================================================================================

Application Dashboards:
  Total duplicate records found: 15
  Records to keep:               5
  Records to delete:             10

Benchmarks:
  Total duplicate records found: 36
  Records to keep:               12
  Records to delete:             24

================================================================================

✅ Deduplication completed successfully!
```

### Step 2: Run Database Migration

```bash
# Connect to your database and run the migration
psql -h localhost -U postgres -d perfana < database/migrations/add-unique-constraints-dashboards-benchmarks.sql
```

**Expected Output**:
```
NOTICE: No duplicates found in application_dashboards. Proceeding with constraint creation.
Successfully created unique constraint on application_dashboards

NOTICE: No duplicates found in benchmarks. Proceeding with constraint creation.
Successfully created unique constraint on benchmarks

NOTICE: ✅ Unique constraint on application_dashboards verified
NOTICE: ✅ Unique constraint on benchmarks verified

✅ Migration completed successfully!
```

**If Migration Fails**:
- Error message will indicate how many duplicate groups still exist
- Re-run the deduplication script
- Investigate any records that couldn't be deduplicated

### Step 3: Deploy Code Changes

```bash
# From project root
npm run build

# Restart services
# Option 1: Development
npm run dev

# Option 2: Production
pm2 restart grafana-sync
# or your production deployment method
```

### Step 4: Verify the Fix

#### A. Check for New Duplicates

Run this query after the fix has been deployed for a few hours:

```sql
-- Check application_dashboards for duplicates
SELECT
  system_under_test_id,
  test_environment,
  dashboard_uid,
  dashboard_label,
  COUNT(*) as count
FROM application_dashboards
GROUP BY system_under_test_id, test_environment, grafana_instance_id, dashboard_uid, dashboard_label
HAVING COUNT(*) > 1;

-- Check benchmarks for duplicates
SELECT
  system_under_test_id,
  test_environment,
  workload,
  application_dashboard_id,
  generic_check_id,
  COUNT(*) as count
FROM benchmarks
GROUP BY
  system_under_test_id,
  test_environment,
  workload,
  application_dashboard_id,
  generic_check_id
HAVING COUNT(*) > 1;
```

**Expected Result**: Both queries should return **0 rows**.

#### B. Check Auto-Config Logs

```bash
# Monitor grafana-sync logs for upsert behavior
tail -f logs/grafana-sync.log | grep -i "upserting\|updating existing\|creating new"
```

**Expected Log Messages**:
```
[AutoConfigUpdatesService] Upserting benchmark for profile benchmark...
[AutoConfigUpdatesService] Updating existing benchmark with ID: uuid-xyz
[AutoConfigUpdatesService] Successfully updated benchmark with ID: uuid-xyz
```

or

```
[AutoConfigUpdatesService] Upserting benchmark for profile benchmark...
[AutoConfigUpdatesService] Creating new benchmark
[AutoConfigUpdatesService] Successfully inserted new benchmark with ID: uuid-abc
```

#### C. Verify Unique Constraints

```sql
-- List unique constraints on application_dashboards
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'application_dashboards'
  AND indexname = 'uq_application_dashboards_unique';

-- List unique constraints on benchmarks
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'benchmarks'
  AND indexname = 'uq_benchmarks_unique';
```

**Expected**: Both queries should return 1 row showing the unique index definition.

---

## 🔍 Monitoring & Validation

### Metrics to Track

1. **Duplicate Count** (should remain 0):
   ```sql
   -- Run hourly
   SELECT COUNT(*) as duplicate_groups FROM (
     SELECT system_under_test_id, test_environment, workload, application_dashboard_id, generic_check_id
     FROM benchmarks
     GROUP BY system_under_test_id, test_environment, workload, application_dashboard_id, generic_check_id
     HAVING COUNT(*) > 1
   ) duplicates;
   ```

2. **Upsert Statistics** (from logs):
   - Number of creates (wasCreated = true)
   - Number of updates (wasCreated = false)
   - Ratio should stabilize over time (more updates than creates after initial setup)

3. **Constraint Violation Errors**:
   ```bash
   # Should be 0
   grep "duplicate key value violates unique constraint" logs/grafana-sync.log | wc -l
   ```

---

## 🚨 Rollback Plan

If issues occur after deployment:

### 1. Remove Unique Constraints

```sql
-- Rollback migration
DROP INDEX IF EXISTS uq_application_dashboards_unique;
DROP INDEX IF EXISTS uq_benchmarks_unique;
```

### 2. Revert Code Changes

```bash
# Revert entity changes
git checkout HEAD~1 -- packages/shared/src/entities/application-dashboard.entity.ts
git checkout HEAD~1 -- packages/shared/src/entities/benchmark.entity.ts

# Revert service changes
git checkout HEAD~1 -- apps/grafana-sync/src/modules/auto-config/auto-config-updates.service.ts

# Revert cron changes
git checkout HEAD~1 -- apps/grafana-sync/src/modules/auto-config/auto-config.service.ts
git checkout HEAD~1 -- apps/grafana-sync/src/modules/grafana-sync/grafana-sync.service.ts

# Rebuild and restart
npm run build
pm2 restart grafana-sync
```

---

## 📊 Expected Results

After successful deployment:

### Immediate Effects
- ✅ No new duplicates created
- ✅ Upsert logic prevents duplicate attempts
- ✅ Database constraints enforce uniqueness
- ✅ Auto-config runs every 2 minutes instead of every minute

### Long-term Effects
- ✅ Cleaner database with no duplicate records
- ✅ Reduced database size and improved query performance
- ✅ More predictable auto-configuration behavior
- ✅ Easier troubleshooting and debugging

---

## 📚 Related Files

### Scripts
- `apps/grafana-sync/scripts/deduplicate-dashboards-benchmarks.ts` - Deduplication script

### Migrations
- `database/migrations/add-unique-constraints-dashboards-benchmarks.sql` - Database migration

### Entities
- `packages/shared/src/entities/application-dashboard.entity.ts` - ApplicationDashboard entity with @Unique
- `packages/shared/src/entities/benchmark.entity.ts` - Benchmark entity with @Unique

### Services
- `apps/grafana-sync/src/modules/auto-config/auto-config-updates.service.ts` - Upsert logic
- `apps/grafana-sync/src/modules/auto-config/auto-config.service.ts` - Cron schedule

### Documentation
- `DUPLICATE_FIX_IMPLEMENTATION.md` - This document

---

## 🎯 Success Criteria

- [ ] Deduplication script runs successfully with 0 errors
- [ ] Database migration applies successfully
- [ ] All unique constraints are in place
- [ ] No duplicate records exist after deployment
- [ ] Auto-config service logs show upsert behavior
- [ ] No constraint violation errors in logs after 24 hours
- [ ] Performance impact is negligible (< 10% increase in auto-config duration)

---

## 💡 Additional Notes

### Why COALESCE for Nullable Fields?

In PostgreSQL, `NULL != NULL`, meaning two NULL values are considered distinct. This would allow multiple rows with NULL values in the unique constraint fields.

We use `COALESCE()` to convert NULLs to sentinel values:
- `application_dashboard_id`: NULL → `00000000-0000-0000-0000-000000000000`
- `generic_check_id`: NULL → empty string `''`

This ensures that only ONE benchmark can exist with NULL values for these fields per unique combination.

### Why Keep Oldest Record?

The oldest record (earliest `created_at`) is kept because:
1. It was created first and likely referenced first
2. Preserves historical accuracy
3. Minimizes foreign key update cascades
4. Consistent with database audit practices

---

## 🆘 Troubleshooting

### Issue: Migration fails with "duplicate key value"

**Cause**: Duplicates still exist in the database

**Solution**:
1. Re-run deduplication script: `npx tsx scripts/deduplicate-dashboards-benchmarks.ts --execute`
2. Verify no duplicates: Run validation queries from Step 4
3. Retry migration

### Issue: Upsert creates duplicates

**Cause**: Unique constraint not applied or query logic mismatch

**Solution**:
1. Verify constraints exist (Step 4C)
2. Check that the `findOne` query in upsert matches the unique constraint fields exactly
3. Review auto-config logs for errors

### Issue: Performance degradation

**Cause**: Index overhead or increased query complexity

**Solution**:
1. Monitor query execution plans
2. Ensure indexes are being used
3. Consider adjusting cron schedule further (e.g., every 5 minutes)

---

**Document Version**: 1.0
**Last Updated**: 2025-12-03
**Author**: Claude Code
**Status**: Implementation Complete ✅
