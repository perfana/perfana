import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { GrafanaDashboard, ApplicationDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';
import { StoreDashboardService } from './store-dashboard.service';
import { PERFANA_TAG, GRAFANA_SEARCH_LIMIT } from '../../config/constants';

interface DashboardToUpdate {
  perfanaDashboard: any;
  usedBySUT: string[];
}

/**
 * Updates existing dashboards when changes are detected.
 *
 * Two update modes:
 * 1. Regular updates - Sync changes from Grafana -> Perfana DB
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
   * Find dashboards to update from Grafana instance.
   * The Grafana API search already filters by the perfana tag, so no
   * redundant in-memory tag check is needed.
   */
  async getDashboardsToUpdate(grafanaInstance: GrafanaInstance): Promise<DashboardToUpdate[]> {
    this.logger.debug(`Finding dashboards to update for instance: ${grafanaInstance.label}`);

    try {
      const storedDashboards = await this.grafanaDashboardRepo.find({
        where: { grafanaInstanceId: grafanaInstance.id },
        select: ['uid', 'updated', 'usedBySut'],
      });

      const grafanaDashboards = await this.grafanaApiService.searchDashboards(grafanaInstance.id, {
        tag: PERFANA_TAG,
        limit: GRAFANA_SEARCH_LIMIT,
      });

      const batchSize = 20;
      const dashboardsToUpdate: DashboardToUpdate[] = [];

      for (let i = 0; i < grafanaDashboards.length; i += batchSize) {
        const batch = grafanaDashboards.slice(i, i + batchSize);

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
   * Update dashboards that have changed in Grafana.
   * When instances are provided (from the sync orchestrator), avoids re-fetching.
   */
  async updateDashboards(instances?: GrafanaInstance[]): Promise<number> {
    this.logger.debug('Checking for dashboard updates...');

    let totalUpdated = 0;

    try {
      const allInstances = instances ?? (await this.grafanaInstanceRepo.find());

      for (const instance of allInstances) {
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
   * Propagate changes from template dashboards to application dashboards.
   * Scoped by organization when the instance belongs to one.
   */
  async updateTemplateDashboards(): Promise<number> {
    this.logger.debug('Propagating template dashboard updates...');

    let totalUpdated = 0;

    try {
      const instances = await this.grafanaInstanceRepo.find();

      for (const instance of instances) {
        const dashboardsToUpdate = await this.getDashboardsToUpdate(instance);

        for (const { perfanaDashboard } of dashboardsToUpdate) {
          const where: any = { templateDashboardUid: perfanaDashboard.uid };
          if (instance.organizationId) {
            where.organizationId = instance.organizationId;
          }
          const appDashboards = await this.applicationDashboardRepo.find({ where });

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
