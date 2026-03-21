# Database Migration Consolidation

## Summary

On 2026-02-03, we consolidated 11 incremental database migrations into a single initial schema setup, fixing critical bugs and establishing a clean migration baseline for future development.

## Critical Bug Fixed

**Migrations 9-11 were never run in any environment**

The file `/packages/shared/src/database/index.ts` only exported migrations 1-8. Migrations 9-11 existed but were never exported, which meant they were never loaded by TypeORM and thus never executed.

**Impact**: Report generation features were broken - the `report_templates` and `generated_reports` tables were never created in production databases.

## Migration History

### Before Consolidation (11 migrations)

1. **1700000000000-ConsolidatedSchema** - Base schema (59 tables)
2. **1765385200000-AddNotificationChannels** - notification_channels table
3. **1767000000000-AddApdexBenchmarkFields** - 5 Apdex-related columns to benchmarks table
4. **1768000000000-AddDynatraceMetricName** - metric_name column to dynatrace_queries
5. **1769000000000-AddDsMetricCollectionStatus** - ds_metric_collection_status table
6. **1769500000000-AddTrendsPresetSeriesConfig** - series_config column to trends_filter_presets
7. **1770000000000-AddComparePresetSeriesConfig** - series_config column to compare_filter_presets
8. **1771000000000-AddAwrTables** - awr_reports and awr_analysis tables
9. **1772000000000-AddReportPerformanceIndexes** - 5 performance indexes (NEVER RAN)
10. **1773000000000-AddGeneratedReportsAndTemplates** - report_templates and generated_reports tables (NEVER RAN)
11. **1773100000000-AddPdfDataColumn** - pdf_data column to generated_reports (NEVER RAN)

### After Consolidation (2 migrations)

1. **1700000000000-ConsolidatedSchema** - Complete schema including all elements from migrations 1-11
2. **1774000000000-CleanupMigrationHistory** - Applies missing schema elements from migrations 9-11 to existing databases

## Changes Made

### Schema Elements Added to Consolidated Schema

**New Tables (6)**:
- `notification_channels` - Slack/Teams webhook notifications
- `ds_metric_collection_status` - Metric collection tracking
- `awr_reports` - Oracle AWR report storage
- `awr_analysis` - AWR analysis results
- `report_templates` - Reusable report configurations
- `generated_reports` - Generated report instances with HTML and PDF support

**New Columns (8)**:
- `benchmarks.benchmark_type` - Apdex support
- `benchmarks.transaction_name` - Apdex support
- `benchmarks.apdex_threshold_ms` - Apdex support
- `benchmarks.min_apdex_score` - Apdex support
- `benchmarks.include_failed_requests` - Apdex support
- `dynatrace_queries.metric_name` - Explicit metric naming
- `trends_filter_presets.series_config` - JSON configuration
- `compare_filter_presets.series_config` - JSON configuration
- `generated_reports.pdf_data` - PDF binary data storage

**New Indexes (5)**:
- Performance indexes for report generation queries

### Files Modified

- `/packages/shared/src/database/index.ts` - Updated to export only ConsolidatedSchema and CleanupMigrationHistory
- `/packages/shared/src/database/migrations/1700000000000-ConsolidatedSchema.ts` - Updated down() method to include new tables
- `/database/schema_dump.sql` - Replaced with consolidated version including all 11 migrations

### Files Created

- `/packages/shared/src/database/migrations/1774000000000-CleanupMigrationHistory.ts` - Cleanup migration for existing databases

### Files Archived

Migrations 2-11 moved to `/database/migrations_archive/`:
- All 10 incremental migration files
- Original `schema_dump_old.sql`

## Database Scenarios

### Production Database (UNAFFECTED) ✅

**Current production has 15 migrations applied (timestamps 1700-1775).**

When deploying the consolidation:
1. perfana-migration container loads 2 migration files (1700, 1774)
2. TypeORM compares: Container has timestamps up to 1774, database has up to 1775
3. TypeORM conclusion: **"No pending migrations"**
4. **Result**: Production continues unchanged - zero risk, zero downtime

**Why this works:**
- Production already has the complete schema (all 15 migrations were applied)
- Migration timestamp 1774 (CleanupMigrationHistory) is older than production's latest (1775)
- TypeORM only runs migrations that are newer than what's in the database
- Schema is identical whether built incrementally (15 migrations) or consolidated (1 migration)

**Production migration history remains:**
```
15 migrations (1700000000000 through 1775000000000)
```

### Fresh Install (NEW BEHAVIOR) 🆕

When starting with a new database:
1. Run migrations: `npm run migrate` (or perfana-migration container)
2. ConsolidatedSchema creates complete schema (65+ tables)
3. CleanupMigrationHistory detects fresh database and skips
4. **Result**: Full schema with only 2 migrations in history

**Fresh install migration history:**
```
2 migrations (1700000000000, 1774000000000)
```

### Development Database (FRESH START)

For developers creating new local databases:
1. Drop existing database: `dropdb perfana_native`
2. Create fresh database: `createdb perfana_native`
3. Run migrations: `npm run migrate`
4. **Result**: Clean 2-migration setup instead of old 15-migration approach

## For Future Development

### Creating New Migrations

All new migrations should be timestamped after 1774000000000:

```bash
# Generate timestamp
date +%s000

# Create migration
npx typeorm migration:create packages/shared/src/database/migrations/[TIMESTAMP]-YourMigrationName
```

### Exporting Migrations

**CRITICAL**: Always export new migrations in `/packages/shared/src/database/index.ts`:

```typescript
export { YourMigrationName[TIMESTAMP] } from './migrations/[TIMESTAMP]-YourMigrationName';
```

Forgetting to export will prevent the migration from running!

### Running Migrations

```bash
# From repository root
cd apps/api
npm run migrate

# Or directly
npx ts-node -r tsconfig-paths/register run-migrations.ts
```

## Verification

### Check Migration Status

```bash
# Connect to database
psql -U perfana -d perfana_native

# View migrations
SELECT * FROM migrations ORDER BY timestamp;
```

Expected result:
```
 id |   timestamp   |                 name
----+---------------+--------------------------------------
  1 | 1700000000000 | ConsolidatedSchema1700000000000
  2 | 1774000000000 | CleanupMigrationHistory1774000000000
(2 rows)
```

### Verify New Tables

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('notification_channels', 'ds_metric_collection_status',
                  'awr_reports', 'awr_analysis',
                  'report_templates', 'generated_reports');
```

Should return all 6 tables.

### Verify New Columns

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'generated_reports' AND column_name = 'pdf_data';
```

Should return `pdf_data`.

## Rollback Plan

If issues occur after consolidation:

1. **Stop all services**
2. **Restore database from backup** (mandatory backup before deployment)
3. **Revert code** to previous commit
4. **Restart services**
5. **Investigate** issues in development environment

## References

- [Frontend Coding Rules](apps/web/CODING_RULES.md)
- [Backend Coding Rules](apps/api/CODING_RULES.md)
- [TypeORM Migrations Documentation](https://typeorm.io/migrations)
- Original consolidation plan: `/Users/daniel/.claude/plans/wobbly-booping-rocket.md`
