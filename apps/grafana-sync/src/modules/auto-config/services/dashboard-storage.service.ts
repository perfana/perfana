/**
 * Copyright 2025 Perfana Contributors
 *
 * DashboardStorageService
 *
 * Extracted from: dashboard-configurator.service.ts
 *
 * Handles application dashboard storage logic:
 * - Determining when to store/update dashboards
 * - Managing variable replacement
 * - Coordinating storage operations
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  MappedTestRun,
  MappedAutoConfigDashboard,
  MappedGrafanaDashboard,
} from '../auto-config-finders.service';
import { DashboardVariable } from '../types';
import { ApplicationDashboardCreatorService } from './application-dashboard-creator.service';

@Injectable()
export class DashboardStorageService {
  private readonly logger = new Logger(DashboardStorageService.name);

  constructor(private readonly dashboardCreatorService: ApplicationDashboardCreatorService) {}

  /**
   * Store application dashboards in MongoDB
   */
  async storeApplicationDashboardsInMongo(
    grafanaDashboard: MappedGrafanaDashboard,
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    applicationDashboardVariables: DashboardVariable[],
    applicationDashboards: any[],
    templateDashboardUid: string,
    update: boolean,
    templateTags?: string[],
  ): Promise<void> {
    this.logger.debug(
      `storeApplicationDashboardsInMongo - autoConfigDashboard.readOnly: ${autoConfigDashboard.readOnly}`,
    );
    this.logger.debug(
      `storeApplicationDashboardsInMongo - autoConfigDashboard.createSeparateDashboardForVariable: ${autoConfigDashboard.createSeparateDashboardForVariable}`,
    );
    this.logger.debug(
      `storeApplicationDashboardsInMongo - applicationDashboards.length: ${applicationDashboards.length}`,
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
      `storeApplicationDashboardsInMongo - checkIfUpdateRequired result: ${updateRequired}`,
    );

    if (applicationDashboards.length === 0 || updateRequired) {
      // Get tags from template, filtering out 'perfana-template'
      const dashboardTags = (templateTags || grafanaDashboard.tags || []).filter(
        (tag: string) => tag.toLowerCase() !== 'perfana-template',
      );

      if (!autoConfigDashboard.createSeparateDashboardForVariable) {
        this.logger.debug(`storeApplicationDashboardsInMongo - Creating ONE application dashboard`);
        // Create one application dashboard
        await this.dashboardCreatorService.createOneApplicationDashboard(
          newApplicationDashboardVariables,
          autoConfigDashboard,
          testRun,
          grafanaDashboard,
          templateDashboardUid,
          dashboardTags,
        );
      } else {
        this.logger.debug(
          `storeApplicationDashboardsInMongo - Creating SEPARATE dashboards for variable: ${autoConfigDashboard.createSeparateDashboardForVariable}`,
        );
        await this.dashboardCreatorService.createDashboardsWhenCreateSeparateDashboardForVariableIsSet(
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
        `storeApplicationDashboardsInMongo - SKIPPING dashboard creation - update not required`,
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
    autoConfigDashboard: MappedAutoConfigDashboard,
    newApplicationDashboardVariables: DashboardVariable[],
    applicationDashboards: any[],
    _grafanaDashboard: MappedGrafanaDashboard,
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
}
