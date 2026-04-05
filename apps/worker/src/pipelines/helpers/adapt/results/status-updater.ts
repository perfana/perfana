/**
 * Status Updater for ADAPT Pipeline
 *
 * Handles final status updates and conclusion tracking for test runs
 * after ADAPT processing is complete.
 */

import type { Logger } from 'pino';
import type { EntityManager } from 'typeorm';

/**
 * Status Updater for ADAPT results
 *
 * Manages final status updates, conclusion generation logging,
 * and test run status consolidation after ADAPT analysis.
 */
export class AdaptStatusUpdater {
  constructor(private logger: Logger) {}

  /**
   * Update final test run status after ADAPT processing
   *
   * Updates:
   * - evaluatingAdapt status to 'COMPLETED'
   * - adaptTestRunOK based on conclusion (true if not REGRESSION, always true for BASELINE mode)
   * - overall result (true only when both meetsRequirement AND adaptTestRunOK are true)
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to update status for
   */
  async updateFinalStatus(manager: EntityManager, testRunIds: string[]): Promise<void> {
    const placeholders = testRunIds.map((_: any, i: number) => `$${i + 1}`).join(', ');

    // Update evaluation status and consolidated result based on conclusions
    await manager.query(
      `
      UPDATE test_runs
      SET
          status = jsonb_set(
              COALESCE(status, '{}'),
              '{evaluatingAdapt}',
              '"COMPLETED"'
          ),
          consolidated_result = jsonb_set(
              jsonb_set(
                  COALESCE(consolidated_result, '{}'),
                  '{adaptTestRunOK}',
                  CASE
                      -- For BASELINE mode: Always true per specification
                      WHEN COALESCE((adapt_config->>'mode'), 'COMPARISON') = 'BASELINE' THEN 'true'::jsonb
                      -- Otherwise: true if conclusion != 'REGRESSION'
                      ELSE CASE
                          WHEN EXISTS (
                              SELECT 1 FROM ds_adapt_conclusion dac
                              WHERE dac.test_run_id = test_runs.test_run_id
                              AND dac.conclusion = 'REGRESSION'
                          ) THEN 'false'::jsonb
                          ELSE 'true'::jsonb
                      END
                  END
              ),
              '{overall}',
              -- Only set overall when differencesAccepted is 'TBD', otherwise preserve existing value
              CASE
                  WHEN COALESCE((adapt_config->>'differencesAccepted'), 'TBD') = 'TBD' THEN
                      -- overall requires BOTH meetsRequirement AND adaptTestRunOK
                      CASE WHEN
                          COALESCE((COALESCE(consolidated_result, '{}'::jsonb)->>'meetsRequirement')::boolean, true) AND
                          -- Check the adaptTestRunOK value we just set above
                          CASE
                              -- For BASELINE mode: Always true per specification
                              WHEN COALESCE((adapt_config->>'mode'), 'COMPARISON') = 'BASELINE' THEN true
                              -- Otherwise: true if conclusion != 'REGRESSION'
                              ELSE NOT EXISTS (
                                  SELECT 1 FROM ds_adapt_conclusion dac
                                  WHERE dac.test_run_id = test_runs.test_run_id
                                  AND dac.conclusion = 'REGRESSION'
                              )
                          END
                      THEN 'true'::jsonb ELSE 'false'::jsonb END
                  ELSE
                      -- Preserve existing overall value when differencesAccepted is not 'TBD'
                      COALESCE(consolidated_result->'overall', 'null'::jsonb)
              END
          ),
          updated_at = NOW()
      WHERE test_run_id IN (${placeholders})
    `,
      testRunIds
    );

    this.logger.info(`Updated final status for ${testRunIds.length} test runs`);
  }

  /**
   * Log tracked regression processing results
   *
   * Fetches and logs details about tracked regressions found during
   * conclusion generation for debugging and monitoring purposes.
   *
   * @param manager - TypeORM entity manager for query execution
   * @param testRunIds - Test run IDs to check for tracked regressions
   */
  async logTrackedRegressionResults(manager: EntityManager, testRunIds: string[]): Promise<void> {
    const trackedRegResults = await manager.query(
      `
      SELECT
        test_run_id,
        COALESCE(array_length(tracked_regressions, 1), 0) as tracked_count,
        (details->>'trackedRegressionCount')::int as details_tracked_count,
        conclusion
      FROM ds_adapt_conclusion
      WHERE test_run_id = ANY($1)
      AND tracked_regressions IS NOT NULL
      AND array_length(tracked_regressions, 1) > 0
    `,
      [testRunIds]
    );

    if (trackedRegResults.length > 0) {
      this.logger.info(
        `Tracked regression processing found ${trackedRegResults.length} test run(s) with historical regressions:`
      );
      trackedRegResults.forEach((row: any) => {
        this.logger.info(
          `  - Test run ${row.test_run_id}: ${row.tracked_count} tracked regression(s) (conclusion: ${row.conclusion})`
        );
      });
    } else {
      this.logger.info(`Tracked regression processing: No historical regressions found for any test run`);
    }
  }
}
