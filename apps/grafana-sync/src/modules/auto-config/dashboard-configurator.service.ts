import { Injectable, Logger } from '@nestjs/common';
import { TestRun, ProfileGrafanaDashboard } from '@perfana/shared/entities';
import { DashboardFinderService } from './dashboard-finder.service';
import { VariableDiscoveryService } from './variable-discovery.service';
import { DashboardVariable } from './types';
import { DashboardProcessorService } from './services';
import { PERFANA_TEMPLATE_TAG } from '../../config/constants';

@Injectable()
export class DashboardConfiguratorService {
  private readonly logger = new Logger(DashboardConfiguratorService.name);

  constructor(
    private readonly dashboardFinderService: DashboardFinderService,
    private readonly variableDiscoveryService: VariableDiscoveryService,
    private readonly dashboardProcessorService: DashboardProcessorService,
  ) {}

  /**
   * Process single auto config dashboard (Main Orchestration Method)
   * CRITICAL: This method contains the readOnly branching logic
   */
  async processAutoConfigDashboard(
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    testRunVariables: any[],
  ): Promise<void> {
    this.logger.log(
      `AutoConfig sync for test run: ${testRun.testRunId} and ${autoConfigDashboard.dashboardName}`,
    );

    // Step 1: Get and validate template dashboard
    const templateDashboard = await this.getAndValidateTemplateDashboard(autoConfigDashboard);
    if (!templateDashboard) return;

    // Step 2: Get Grafana instance
    const grafanaInstance = await this.dashboardFinderService.findGrafanaConfiguration(
      autoConfigDashboard.grafanaLabel,
    );
    if (!grafanaInstance) {
      this.logger.error(`No grafana instance found for: ${autoConfigDashboard.grafanaLabel}`);
      return;
    }

    // Step 3: Discover variables from template dashboard
    const applicationDashboardVariables: DashboardVariable[] =
      await this.variableDiscoveryService.getApplicationDashboardVariables(
        testRun,
        templateDashboard,
        autoConfigDashboard,
        grafanaInstance,
      );

    this.logger.log(
      `Found application dashboard variables: ${JSON.stringify(applicationDashboardVariables)}`,
    );

    // Step 4: Process dashboards if variables are found
    if (
      this.variableValuesFound(
        applicationDashboardVariables,
        autoConfigDashboard.setHardcodedValueForVariables,
      )
    ) {
      await this.processDashboardsForVariables(
        testRun,
        autoConfigDashboard,
        applicationDashboardVariables,
        testRunVariables,
        grafanaInstance,
        templateDashboard,
      );
    }
  }

  /**
   * Get and validate template dashboard
   */
  private async getAndValidateTemplateDashboard(
    autoConfigDashboard: ProfileGrafanaDashboard,
  ): Promise<any | null> {
    const templateDashboard = await this.dashboardFinderService.findGrafanaDashboardOrNull(
      autoConfigDashboard.grafanaLabel,
      [autoConfigDashboard.dashboardUid],
    );

    if (!templateDashboard) {
      this.logger.error(
        `No template dashboard found for: ${autoConfigDashboard.dashboardUid}, skip processing.`,
      );
      return null;
    }

    // Validate template dashboard
    if (
      !templateDashboard.tags ||
      !templateDashboard.tags.some((tag) => tag.toLowerCase() === PERFANA_TEMPLATE_TAG)
    ) {
      throw new Error(
        `Expected a template dashboard, it is not: ${autoConfigDashboard.dashboardUid}`,
      );
    }

    if (!templateDashboard.grafanaJson) {
      throw new Error(
        `No template json found for dashboard with uid: ${autoConfigDashboard.dashboardUid}`,
      );
    }

    return templateDashboard;
  }

  /**
   * Process dashboards for all variable combinations
   */
  private async processDashboardsForVariables(
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    applicationDashboardVariables: DashboardVariable[],
    testRunVariables: any[],
    grafanaInstance: any,
    templateDashboard: any,
  ): Promise<void> {
    const separateVariable = autoConfigDashboard.createSeparateDashboardForVariable;

    // Debug logging for createSeparateDashboardForVariable
    if (separateVariable) {
      const separateVarData = applicationDashboardVariables.find(
        (v) => v.name === separateVariable,
      );
      this.logger.log(
        `CreateSeparateDashboardForVariable: ${separateVariable}, found variable: ${JSON.stringify(separateVarData)}`,
      );
    }

    // Generate variable sets based on createSeparateDashboardForVariable setting
    const variableListsToProcess =
      this.setOfVariablesPerCreateSeparateDashboardForVariable(
        separateVariable,
        applicationDashboardVariables,
      );

    this.logger.log(
      `Variable lists to process: ${Object.keys(variableListsToProcess).length} lists`,
    );

    // Process each variable set
    for (const [_key, variableValues] of Object.entries(variableListsToProcess)) {
      this.logger.log(`Processing for: ` + JSON.stringify(variableValues));

      await this.dashboardProcessorService.processSingleVariableSet(
        testRun,
        autoConfigDashboard,
        variableValues,
        testRunVariables,
        grafanaInstance,
        templateDashboard,
      );
    }
  }

  /**
   * Check if variable values have been found
   */
  private variableValuesFound(
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
  private setOfVariablesPerCreateSeparateDashboardForVariable(
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
