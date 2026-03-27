import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TestRun } from '@perfana/shared/entities';

/**
 * Checks for stuck or problematic test runs.
 * Runs every 5 minutes to detect:
 * - Test runs in "running" status for too long
 * - Test runs with missing end time
 * - Test runs with invalid state
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

}
