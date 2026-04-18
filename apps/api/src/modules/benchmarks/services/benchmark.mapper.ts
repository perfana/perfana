import { Benchmark as BenchmarkEntity } from '../../../entities';
import { Benchmark } from './benchmark-query.types';

/**
 * Utility service for mapping benchmark entities to DTOs
 */
export class BenchmarkMapper {
  /**
   * Map a BenchmarkEntity to the Benchmark DTO
   */
  static mapEntityToBenchmark(entity: BenchmarkEntity): Benchmark {
    return {
      id: entity.id,
      system_under_test_id: entity.system_under_test_id,
      test_environment: entity.test_environment,
      workload: entity.workload,
      source: entity.source,
      grafana_instance: entity.grafana_instance,
      dashboard_label: entity.dashboard_label,
      dashboard_id: entity.dashboard_id,
      dashboard_uid: entity.dashboard_uid,
      application_dashboard_id: entity.application_dashboard_id,
      metrics_source_id: entity.metrics_source_id,
      generic_check_id: entity.generic_check_id,
      configuration: entity.configuration,
      config_title: entity.config_title || (entity.configuration as any)?.title,
      config_id: entity.config_id,
      panel_title: entity.panel_title,
      metric_unit: entity.metric_unit,
      evaluate_type: entity.evaluate_type || (entity.configuration as any)?.evaluateType,
      requirement_operator: entity.requirement_operator || (entity.configuration as any)?.requirement?.operator,
      requirement_value: entity.requirement_value ?? ((entity.configuration as any)?.requirement?.value != null ? Number((entity.configuration as any).requirement.value) : undefined),
      enabled: entity.enabled,
      valid: entity.valid,
      tags: entity.tags,
      created_at: entity.created_at.toISOString(),
      updated_at: entity.updated_at.toISOString(),
      benchmark_type: entity.benchmark_type || 'metric',
      transaction_name: entity.transaction_name,
      apdex_threshold_ms: entity.apdex_threshold_ms,
      min_apdex_score: entity.min_apdex_score ? parseFloat(String(entity.min_apdex_score)) : undefined,
      include_failed_requests: entity.include_failed_requests ?? false,
      exclude_ramp_up_time: entity.exclude_ramp_up_time ?? true,
      systems_under_test: entity.system_under_test ? {
        id: entity.system_under_test.id,
        name: entity.system_under_test.name,
      } : undefined,
    };
  }
}
