/**
 * Handles dashboard processing workflows: variable set processing,
 * existing dashboard handling, Grafana dashboard creation, and
 * application dashboard storage.
 */

import { Injectable, Logger } from '@nestjs/common';
import { GrafanaApiService } from '../../grafana-api/grafana-api.service';
import {
  TestRun,
  ProfileGrafanaDashboard,
  GrafanaDashboard,
  GrafanaInstance,
  ApplicationDashboard,
} from '@perfana/shared/entities';
import {
  DashboardFinderService,
} from '../dashboard-finder.service';
import {
  AutoConfigUpdatesService,
  ApplicationDashboardInsertData,
} from '../auto-config-updates.service';
import { DashboardVariable } from '../types';
import { createDashboardUid } from '../dashboard-uid.util';
import { PERFANA_TEMPLATE_TAG } from '../../../config/constants';

@Injectable()
export class DashboardProcessorService {
  private readonly logger = new Logger(DashboardProcessorService.name);

  constructor(
    private readonly grafanaApiService: GrafanaApiService,
    private readonly dashboardFinderService: DashboardFinderService,
    private readonly updatesService: AutoConfigUpdatesService,
  ) {}

  /**
   * Process a single variable set
   */
  async processSingleVariableSet(
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    variableValues: DashboardVariable[],
    testRunVariables: any[],
    grafanaInstance: any,
    templateDashboard: any,
  ): Promise<void> {
    const applicationDashboards = await this.dashboardFinderService.findApplicationDashboards(
      templateDashboard.grafanaInstance?.label || '',
      testRun,
      autoConfigDashboard,
      variableValues,
    );

    this.logger.log(
      `Found application dashboards: ${applicationDashboards.map((ad) => `${ad.dashboardUid} - ${ad.dashboardName} - ${ad.dashboardLabel} - from template: ${ad.templateDashboardUid}`).join(', ')}`,
    );

    if (applicationDashboards.length > 0) {
      await this.handleExistingApplicationDashboards(
        applicationDashboards,
        grafanaInstance,
        testRun,
        autoConfigDashboard,
        variableValues,
        templateDashboard,
      );
    } else {
      await this.handleNoApplicationDashboards(
        testRun,
        autoConfigDashboard,
        variableValues,
        testRunVariables,
        grafanaInstance,
        templateDashboard,
        applicationDashboards,
      );
    }
  }

  /**
   * Handle existing application dashboards
   */
  private async handleExistingApplicationDashboards(
    applicationDashboards: any[],
    grafanaInstance: any,
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    variableValues: DashboardVariable[],
    templateDashboard: any,
  ): Promise<void> {
    const applicationDashboard = applicationDashboards[0];
    const storedGrafanaDashboard = await this.dashboardFinderService.findGrafanaDashboardOrNull(
      grafanaInstance.label,
      [applicationDashboard.dashboardUid],
    );

    if (!storedGrafanaDashboard) {
      this.logger.warn(
        `No stored grafana dashboard found for: ${applicationDashboard.dashboardUid}, deleting the applicationDashboard.`,
      );
      // TODO: In full implementation: delete applicationDashboard
    } else {
      await this.storeApplicationDashboards(
        storedGrafanaDashboard,
        testRun,
        autoConfigDashboard,
        variableValues,
        applicationDashboards,
        autoConfigDashboard.dashboardUid,
        true,
        templateDashboard.tags,
      );
    }
  }

  /**
   * Handle no application dashboards (create new ones)
   */
  private async handleNoApplicationDashboards(
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    variableValues: DashboardVariable[],
    testRunVariables: any[],
    grafanaInstance: any,
    templateDashboard: any,
    applicationDashboards: any[],
  ): Promise<void> {
    const existingGrafanaDashboards =
      await this.dashboardFinderService.findExistingGrafanaDashboardsByResolvedUid(
        templateDashboard,
        testRun,
        autoConfigDashboard,
        variableValues,
      );

    this.logger.log(
      `Found existing grafanaDashboards: ${existingGrafanaDashboards.map((gd) => `${gd.uid} - ${gd.name}`).join(', ')}`,
    );

    if (existingGrafanaDashboards.length === 0 || autoConfigDashboard.readOnly) {
      // CRITICAL PATH: readOnly dashboards OR no existing dashboards
      await this.createAndStoreDashboards(
        grafanaInstance,
        templateDashboard,
        testRun,
        autoConfigDashboard,
        variableValues,
        applicationDashboards,
        testRunVariables,
      );
    } else {
      // Existing dashboards found and NOT readOnly
      await this.storeApplicationDashboards(
        existingGrafanaDashboards[0],
        testRun,
        autoConfigDashboard,
        variableValues,
        applicationDashboards,
        autoConfigDashboard.readOnly
          ? existingGrafanaDashboards[0].uid
          : existingGrafanaDashboards[0].templateDashboardUid || existingGrafanaDashboards[0].uid,
        false,
        templateDashboard.tags,
      );
    }
  }

  /**
   * Create dashboards in Grafana and store in MongoDB
   */
  private async createAndStoreDashboards(
    grafanaInstance: any,
    templateDashboard: any,
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    variableValues: DashboardVariable[],
    applicationDashboards: any[],
    _testRunVariables: any[],
  ): Promise<void> {
    const storedGrafanaDashboard = await this.createDashboardsInGrafana(
      grafanaInstance,
      templateDashboard.grafanaJson,
      testRun,
      autoConfigDashboard,
      variableValues,
    );

    this.logger.debug(
      `Before storeApplicationDashboards - variableValues: ${JSON.stringify(variableValues.map((v) => ({ name: v.name, values: v.values })))}`,
    );

    if (autoConfigDashboard.readOnly && storedGrafanaDashboard) {
      await this.storeApplicationDashboards(
        storedGrafanaDashboard,
        testRun,
        autoConfigDashboard,
        variableValues,
        applicationDashboards,
        storedGrafanaDashboard.uid,
        false,
        storedGrafanaDashboard.tags,
      );
    }
  }

  /**
   * Create dashboards in Grafana. Handles both readOnly and regular dashboard creation.
   */
  private async createDashboardsInGrafana(
    grafanaInstance: any,
    templateJson: string,
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    applicationDashboardVariables: DashboardVariable[],
  ): Promise<GrafanaDashboard | null> {
    let storedGrafanaDashboard: GrafanaDashboard | null = null;

    if (autoConfigDashboard.readOnly) {
      storedGrafanaDashboard = await this.handleReadOnlyDashboard(
        grafanaInstance,
        autoConfigDashboard,
        testRun,
      );
    } else {
      storedGrafanaDashboard = await this.createNewDashboard(
        grafanaInstance,
        autoConfigDashboard,
        testRun,
        applicationDashboardVariables,
      );
    }

    return storedGrafanaDashboard;
  }

  /**
   * Handle read-only dashboard creation (reuse template)
   */
  private async handleReadOnlyDashboard(
    grafanaInstance: any,
    autoConfigDashboard: ProfileGrafanaDashboard,
    testRun: TestRun,
  ): Promise<GrafanaDashboard> {
    this.logger.log(
      'Dashboard is read only, skip create grafana dashboard: reusing existing dashboard template.',
    );

    // Find the template dashboard
    const templateDashboard = await this.dashboardFinderService.findGrafanaDashboard(
      autoConfigDashboard.grafanaLabel,
      [autoConfigDashboard.dashboardUid],
    );

    // Update template's usedBySut
    const systemUnderTestName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    await this.updatesService.updateUsedBySut(templateDashboard, systemUnderTestName);

    // Use the template dashboard as the stored dashboard
    return await this.dashboardFinderService.findGrafanaDashboard(grafanaInstance.label, [
      autoConfigDashboard.dashboardUid,
    ]);
  }

  /**
   * Create a new dashboard in Grafana
   */
  private async createNewDashboard(
    grafanaInstance: any,
    autoConfigDashboard: ProfileGrafanaDashboard,
    testRun: TestRun,
    applicationDashboardVariables: DashboardVariable[],
  ): Promise<GrafanaDashboard> {
    this.logger.log(
      `Creating new dashboard for autoConfigDashboard: ${autoConfigDashboard.dashboardName}`,
    );

    // Get Grafana instance ID for API calls
    const grafanaInstances = await this.grafanaApiService.getAllInstances();
    const grafanaInstanceEntity = grafanaInstances.find((gi) => gi.label === grafanaInstance.label);

    if (!grafanaInstanceEntity) {
      throw new Error(`Grafana instance ${grafanaInstance.label} not found`);
    }

    // Get template dashboard from Grafana API
    const templateDashboardResponse = await this.grafanaApiService.getDashboardByUid(
      grafanaInstanceEntity.id,
      autoConfigDashboard.dashboardUid,
    );

    // Create or find folder for system under test
    const sutName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    const folderId = await this.grafanaApiService.createOrFindFolder(
      grafanaInstanceEntity.id,
      sutName,
    );

    // Generate UID for new dashboard
    const newDashboardUid = createDashboardUid(
      testRun,
      autoConfigDashboard,
      applicationDashboardVariables,
    );

    // Prepare new dashboard JSON
    const newDashboardJson = {
      dashboard: {
        ...templateDashboardResponse.dashboard,
        id: null,
        uid: newDashboardUid,
        title: `${autoConfigDashboard.dashboardName} - ${sutName} ${testRun.testEnvironment}`,
        tags: (templateDashboardResponse.dashboard.tags || []).filter(
          (tag: string) => tag.toLowerCase() !== PERFANA_TEMPLATE_TAG,
        ),
      },
      folderId: folderId,
      overwrite: false,
    };

    // Create dashboard in Grafana
    await this.grafanaApiService.createDashboard(grafanaInstanceEntity.id, newDashboardJson);

    this.logger.log(
      `Created dashboard: ${newDashboardJson.dashboard.title} with UID: ${newDashboardUid}`,
    );

    // Get the created dashboard details
    const createdDashboardDetails = await this.grafanaApiService.getDashboardByUid(
      grafanaInstanceEntity.id,
      newDashboardUid,
    );

    // Upsert to grafana_dashboards table
    const upsertResult = await this.updatesService.upsertGrafanaDashboard({
      grafana: grafanaInstance.label,
      uid: newDashboardUid,
      title: newDashboardJson.dashboard.title,
      id: createdDashboardDetails.dashboard.id,
      grafanaJson: createdDashboardDetails,
      usedBySUT: [sutName],
      panels: [],
    });

    // Set grafanaInstance on the returned entity so consumers can access .grafanaInstance.label
    const result = upsertResult.value;
    result.grafanaInstance = grafanaInstance;
    return result;
  }

  /**
   * Store application dashboards in the database
   */
  private async storeApplicationDashboards(
    grafanaDashboard: GrafanaDashboard,
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    applicationDashboardVariables: DashboardVariable[],
    applicationDashboards: any[],
    templateDashboardUid: string,
    update: boolean,
    templateTags?: string[],
  ): Promise<void> {
    this.logger.debug(
      `storeApplicationDashboards - autoConfigDashboard.readOnly: ${autoConfigDashboard.readOnly}`,
    );
    this.logger.debug(
      `storeApplicationDashboards - autoConfigDashboard.createSeparateDashboardForVariable: ${autoConfigDashboard.createSeparateDashboardForVariable}`,
    );
    this.logger.debug(
      `storeApplicationDashboards - applicationDashboards.length: ${applicationDashboards.length}`,
    );

    // Replace hardcoded values for variables
    const newApplicationDashboardVariables = this.replaceHardcodedValuesForVariables(
      applicationDashboardVariables,
      autoConfigDashboard.setHardcodedValueForVariables,
    );

    const updateRequired = this.checkIfUpdateRequired(
      autoConfigDashboard,
      newApplicationDashboardVariables,
      applicationDashboards,
      grafanaDashboard,
    );

    this.logger.debug(
      `storeApplicationDashboards - checkIfUpdateRequired result: ${updateRequired}`,
    );

    if (applicationDashboards.length === 0 || updateRequired) {
      // Get tags from template, filtering out 'perfana-template'
      const dashboardTags = (templateTags || grafanaDashboard.tags || []).filter(
        (tag: string) => tag.toLowerCase() !== 'perfana-template',
      );

      if (!autoConfigDashboard.createSeparateDashboardForVariable) {
        this.logger.debug(`storeApplicationDashboards - Creating ONE application dashboard`);
        // Create one application dashboard
        await this.createOneApplicationDashboard(
          newApplicationDashboardVariables,
          autoConfigDashboard,
          testRun,
          grafanaDashboard,
          templateDashboardUid,
          dashboardTags,
        );
      } else {
        this.logger.debug(
          `storeApplicationDashboards - Creating SEPARATE dashboards for variable: ${autoConfigDashboard.createSeparateDashboardForVariable}`,
        );
        await this.createDashboardsWhenCreateSeparateDashboardForVariableIsSet(
          applicationDashboardVariables,
          autoConfigDashboard,
          applicationDashboards,
          testRun,
          grafanaDashboard,
          templateDashboardUid,
          dashboardTags,
        );
      }
    } else {
      this.logger.debug(
        `storeApplicationDashboards - SKIPPING dashboard creation - update not required`,
      );
    }
  }

  /**
   * Replace hardcoded values for variables
   */
  private replaceHardcodedValuesForVariables(
    applicationDashboardVariables: DashboardVariable[],
    setHardcodedValueForVariables: Array<{ name: string; values: string[] }> | undefined,
  ): DashboardVariable[] {
    if (!setHardcodedValueForVariables || setHardcodedValueForVariables.length === 0) {
      return applicationDashboardVariables;
    }

    const result = [...applicationDashboardVariables];

    for (const hardcodedVar of setHardcodedValueForVariables) {
      const existingIndex = result.findIndex((v) => v.name === hardcodedVar.name);
      if (existingIndex >= 0) {
        result[existingIndex] = hardcodedVar;
      } else {
        result.push(hardcodedVar);
      }
    }

    return result;
  }

  /**
   * Check if update is required
   */
  private checkIfUpdateRequired(
    autoConfigDashboard: ProfileGrafanaDashboard,
    newApplicationDashboardVariables: DashboardVariable[],
    applicationDashboards: any[],
    _grafanaDashboard: GrafanaDashboard,
  ): boolean {
    // If no application dashboards exist, update is required
    if (applicationDashboards.length === 0) {
      return true;
    }

    // Check if variables have changed
    const existingDashboard = applicationDashboards[0];
    if (!existingDashboard.variables) {
      return true;
    }

    // Compare variables
    for (const newVar of newApplicationDashboardVariables) {
      const existingVar = existingDashboard.variables.find(
        (v: DashboardVariable) => v.name === newVar.name,
      );

      if (!existingVar) {
        return true;
      }

      if (existingVar.values.length !== newVar.values.length) {
        return true;
      }

      if (!existingVar.values.every((val: string, index: number) => val === newVar.values[index])) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create one application dashboard
   */
  private async createOneApplicationDashboard(
    applicationDashboardVariables: DashboardVariable[],
    autoConfigDashboard: ProfileGrafanaDashboard,
    testRun: TestRun,
    grafanaDashboard: GrafanaDashboard,
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

    const sutName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    const variables = [
      // Only add system_under_test if it doesn't already exist
      ...(!hasSystemUnderTest
        ? [
            {
              name: 'system_under_test',
              values: [sutName],
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
      application: sutName,
      testEnvironment: testRun.testEnvironment,
      grafana: grafanaDashboard.grafanaInstance?.label || '',
      grafanaDashboardId: grafanaDashboard.id,
      dashboardName: autoConfigDashboard.dashboardName,
      dashboardLabel: autoConfigDashboard.dashboardName,
      dashboardId: grafanaDashboard.grafanaId,
      dashboardUid: grafanaDashboard.uid,
      templateDashboardUid: templateDashboardUid,
      tags: dashboardTags,
      variables: variables,
      organizationId: testRun.organizationId, // RBAC: inherit from test run
    };

    this.logger.log(
      `Creating application dashboard: ${applicationDashboard.dashboardLabel} for ${sutName} / ${testRun.testEnvironment}`,
    );

    await this.updatesService.insertApplicationDashboard(applicationDashboard);
  }

  /**
   * Create separate dashboards when createSeparateDashboardForVariable is set
   */
  private async createDashboardsWhenCreateSeparateDashboardForVariableIsSet(
    applicationDashboardVariables: DashboardVariable[],
    autoConfigDashboard: ProfileGrafanaDashboard,
    applicationDashboards: ApplicationDashboard[],
    testRun: TestRun,
    grafanaDashboard: GrafanaDashboard,
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
    autoConfigDashboard: ProfileGrafanaDashboard,
    testRun: TestRun,
    grafanaDashboard: GrafanaDashboard,
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
    const grafanaLabel = grafanaDashboard.grafanaInstance?.label || '';
    const sutName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    const existingApplicationDashboards =
      await this.dashboardFinderService.findApplicationDashboardsForSystemUnderTest(
        testRun,
        grafanaLabel,
        dashboardUidToUse,
        autoConfigDashboard.dashboardName + ' ' + createSeparateDashboardForVariableValue,
      );

    if (existingApplicationDashboards.length === 0) {
      // Create new application dashboard using the updatesService
      const applicationDashboardData: ApplicationDashboardInsertData = {
        application: sutName,
        testEnvironment: testRun.testEnvironment,
        grafana: grafanaLabel || 'UNKNOWN',
        dashboardName: grafanaDashboard.name || 'UNKNOWN',
        dashboardLabel:
          autoConfigDashboard.dashboardName + ' ' + createSeparateDashboardForVariableValue,
        dashboardId: grafanaDashboard.grafanaId,
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
    autoConfigDashboard: ProfileGrafanaDashboard,
    testRun: TestRun,
    createSeparateDashboardForVariableValue: string,
  ): Array<{ name: string; values: string[] }> {
    // Check if system_under_test and test_environment already exist in applicationDashboardVariables
    const hasSystemUnderTest = applicationDashboardVariables.some(
      (v) => v.name === 'system_under_test',
    );
    const hasTestEnvironment = applicationDashboardVariables.some(
      (v) => v.name === 'test_environment',
    );

    const sutName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    const baseVariables = [
      // Only add system_under_test if it doesn't already exist
      ...(!hasSystemUnderTest
        ? [
            {
              name: 'system_under_test',
              values: [sutName],
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
    autoConfigDashboard: ProfileGrafanaDashboard,
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
