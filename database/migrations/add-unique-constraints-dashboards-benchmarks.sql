-- Migration: Add unique constraints to application_dashboards and benchmarks
-- Date: 2025-12-03
-- Description: Adds unique constraints to prevent duplicate records in application_dashboards and benchmarks tables
--
-- PREREQUISITES:
-- 1. Run the deduplication script FIRST:
--    cd apps/grafana-sync && npx tsx scripts/deduplicate-dashboards-benchmarks.ts --execute
--
-- IMPORTANT: This migration will FAIL if duplicates still exist!

-- ============================================================================
-- APPLICATION_DASHBOARDS UNIQUE CONSTRAINT
-- ============================================================================

-- Check for any remaining duplicates before adding constraint
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT
      system_under_test_id,
      test_environment,
      grafana_instance_id,
      dashboard_uid,
      dashboard_label,
      COUNT(*) as cnt
    FROM application_dashboards
    GROUP BY
      system_under_test_id,
      test_environment,
      grafana_instance_id,
      dashboard_uid,
      dashboard_label
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Found % duplicate groups in application_dashboards. Run deduplication script first!', duplicate_count;
  END IF;

  RAISE NOTICE 'No duplicates found in application_dashboards. Proceeding with constraint creation.';
END $$;

-- Create unique constraint on application_dashboards
-- This prevents duplicate dashboards for the same SUT, environment, Grafana instance, and dashboard
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_dashboards_unique
ON application_dashboards (
  system_under_test_id,
  test_environment,
  grafana_instance_id,
  dashboard_uid,
  dashboard_label
);

SELECT 'Successfully created unique constraint on application_dashboards' as status;

-- ============================================================================
-- BENCHMARKS UNIQUE CONSTRAINT
-- ============================================================================

-- Check for any remaining duplicates before adding constraint
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT
      system_under_test_id,
      test_environment,
      workload,
      COALESCE(application_dashboard_id::text, 'NULL') as app_dash_id,
      COALESCE(generic_check_id, 'NULL') as check_id,
      COUNT(*) as cnt
    FROM benchmarks
    GROUP BY
      system_under_test_id,
      test_environment,
      workload,
      COALESCE(application_dashboard_id::text, 'NULL'),
      COALESCE(generic_check_id, 'NULL')
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Found % duplicate groups in benchmarks. Run deduplication script first!', duplicate_count;
  END IF;

  RAISE NOTICE 'No duplicates found in benchmarks. Proceeding with constraint creation.';
END $$;

-- Create unique constraint on benchmarks
-- This prevents duplicate benchmarks for the same SUT, environment, workload, dashboard, and check
--
-- NOTE: We use COALESCE to handle NULL values in application_dashboard_id and generic_check_id
-- NULL values are treated as distinct in standard UNIQUE constraints, but we want to treat
-- them as equal for our use case (i.e., only one benchmark per NULL combination)
CREATE UNIQUE INDEX IF NOT EXISTS uq_benchmarks_unique
ON benchmarks (
  system_under_test_id,
  test_environment,
  workload,
  COALESCE(application_dashboard_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(generic_check_id, '')
);

SELECT 'Successfully created unique constraint on benchmarks' as status;

-- ============================================================================
-- VERIFY CONSTRAINTS
-- ============================================================================

-- Verify application_dashboards constraint
DO $$
DECLARE
  constraint_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'uq_application_dashboards_unique'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    RAISE NOTICE '✅ Unique constraint on application_dashboards verified';
  ELSE
    RAISE EXCEPTION '❌ Failed to create unique constraint on application_dashboards';
  END IF;
END $$;

-- Verify benchmarks constraint
DO $$
DECLARE
  constraint_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'uq_benchmarks_unique'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    RAISE NOTICE '✅ Unique constraint on benchmarks verified';
  ELSE
    RAISE EXCEPTION '❌ Failed to create unique constraint on benchmarks';
  END IF;
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

SELECT '✅ Migration completed successfully! Unique constraints added to application_dashboards and benchmarks.' as status;
