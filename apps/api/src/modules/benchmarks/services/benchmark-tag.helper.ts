import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
        const dashboard = await this.appDashboardRepo.findOne({
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
        const dashboard = await this.appDashboardRepo.findOne({
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
