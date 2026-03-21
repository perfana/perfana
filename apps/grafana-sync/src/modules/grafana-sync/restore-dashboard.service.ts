import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaDashboard, GrafanaInstance, ApplicationDashboard } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

/**
 * RestoreDashboardService
 *
 * Restores missing dashboards from Perfana database back to Grafana instances.
 *
 * Use cases:
 * - Dashboard was accidentally deleted in Grafana
 * - New Grafana instance needs seeding with existing dashboards
 * - Disaster recovery scenarios
 *
 * Process:
 * 1. Fetch all dashboards from Perfana DB for an instance
 * 2. Check which dashboards exist in Grafana
 * 3. Restore missing dashboards via Grafana HTTP API
 *
 * TODO: Port logic from perfana-grafana/src/sync/restore-dashboards.ts
 */
@Injectable()
export class RestoreDashboardService {
  private readonly logger = new Logger(RestoreDashboardService.name);

  constructor(
    @InjectRepository(GrafanaDashboard)
    private grafanaDashboardRepo: Repository<GrafanaDashboard>,
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
    @InjectRepository(ApplicationDashboard)
    private applicationDashboardRepo: Repository<ApplicationDashboard>,
    private grafanaApiService: GrafanaApiService,
  ) {}

  /**
   * Restore missing dashboards for all Grafana instances
   * Returns count of dashboards restored
   */
  async restoreDashboards(): Promise<number> {
    this.logger.debug('Checking for missing dashboards to restore...');

    let totalRestored = 0;

    try {
      const instances = await this.grafanaInstanceRepo.find();

      for (const instance of instances) {
        const restored = await this.restoreDashboardsForInstance(instance.id);
        totalRestored += restored;
      }

      if (totalRestored > 0) {
        this.logger.log(`Restored ${totalRestored} missing dashboards`);
      }
    } catch (error) {
      this.logger.error('Failed to restore dashboards:', error);
    }

    return totalRestored;
  }

  /**
   * Find dashboards to restore
   * Based on: perfana-grafana/grafana-sync/restore-dashboard/get-dashboards-to-restore.js
   */
  async getDashboardsToRestore(grafanaInstance: GrafanaInstance): Promise<GrafanaDashboard[]> {
    this.logger.debug(`Finding dashboards to restore for instance: ${grafanaInstance.label}`);

    try {
      // Get all stored dashboards for this instance
      const storedDashboards = await this.grafanaDashboardRepo.find({
        where: { grafanaInstanceId: grafanaInstance.id },
      });

      // Get all dashboard UIDs from Grafana
      const allGrafanaDashboards = await this.grafanaApiService.searchDashboards(
        grafanaInstance.id,
        { limit: 5000 },
      );

      // Filter to only actual dashboards (exclude folders)
      const grafanaDashboardUids = new Set(
        allGrafanaDashboards
          .filter((item) => item.type === 'dash-db')
          .map((dashboard) => dashboard.uid),
      );

      // Find stored dashboards that don't exist in Grafana
      const missingDashboards = storedDashboards.filter(
        (stored) => !grafanaDashboardUids.has(stored.uid),
      );

      // Filter to only dashboards that should be restored
      const dashboardsToRestore: GrafanaDashboard[] = [];

      for (const missingDashboard of missingDashboards) {
        try {
          // Check if used by application dashboards
          const applicationDashboards = await this.applicationDashboardRepo.find({
            where: { dashboardUid: missingDashboard.uid },
          });

          const isUsedByApplications = applicationDashboards.length > 0;

          // Check if it's a template dashboard
          const isTemplate = missingDashboard.tags?.includes('perfana-template');

          // Restore if used by applications OR is a template
          if (isUsedByApplications || isTemplate) {
            dashboardsToRestore.push(missingDashboard);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.stack : String(error);
          this.logger.error(
            `Failed to check if dashboard ${missingDashboard.uid} should be restored`,
            errorMessage,
          );
        }
      }

      if (dashboardsToRestore.length > 0) {
        this.logger.log(
          `Found ${dashboardsToRestore.length} dashboards to restore: ${dashboardsToRestore.map((d) => d.name).join(', ')}`,
        );
      } else {
        this.logger.debug('No dashboards to restore');
      }

      return dashboardsToRestore;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Failed to get dashboards to restore for ${grafanaInstance.label}`,
        errorMessage,
      );
      return [];
    }
  }

  /**
   * Restore a dashboard to Grafana
   * Based on: perfana-grafana/grafana-sync/restore-dashboard/restore-dashboard.js
   */
  async restoreDashboard(
    grafanaInstance: GrafanaInstance,
    dashboard: GrafanaDashboard,
  ): Promise<void> {
    this.logger.log(`Restoring dashboard: ${dashboard.name} to ${grafanaInstance.label}`);

    try {
      // Parse stored Grafana JSON
      const grafanaJson =
        typeof dashboard.grafanaJson === 'string'
          ? JSON.parse(dashboard.grafanaJson)
          : dashboard.grafanaJson;

      // Validate grafanaJson has required structure
      if (!grafanaJson || !grafanaJson.dashboard) {
        this.logger.warn(
          `Dashboard "${dashboard.name}" has invalid grafanaJson (missing dashboard property), skipping restore`,
        );
        return;
      }

      // Prepare dashboard for restoration
      const restorePayload = {
        dashboard: {
          ...grafanaJson.dashboard,
          id: null, // Let Grafana assign new ID
        },
        folderId: grafanaJson.meta?.folderId || 0, // Use stored folder or General
        overwrite: false,
      };

      // Remove ID (Grafana will assign new one)
      delete restorePayload.dashboard.id;

      // Create dashboard in Grafana
      await this.grafanaApiService.createDashboard(grafanaInstance.id, restorePayload);

      this.logger.log(`Restored dashboard: ${dashboard.name} to ${grafanaInstance.label}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : String(error);

      // If restore fails due to precondition (412), remove from Perfana DB
      if (errorMessage.includes('412') || errorMessage.includes('precondition')) {
        this.logger.warn(
          `Dashboard "${dashboard.name}" could not be restored (precondition failed), removing from Perfana database`,
        );

        try {
          await this.grafanaDashboardRepo.remove(dashboard);
          this.logger.log(`Removed dashboard ${dashboard.name} from Perfana database`);
        } catch (removeError) {
          const removeErrorMessage =
            removeError instanceof Error ? removeError.stack : String(removeError);
          this.logger.error('Failed to remove dashboard from Perfana database', removeErrorMessage);
        }
      } else {
        this.logger.error(`Failed to restore dashboard "${dashboard.name}"`, errorStack);
        throw error;
      }
    }
  }

  /**
   * Restore missing dashboards for a specific Grafana instance
   */
  private async restoreDashboardsForInstance(instanceId: string): Promise<number> {
    let restoredCount = 0;

    try {
      const instance = await this.grafanaInstanceRepo.findOne({
        where: { id: instanceId },
      });

      if (!instance) {
        this.logger.error(`Grafana instance ${instanceId} not found`);
        return 0;
      }

      // Get dashboards to restore
      const dashboardsToRestore = await this.getDashboardsToRestore(instance);

      // Restore each dashboard
      for (const dashboard of dashboardsToRestore) {
        await this.restoreDashboard(instance, dashboard);
        restoredCount++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Failed to restore dashboards for instance ${instanceId}:`, errorMessage);
    }

    return restoredCount;
  }
}
