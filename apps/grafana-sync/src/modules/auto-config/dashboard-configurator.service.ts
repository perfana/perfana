/**
 * Copyright 2025 Perfana Contributors
 *
 * DashboardConfiguratorService (Orchestrator)
 *
 * Refactored from 950-line monolithic service to <200-line orchestrator.
 * Delegates to specialized services for all dashboard configuration operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AutoConfigFindersService,
  MappedTestRun,
  MappedAutoConfigDashboard,
} from './auto-config-finders.service';
import { VariableDiscoveryService } from './variable-discovery.service';
import { DashboardVariable } from './types';
import { DashboardProcessorService, DashboardVariableHelperService } from './services';

@Injectable()
export class DashboardConfiguratorService {
  private readonly logger = new Logger(DashboardConfiguratorService.name);

  constructor(
    private readonly findersService: AutoConfigFindersService,
    private readonly variableDiscoveryService: VariableDiscoveryService,
    private readonly dashboardProcessorService: DashboardProcessorService,
    private readonly variableHelperService: DashboardVariableHelperService,
  ) {}

  /**
   * Process single auto config dashboard (Main Orchestration Method)
   * CRITICAL: This method contains the readOnly branching logic
   */
  async processAutoConfigDashboard(
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    testRunVariables: any[],
  ): Promise<void> {
    this.logger.log(
      `AutoConfig sync for test run: ${testRun.testRunId} and ${autoConfigDashboard.dashboardName}`,
    );

    // Step 1: Get and validate template dashboard
    const templateDashboard = await this.getAndValidateTemplateDashboard(autoConfigDashboard);
    if (!templateDashboard) return;

    // Step 2: Get Grafana instance
    const grafanaInstance = await this.findersService.findGrafanaConfiguration(
      autoConfigDashboard.grafana,
    );
    if (!grafanaInstance) {
      this.logger.error(`No grafana instance found for: ${autoConfigDashboard.grafana}`);
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
      this.variableHelperService.variableValuesFound(
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
    autoConfigDashboard: MappedAutoConfigDashboard,
  ): Promise<any | null> {
    const templateDashboard = await this.findersService.findGrafanaDashboardOrNull(
      autoConfigDashboard.grafana,
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
      !templateDashboard.tags.some((tag) => tag.toLowerCase() === 'perfana-template')
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
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
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
      this.variableHelperService.setOfVariablesPerCreateSeparateDashboardForVariable(
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
}
