/**
 * Copyright 2025 Perfana Contributors
 *
 * ApplicationDashboardCreatorService
 *
 * Extracted from: dashboard-configurator.service.ts
 *
 * Handles application dashboard creation logic:
 * - Creating single application dashboards
 * - Creating separate dashboards per variable value
 * - Managing dashboard variables and metadata
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AutoConfigFindersService,
  MappedTestRun,
  MappedAutoConfigDashboard,
  MappedGrafanaDashboard,
} from '../auto-config-finders.service';
import {
  AutoConfigUpdatesService,
  ApplicationDashboardInsertData,
} from '../auto-config-updates.service';
import { DashboardVariable } from '../types';
import { ApplicationDashboard } from '@perfana/shared/entities';

@Injectable()
export class ApplicationDashboardCreatorService {
  private readonly logger = new Logger(ApplicationDashboardCreatorService.name);

  constructor(
    private readonly findersService: AutoConfigFindersService,
    private readonly updatesService: AutoConfigUpdatesService,
  ) {}

  /**
   * Create one application dashboard
   */
  async createOneApplicationDashboard(
    applicationDashboardVariables: DashboardVariable[],
    autoConfigDashboard: MappedAutoConfigDashboard,
    testRun: MappedTestRun,
    grafanaDashboard: MappedGrafanaDashboard,
    templateDashboardUid: string,
    dashboardTags: string[],
  ): Promise<void> {
    // Check if system_under_test and test_environment already exist in applicationDashboardVariables
    const hasSystemUnderTest = applicationDashboardVariables.some(
      (v) => v.name === 'system_under_test',
    );
    const hasTestEnvironment = applicationDashboardVariables.some(
      (v) => v.name === 'test_environment',
    );

    const variables = [
      // Only add system_under_test if it doesn't already exist
      ...(!hasSystemUnderTest
        ? [
            {
              name: 'system_under_test',
              values: [testRun.systemUnderTestName],
            },
          ]
        : []),
      // Only add test_environment if it doesn't already exist
      ...(!hasTestEnvironment
        ? [
            {
              name: 'test_environment',
              values: [testRun.testEnvironment],
            },
          ]
        : []),
      ...applicationDashboardVariables,
    ];

    const applicationDashboard: ApplicationDashboardInsertData = {
      application: testRun.systemUnderTestName,
      testEnvironment: testRun.testEnvironment,
      grafana: grafanaDashboard.grafana,
      grafanaDashboardId: grafanaDashboard._id,
      dashboardName: autoConfigDashboard.dashboardName,
      dashboardLabel: autoConfigDashboard.dashboardName,
      dashboardId: grafanaDashboard.id,
      dashboardUid: grafanaDashboard.uid,
      templateDashboardUid: templateDashboardUid,
      tags: dashboardTags,
      variables: variables,
      organizationId: testRun.organizationId, // RBAC: inherit from test run
    };

    this.logger.log(
      `Creating application dashboard: ${applicationDashboard.dashboardLabel} for ${testRun.systemUnderTestName} / ${testRun.testEnvironment}`,
    );

    await this.updatesService.insertApplicationDashboard(applicationDashboard);
  }

  /**
   * Create separate dashboards when createSeparateDashboardForVariable is set
   */
  async createDashboardsWhenCreateSeparateDashboardForVariableIsSet(
    applicationDashboardVariables: DashboardVariable[],
    autoConfigDashboard: MappedAutoConfigDashboard,
    applicationDashboards: ApplicationDashboard[],
    testRun: MappedTestRun,
    grafanaDashboard: MappedGrafanaDashboard,
    templateDashboardUid: string,
    dashboardTags: string[],
  ): Promise<void> {
    this.logger.debug(
      `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - Creating separate dashboards for variable: ${autoConfigDashboard.createSeparateDashboardForVariable}`,
    );
    this.logger.debug(
      `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - applicationDashboardVariables: ${JSON.stringify(applicationDashboardVariables.map((v) => ({ name: v.name, values: v.values })))}`,
    );

    // Find the variable to create separate dashboards for
    const filteredDashboardVariable = applicationDashboardVariables.find(
      (v) => v.name === autoConfigDashboard.createSeparateDashboardForVariable,
    );

    if (!filteredDashboardVariable) {
      this.logger.debug(
        `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - Variable '${autoConfigDashboard.createSeparateDashboardForVariable}' not found in applicationDashboardVariables`,
      );
      return;
    }

    this.logger.debug(
      `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - Found variable with ${filteredDashboardVariable.values.length} values: ${JSON.stringify(filteredDashboardVariable.values)}`,
    );

    // Check which values already have dashboards
    const existingValues = this.checkExistingValues(
      autoConfigDashboard,
      applicationDashboardVariables,
      applicationDashboards,
    );

    this.logger.debug(
      `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - existingValues: ${JSON.stringify(existingValues)}`,
    );

    // Create a dashboard for each value that doesn't exist
    for (const createSeparateDashboardForVariableValue of filteredDashboardVariable.values) {
      this.logger.debug(
        `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - Processing separate dashboard for value: ${createSeparateDashboardForVariableValue}`,
      );

      if (!existingValues.includes(createSeparateDashboardForVariableValue)) {
        await this.createSeparateDashboardForValue(
          createSeparateDashboardForVariableValue,
          applicationDashboardVariables,
          autoConfigDashboard,
          testRun,
          grafanaDashboard,
          templateDashboardUid,
          dashboardTags,
        );
      } else {
        this.logger.debug(
          `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - Separate dashboard already exists for value: ${createSeparateDashboardForVariableValue}`,
        );
      }
    }

    this.logger.debug(
      `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - Completed processing all values`,
    );
  }

  /**
   * Create a separate dashboard for a specific variable value
   */
  private async createSeparateDashboardForValue(
    createSeparateDashboardForVariableValue: string,
    applicationDashboardVariables: DashboardVariable[],
    autoConfigDashboard: MappedAutoConfigDashboard,
    testRun: MappedTestRun,
    grafanaDashboard: MappedGrafanaDashboard,
    templateDashboardUid: string,
    dashboardTags: string[],
  ): Promise<void> {
    this.logger.debug(
      `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - Creating new separate dashboard for value: ${createSeparateDashboardForVariableValue}`,
    );

    // Build variables array
    const variables = this.buildVariablesForSeparateDashboard(
      applicationDashboardVariables,
      autoConfigDashboard,
      testRun,
      createSeparateDashboardForVariableValue,
    );

    // For readOnly dashboards, the dashboardUid should be the template UID since no new
    // Grafana dashboard is created - we're reusing the template dashboard.
    const dashboardUidToUse = templateDashboardUid;

    this.logger.log(
      `Using template dashboard UID for separate dashboard (${createSeparateDashboardForVariableValue}): ${dashboardUidToUse}`,
    );

    // Check if this specific dashboard already exists by label (since all share the same template UID)
    const existingApplicationDashboards =
      await this.findersService.findApplicationDashboardsForSystemUnderTest(
        testRun,
        grafanaDashboard.grafana,
        dashboardUidToUse,
        autoConfigDashboard.dashboardName + ' ' + createSeparateDashboardForVariableValue,
      );

    if (existingApplicationDashboards.length === 0) {
      // Create new application dashboard using the updatesService
      const applicationDashboardData: ApplicationDashboardInsertData = {
        application: testRun.systemUnderTestName,
        testEnvironment: testRun.testEnvironment,
        grafana: grafanaDashboard.grafana || 'UNKNOWN',
        dashboardName: grafanaDashboard.name || 'UNKNOWN',
        dashboardLabel:
          autoConfigDashboard.dashboardName + ' ' + createSeparateDashboardForVariableValue,
        dashboardId: grafanaDashboard.id,
        dashboardUid: dashboardUidToUse,
        templateDashboardUid: templateDashboardUid,
        tags: dashboardTags,
        variables: variables,
        organizationId: testRun.organizationId, // RBAC: inherit from test run
      };

      await this.updatesService.insertApplicationDashboard(applicationDashboardData);

      this.logger.debug(
        `createDashboardsWhenCreateSeparateDashboardForVariableIsSet - Created separate application dashboard: ${applicationDashboardData.dashboardLabel} (UID: ${applicationDashboardData.dashboardUid})`,
      );
    }
  }

  /**
   * Build variables array for a separate dashboard
   */
  private buildVariablesForSeparateDashboard(
    applicationDashboardVariables: DashboardVariable[],
    autoConfigDashboard: MappedAutoConfigDashboard,
    testRun: MappedTestRun,
    createSeparateDashboardForVariableValue: string,
  ): Array<{ name: string; values: string[] }> {
    // Check if system_under_test and test_environment already exist in applicationDashboardVariables
    const hasSystemUnderTest = applicationDashboardVariables.some(
      (v) => v.name === 'system_under_test',
    );
    const hasTestEnvironment = applicationDashboardVariables.some(
      (v) => v.name === 'test_environment',
    );

    const baseVariables = [
      // Only add system_under_test if it doesn't already exist
      ...(!hasSystemUnderTest
        ? [
            {
              name: 'system_under_test',
              values: [testRun.systemUnderTestName],
            },
          ]
        : []),
      // Only add test_environment if it doesn't already exist
      ...(!hasTestEnvironment
        ? [
            {
              name: 'test_environment',
              values: [testRun.testEnvironment],
            },
          ]
        : []),
      ...applicationDashboardVariables.map((v) => ({
        name: v.name,
        values: v.values,
      })),
    ];

    const extendedVariablesMap: Map<string, { name: string; values: string[] }> = new Map();

    // Add hardcoded variables first
    if (autoConfigDashboard.setHardcodedValueForVariables) {
      autoConfigDashboard.setHardcodedValueForVariables.forEach((variable) => {
        extendedVariablesMap.set(variable.name, {
          name: variable.name,
          values: variable.values,
        });
      });
    }

    // Add variables, but for the separate variable, only include the current value
    baseVariables.forEach((variable) => {
      if (!extendedVariablesMap.has(variable.name)) {
        if (variable.name === autoConfigDashboard.createSeparateDashboardForVariable) {
          // For the separate variable, only include the current value
          extendedVariablesMap.set(variable.name, {
            name: variable.name,
            values: [createSeparateDashboardForVariableValue],
          });
        } else {
          // For other variables, include all values
          extendedVariablesMap.set(variable.name, {
            name: variable.name,
            values: variable.values,
          });
        }
      }
    });

    // Convert map to array for database
    return Array.from(extendedVariablesMap.values());
  }

  /**
   * Check which values of the separate variable already have dashboards
   */
  private checkExistingValues(
    autoConfigDashboard: MappedAutoConfigDashboard,
    applicationDashboardVariables: DashboardVariable[],
    applicationDashboards: ApplicationDashboard[],
  ): string[] {
    const existingValues: string[] = [];

    if (!autoConfigDashboard.createSeparateDashboardForVariable) {
      return existingValues;
    }

    // Check if the separate variable exists in the dashboard variables
    const hasSeparateDashboardVariable = applicationDashboardVariables
      .filter((v) => v.name !== 'system_under_test' && v.name !== 'test_environment')
      .some((v) => autoConfigDashboard.createSeparateDashboardForVariable === v.name);

    if (hasSeparateDashboardVariable) {
      // Extract existing values from application dashboards
      applicationDashboards.forEach((applicationDashboard) => {
        const variables = applicationDashboard.variables;

        if (!variables) {
          return;
        }

        const variable = variables.find(
          (v: DashboardVariable) =>
            v.name === autoConfigDashboard.createSeparateDashboardForVariable,
        );

        if (variable?.values) {
          variable.values.forEach((value) => {
            existingValues.push(value);
          });
        }
      });
    }

    return existingValues;
  }
}
