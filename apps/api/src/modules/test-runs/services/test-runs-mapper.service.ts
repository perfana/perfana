import { Injectable } from '@nestjs/common';
import { TestRun as TestRunEntity } from '../../../entities';
import { TestRun, TimePeriod, DateBounds } from '../types/test-run.types';

/**
 * Service responsible for mapping TestRun entities to API DTOs
 * and providing utility functions for date calculations
 */
@Injectable()
export class TestRunsMapperService {
  /**
   * Calculate completion percentage for a test run
   * Based on elapsed time vs planned duration
   */
  calculateCompletionPercentage(entity: TestRunEntity): number | undefined {
    if (!entity.startTime || !entity.plannedDuration) {
      return undefined;
    }

    const now = new Date();
    const endTime = entity.endTime || now;
    const elapsedSeconds = Math.floor((endTime.getTime() - entity.startTime.getTime()) / 1000);
    const percentage = Math.min(Math.round((elapsedSeconds / entity.plannedDuration) * 100), 100);

    return percentage >= 0 ? percentage : undefined;
  }

  /**
   * Map TypeORM TestRunEntity to API TestRun format
   */
  mapEntityToTestRun(entity: TestRunEntity): TestRun {
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
      ramp_up: entity.rampUp,
      completed: entity.completed || false,
      abort: entity.abort,
      is_stale: entity.isStale,
      stale_detected_at: entity.staleDetectedAt?.toISOString(),
      completion_percentage: this.calculateCompletionPercentage(entity),
      status: entity.status,
      consolidated_result: entity.consolidatedResult,
      annotations: entity.annotations,
      tags: entity.tags,
      application_release: entity.applicationRelease,
      ci_build_results_url: entity.ciBuildResultsUrl,
      expires: entity.expires?.toISOString(),
      expired: entity.expired,
      valid: entity.valid,
      reasons_not_valid: entity.reasonsNotValid,
      data_warnings: entity.dataWarnings,
      adapt_config: entity.adaptConfig,
      variables: entity.variables,
      deep_links: entity.deepLinks,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString(),
      systems_under_test: entity.systemUnderTest ? {
        name: entity.systemUnderTest.name,
        pyroscope_instance_id: entity.systemUnderTest.pyroscope_instance_id,
        pyroscope_configurations: entity.systemUnderTest.pyroscope_configurations,
        pyroscopeInstance: entity.systemUnderTest.pyroscopeInstance ? {
          id: entity.systemUnderTest.pyroscopeInstance.id,
          label: entity.systemUnderTest.pyroscopeInstance.label,
          pyroscope_url: entity.systemUnderTest.pyroscopeInstance.pyroscopeUrl,
          backend_url: entity.systemUnderTest.pyroscopeInstance.backendUrl,
          pyroscope_stand_alone: entity.systemUnderTest.pyroscopeInstance.pyroscopeStandAlone,
        } : undefined,
      } : undefined
    };
  }

  /**
   * Map multiple entities to TestRun array
   */
  mapEntitiesToTestRuns(entities: TestRunEntity[]): TestRun[] {
    return entities.map(entity => this.mapEntityToTestRun(entity));
  }

  /**
   * Calculate date bounds from time period
   */
  calculateDateBounds(
    timePeriod: TimePeriod,
    from?: string,
    to?: string
  ): DateBounds {
    if (timePeriod === 'custom' && from && to) {
      return { dateThreshold: new Date(from), dateUpperBound: new Date(to) };
    }

    if (timePeriod === 'all') {
      return { dateThreshold: null, dateUpperBound: null };
    }

    const now = new Date();
    const millisPerDay = 24 * 60 * 60 * 1000;
    const daysMap: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30 };
    const days = daysMap[timePeriod] || 7;

    return {
      dateThreshold: new Date(now.getTime() - days * millisPerDay),
      dateUpperBound: null
    };
  }

  /**
   * Apply date filters to a query builder
   */
  applyDateFilters<T extends import('typeorm').ObjectLiteral>(
    query: import('typeorm').SelectQueryBuilder<T>,
    dateThreshold: Date | null,
    dateUpperBound: Date | null
  ): void {
    if (dateThreshold) {
      query.andWhere('tr.created_at >= :dateThreshold', { dateThreshold });
    }
    if (dateUpperBound) {
      query.andWhere('tr.created_at <= :dateUpperBound', { dateUpperBound });
    }
  }

  /**
   * Parse numeric value from database result
   */
  parseFloat(value: unknown, defaultValue: number = 0): number {
    if (value === null || value === undefined) return defaultValue;
    const parsed = Number.parseFloat(String(value));
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Parse integer value from database result
   */
  parseInt(value: unknown, defaultValue: number = 0): number {
    if (value === null || value === undefined) return defaultValue;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }
}
