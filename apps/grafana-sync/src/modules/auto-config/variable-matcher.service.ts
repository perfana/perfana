/**
 * Handles variable value filtering and matching:
 * - Override values with hardcoded configurations
 * - Filter values based on regex patterns
 * - Replace dynamic variable placeholders
 */

import { Injectable, Logger } from '@nestjs/common';
import { TestRun } from '@perfana/shared/entities';
import { DashboardVariable } from './types';
import { validateRegexPattern } from '@perfana/shared/utils';

/**
 * Match regex configuration for variables
 */
export interface MatchRegexForVariable {
  name: string;
  regex: string;
}

@Injectable()
export class VariableMatcherService {
  private readonly logger = new Logger(VariableMatcherService.name);

  /**
   * Override variable values if set in configuration
   */
  overrideValues(
    applicationDashboardVariables: DashboardVariable[],
    overrideValueForVariables: DashboardVariable[] | undefined,
    testRun: TestRun,
  ): DashboardVariable[] {
    if (overrideValueForVariables && overrideValueForVariables.length > 0) {
      applicationDashboardVariables.forEach((variable, variableIndex) => {
        overrideValueForVariables.forEach((overrideValueForVariable) => {
          if (variable.name === overrideValueForVariable.name) {
            applicationDashboardVariables[variableIndex].values = [];

            overrideValueForVariable.values.forEach((overrideValue) => {
              applicationDashboardVariables[variableIndex].values.push(
                this.replaceDynamicVariableValues(overrideValue, testRun),
              );
            });
          }
        });
      });
    }

    return applicationDashboardVariables;
  }

  /**
   * Filter variable values based on regex patterns
   */
  filterValuesOnRegex(
    applicationDashboardVariables: DashboardVariable[],
    autoConfigGrafanaDashboard: any,
    testRun: TestRun,
  ): DashboardVariable[] {
    if (
      autoConfigGrafanaDashboard.matchRegexForVariables &&
      Object.keys(autoConfigGrafanaDashboard.matchRegexForVariables).length > 0
    ) {
      applicationDashboardVariables.forEach((variable, variableIndex) => {
        // Convert matchRegexForVariables object to array format
        const matchRegexArray = Object.entries(
          autoConfigGrafanaDashboard.matchRegexForVariables,
        ).map(([name, regex]) => ({
          name,
          regex: regex as string,
        }));

        matchRegexArray.forEach((matchRegexForVariable: MatchRegexForVariable) => {
          if (variable.name === matchRegexForVariable.name) {
            applicationDashboardVariables[variableIndex].values = applicationDashboardVariables[
              variableIndex
            ].values.filter((value) => {
              return this.matchValue(matchRegexArray, variable.name, value, testRun);
            });
          }
        });
      });
    }

    return applicationDashboardVariables;
  }

  /**
   * Match value against regex patterns
   */
  matchValue(
    matchRegexForVariables: MatchRegexForVariable[],
    applicationDashboardVariableName: string,
    applicationDashboardVariableValue: string,
    testRun: TestRun,
  ): boolean {
    let valueMatched = false;

    matchRegexForVariables.forEach((matchVariable) => {
      const regexPattern = this.replaceDynamicVariableValues(matchVariable.regex, testRun);

      // Validate regex pattern for ReDoS safety
      const validationResult = validateRegexPattern(regexPattern);

      if (!validationResult.safe || !validationResult.regex) {
        this.logger.warn(
          `Invalid or unsafe regex pattern for variable "${matchVariable.name}": ${validationResult.error}`,
        );
        return; // Skip this pattern
      }

      if (applicationDashboardVariableName === matchVariable.name) {
        if (validationResult.regex.test(applicationDashboardVariableValue)) valueMatched = true;
      }
    });

    return valueMatched;
  }

  /**
   * Replace dynamic variable values with test run variables
   */
  replaceDynamicVariableValues(variableValue: string, testRun: TestRun): string {
    if (testRun.variables) {
      const variableIndex = testRun.variables
        .map((variable: any) => variable.placeholder)
        .indexOf(variableValue);

      if (variableIndex === -1) {
        return variableValue;
      } else {
        return variableValue.replace(
          testRun.variables[variableIndex].placeholder,
          testRun.variables[variableIndex].value,
        );
      }
    } else {
      return variableValue;
    }
  }

  /**
   * Escape special regex characters
   */
  escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
