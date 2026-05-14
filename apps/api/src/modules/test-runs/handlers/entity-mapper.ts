/**
 * Entity Mapper Utility
 *
 * Shared mapping function for converting TypeORM TestRunEntity to API TestRun format.
 * Used by all handlers to ensure consistent response format.
 */

import { TestRun as TestRunEntity } from '../../../entities';
import { TestRun } from '../types/test-run.types';

/**
 * Map TypeORM TestRunEntity to API TestRun response format
 */
export function mapEntityToTestRun(entity: TestRunEntity): TestRun {
  return {
    id: entity.id,
    test_run_id: entity.testRunId,
    system_under_test_id: entity.systemUnderTestId,
    test_environment: entity.testEnvironment,
    workload: entity.workload,
    start_time: entity.startTime?.toISOString(),
    end_time: entity.endTime?.toISOString(),
    duration: entity.duration,
    planned_duration: entity.plannedDuration,
    analysis_start_offset: entity.analysisStartOffset,
    completed: entity.completed || false,
    abort: entity.abort,
    is_stale: entity.isStale,
    stale_detected_at: entity.staleDetectedAt?.toISOString(),
    status: entity.status,
    consolidated_result: entity.consolidatedResult,
    annotations: entity.annotations,
    tags: entity.tags,
    application_release: entity.applicationRelease,
    ci_build_results_url: entity.ciBuildResultsUrl,
    expires: entity.expires?.toISOString(),
    expired: entity.expired,
    valid: entity.valid,
    reasons_not_valid: entity.reasonsNotValid ?? undefined,
    data_warnings: entity.dataWarnings ?? undefined,
    adapt_config: entity.adaptConfig,
    variables: entity.variables,
    deep_links: entity.deepLinks,
    // Ownership tracking (multi-tenant RBAC)
    organization_id: entity.organizationId,
    team_id: entity.teamId,
    created_by: entity.createdBy,
    updated_by: entity.updatedBy,
    created_at: entity.createdAt.toISOString(),
    updated_at: entity.updatedAt.toISOString(),
    systems_under_test: entity.systemUnderTest
      ? {
          name: entity.systemUnderTest.name,
          pyroscope_instance_id: entity.systemUnderTest.pyroscope_instance_id,
          pyroscope_configurations: entity.systemUnderTest.pyroscope_configurations,
          pyroscopeInstance: entity.systemUnderTest.pyroscopeInstance
            ? {
                id: entity.systemUnderTest.pyroscopeInstance.id,
                label: entity.systemUnderTest.pyroscopeInstance.label,
                pyroscope_url: entity.systemUnderTest.pyroscopeInstance.pyroscopeUrl,
                backend_url: entity.systemUnderTest.pyroscopeInstance.backendUrl,
                pyroscope_stand_alone: entity.systemUnderTest.pyroscopeInstance.pyroscopeStandAlone,
              }
            : undefined,
        }
      : undefined,
  };
}
