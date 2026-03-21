-- Migration: Add index on ds_metrics.test_run_id for worker query optimization
-- Date: 2026-01-18
-- Description: Adds standalone index on test_run_id to optimize dashboard panels update query
--              in PerformanceTestMetricsPipeline worker. While test_run_id is part of the
--              composite primary key, this standalone index improves query planner efficiency
--              for queries filtering only on test_run_id with JOINs to other tables.

-- Create index on test_run_id for faster dashboard lookup queries
CREATE INDEX IF NOT EXISTS idx_ds_metrics_test_run_id ON ds_metrics(test_run_id);

-- Log completion
SELECT 'Successfully added index on ds_metrics.test_run_id' as status;
