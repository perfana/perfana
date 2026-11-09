import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import { mergeAndFilterTags } from '../../../common/tag-filter.utils';
import { ApplicationDashboard as ApplicationDashboardEntity } from '../../../entities';

/**
 * Helper service for benchmark tag inheritance operations.
 */
@Injectable()
export class BenchmarkTagHelper {
  private readonly logger = new Logger(BenchmarkTagHelper.name);

  constructor(
    @InjectRepository(ApplicationDashboardEntity)
    private readonly appDashboardRepo: Repository<ApplicationDashboardEntity>,
  ) {}

  /**
   * Inherit tags from application dashboard if available
   */
  async inheritTagsFromDashboard(
    applicationDashboardId: string | undefined,
    providedTags: string[] | undefined,
  ): Promise<string[]> {
    let inheritedTags: string[] = providedTags || [];

    if (applicationDashboardId) {
      try {
        const dashboard = await withRequestEm(this.appDashboardRepo).findOne({
          where: { id: applicationDashboardId },
          select: ['id', 'tags'],
        });

        if (dashboard?.tags?.length) {
          inheritedTags = mergeAndFilterTags(dashboard.tags, providedTags || []);
          this.logger.debug(
            `Inherited ${dashboard.tags.length} raw tags, filtered to ${inheritedTags.length} tags: ${inheritedTags.join(', ')}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          'Failed to find application dashboard for tag inheritance:',
          error,
        );
      }
    }

    return inheritedTags;
  }

  /** The metrics source an application dashboard hangs off, or undefined when the row is gone. */
  async metricsSourceIdOf(applicationDashboardId: string): Promise<string | undefined> {
    const dashboard = await withRequestEm(this.appDashboardRepo).findOne({
      where: { id: applicationDashboardId },
      select: ['id', 'metricsSourceId'],
    });
    return dashboard?.metricsSourceId ?? undefined;
  }

  /**
   * The label of the Grafana instance an application dashboard lives on, or undefined when it has
   * none (Dynatrace and performance-metrics dashboards) or the row is gone. `benchmarks.grafana_instance`
   * is the label the SLO table shows; the web client has no label for a dashboard picked from the
   * list (only `grafana_instance_id`), so it used to send 'Default' for every new SLO (#720).
   */
  async grafanaInstanceLabelOf(applicationDashboardId: string): Promise<string | undefined> {
    // A display label is not worth failing the save over; fall back like tag inheritance does.
    try {
      const dashboard = await withRequestEm(this.appDashboardRepo).findOne({
        where: { id: applicationDashboardId },
        relations: { grafanaInstance: true },
        select: { id: true, grafanaInstance: { id: true, label: true } },
      });
      return dashboard?.grafanaInstance?.label || undefined;
    } catch (error) {
      this.logger.warn('Failed to resolve the Grafana instance of an application dashboard:', error);
      return undefined;
    }
  }

  /**
   * Get inherited tags for update operation based on dashboard lookup
   */
  async getInheritedTagsForUpdate(
    dashboardUid: string | undefined,
    systemUnderTestId: string | undefined,
    testEnvironment: string | undefined,
    providedTags: string[] | undefined,
    existingTags: string[] | undefined,
  ): Promise<string[]> {
    let inheritedTags: string[] = providedTags || existingTags || [];

    if (dashboardUid && systemUnderTestId && testEnvironment) {
      try {
        const dashboard = await withRequestEm(this.appDashboardRepo).findOne({
          where: {
            systemUnderTestId,
            testEnvironment,
            dashboardUid,
          },
          select: ['id', 'tags'],
        });

        if (dashboard?.tags?.length) {
          const tags = providedTags || existingTags || [];
          inheritedTags = mergeAndFilterTags(dashboard.tags, tags);
          this.logger.debug(
            `Inherited ${dashboard.tags.length} raw tags, filtered to ${inheritedTags.length} tags: ${inheritedTags.join(', ')}`,
          );
        }
      } catch {
        this.logger.debug(
          'No matching application_dashboard found for tag inheritance during update',
        );
      }
    }

    return inheritedTags;
  }
}
