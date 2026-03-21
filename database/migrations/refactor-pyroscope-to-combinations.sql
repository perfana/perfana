-- Migration: Refactor Pyroscope configuration to use app+profiler combinations
-- Date: 2025-12-09
-- Description: Changes from separate arrays to array of {application, profiler} combinations

-- Add new JSONB column for combinations
ALTER TABLE systems_under_test
  ADD COLUMN IF NOT EXISTS pyroscope_configurations JSONB DEFAULT '[]'::jsonb;

-- Migrate existing data: create combinations from cartesian product
-- This assumes the old design intended all apps × all profilers
UPDATE systems_under_test
SET pyroscope_configurations = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'application', app,
      'profiler', prof
    )
  )
  FROM unnest(COALESCE(pyroscope_applications, ARRAY[]::text[])) AS app
  CROSS JOIN unnest(COALESCE(pyroscope_profilers, ARRAY[]::text[])) AS prof
)
WHERE pyroscope_applications IS NOT NULL
  AND array_length(pyroscope_applications, 1) > 0
  AND pyroscope_profilers IS NOT NULL
  AND array_length(pyroscope_profilers, 1) > 0;

-- Drop old array columns (keep _old columns for now)
ALTER TABLE systems_under_test
  DROP COLUMN IF EXISTS pyroscope_applications;

ALTER TABLE systems_under_test
  DROP COLUMN IF EXISTS pyroscope_profilers;

-- Add index for JSONB operations
CREATE INDEX IF NOT EXISTS idx_systems_under_test_pyroscope_configurations
  ON systems_under_test USING GIN (pyroscope_configurations);

-- Add column comment
COMMENT ON COLUMN systems_under_test.pyroscope_configurations
  IS 'Array of {application, profiler} combinations for Pyroscope profiling';

-- Log completion
SELECT 'Successfully refactored Pyroscope configuration to use combinations' as status;
