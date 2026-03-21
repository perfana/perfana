-- Insert simple check results for MyAfterburner-acc-loadTest-00010 into PostgreSQL check_results table
-- 1 passed and 1 failed check result

-- First, get the system_under_test_id for MyAfterburner
WITH system_info AS (
  SELECT id as system_under_test_id FROM systems_under_test WHERE name = 'MyAfterburner' LIMIT 1
)

INSERT INTO check_results (
  test_run_id,
  system_under_test_id,
  test_environment,
  workload,
  dashboard_label,
  dashboard_uid,
  panel_title,
  panel_id,
  panel_type,
  metric_name,
  generic_check_id,
  benchmark_id,
  status,
  message,
  exclude_ramp_up_time,
  ramp_up,
  average_all,
  evaluate_type,
  panel_average,
  meets_requirement,
  requirement,
  targets,
  source,
  created_at
)
SELECT 
  'MyAfterburner-acc-loadTest-00010',
  system_info.system_under_test_id,
  'acc',
  'loadTest',
  dashboard_label,
  dashboard_uid,
  panel_title,
  panel_id,
  panel_type,
  metric_name,
  generic_check_id,
  benchmark_id,
  status,
  message,
  exclude_ramp_up_time,
  ramp_up,
  average_all,
  evaluate_type,
  panel_average,
  meets_requirement,
  requirement,
  targets,
  source,
  NOW()
FROM system_info,
(VALUES 
  -- Record 1: PASSED - JVM G1GC Memory Check
  ('JVM memory management G1GC', 'spring-boot-kubernetes-jvm-g1gc-mimir', 'Maximum Pause Durations end of major GC by cause', 178, 'timeseries', NULL, 'jvm-gc-check-1', 'jvm-gc-benchmark-1', 'COMPLETE', 'All targets meet requirements', true, 60, false, 'max', 0.133, true, '{"operator": "lt", "value": 0.6}'::jsonb, '[{"target": "Allocation Failure", "value": 0.133, "meets_requirement": true}]'::jsonb, 'grafana'),
  
  -- Record 2: FAILED - CPU Usage Check
  ('Docker container metrics', 'docker-telegraf-influxdb', 'CPU Usage', 1, 'timeseries', 'CPU', 'cpu-check-1', 'cpu-benchmark-1', 'COMPLETE', 'Target failed requirements', true, 60, false, 'avg', 82.72, false, '{"operator": "lt", "value": 70}'::jsonb, '[{"target": "Usage", "value": 82.72, "meets_requirement": false}]'::jsonb, 'grafana')

) AS t(dashboard_label, dashboard_uid, panel_title, panel_id, panel_type, metric_name, generic_check_id, benchmark_id, status, message, exclude_ramp_up_time, ramp_up, average_all, evaluate_type, panel_average, meets_requirement, requirement, targets, source);