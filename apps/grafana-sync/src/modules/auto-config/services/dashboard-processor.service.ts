/**
 * Copyright 2025 Perfana Contributors
 *
 * DashboardProcessorService
 *
 * Extracted from: dashboard-configurator.service.ts
 *
 * Handles dashboard processing workflows:
 * - Processing variable sets
 * - Handling existing dashboards
 * - Creating new dashboards
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AutoConfigFindersService,
  MappedTestRun,
  MappedAutoConfigDashboard,
} from '../auto-config-finders.service';
import { DashboardVariable } from '../types';
import { DashboardCreatorService } from './dashboard-creator.service';
import { DashboardFinderService } from './dashboard-finder.service';
import { DashboardStorageService } from './dashboard-storage.service';

@Injectable()
export class DashboardProcessorService {
  private readonly logger = new Logger(DashboardProcessorService.name);

  constructor(
    private readonly findersService: AutoConfigFindersService,
    private readonly dashboardCreatorService: DashboardCreatorService,
    private readonly dashboardFinderService: DashboardFinderService,
    private readonly dashboardStorageService: DashboardStorageService,
  ) {}

  /**
   * Process a single variable set
   */
  async processSingleVariableSet(
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    variableValues: DashboardVariable[],
    testRunVariables: any[],
    grafanaInstance: any,
    templateDashboard: any,
  ): Promise<void> {
    const applicationDashboards = await this.dashboardFinderService.findApplicationDashboards(
      templateDashboard.grafana,
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
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    variableValues: DashboardVariable[],
    templateDashboard: any,
  ): Promise<void> {
    const applicationDashboard = applicationDashboards[0];
    const storedGrafanaDashboard = await this.findersService.findGrafanaDashboardOrNull(
      grafanaInstance.label,
      [applicationDashboard.dashboardUid],
    );

    if (!storedGrafanaDashboard) {
      this.logger.warn(
        `No stored grafana dashboard found for: ${applicationDashboard.dashboardUid}, deleting the applicationDashboard.`,
      );
      // TODO: In full implementation: delete applicationDashboard
    } else {
      await this.dashboardStorageService.storeApplicationDashboardsInMongo(
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
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    variableValues: DashboardVariable[],
    testRunVariables: any[],
    grafanaInstance: any,
    templateDashboard: any,
    applicationDashboards: any[],
  ): Promise<void> {
    const existingGrafanaDashboards =
      await this.dashboardFinderService.findExistingGrafanaDashboards(
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
      await this.dashboardStorageService.storeApplicationDashboardsInMongo(
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
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    variableValues: DashboardVariable[],
    applicationDashboards: any[],
    _testRunVariables: any[],
  ): Promise<void> {
    const storedGrafanaDashboard =
      await this.dashboardCreatorService.createDashboardsInGrafanaAndMongo(
        grafanaInstance,
        templateDashboard.grafanaJson,
        testRun,
        autoConfigDashboard,
        variableValues,
      );

    this.logger.debug(
      `Before storeApplicationDashboardsInMongo - variableValues: ${JSON.stringify(variableValues.map((v) => ({ name: v.name, values: v.values })))}`,
    );

    if (autoConfigDashboard.readOnly && storedGrafanaDashboard) {
      await this.dashboardStorageService.storeApplicationDashboardsInMongo(
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
}
