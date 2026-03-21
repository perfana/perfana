import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TestRun } from '@perfana/shared/entities';

/**
 * TestRunSanityCheckerService
 *
 * Checks for stuck or problematic test runs.
 * Runs every 5 minutes to detect:
 * - Test runs in "running" status for too long
 * - Test runs with missing end time
 * - Test runs with invalid state
 *
 * TODO: Port logic from perfana-grafana/src/sanity-checker/test-run-checker.ts
 */
@Injectable()
export class TestRunSanityCheckerService {
  private readonly logger = new Logger(TestRunSanityCheckerService.name);

  constructor(
    private configService: ConfigService,
    @InjectRepository(TestRun)
    private testRunRepository: Repository<TestRun>,
  ) {}

  /**
   * Check for stuck test runs every 5 minutes
   */
  @Cron('*/5 * * * *')
  async checkStuckTestRuns() {
    if (!this.configService.get<boolean>('grafanaSync.sanityChecker.testRun.enabled', false)) {
      return;
    }

    this.logger.debug('Checking for stuck test runs...');

    const delayMinutes = this.configService.get<number>(
      'grafanaSync.sanityChecker.testRun.delayMinutes',
      10,
    );

    try {
      const threshold = new Date(Date.now() - delayMinutes * 60 * 1000);

      // TODO: Fix status query - status is JSONB with evaluatingAdapt property
      // Should query for: testRun.status->>'evaluatingAdapt' = 'EVALUATING'
      const stuckTestRuns = await this.testRunRepository
        .createQueryBuilder('testRun')
        .where('testRun.endTime IS NULL')
        .andWhere('testRun.startTime < :threshold', { threshold })
        .getMany();

      if (stuckTestRuns.length > 0) {
        this.logger.warn(`Found ${stuckTestRuns.length} stuck test runs`);

        for (const testRun of stuckTestRuns) {
          // TODO: Determine correct status update strategy
          // status is a JSONB field with evaluatingAdapt property, not a simple string
          await this.testRunRepository.update(testRun.id, {
            endTime: new Date(),
            // TODO: Update status.evaluatingAdapt to 'FAILED' if appropriate
          });
        }

        this.logger.log(`Updated ${stuckTestRuns.length} stuck test runs with end time`);
      }
    } catch (error) {
      this.logger.error('Sanity check failed:', error);
    }
  }

  /**
   * Check for test runs with missing end time
   * TODO: Port from perfana-grafana
   */
  @Cron('*/10 * * * *')
  async checkMissingEndTime() {
    if (!this.configService.get<boolean>('grafanaSync.sanityChecker.testRun.enabled', false)) {
      return;
    }

    this.logger.debug('Checking for test runs with missing end time...');

    try {
      // TODO: Implement check for completed test runs without end time
      this.logger.warn(
        'checkMissingEndTime() not yet implemented - needs port from perfana-grafana',
      );
    } catch (error) {
      this.logger.error('Missing end time check failed:', error);
    }
  }

  /**
   * Check for orphaned test runs (no benchmark reference)
   * TODO: Port from perfana-grafana
   */
  async checkOrphanedTestRuns(): Promise<void> {
    // TODO: Implement orphaned test run detection
    this.logger.warn('checkOrphanedTestRuns() not yet implemented');
  }
}
