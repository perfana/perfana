import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { withRequestEm } from '../../../common/db/request-em';
import { mergeAndFilterTags } from '../../../common/tag-filter.utils';
import { ApplicationDashboard as ApplicationDashboardEntity } from '../../../entities';

/**
 * The system and environment an SLO request was authorized for. An application dashboard belongs to
 * exactly one of each, so a dashboard id only means something inside this pair.
 */
export interface DashboardScope {
  systemUnderTestId: string;
  testEnvironment: string;
}

/**
 * The application dashboard an SLO targets: its lookup, scoped to the authorized system and
 * environment, and the tags an SLO inherits from it.
 */
@Injectable()
export class BenchmarkTagHelper {
  private readonly logger = new Logger(BenchmarkTagHelper.name);

  constructor(
    @InjectRepository(ApplicationDashboardEntity)
    private readonly appDashboardRepo: Repository<ApplicationDashboardEntity>,
  ) {}

  /**
   * The application dashboard `applicationDashboardId` names, or null when it is not a dashboard of
   * `scope` — exactly as if the id did not exist. The id comes from the request body, and the scope
   * is the system and environment the caller was authorized for; nothing else ties the two
   * together, and a default deploy has no RLS backstop (`DB_ENABLE_RLS_ROLE` is false). Looked up by
   * id alone, naming another tenant's dashboard read back its Grafana instance label, tags and
   * metrics source.
   */
  async findInScope(
    applicationDashboardId: string,
    scope: DashboardScope,
  ): Promise<ApplicationDashboardEntity | null> {
    // TypeORM drops an undefined key from `where`, so a missing scope value would widen the lookup
    // to every system. A non-uuid id makes Postgres throw, which aborts the request's transaction.
    if (!scope.systemUnderTestId || !scope.testEnvironment || !isUuid(applicationDashboardId)) {
      return null;
    }
    return withRequestEm(this.appDashboardRepo).findOne({
      where: {
        id: applicationDashboardId,
        systemUnderTestId: scope.systemUnderTestId,
        testEnvironment: scope.testEnvironment,
      },
      relations: { grafanaInstance: true },
      select: { id: true, tags: true, metricsSourceId: true, grafanaInstance: { id: true, label: true } },
    });
  }

  /** The provided tags merged with the dashboard's own, system tags filtered out. */
  inheritTagsFromDashboard(
    dashboard: Pick<ApplicationDashboardEntity, 'tags'> | null | undefined,
    providedTags: string[] | undefined,
  ): string[] {
    if (!dashboard?.tags?.length) return providedTags || [];
    const inheritedTags = mergeAndFilterTags(dashboard.tags, providedTags || []);
    this.logger.debug(
      `Inherited ${dashboard.tags.length} raw tags, filtered to ${inheritedTags.length} tags: ${inheritedTags.join(', ')}`,
    );
    return inheritedTags;
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
