import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import { ConfigService } from '@nestjs/config';
import { TestRun as TestRunEntity } from '../../../entities';
import { QueueService } from '../../queue/queue.service';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../types/realtime-events.types';
import { mapEntityToTestRun } from '../handlers/entity-mapper';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { withOrgFilter } from '../../../common/utils/with-org-filter';

@Injectable()
export class TestRunsStaleDetectionService {
  private readonly logger = new Logger(TestRunsStaleDetectionService.name);
  private readonly staleTimeoutMinutes: number;

  constructor(
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    private queueService: QueueService,
    private configService: ConfigService,
    private testRunsGateway: TestRunsGateway,
    private readonly authzService: AuthorizationService,
  ) {
    // Get stale timeout from environment with default of 2 minutes
    this.staleTimeoutMinutes = this.configService.get<number>('STALE_TIMEOUT_MINUTES', 2);
    this.logger.log(`Stale timeout configured to ${this.staleTimeoutMinutes} minutes`);
  }

  /**
   * Find and mark test runs as stale if they haven't been updated within the timeout period
   * @returns Array of test run IDs that were marked as stale
   */
  async detectAndMarkStaleTestRuns(): Promise<string[]> {
    try {
      const staleThresholdDate = new Date(Date.now() - this.staleTimeoutMinutes * 60 * 1000);

      // Find incomplete test runs that haven't been updated in a while and aren't already marked as stale
      const staleTestRuns = await withRequestEm(this.testRunRepo).find({
        where: {
          completed: false,
          isStale: false,
          updatedAt: LessThan(staleThresholdDate),
        },
        select: ['id', 'testRunId', 'systemUnderTestId', 'testEnvironment', 'workload', 'startTime', 'endTime', 'updatedAt'],
      });

      if (staleTestRuns.length === 0) {
        this.logger.debug('No stale test runs detected');
        return [];
      }

      this.logger.log(`Found ${staleTestRuns.length} stale test run(s)`);

      const markedTestRunIds: string[] = [];

      for (const testRun of staleTestRuns) {
        try {
          await this.markTestRunAsStale(testRun);
          markedTestRunIds.push(testRun.testRunId);

          // Trigger analysis for the stale test run
          await this.triggerAnalysisForStaleRun(testRun);
        } catch (error) {
          this.logger.error(
            `Failed to process stale test run ${testRun.testRunId}: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined
          );
        }
      }

      this.logger.log(`Successfully marked ${markedTestRunIds.length} test run(s) as stale`);
      return markedTestRunIds;
    } catch (error) {
      this.logger.error(
        `Error detecting stale test runs: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
      throw error;
    }
  }

  /**
   * Mark a single test run as stale and completed
   */
  private async markTestRunAsStale(testRun: TestRunEntity): Promise<void> {
    const now = new Date();

    await withRequestEm(this.testRunRepo).update(testRun.id, {
      isStale: true,
      staleDetectedAt: now,
      completed: true,
      endTime: testRun.endTime || now, // Set end time to now if not already set
    });

    this.logger.log(
      `Marked test run ${testRun.testRunId} as stale (last updated: ${testRun.updatedAt.toISOString()})`
    );

    // Emit real-time event so the frontend moves the test run from "Running" to "Completed"
    try {
      const updatedEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { id: testRun.id },
        relations: ['systemUnderTest'],
      });

      if (updatedEntity) {
        const testRunData = mapEntityToTestRun(updatedEntity);
        this.testRunsGateway.emitTestRunUpdated(
          {
            eventType: TestRunEventType.UPDATED,
            timestamp: now.toISOString(),
            testRun: testRunData,
            teamId: updatedEntity.systemUnderTest?.team_id,
          },
          undefined,
          updatedEntity.organizationId ?? undefined,
          updatedEntity.systemUnderTest?.team_id,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to emit real-time event for stale test run ${testRun.testRunId}: ${
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : String(error)
        }`,
      );
    }
  }

  /**
   * Trigger automated analysis for a stale test run
   * Sends the test run to the worker queue for processing
   */
  private async triggerAnalysisForStaleRun(testRun: TestRunEntity): Promise<void> {
    try {
      const jobId = await this.queueService.sendJob('analyzeTestRun', {
        testRunId: testRun.testRunId,
        systemUnderTestId: testRun.systemUnderTestId,
        testEnvironment: testRun.testEnvironment,
        workload: testRun.workload,
        reason: 'stale_detection',
      });

      this.logger.log(
        `Triggered analysis for stale test run ${testRun.testRunId} (job ID: ${jobId})`
      );
    } catch (error) {
      this.logger.error(
        `Failed to trigger analysis for stale test run ${testRun.testRunId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
      // Don't throw - we still want to mark the test run as stale even if analysis fails to trigger
    }
  }

  /**
   * Get statistics about stale test runs with optional organization filtering
   *
   * @param userId - User ID for authorization checks
   * @param roles - User roles for authorization checks
   */
  async getStaleTestRunStats(
    userId: string = '',
    roles: string[] = [],
  ): Promise<{
    totalStale: number;
    staleInLast24Hours: number;
  }> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);

    // Non-admin users with no organization memberships see zeros
    if (orgIds !== null && orgIds.length === 0) {
      this.logger.debug('User has no organization memberships, returning zero stale stats');
      return {
        totalStale: 0,
        staleInLast24Hours: 0,
      };
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Build query for total stale count with organization filtering
    const totalStaleQuery = withRequestEm(this.testRunRepo)
      .createQueryBuilder('tr')
      .where('tr.isStale = :isStale', { isStale: true });

    if (orgIds !== null) {
      totalStaleQuery
        .leftJoin('tr.systemUnderTest', 'sut')
        .leftJoin('sut.team', 'team')
        .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
    }

    const totalStale = await totalStaleQuery.getCount();

    // Build query for stale in last 24 hours with organization filtering
    const staleInLast24HoursQuery = withRequestEm(this.testRunRepo)
      .createQueryBuilder('tr')
      .where('tr.isStale = :isStale', { isStale: true })
      .andWhere('tr.staleDetectedAt >= :oneDayAgo', { oneDayAgo });

    if (orgIds !== null) {
      staleInLast24HoursQuery
        .leftJoin('tr.systemUnderTest', 'sut')
        .leftJoin('sut.team', 'team')
        .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
    }

    const staleInLast24Hours = await staleInLast24HoursQuery.getCount();

    this.logger.debug(
      `Stale stats: total=${totalStale}, last24h=${staleInLast24Hours}${orgIds === null ? ' (admin)' : ` (orgs: ${orgIds.length})`}`
    );

    return {
      totalStale,
      staleInLast24Hours,
    };
  }
}
