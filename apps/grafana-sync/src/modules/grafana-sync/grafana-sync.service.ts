import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { StoreDashboardService } from './store-dashboard.service';
import { RestoreDashboardService } from './restore-dashboard.service';
import { UpdateDashboardsService } from './update-dashboards.service';

/**
 * GrafanaSyncService
 *
 * Main orchestrator for Grafana dashboard synchronization.
 * Runs periodic sync jobs using @nestjs/schedule decorators.
 *
 * Sync operations:
 * 1. Store new dashboards from Grafana → Perfana DB
 * 2. Update existing dashboards with changes
 * 3. Restore missing dashboards from Perfana DB → Grafana
 */
@Injectable()
export class GrafanaSyncService {
  private readonly logger = new Logger(GrafanaSyncService.name);
  private isSyncing = false;

  constructor(
    private configService: ConfigService,
    private storeDashboardService: StoreDashboardService,
    private restoreDashboardService: RestoreDashboardService,
    private updateDashboardsService: UpdateDashboardsService,
  ) {}

  /**
   * Main sync job - runs at configured interval
   * Default: Every 30 seconds (GRAFANA_SYNC_INTERVAL)
   */
  @Interval(30000) // 30 seconds - TODO: Make this configurable
  async handleGrafanaSync() {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping...');
      return;
    }

    try {
      this.isSyncing = true;
      this.logger.debug('Starting Grafana dashboard sync...');

      const startTime = Date.now();

      // Add new dashboards from Grafana to Perfana DB
      const addedCount = await this.storeDashboardService.addNewDashboards();

      // Update existing dashboards with changes
      const updatedCount = await this.updateDashboardsService.updateDashboards();

      // Restore missing dashboards from Perfana DB to Grafana
      const restoredCount = await this.restoreDashboardService.restoreDashboards();

      const duration = Date.now() - startTime;

      this.logger.log(
        `Sync completed in ${duration}ms: ${addedCount} added, ${updatedCount} updated, ${restoredCount} restored`,
      );
    } catch (error) {
      this.logger.error('Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Template update job - propagates changes from template dashboards
   * Runs every 2 minutes if enabled
   */
  @Cron('*/2 * * * *') // Every 2 minutes
  async handleTemplateUpdates() {
    if (!this.configService.get<boolean>('grafanaSync.propagateTemplateUpdates', false)) {
      return;
    }

    try {
      this.logger.debug('Starting template dashboard updates...');
      await this.updateDashboardsService.updateTemplateDashboards();
    } catch (error) {
      this.logger.error('Template update failed:', error);
    }
  }

  /**
   * Manual sync trigger (can be called via API endpoint)
   */
  async triggerManualSync(): Promise<void> {
    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.logger.log('Manual sync triggered');
    await this.handleGrafanaSync();
  }

  /**
   * Get sync status
   */
  getSyncStatus(): { syncing: boolean } {
    return { syncing: this.isSyncing };
  }
}
