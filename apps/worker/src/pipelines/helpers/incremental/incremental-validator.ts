/**
 * Incremental Metrics Pipeline Validator
 *
 * Handles input validation and parsing for the Incremental Metrics Pipeline.
 * Validates required fields, parses dates, and ensures input correctness.
 *
 * Responsibilities:
 * - Input validation and parsing
 * - Date validation and conversion
 * - Time range validation
 */

import type { IncrementalMetricsInput } from './types.js';

/**
 * Result of input validation
 */
export interface InputValidationResult {
  valid: boolean;
  input?: IncrementalMetricsInput;
  error?: string;
}

/**
 * Incremental Validator
 *
 * Validates and parses input for the Incremental Metrics Pipeline.
 */
export class IncrementalValidator {
  /**
   * Validate pipeline input structure and types
   *
   * @param input - Unknown input to validate
   * @returns Validation result with parsed input if valid
   */
  validateInput(input: any): InputValidationResult {
    if (!input || typeof input !== 'object') {
      return {
        valid: false,
        error: 'Invalid input: must be an object',
      };
    }

    const {
      testRunId,
      fromTime,
      toTime,
      grafanaInstanceId,
      applicationDashboardIds,
      metricsSourceIds,
      dynatraceConfigId,
      collectPerformanceTestMetrics,
      collectGrafanaMetrics,
      collectDynatraceMetrics,
    } = input as Record<string, unknown>;

    // Validate required fields
    if (!testRunId || typeof testRunId !== 'string') {
      return {
        valid: false,
        error: 'Invalid input: testRunId is required and must be a string',
      };
    }

    if (!fromTime) {
      return {
        valid: false,
        error: 'Invalid input: fromTime is required',
      };
    }

    if (!toTime) {
      return {
        valid: false,
        error: 'Invalid input: toTime is required',
      };
    }

    // Parse dates if strings
    const parsedFromTime = fromTime instanceof Date ? fromTime : new Date(fromTime as string | number);
    const parsedToTime = toTime instanceof Date ? toTime : new Date(toTime as string | number);

    if (isNaN(parsedFromTime.getTime())) {
      return {
        valid: false,
        error: 'Invalid input: fromTime is not a valid date',
      };
    }

    if (isNaN(parsedToTime.getTime())) {
      return {
        valid: false,
        error: 'Invalid input: toTime is not a valid date',
      };
    }

    if (parsedFromTime >= parsedToTime) {
      return {
        valid: false,
        error: 'Invalid input: fromTime must be before toTime',
      };
    }

    // Return validated input with parsed dates
    return {
      valid: true,
      input: {
        testRunId: testRunId as string,
        fromTime: parsedFromTime,
        toTime: parsedToTime,
        grafanaInstanceId: grafanaInstanceId as string | undefined,
        applicationDashboardIds: applicationDashboardIds as string[] | undefined,
        metricsSourceIds: metricsSourceIds as string[] | undefined,
        dynatraceConfigId: dynatraceConfigId as string | undefined,
        collectPerformanceTestMetrics: collectPerformanceTestMetrics as boolean | undefined,
        collectGrafanaMetrics: collectGrafanaMetrics as boolean | undefined,
        collectDynatraceMetrics: collectDynatraceMetrics as boolean | undefined,
      },
    };
  }

  /**
   * Create default collection result with initial values
   *
   * @returns Default collection result
   */
  createDefaultCollectionResult(): { success: boolean; dataPoints: number; errors: string[]; duration: number } {
    return {
      success: true,
      dataPoints: 0,
      errors: [],
      duration: 0,
    };
  }
}
