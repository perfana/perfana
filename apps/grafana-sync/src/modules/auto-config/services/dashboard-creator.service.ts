/**
 * Copyright 2025 Perfana Contributors
 *
 * DashboardCreatorService
 *
 * Extracted from: dashboard-configurator.service.ts
 *
 * Handles dashboard creation in Grafana and database storage:
 * - Creating new dashboards in Grafana
 * - Upserting dashboard metadata to database
 * - Managing read-only dashboard references
 */

import { Injectable, Logger } from '@nestjs/common';
import { GrafanaApiService } from '../../grafana-api/grafana-api.service';
import {
  AutoConfigFindersService,
  MappedTestRun,
  MappedAutoConfigDashboard,
  MappedGrafanaDashboard,
} from '../auto-config-finders.service';
import { AutoConfigUpdatesService } from '../auto-config-updates.service';
import { DashboardVariable } from '../types';
import { createDashboardUid } from '../dashboard-uid.util';

@Injectable()
export class DashboardCreatorService {
  private readonly logger = new Logger(DashboardCreatorService.name);

  constructor(
    private readonly grafanaApiService: GrafanaApiService,
    private readonly findersService: AutoConfigFindersService,
    private readonly updatesService: AutoConfigUpdatesService,
  ) {}

  /**
   * Create dashboards in Grafana and MongoDB
   * Handles both readOnly and regular dashboard creation
   */
  async createDashboardsInGrafanaAndMongo(
    grafanaInstance: any,
    templateJson: string,
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    applicationDashboardVariables: DashboardVariable[],
  ): Promise<MappedGrafanaDashboard | null> {
    let storedGrafanaDashboard: MappedGrafanaDashboard | null = null;

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
    autoConfigDashboard: MappedAutoConfigDashboard,
    testRun: MappedTestRun,
  ): Promise<MappedGrafanaDashboard> {
    this.logger.log(
      'Dashboard is read only, skip create grafana dashboard: reusing existing dashboard template.',
    );

    // Find the template dashboard
    const templateDashboard = await this.findersService.findGrafanaDashboard(
      autoConfigDashboard.grafana,
      [autoConfigDashboard.dashboardUid],
    );

    // Update template's usedBySut
    await this.updatesService.updateUsedBySut(templateDashboard, testRun.systemUnderTestName);

    // Use the template dashboard as the stored dashboard
    return await this.findersService.findGrafanaDashboard(grafanaInstance.label, [
      autoConfigDashboard.dashboardUid,
    ]);
  }

  /**
   * Create a new dashboard in Grafana
   */
  private async createNewDashboard(
    grafanaInstance: any,
    autoConfigDashboard: MappedAutoConfigDashboard,
    testRun: MappedTestRun,
    applicationDashboardVariables: DashboardVariable[],
  ): Promise<MappedGrafanaDashboard> {
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
    const folderId = await this.grafanaApiService.createOrFindFolder(
      grafanaInstanceEntity.id,
      testRun.systemUnderTestName,
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
        title: `${autoConfigDashboard.dashboardName} - ${testRun.systemUnderTestName} ${testRun.testEnvironment}`,
        tags: (templateDashboardResponse.dashboard.tags || []).filter(
          (tag: string) => tag.toLowerCase() !== 'perfana-template',
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

    // Store the created dashboard in grafana_dashboards table
    const storedGrafanaDashboard: MappedGrafanaDashboard = {
      _id: '', // Will be set by upsert
      uid: newDashboardUid,
      grafana: grafanaInstance.label,
      name: newDashboardJson.dashboard.title,
      id: createdDashboardDetails.dashboard.id,
      postgresId: '', // Will be set by upsert
      tags: createdDashboardDetails.dashboard.tags || [],
      grafanaJson: JSON.stringify(createdDashboardDetails),
      templateDashboardUid: autoConfigDashboard.dashboardUid,
      usedBySUT: [testRun.systemUnderTestName],
      templatingVariables: [],
    };

    // Upsert to grafana_dashboards table
    await this.updatesService.upsertGrafanaDashboard({
      grafana: grafanaInstance.label,
      uid: newDashboardUid,
      title: newDashboardJson.dashboard.title,
      id: createdDashboardDetails.dashboard.id,
      grafanaJson: createdDashboardDetails,
      usedBySUT: [testRun.systemUnderTestName],
      panels: [],
    });

    return storedGrafanaDashboard;
  }
}
