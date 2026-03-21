/**
 * Realtime Publisher for ADAPT Results
 *
 * Handles non-blocking realtime updates via Redis for modified test runs.
 * Failures in realtime publishing do not affect pipeline execution.
 */

import type { Logger } from 'pino';
import { getRealtimePublisher } from '../../../../common/realtime-accessor.js';
import { getDatabaseService } from '../../../../common/database-accessor.js';

/**
 * Realtime Publisher for ADAPT pipeline results
 *
 * Publishes test run updates to Redis for consumption by frontend clients.
 * All operations are non-blocking and failures are logged but not thrown.
 */
export class AdaptRealtimePublisher {
  constructor(private logger: Logger) {}

  /**
   * Publish realtime updates for modified test runs
   *
   * This is non-blocking and failures will not affect pipeline execution.
   * Updates are published to Redis for consumption by frontend clients.
   *
   * @param testRunIds - Test run IDs to publish updates for
   */
  async publishRealtimeUpdates(testRunIds: string[]): Promise<void> {
    try {
      const realtime = getRealtimePublisher();
      const db = getDatabaseService();

      // Fetch updated test runs and publish to Redis
      for (const testRunId of testRunIds) {
        const testRun = await db.getTestRunByTestRunId(testRunId);
        if (testRun) {
          await realtime.triggerTestRunUpdated(testRun);
          this.logger.debug(`Published realtime update for test run: ${testRunId}`);
        }
      }
    } catch (error) {
      // Log but don't throw - realtime updates are non-critical
      this.logger.warn('Error publishing realtime updates:', error);
    }
  }
}
