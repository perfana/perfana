/**
 * Copyright 2025 Perfana Contributors
 *
 * DashboardVariableHelperService
 *
 * Extracted from: dashboard-configurator.service.ts
 *
 * Provides helper functions for dashboard variable management:
 * - Variable value validation
 * - Variable set generation for separate dashboards
 * - Variable transformation utilities
 */

import { Injectable, Logger } from '@nestjs/common';
import { DashboardVariable } from '../types';

@Injectable()
export class DashboardVariableHelperService {
  private readonly logger = new Logger(DashboardVariableHelperService.name);

  /**
   * Check if variable values have been found
   */
  variableValuesFound(
    applicationDashboardVariables: DashboardVariable[],
    setHardcodedValueForVariables: Array<{ name: string; values: string[] }> | undefined,
  ): boolean {
    // If there are hardcoded variables, we always have values
    if (setHardcodedValueForVariables && setHardcodedValueForVariables.length > 0) {
      return true;
    }

    // Check if any variables have values
    return applicationDashboardVariables.some((v) => v.values && v.values.length > 0);
  }

  /**
   * Create set of variables per createSeparateDashboardForVariable
   */
  setOfVariablesPerCreateSeparateDashboardForVariable(
    separateVariable: string | undefined,
    applicationDashboardVariables: DashboardVariable[],
  ): Record<string, DashboardVariable[]> {
    if (!separateVariable) {
      return { default: applicationDashboardVariables };
    }

    // Find the separate variable
    const separateVar = applicationDashboardVariables.find((v) => v.name === separateVariable);
    if (!separateVar || !separateVar.values || separateVar.values.length === 0) {
      return { default: applicationDashboardVariables };
    }

    // Create a set for each value of the separate variable
    const result: Record<string, DashboardVariable[]> = {};
    for (const value of separateVar.values) {
      const key = `${separateVariable}:${value}`;
      // Filter out the separate variable and create a new list with just this value
      const filteredVariables = applicationDashboardVariables.filter(
        (v) => v.name !== separateVariable,
      );
      result[key] = [
        ...filteredVariables,
        {
          name: separateVariable,
          values: [value],
        },
      ];
    }

    return result;
  }
}
