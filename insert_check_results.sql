-- Insert check results for MyAfterburner-acc-loadTest-00010 into PostgreSQL check_results table
-- Based on MongoDB checkResults data

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
  panel_description,
  panel_y_axes_format,
  metric_name,
  generic_check_id,
  benchmark_id,
  status,
  message,
  exclude_ramp_up_time,
  ramp_up,
  average_all,
  evaluate_type,
  match_pattern,
  panel_average,
  meets_requirement,
  requirement,
  benchmark,
  validate_with_default_if_no_data,
  validate_with_default_if_no_data_value,
  targets,
  metadata,
  source,
  tags,
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
  panel_description,
  panel_y_axes_format,
  metric_name,
  generic_check_id,
  benchmark_id,
  status,
  message,
  exclude_ramp_up_time,
  ramp_up,
  average_all,
  evaluate_type,
  match_pattern,
  panel_average,
  meets_requirement,
  requirement,
  benchmark,
  validate_with_default_if_no_data,
  validate_with_default_if_no_data_value,
  targets,
  ('{"perfana_info": "' || perfana_info || '"}')::jsonb,
  source,
  tags,
  NOW()
FROM system_info,
(VALUES 
  -- Record 1: JVM G1GC afterburner-fe - Maximum Pause Durations end of major GC
  ('JVM memory management G1GC afterburner-fe', 'spring-boot-kubernetes-jvm-g1gc-mimir', 'Maximum Pause Durations end of major GC by cause', 178, 'timeseries', NULL, 's', NULL, 'spring-boot-kubernetes-spring-boot-kubernetes-jvm-g1gc-mimir-178', '6M7rZIY9yFOb89uLGqQWCjo8YptxlOyAcyuoXs-KgQC', 'COMPLETE', 'All 1 targets meet requirements', true, 60, false, 'max', NULL, 0.133, true, '{"operator": "lt", "value": 0.6}'::jsonb, NULL, false, 0, '[{"target": "Allocation Failure", "value": 0.133, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.221259', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 2: JVM G1GC afterburner-be - Maximum Pause Durations end of major GC  
  ('JVM memory management G1GC afterburner-be', 'spring-boot-kubernetes-jvm-g1gc-mimir', 'Maximum Pause Durations end of major GC by cause', 178, 'timeseries', NULL, 's', NULL, 'spring-boot-kubernetes-spring-boot-kubernetes-jvm-g1gc-mimir-178', 'FMnEXDe5kiAaRqcCAGGegXCraMhXLdQfbBDIeXWuetP', '', NULL, NULL, 'COMPLETE', 'All 2 targets meet requirements', NULL, NULL, true, 60, false, 'max', NULL, NULL, 0.159, true, '{"operator": "lt", "value": 0.6}'::jsonb, NULL, false, 0, '[{"target": "Allocation Failure", "value": 0.159, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "Metadata GC Threshold", "value": 0.102, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.227195', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 3: JVM G1GC afterburner-fe - Maximum Pause Durations end of minor GC
  ('JVM memory management G1GC afterburner-fe', 'spring-boot-kubernetes-jvm-g1gc-mimir', 'Maximum Pause Durations end of minor GC by cause', 151, 'timeseries', NULL, 's', NULL, 'spring-boot-kubernetes-spring-boot-kubernetes-jvm-g1gc-mimir-151', '28G0VP9Md0pygJYQAA9l16iAfNJuFQWCWKD-p91-Sm3', '', NULL, NULL, 'COMPLETE', 'All 1 targets meet requirements', NULL, NULL, true, 60, false, 'max', NULL, NULL, 0.03, true, '{"operator": "lt", "value": 0.1}'::jsonb, NULL, false, 0, '[{"target": "Allocation Failure", "value": 0.03, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.232653', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 4: JVM G1GC afterburner-be - Maximum Pause Durations end of minor GC
  ('JVM memory management G1GC afterburner-be', 'spring-boot-kubernetes-jvm-g1gc-mimir', 'Maximum Pause Durations end of minor GC by cause', 151, 'timeseries', NULL, 's', NULL, 'spring-boot-kubernetes-spring-boot-kubernetes-jvm-g1gc-mimir-151', 'KhywpOnuJ8-Az1fRXxoZxQXHo9qRWDfnx0ciXrrx0nX', '', NULL, NULL, 'COMPLETE', 'All 1 targets meet requirements', NULL, NULL, true, 60, false, 'max', NULL, NULL, 0.03, true, '{"operator": "lt", "value": 0.1}'::jsonb, NULL, false, 0, '[{"target": "Allocation Failure", "value": 0.03, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.238143', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 5: HTTP connection pool afterburner-fe
  ('HTTP connection pool afterburner-fe', 'spring-boot-kubernetes-httpconpool-mimir', 'HTTP connection pool in use', 106, 'timeseries', NULL, 'percentunit', NULL, 'spring-boot-kubernetes-spring-boot-kubernetes-httpconpool-mimir-106', 'FMS-lnilvmSFe8HWiIovOut4oL02n8cnMT0tOS9fp_B', '', NULL, NULL, 'COMPLETE', 'All 1 targets meet requirements', NULL, NULL, true, 60, false, 'max', NULL, NULL, 0.5333333333333333, true, '{"operator": "lt", "value": 0.9}'::jsonb, '{"operator": "pst", "value": 0.2, "absoluteFailureThreshold": 0}'::jsonb, false, 0, '[{"target": "afterburner-http-client", "value": 0.5333333333333333, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.243001', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 6: HTTP connection pool afterburner-be
  ('HTTP connection pool afterburner-be', 'spring-boot-kubernetes-httpconpool-mimir', 'HTTP connection pool in use', 106, 'timeseries', NULL, 'percentunit', NULL, 'spring-boot-kubernetes-spring-boot-kubernetes-httpconpool-mimir-106', 'vCvdHzwSeUWjeYgRkFUnVJS5-chZKcrCubPfOA0XiFc', '', NULL, NULL, 'COMPLETE', 'All 1 targets meet requirements', NULL, NULL, true, 60, false, 'max', NULL, NULL, 0, true, '{"operator": "lt", "value": 0.9}'::jsonb, '{"operator": "pst", "value": 0.2, "absoluteFailureThreshold": 0}'::jsonb, false, 0, '[{"target": "afterburner-http-client", "value": 0, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.247470', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 7: Hikari Connection Pool afterburner-fe
  ('Hikari Connection Pool afterburner-fe', 'spring-boot-kubernetes-hickari-cp-mimir', 'Pending connections', 19, 'timeseries', NULL, 'short', NULL, 'spring-boot-kubernetes-spring-boot-kubernetes-hickari-cp-mimir-19', '8X-uqTYZ86sgElGpP3tudbDBBSi6NXirrXOW6fLMAXj', '', NULL, NULL, 'COMPLETE', 'All 1 targets meet requirements', NULL, NULL, true, 60, false, 'max', NULL, NULL, 0, true, '{"operator": "lt", "value": 10}'::jsonb, NULL, false, 0, '[{"target": "basket-db-pool", "value": 0, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.252270', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 8: Hikari Connection Pool afterburner-be
  ('Hikari Connection Pool afterburner-be', 'spring-boot-kubernetes-hickari-cp-mimir', 'Pending connections', 19, 'timeseries', NULL, 'short', NULL, 'spring-boot-kubernetes-spring-boot-kubernetes-hickari-cp-mimir-19', 'VTSgwxFKHh5w7188YcEWEOu2BlgXr3WV0iQsCWg1ml4', '', NULL, NULL, 'COMPLETE', 'All 2 targets meet requirements', NULL, NULL, true, 60, false, 'max', NULL, NULL, 0, true, '{"operator": "lt", "value": 10}'::jsonb, NULL, false, 0, '[{"target": "basket-db-pool", "value": 0, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "employee-db-pool", "value": 0, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.258476', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 9: JFR Exporter afterburner-fe CPU
  ('JFR Exporter afterburner-fe', 'jfr-exporter-influxdb', 'CPU', 2, 'timeseries', NULL, 'percent', NULL, 'jfr-jfr-exporter-influxdb-2', 'v1TQMO8lEvQ7L6S1S2KWTkyQAWrJj8GrsbF_7B5YUKb', '', NULL, NULL, 'COMPLETE', 'All 3 targets meet requirements', NULL, NULL, true, 60, false, 'avg', '^(?!.*max_machineTotal).*', NULL, 32.5410260788856, true, '{"operator": "lt", "value": 70}'::jsonb, '{"operator": "pst", "value": 10, "absoluteFailureThreshold": 0}'::jsonb, false, 0, '[{"target": "max_machineTotal", "value": 32.5410260788856, "meets_requirement": null, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "max_jvmSystem", "value": 0.20695897758067136, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "max_jvmUser", "value": 1.5936892066571502, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.264662', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 10: Docker container metrics afterburner-be CPU
  ('Docker container metrics perfana-demo-afterburner-be-1', 'docker-telegraf-influxdb', 'CPU', 1, 'timeseries', NULL, 'short', NULL, 'docker-docker-telegraf-influxdb-1', 'DLq4RaWFleRP90hUkGv70WopuKE04FXq_DcVMmberJN', '', NULL, NULL, 'COMPLETE', 'All 1 targets meet requirements', NULL, NULL, true, 60, false, 'avg', NULL, NULL, 13.49717016039426, true, '{"operator": "lt", "value": 70}'::jsonb, '{"operator": "pst", "value": 10, "absoluteFailureThreshold": 0}'::jsonb, false, 0, '[{"target": "Usage", "value": 13.49717016039426, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.272562', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 11: Docker container metrics afterburner-fe CPU (FAILED)
  ('Docker container metrics perfana-demo-afterburner-fe-1', 'docker-telegraf-influxdb', 'CPU', 1, 'timeseries', NULL, 'short', NULL, 'docker-docker-telegraf-influxdb-1', '4ZB5KfT75Gt6enB_xRJoQsk_6iJYsDKXvDCCxOz48s8', '', NULL, NULL, 'COMPLETE', '0 of 1 targets failed requirements', NULL, NULL, true, 60, false, 'avg', NULL, NULL, 82.71505960859577, false, '{"operator": "lt", "value": 70}'::jsonb, '{"operator": "pst", "value": 10, "absoluteFailureThreshold": 0}'::jsonb, false, 0, '[{"target": "Usage", "value": 82.71505960859577, "meets_requirement": false, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.283269', 'perfana-pipeline', '{}'::text[]),
  
  -- Record 12: Gatling Response times 99th percentile
  ('Gatling AfterburnerBasicSimulation', 'gatling-overview-influxdb', 'Response times 99th percentile', 31, 'timeseries', NULL, 'ms', NULL, 'gatling-gatling-overview-influxdb-31', 'K7EAw9fq22XSIa_O2qH3V8G479dwwXT4c82vgEcR7_p', '', NULL, NULL, 'COMPLETE', 'All 6 targets meet requirements', NULL, NULL, true, 60, false, 'avg', NULL, NULL, 143.03333333333333, true, '{"operator": "lt", "value": 1000}'::jsonb, NULL, false, 0, '[{"target": "memory_churn", "value": 143.03333333333333, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "remote_call_delayed", "value": 277.53333333333336, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "flaky_call", "value": 253, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "database_call", "value": 105.16666666666667, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "simple_delay", "value": 269.3333333333333, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}, {"target": "simple_cpu_burn", "value": 182.5, "meets_requirement": true, "isArtificial": false, "fitPercentageChange": null, "fitAbsoluteChange": null, "fitQuality": null, "fitMeetsRequirement": null}]'::jsonb, 'Created by Perfana Check Pipeline at 2025-09-04T21:24:45.287512', 'perfana-pipeline', '{}'::text[])
  
) AS t(dashboard_label, dashboard_uid, panel_title, panel_id, panel_type, panel_description, panel_y_axes_format, metric_name, generic_check_id, benchmark_id, snapshot_id, snapshot_key, snapshot_panel_url, status, message, detailed_message, check_duration_ms, exclude_ramp_up_time, ramp_up, average_all, evaluate_type, match_pattern, title_replacer, panel_average, meets_requirement, requirement, benchmark, validate_with_default_if_no_data, validate_with_default_if_no_data_value, targets, perfana_info, source, tags);