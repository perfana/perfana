-- Migration: Update system_under_test table for Pyroscope multi-application support
-- Date: 2025-12-09
-- Description: Adds support for multiple Pyroscope applications and profilers per system under test

-- Add pyroscope_instance_id reference
ALTER TABLE systems_under_test
  ADD COLUMN IF NOT EXISTS pyroscope_instance_id UUID;

-- Add foreign key constraint
ALTER TABLE systems_under_test
  ADD CONSTRAINT fk_systems_under_test_pyroscope_instance
  FOREIGN KEY (pyroscope_instance_id)
  REFERENCES pyroscope_instances(id)
  ON DELETE SET NULL;

-- Rename existing columns to _old (for backward compatibility during migration)
ALTER TABLE systems_under_test
  RENAME COLUMN pyroscope_application TO pyroscope_application_old;

ALTER TABLE systems_under_test
  RENAME COLUMN pyroscope_profiler TO pyroscope_profiler_old;

-- Add new array columns
ALTER TABLE systems_under_test
  ADD COLUMN pyroscope_applications TEXT[];

ALTER TABLE systems_under_test
  ADD COLUMN pyroscope_profilers TEXT[];

-- Migrate existing data from single values to arrays
UPDATE systems_under_test
SET pyroscope_applications = ARRAY[pyroscope_application_old]
WHERE pyroscope_application_old IS NOT NULL AND pyroscope_application_old != '';

UPDATE systems_under_test
SET pyroscope_profilers = ARRAY[pyroscope_profiler_old]
WHERE pyroscope_profiler_old IS NOT NULL AND pyroscope_profiler_old != '';

-- Add index for pyroscope_instance_id for better query performance
CREATE INDEX IF NOT EXISTS idx_systems_under_test_pyroscope_instance
  ON systems_under_test(pyroscope_instance_id);

-- Add index for GIN operations on arrays (useful for array contains queries)
CREATE INDEX IF NOT EXISTS idx_systems_under_test_pyroscope_applications
  ON systems_under_test USING GIN (pyroscope_applications);

CREATE INDEX IF NOT EXISTS idx_systems_under_test_pyroscope_profilers
  ON systems_under_test USING GIN (pyroscope_profilers);

-- Add column comments for documentation
COMMENT ON COLUMN systems_under_test.pyroscope_instance_id
  IS 'Reference to Pyroscope instance for profiling data';

COMMENT ON COLUMN systems_under_test.pyroscope_applications
  IS 'Array of Pyroscope application/service names for profiling';

COMMENT ON COLUMN systems_under_test.pyroscope_profilers
  IS 'Array of Pyroscope profiler types (e.g., process_cpu/cpu, memory/alloc_in_new_tlab_bytes)';

COMMENT ON COLUMN systems_under_test.pyroscope_application_old
  IS 'DEPRECATED: Legacy single application field, to be removed in future migration';

COMMENT ON COLUMN systems_under_test.pyroscope_profiler_old
  IS 'DEPRECATED: Legacy single profiler field, to be removed in future migration';

-- Log completion
SELECT 'Successfully updated systems_under_test table for Pyroscope multi-application support' as status;

-- Note: The old columns (pyroscope_application_old, pyroscope_profiler_old) are kept temporarily
-- for backward compatibility. They should be dropped in a future migration after confirming
-- all data has been migrated and the application is working correctly with the new schema.
