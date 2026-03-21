import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

/**
 * StoreDashboardService
 *
 * Stores new dashboards from Grafana instances into Perfana database.
 *
 * Process:
 * 1. Fetch all dashboards from Grafana HTTP API
 * 2. Compare with existing dashboards in Perfana DB
 * 3. Store new dashboards that don't exist yet
 *
 * TODO: Port logic from perfana-grafana/src/sync/store-dashboards.ts
 */
@Injectable()
export class StoreDashboardService {
  private readonly logger = new Logger(StoreDashboardService.name);

  constructor(
    @InjectRepository(GrafanaDashboard)
    private grafanaDashboardRepo: Repository<GrafanaDashboard>,
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
    private grafanaApiService: GrafanaApiService,
  ) {}

  /**
   * Add new dashboards from all Grafana instances
   * Returns count of dashboards added
   */
  async addNewDashboards(): Promise<number> {
    this.logger.debug('Checking for new dashboards to add...');

    let totalAdded = 0;

    try {
      const instances = await this.grafanaInstanceRepo.find();

      for (const instance of instances) {
        const added = await this.addNewDashboardsForInstance(instance.id);
        totalAdded += added;
      }

      if (totalAdded > 0) {
        this.logger.log(`Added ${totalAdded} new dashboards`);
      }
    } catch (error) {
      this.logger.error('Failed to add new dashboards:', error);
    }

    return totalAdded;
  }

  /**
   * Find dashboards to add from a Grafana instance
   * Based on: perfana-grafana/grafana-sync/store-dashboard/get-dashboards-to-add.js
   */
  async getDashboardsToAdd(grafanaInstance: GrafanaInstance): Promise<any[]> {
    this.logger.debug(`Finding dashboards to add for instance: ${grafanaInstance.label}`);

    try {
      // Get stored dashboards for this instance
      const storedDashboards = await this.grafanaDashboardRepo.find({
        where: { grafanaInstanceId: grafanaInstance.id },
        select: ['uid'],
      });

      const storedUids = new Set(storedDashboards.map((d) => d.uid));

      // Fetch dashboards from Grafana with 'perfana' tag
      const grafanaDashboards = await this.grafanaApiService.searchDashboards(grafanaInstance.id, {
        tag: 'perfana',
        limit: 5000,
      });

      // Filter to only dashboards tagged 'perfana' that aren't stored yet
      const dashboardsToAdd = grafanaDashboards.filter((dashboard) => {
        const hasPerfanaTag = dashboard.tags
          ?.map((tag: string) => tag.toLowerCase())
          .includes('perfana');

        const notStored = !storedUids.has(dashboard.uid);

        return hasPerfanaTag && notStored;
      });

      if (dashboardsToAdd.length > 0) {
        this.logger.log(
          `Found ${dashboardsToAdd.length} dashboards to add: ${dashboardsToAdd.map((d: any) => d.title).join(', ')}`,
        );
      } else {
        this.logger.debug('No dashboards to add');
      }

      return dashboardsToAdd;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Failed to get dashboards to add for ${grafanaInstance.label}`,
        errorMessage,
      );
      return [];
    }
  }

  /**
   * Add new dashboards for a specific Grafana instance
   */
  private async addNewDashboardsForInstance(instanceId: string): Promise<number> {
    let addedCount = 0;

    try {
      const instance = await this.grafanaInstanceRepo.findOne({
        where: { id: instanceId },
      });

      if (!instance) {
        this.logger.error(`Grafana instance ${instanceId} not found`);
        return 0;
      }

      // Get dashboards to add
      const dashboardsToAdd = await this.getDashboardsToAdd(instance);

      // Store each new dashboard
      for (const dashboard of dashboardsToAdd) {
        await this.storeDashboard(instance, dashboard, false);
        addedCount++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Failed to add dashboards for instance ${instanceId}:`, errorMessage);
    }

    return addedCount;
  }

  /**
   * Get existing dashboard UIDs for an instance
   */
  private async getExistingDashboardUids(instanceId: string): Promise<string[]> {
    const dashboards = await this.grafanaDashboardRepo.find({
      where: { grafanaInstanceId: instanceId },
      select: ['uid'],
    });

    return dashboards.map((d) => d.uid);
  }

  /**
   * Store dashboard from Grafana to Perfana database
   * Based on: perfana-grafana/grafana-sync/store-dashboard/store-dashboard.js
   */
  async storeDashboard(
    grafanaInstance: GrafanaInstance,
    grafanaDashboardSummary: any, // From search API
    update: boolean = false,
  ): Promise<GrafanaDashboard> {
    this.logger.debug(
      `Storing dashboard: ${grafanaDashboardSummary.title} (UID: ${grafanaDashboardSummary.uid}), update: ${update}`,
    );

    try {
      // Check if already stored
      const existing = await this.grafanaDashboardRepo.findOne({
        where: {
          uid: grafanaDashboardSummary.uid,
          grafanaInstanceId: grafanaInstance.id,
        },
      });

      // If exists and not updating, skip
      if (existing && !update) {
        this.logger.debug(`Dashboard ${grafanaDashboardSummary.uid} already stored, skipping`);
        return existing;
      }

      // Fetch full dashboard details from Grafana API
      const dashboardDetails = await this.grafanaApiService.getDashboardByUid(
        grafanaInstance.id,
        grafanaDashboardSummary.uid,
      );

      // Extract first graph panel to determine datasource
      const firstGraphPanel = dashboardDetails.dashboard.panels?.find((panel: any) =>
        ['graph', 'timeseries', 'table', 'flamegraph'].includes(panel.type),
      );

      if (!firstGraphPanel) {
        throw new Error(`No graph panel found in dashboard ${grafanaDashboardSummary.title}`);
      }

      // Get datasource information
      let datasource;
      try {
        if (firstGraphPanel.datasource?.uid) {
          datasource = await this.grafanaApiService.getDatasourceByUid(
            grafanaInstance.id,
            firstGraphPanel.datasource.uid,
          );
        } else if (firstGraphPanel.datasource) {
          datasource = await this.grafanaApiService.getDatasourceByName(
            grafanaInstance.id,
            firstGraphPanel.datasource,
          );
        } else {
          throw new Error('No datasource found in panel');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.stack : String(error);
        this.logger.error(
          `Failed to fetch datasource for panel "${firstGraphPanel.title}" in dashboard "${dashboardDetails.dashboard.title}"`,
          errorMessage,
        );
        throw error;
      }

      // Build or update dashboard entity
      const dashboard = existing || new GrafanaDashboard();
      dashboard.grafanaInstanceId = grafanaInstance.id;
      dashboard.grafanaInstance = grafanaInstance;
      dashboard.name = dashboardDetails.dashboard.title;
      dashboard.datasourceType = datasource.type;
      dashboard.uri = dashboardDetails.meta.url;
      dashboard.grafanaId = dashboardDetails.dashboard.id;
      dashboard.uid = dashboardDetails.dashboard.uid;
      dashboard.tags = dashboardDetails.dashboard.tags || [];
      dashboard.slug = dashboardDetails.meta.slug;
      dashboard.grafanaJson = dashboardDetails; // Store full JSON
      dashboard.organizationId = grafanaInstance.organizationId || null;

      // Extract panels
      dashboard.panels = this.extractPanels(dashboardDetails.dashboard.panels);

      // Extract templating variables
      if (dashboardDetails.dashboard.templating?.list) {
        dashboard.templatingVariables = this.extractTemplatingVariables(
          dashboardDetails.dashboard.templating.list,
        );
        dashboard.variables = dashboardDetails.dashboard.templating.list.map((v: any) => ({
          name: v.name,
        }));
      } else {
        dashboard.templatingVariables = [];
        dashboard.variables = [];
      }

      // Save to database (will UPDATE if existing has ID, INSERT if new)
      const saved = await this.grafanaDashboardRepo.save(dashboard);

      const action = update ? 'Updated' : 'Added';
      this.logger.log(`${action} dashboard: ${dashboard.name} from ${grafanaInstance.label}`);

      return saved;
    } catch (error) {
      const action = update ? 'updating' : 'adding';
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Failed ${action} dashboard "${grafanaDashboardSummary.title}" for ${grafanaInstance.label}`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Extract panel information from dashboard
   */
  private extractPanels(panels: any[]): any[] {
    if (!panels) return [];

    return panels
      .filter((panel) => !panel.repeatIteration && panel.datasource)
      .map((panel) => ({
        id: panel.id,
        title: panel.title,
        type: panel.type,
        description: panel.description,
        y_axes_format: this.extractYAxisFormat(panel),
        repeat: panel.repeat !== 'null' ? panel.repeat : undefined,
      }));
  }

  /**
   * Extract Y-axis format from panel config
   */
  private extractYAxisFormat(panel: any): string | undefined {
    // New format (fieldConfig)
    if (panel.fieldConfig?.defaults?.unit) {
      return panel.fieldConfig.defaults.unit;
    }

    // Old format (yaxes)
    if (panel.yaxes?.[0]?.format) {
      return panel.yaxes[0].format;
    }

    return undefined;
  }

  /**
   * Extract templating variables
   */
  private extractTemplatingVariables(templatingList: any[]): any[] {
    return templatingList.map((variable) => ({
      name: variable.name,
      type: variable.type,
      options: variable.regex ? variable.options : undefined,
      datasource: variable.datasource || undefined,
      regex: variable.regex || undefined,
      query: variable.query,
    }));
  }
}
