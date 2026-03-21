import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TestRunsStaleDetectionService } from './test-runs-stale-detection.service';

@Injectable()
export class TestRunsStaleDetectionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TestRunsStaleDetectionSchedulerService.name);
  private isRunning = false;

  constructor(
    private staleDetectionService: TestRunsStaleDetectionService,
  ) {}

  onModuleInit() {
    this.logger.log('Stale test run detection scheduler initialized');
  }

  /**
   * Check for stale test runs every 30 seconds
   * Uses cron expression to run at 0, 30 seconds of every minute
   */
  @Cron('0,30 * * * * *', {
    name: 'detect-stale-test-runs',
  })
  async detectStaleTestRuns() {
    // Prevent overlapping executions
    if (this.isRunning) {
      this.logger.debug('Skipping stale detection - previous execution still running');
      return;
    }

    this.isRunning = true;

    try {
      const staleTestRunIds = await this.staleDetectionService.detectAndMarkStaleTestRuns();

      if (staleTestRunIds.length > 0) {
        this.logger.log(
          `Detected and processed ${staleTestRunIds.length} stale test run(s): ${staleTestRunIds.join(', ')}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Error in scheduled stale detection: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      this.isRunning = false;
    }
  }
}
