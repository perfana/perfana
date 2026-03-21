-- Migration: Add stale detection fields to test_runs table
-- Date: 2025-12-02
-- Description: Adds is_stale and stale_detected_at columns to support stale test run detection

-- Add is_stale column (boolean, default false)
ALTER TABLE test_runs
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN DEFAULT false;

-- Add stale_detected_at column (timestamp)
ALTER TABLE test_runs
ADD COLUMN IF NOT EXISTS stale_detected_at TIMESTAMP WITH TIME ZONE;

-- Create index on is_stale for faster queries
CREATE INDEX IF NOT EXISTS idx_test_runs_is_stale ON test_runs(is_stale);

-- Create composite index on completed and updated_at for stale detection queries
CREATE INDEX IF NOT EXISTS idx_test_runs_completed_updated ON test_runs(completed, updated_at);

-- Update existing rows to have is_stale = false if NULL
UPDATE test_runs SET is_stale = false WHERE is_stale IS NULL;

-- Log completion
SELECT 'Successfully added stale detection fields to test_runs table' as status;
