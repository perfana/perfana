import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaDashboard, GrafanaInstance, ApplicationDashboard } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';
import { PERFANA_TEMPLATE_TAG, GRAFANA_SEARCH_LIMIT } from '../../config/constants';

/**
 * Restores missing dashboards from Perfana database back to Grafana instances.
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
   * Restore missing dashboards for all Grafana instances.
   * When instances are provided (from the sync orchestrator), avoids re-fetching.
   */
  async restoreDashboards(instances?: GrafanaInstance[]): Promise<number> {
    this.logger.debug('Checking for missing dashboards to restore...');

    let totalRestored = 0;

    try {
      const allInstances = instances ?? (await this.grafanaInstanceRepo.find());

      for (const instance of allInstances) {
        const restored = await this.restoreDashboardsForInstance(instance);
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

  async getDashboardsToRestore(grafanaInstance: GrafanaInstance): Promise<GrafanaDashboard[]> {
    this.logger.debug(`Finding dashboards to restore for instance: ${grafanaInstance.label}`);

    try {
      // Get all stored dashboards for this instance
      const storedDashboards = await this.grafanaDashboardRepo.find({
        where: { grafanaInstanceId: grafanaInstance.id },
      });

      const allGrafanaDashboards = await this.grafanaApiService.searchDashboards(
        grafanaInstance.id,
        { limit: GRAFANA_SEARCH_LIMIT },
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
          // Check if used by application dashboards, and through which metrics source.
          // grafana_dashboards holds synthetic placeholder rows for non-Grafana sources
          // (Dynatrace, performance-test metrics) alongside real Grafana dashboards.
          //
          // Scoped to THIS instance: a uid is only unique within a Grafana instance,
          // and the same uid routinely exists on several. Matching on uid alone lets
          // one instance's application dashboards vouch for another's copy, so a row
          // with no references of its own looks used and gets pushed into the wrong
          // Grafana on every cycle.
          const applicationDashboards = await this.applicationDashboardRepo
            .createQueryBuilder('ad')
            .leftJoin('metrics_sources', 'ms', 'ms.id = ad.metrics_source_id')
            .select('ms.source_type', 'sourceType')
            .where('ad.dashboardUid = :uid', { uid: missingDashboard.uid })
            .andWhere('ad.grafanaInstanceId = :instanceId', { instanceId: grafanaInstance.id })
            .getRawMany<{ sourceType: string | null }>();

          const isUsedByApplications = applicationDashboards.length > 0;

          const isTemplate = missingDashboard.tags?.includes(PERFANA_TEMPLATE_TAG);

          // Artificial dashboards have no Grafana counterpart, so restoring one would
          // push an empty placeholder into Grafana. Skip anything sourced elsewhere.
          //
          // `every`, not `some`: a real Grafana dashboard is shared across systems and
          // can carry many application dashboards. One mislinked to a non-Grafana
          // MetricsSource must not permanently block restoring it for everyone else.
          // Requiring ALL of them to be non-Grafana keeps this filter fail-safe, and
          // costs nothing — the placeholders it targets have exactly one reference each,
          // and the isRestorable check below is what actually catches them today.
          const isNonGrafanaSource =
            applicationDashboards.length > 0 &&
            applicationDashboards.every(
              (ad) => ad.sourceType != null && ad.sourceType !== 'grafana',
            );

          // Synthetic rows predating the metrics_source link have no source_type to
          // check, but they also carry no restorable grafanaJson — which is the same
          // condition restoreDashboard refuses on. Filter here so the sync stops
          // requeueing them every cycle forever.
          const isRestorable = this.parseRestorableJson(missingDashboard) !== null;

          // Restore if used by applications OR is a template
          if ((isUsedByApplications || isTemplate) && !isNonGrafanaSource && isRestorable) {
            dashboardsToRestore.push(missingDashboard);
          } else if ((isUsedByApplications || isTemplate) && !isNonGrafanaSource) {
            // Was a candidate and is sourced from Grafana, but has nothing to restore
            // from. Debug, not warn: this is the steady state for placeholder rows and
            // logging it at info is the every-cycle noise this filter exists to stop.
            // It stays available for an operator asking why a dashboard never comes back.
            this.logger.debug(
              `Dashboard "${missingDashboard.name}" (${missingDashboard.uid}) is missing from Grafana but has no restorable grafanaJson — not restoring`,
            );
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
   * Parse the stored Grafana JSON, returning null when the dashboard cannot be
   * restored (no JSON, unparseable JSON, or no `dashboard` property). Synthetic
   * rows created for non-Grafana sources always land here.
   */
  private parseRestorableJson(dashboard: GrafanaDashboard): {
    dashboard: Record<string, unknown>;
    meta?: { folderId?: number; folderUid?: string };
  } | null {
    try {
      const grafanaJson =
        typeof dashboard.grafanaJson === 'string'
          ? JSON.parse(dashboard.grafanaJson)
          : dashboard.grafanaJson;

      return grafanaJson && grafanaJson.dashboard ? grafanaJson : null;
    } catch {
      // Unparseable JSON is unrestorable, not a reason to abort the whole sweep.
      // Absent JSON is the expected case for a placeholder and stays quiet, but
      // corrupt JSON on a real dashboard means it silently stops being restorable
      // — say so once per sweep rather than filtering it away invisibly.
      this.logger.warn(
        `Dashboard "${dashboard.name}" has unparseable grafanaJson, treating as unrestorable`,
      );
      return null;
    }
  }

  /**
   * Restore a dashboard to Grafana.
   * Returns true only when Grafana actually accepted the dashboard.
   */
  async restoreDashboard(
    grafanaInstance: GrafanaInstance,
    dashboard: GrafanaDashboard,
  ): Promise<boolean> {
    this.logger.log(`Restoring dashboard: ${dashboard.name} to ${grafanaInstance.label}`);

    try {
      const grafanaJson = this.parseRestorableJson(dashboard);

      // Validate grafanaJson has required structure
      if (!grafanaJson) {
        this.logger.warn(
          `Dashboard "${dashboard.name}" has invalid grafanaJson (missing dashboard property), skipping restore`,
        );
        return false;
      }

      // Prepare dashboard for restoration.
      // Send both folderId (Grafana ≤12) and folderUid (Grafana 13+) for compatibility.
      const restorePayload = {
        dashboard: {
          ...grafanaJson.dashboard,
          id: null, // Let Grafana assign new ID
        },
        folderId: grafanaJson.meta?.folderId || 0,
        folderUid: grafanaJson.meta?.folderUid || '',
        overwrite: false,
      };

      // Remove ID (Grafana will assign new one)
      delete restorePayload.dashboard.id;

      // Create dashboard in Grafana
      await this.grafanaApiService.createDashboard(grafanaInstance.id, restorePayload);

      this.logger.log(`Restored dashboard: ${dashboard.name} to ${grafanaInstance.label}`);
      return true;
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

        return false;
      } else {
        this.logger.error(`Failed to restore dashboard "${dashboard.name}"`, errorStack);
        throw error;
      }
    }
  }

  private async restoreDashboardsForInstance(instance: GrafanaInstance): Promise<number> {
    let restoredCount = 0;

    try {
      const dashboardsToRestore = await this.getDashboardsToRestore(instance);

      for (const dashboard of dashboardsToRestore) {
        // Isolate each dashboard: restoreDashboard rethrows anything that is not a
        // 412, and one dashboard Grafana rejects would otherwise abort the loop and
        // starve every dashboard behind it, on every cycle.
        try {
          // Only count dashboards Grafana actually accepted — a skipped or dropped
          // dashboard reported as restored makes the sync log claim work it never did.
          if (await this.restoreDashboard(instance, dashboard)) {
            restoredCount++;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.stack : String(error);
          this.logger.error(
            `Failed to restore dashboard "${dashboard.name}", continuing with the rest`,
            errorMessage,
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Failed to restore dashboards for instance ${instance.label}:`,
        errorMessage,
      );
    }

    return restoredCount;
  }
}
