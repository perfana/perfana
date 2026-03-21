-- Migration: Add tags to test_run_configs unique constraint
-- Date: 2025-12-29
-- Updated: 2025-12-30 - Added tags column type conversion from text to text[]
-- Description: Changes the unique constraint on test_run_configs to include tags,
--              allowing the same config key to exist with different tags (e.g., different kubernetes services)
--
-- BACKGROUND:
-- The previous constraint (test_run_id, key) caused incorrect config comparisons because
-- configs from different services (e.g., optimus-prime-be vs afterburner-db-mysql) were being
-- overwritten and compared incorrectly. For example:
--   - Test run 00029: key=metadata.labels.app.kubernetes.io/name, value=afterburner, tags={kubernetes, optimus-prime-be}
--   - Test run 00030: key=metadata.labels.app.kubernetes.io/name, value=mysql, tags={kubernetes, afterburner-db-mysql}
-- These are configs from DIFFERENT services but were compared as if they were the same.

-- ============================================================================
-- STEP 1: CONVERT TAGS COLUMN FROM TEXT TO TEXT[] (IF NEEDED)
-- ============================================================================

DO $$
DECLARE
  v_column_type text;
BEGIN
  -- Check current column type
  SELECT data_type INTO v_column_type
  FROM information_schema.columns
  WHERE table_name = 'test_run_configs' AND column_name = 'tags';

  IF v_column_type = 'text' THEN
    RAISE NOTICE 'Converting tags column from text to text[]...';

    -- Create temporary column
    ALTER TABLE test_run_configs ADD COLUMN IF NOT EXISTS tags_new text[];

    -- Convert existing JSON-like strings to arrays
    -- Format: {"tag1","tag2"} or {tag1,tag2} -> ARRAY['tag1','tag2']
    UPDATE test_run_configs
    SET tags_new = CASE
      WHEN tags IS NULL OR tags = '' OR tags = '{}' THEN '{}'::text[]
      ELSE (
        SELECT COALESCE(array_agg(trim(both '"' from elem))::text[], '{}'::text[])
        FROM unnest(string_to_array(
          trim(both '{}' from tags),
          ','
        )) AS elem
        WHERE elem IS NOT NULL AND elem != ''
      )
    END
    WHERE tags_new IS NULL;

    -- Drop old column and rename new one
    ALTER TABLE test_run_configs DROP COLUMN tags;
    ALTER TABLE test_run_configs RENAME COLUMN tags_new TO tags;

    RAISE NOTICE 'Tags column converted to text[] successfully';
  ELSIF v_column_type = 'ARRAY' THEN
    RAISE NOTICE 'Tags column is already text[], skipping conversion';
  ELSE
    RAISE NOTICE 'Tags column type: %, assuming text[] compatible', v_column_type;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: CREATE IMMUTABLE FUNCTION FOR TAGS HASHING
-- ============================================================================

-- Create an immutable function to hash the tags array for use in the unique index
-- This is required because PostgreSQL doesn't support array columns directly in unique constraints
CREATE OR REPLACE FUNCTION tags_hash(tags text[]) RETURNS text AS $$
BEGIN
  RETURN md5(COALESCE(array_to_string(tags, ','), ''));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- STEP 3: UPDATE UNIQUE CONSTRAINT
-- ============================================================================

-- Drop the old unique constraint that only used (test_run_id, key)
ALTER TABLE test_run_configs DROP CONSTRAINT IF EXISTS test_run_configs_test_run_id_key_key;

-- Drop old index if exists (for idempotency)
DROP INDEX IF EXISTS test_run_configs_test_run_id_key_tags_key;

-- Create new unique index that includes tags hash
-- This allows the same key to exist multiple times per test run as long as tags are different
CREATE UNIQUE INDEX test_run_configs_test_run_id_key_tags_key
ON test_run_configs (test_run_id, key, tags_hash(tags));

-- ============================================================================
-- STEP 4: VERIFY MIGRATION
-- ============================================================================

DO $$
DECLARE
  v_column_type text;
  v_old_constraint_exists BOOLEAN;
  v_new_index_exists BOOLEAN;
  v_function_exists BOOLEAN;
BEGIN
  -- Check column type
  SELECT data_type INTO v_column_type
  FROM information_schema.columns
  WHERE table_name = 'test_run_configs' AND column_name = 'tags';

  -- Check old constraint is gone
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'test_run_configs_test_run_id_key_key'
  ) INTO v_old_constraint_exists;

  -- Check new index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'test_run_configs_test_run_id_key_tags_key'
  ) INTO v_new_index_exists;

  -- Check function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'tags_hash'
  ) INTO v_function_exists;

  -- Verify column type
  IF v_column_type != 'ARRAY' THEN
    RAISE EXCEPTION 'Tags column is not text[] (current type: %)', v_column_type;
  END IF;

  IF v_old_constraint_exists THEN
    RAISE WARNING 'Old constraint test_run_configs_test_run_id_key_key still exists';
  ELSE
    RAISE NOTICE 'Old constraint successfully removed';
  END IF;

  IF v_new_index_exists AND v_function_exists THEN
    RAISE NOTICE 'New unique index test_run_configs_test_run_id_key_tags_key created successfully';
  ELSE
    RAISE EXCEPTION 'Failed to create new unique index or function';
  END IF;

  RAISE NOTICE 'All verifications passed!';
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

SELECT 'Migration completed: test_run_configs now supports same key with different tags' as status;
