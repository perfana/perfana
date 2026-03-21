import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { GrafanaDashboard, ApplicationDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';
import { StoreDashboardService } from './store-dashboard.service';

interface DashboardToUpdate {
  perfanaDashboard: any; // From search API
  usedBySUT: string[]; // Systems using this dashboard
}

/**
 * UpdateDashboardsService
 *
 * Updates existing dashboards when changes are detected.
 *
 * Two update modes:
 * 1. Regular updates - Sync changes from Grafana → Perfana DB
 * 2. Template propagation - Push changes from template dashboards to instances
 */
@Injectable()
export class UpdateDashboardsService {
  private readonly logger = new Logger(UpdateDashboardsService.name);

  constructor(
    @InjectRepository(GrafanaDashboard)
    private grafanaDashboardRepo: Repository<GrafanaDashboard>,
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
    @InjectRepository(ApplicationDashboard)
    private applicationDashboardRepo: Repository<ApplicationDashboard>,
    private grafanaApiService: GrafanaApiService,
    private storeDashboardService: StoreDashboardService,
    private configService: ConfigService,
  ) {}

  /**
   * Find dashboards to update from Grafana instance
   * Based on: perfana-grafana/grafana-sync/update-dashboards/get-dashboards-to-update.js
   */
  async getDashboardsToUpdate(grafanaInstance: GrafanaInstance): Promise<DashboardToUpdate[]> {
    this.logger.debug(`Finding dashboards to update for instance: ${grafanaInstance.label}`);

    try {
      // Get stored dashboards for this instance
      const storedDashboards = await this.grafanaDashboardRepo.find({
        where: { grafanaInstanceId: grafanaInstance.id },
        select: ['uid', 'updated', 'usedBySut'],
      });

      // Fetch all dashboards with 'perfana' tag from Grafana
      const grafanaDashboards = await this.grafanaApiService.searchDashboards(grafanaInstance.id, {
        tag: 'perfana',
        limit: 5000,
      });

      // Filter to only dashboards with 'perfana' tag
      const perfanaDashboards = grafanaDashboards.filter((dashboard) =>
        dashboard.tags?.map((t: string) => t.toLowerCase()).includes('perfana'),
      );

      // Process dashboards in batches to respect concurrency limits
      const batchSize = 20; // Same as original PARALLEL_GET_DASHBOARD_CALLS
      const dashboardsToUpdate: DashboardToUpdate[] = [];

      for (let i = 0; i < perfanaDashboards.length; i += batchSize) {
        const batch = perfanaDashboards.slice(i, i + batchSize);

        const batchPromises = batch.map(async (dashboard) => {
          try {
            // Fetch full dashboard details to check update timestamp
            const details = await this.grafanaApiService.getDashboardByUid(
              grafanaInstance.id,
              dashboard.uid,
            );

            // Find matching stored dashboard
            const storedDashboard = storedDashboards.find((stored) => stored.uid === dashboard.uid);

            if (storedDashboard) {
              // Check if Grafana dashboard is newer than stored
              const grafanaUpdated = new Date(details.meta.updated);
              const storedUpdated = storedDashboard.updated
                ? new Date(storedDashboard.updated)
                : new Date(0);
              const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

              // Only update if:
              // 1. Grafana dashboard was updated in last hour (reduce noise)
              // 2. Grafana update is newer than stored update
              if (grafanaUpdated > oneHourAgo && grafanaUpdated > storedUpdated) {
                return {
                  perfanaDashboard: dashboard,
                  usedBySUT: storedDashboard.usedBySut || [],
                };
              }
            }

            return null;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.stack : String(error);
            this.logger.error(
              `Failed to check update status for dashboard ${dashboard.uid}`,
              errorMessage,
            );
            return null;
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);

        // Collect successful results
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            dashboardsToUpdate.push(result.value);
          }
        });
      }

      if (dashboardsToUpdate.length > 0) {
        this.logger.log(
          `Found ${dashboardsToUpdate.length} dashboards to update: ${dashboardsToUpdate.map((d) => d.perfanaDashboard.title).join(', ')}`,
        );
      } else {
        this.logger.debug('No dashboards to update');
      }

      return dashboardsToUpdate;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Failed to get dashboards to update for ${grafanaInstance.label}`,
        errorMessage,
      );
      return [];
    }
  }

  /**
   * Update dashboards that have changed in Grafana
   * Returns count of dashboards updated
   */
  async updateDashboards(): Promise<number> {
    this.logger.debug('Checking for dashboard updates...');

    let totalUpdated = 0;

    try {
      const instances = await this.grafanaInstanceRepo.find();

      for (const instance of instances) {
        const updated = await this.updateDashboardsForInstance(instance);
        totalUpdated += updated;
      }

      if (totalUpdated > 0) {
        this.logger.log(`Updated ${totalUpdated} dashboards`);
      }
    } catch (error) {
      this.logger.error('Failed to update dashboards:', error);
    }

    return totalUpdated;
  }

  /**
   * Update dashboards for a specific Grafana instance
   */
  private async updateDashboardsForInstance(instance: GrafanaInstance): Promise<number> {
    let updatedCount = 0;

    try {
      const dashboardsToUpdate = await this.getDashboardsToUpdate(instance);

      for (const { perfanaDashboard } of dashboardsToUpdate) {
        try {
          await this.storeDashboardService.storeDashboard(instance, perfanaDashboard, true);
          updatedCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.stack : String(error);
          this.logger.error(
            `Failed to update dashboard ${perfanaDashboard.title} (UID: ${perfanaDashboard.uid})`,
            errorMessage,
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Failed to update dashboards for instance ${instance.label}`, errorMessage);
    }

    return updatedCount;
  }

  /**
   * Update template dashboards and propagate changes to instances
   * Used when GRAFANA_PROPAGATE_TEMPLATE_UPDATES is enabled
   *
   * This updates the panels metadata in application_dashboards when
   * the template dashboard changes (e.g., panel titles, types, formats)
   */
  async updateTemplateDashboards(): Promise<number> {
    this.logger.debug('Propagating template dashboard updates...');

    let totalUpdated = 0;

    try {
      const instances = await this.grafanaInstanceRepo.find();

      for (const instance of instances) {
        // Get dashboards that were updated in the last sync
        const dashboardsToUpdate = await this.getDashboardsToUpdate(instance);

        for (const { perfanaDashboard } of dashboardsToUpdate) {
          // Find application dashboards that use this as a template
          const appDashboards = await this.applicationDashboardRepo.find({
            where: {
              templateDashboardUid: perfanaDashboard.uid,
            },
          });

          if (appDashboards.length === 0) {
            this.logger.debug(
              `No application dashboards found using template ${perfanaDashboard.uid}`,
            );
            continue;
          }

          // Get the updated template dashboard to get fresh panels
          const templateDashboard = await this.grafanaDashboardRepo.findOne({
            where: {
              uid: perfanaDashboard.uid,
              grafanaInstanceId: instance.id,
            },
          });

          if (!templateDashboard) {
            this.logger.warn(`Template dashboard ${perfanaDashboard.uid} not found in database`);
            continue;
          }

          // Update the referenced grafana_dashboard for each application dashboard
          for (const appDashboard of appDashboards) {
            try {
              // Get the grafana_dashboard that this application dashboard references
              const referencedDashboard = await this.grafanaDashboardRepo.findOne({
                where: {
                  id: appDashboard.grafanaDashboardId,
                },
              });

              if (!referencedDashboard) {
                this.logger.warn(
                  `Referenced dashboard not found for ${appDashboard.dashboardLabel}`,
                );
                continue;
              }

              // Update the referenced dashboard's panels from the template
              referencedDashboard.panels = templateDashboard.panels;

              await this.grafanaDashboardRepo.save(referencedDashboard);
              totalUpdated++;

              this.logger.log(
                `Propagated template changes to dashboard for: ${appDashboard.dashboardLabel}`,
              );
            } catch (error) {
              const errorMessage = error instanceof Error ? error.stack : String(error);
              this.logger.error(
                `Failed to update dashboard for ${appDashboard.dashboardLabel}`,
                errorMessage,
              );
            }
          }
        }
      }

      if (totalUpdated > 0) {
        this.logger.log(`Propagated template updates to ${totalUpdated} application dashboards`);
      }
    } catch (error) {
      this.logger.error('Failed to propagate template dashboard updates:', error);
    }

    return totalUpdated;
  }
}
