/**
 * ADAPT Pipeline Validator
 *
 * Handles input validation and pre-processing validation for the ADAPT
 * (Automated Detection of Anomalies in Performance Tests) pipeline.
 *
 * Responsibilities:
 * - Input validation and parsing
 * - Test run existence and processability checks
 * - Changepoint detection
 * - Empty control group detection
 * - Evaluation status management
 */

import type { Logger } from 'pino';
import type { EntityManager } from 'typeorm';
import type { AdaptInput } from './types.js';

/**
 * Result of input validation
 */
export interface InputValidationResult {
  valid: boolean;
  input?: AdaptInput;
  error?: string;
}

/**
 * Result of pre-processing validation
 */
export interface PreProcessingValidationResult {
  /** Test runs that have changepoints and should be excluded */
  changepoints: string[];
  /** Test runs with empty control groups that should be excluded */
  emptyControlGroups: string[];
  /** Test runs that can be processed (after filtering) */
  processableTestRuns: string[];
}

export class AdaptValidator {
  constructor(private logger: Logger) {}

  /**
   * Validate pipeline input structure and types
   *
   * @param input - Unknown input to validate
   * @returns Validation result with parsed input if valid
   */
  validateInput(input: unknown): InputValidationResult {
    if (!input || typeof input !== 'object') {
      return {
        valid: false,
        error: 'Invalid input: expected an object',
      };
    }

    const typedInput = input as Record<string, unknown>;

    // Validate testRunIds
    if (!Array.isArray(typedInput.testRunIds)) {
      return {
        valid: false,
        error: 'Invalid input: testRunIds must be an array',
      };
    }

    if (typedInput.testRunIds.length === 0) {
      return {
        valid: false,
        error: 'Invalid input: testRunIds cannot be empty',
      };
    }

    if (!typedInput.testRunIds.every((id: unknown) => typeof id === 'string')) {
      return {
        valid: false,
        error: 'Invalid input: all testRunIds must be strings',
      };
    }

    // Parse and return validated input with defaults
    const validatedInput: AdaptInput = {
      testRunIds: typedInput.testRunIds as string[],
      updateControlGroup: typedInput.updateControlGroup !== false,
      updateControlStatistics: typedInput.updateControlStatistics !== false,
      updateResults: typedInput.updateResults !== false,
      updateConclusion: typedInput.updateConclusion !== false,
      updateTrackedResults: typedInput.updateTrackedResults !== false,
      applicationDashboardId: typedInput.applicationDashboardId as string | undefined,
      panelId: typedInput.panelId as number | undefined,
      metricName: typedInput.metricName as string | undefined,
    };

    return {
      valid: true,
      input: validatedInput,
    };
  }

  /**
   * Update evaluation status for test runs
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to update
   * @param status - Status to set (e.g., 'IN_PROGRESS', 'COMPLETED', 'FAILED')
   */
  async updateEvaluationStatus(
    manager: EntityManager,
    testRunIds: string[],
    status: string
  ): Promise<void> {
    if (testRunIds.length === 0) {
      return;
    }

    const placeholders = testRunIds.map((_: string, i: number) => `$${i + 1}`).join(', ');

    await manager.query(
      `
      UPDATE test_runs
      SET status = jsonb_set(
          COALESCE(status, '{}'),
          '{evaluatingAdapt}',
          $${testRunIds.length + 1}::jsonb
      ), updated_at = NOW()
      WHERE test_run_id IN (${placeholders})
    `,
      [...testRunIds, JSON.stringify(status)]
    );

    this.logger.debug(`Updated evaluation status to ${status} for ${testRunIds.length} test runs`);
  }

  /**
   * Check for changepoints in the given test runs
   *
   * Test runs with changepoints are excluded from ADAPT processing because
   * they represent baseline shifts that invalidate control group comparisons.
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to check
   * @returns Array of test run IDs that have changepoints
   */
  async checkForChangepoints(
    manager: EntityManager,
    testRunIds: string[]
  ): Promise<string[]> {
    if (testRunIds.length === 0) {
      return [];
    }

    const placeholders = testRunIds.map((_: string, i: number) => `$${i + 1}`).join(', ');

    // Query ds_change_points table to find changepoints
    const result = await manager.query(
      `
      SELECT DISTINCT cp.test_run_id
      FROM ds_change_points cp
      WHERE cp.test_run_id IN (${placeholders})
    `,
      testRunIds
    );

    const changepoints = result.map((row: { test_run_id: string }) => row.test_run_id);

    if (changepoints.length > 0) {
      // Update status to NO_BASELINES_FOUND for changepoint test runs
      const changepointPlaceholders = changepoints.map((_: string, i: number) => `$${i + 1}`).join(', ');
      await manager.query(
        `
        UPDATE test_runs
        SET status = jsonb_set(
            COALESCE(status, '{}'),
            '{evaluatingAdapt}',
            '"NO_BASELINES_FOUND"'
        )
        WHERE test_run_id IN (${changepointPlaceholders})
      `,
        changepoints
      );

      this.logger.info(
        `Found ${changepoints.length} changepoint test runs (set to NO_BASELINES_FOUND): ${changepoints.join(', ')}`
      );
    }

    return changepoints;
  }

  /**
   * Check for test runs with empty control groups
   *
   * Test runs without control group statistics cannot be compared and are
   * excluded from ADAPT processing.
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to check
   * @returns Array of test run IDs with empty control groups
   */
  async checkEmptyControlGroups(
    manager: EntityManager,
    testRunIds: string[]
  ): Promise<string[]> {
    if (testRunIds.length === 0) {
      return [];
    }

    const placeholders = testRunIds.map((_: string, i: number) => `$${i + 1}`).join(', ');

    const result = await manager.query(
      `
      SELECT DISTINCT ms.test_run_id
      FROM ds_metric_statistics ms
      LEFT JOIN ds_control_group_statistics cgs ON (
          cgs.control_group_id = ms.test_run_id AND  -- Assumes testRunId equals controlGroupId
          cgs.metrics_source_id IS NOT DISTINCT FROM ms.metrics_source_id AND
          cgs.panel_id = ms.panel_id AND
          cgs.metric_name = ms.metric_name
      )
      WHERE ms.test_run_id IN (${placeholders})
        AND (
          ms.application_dashboard_id IN (SELECT id FROM application_dashboards)
          OR ms.application_dashboard_id IN (SELECT DISTINCT application_dashboard_id FROM dynatrace_queries)
        )
      GROUP BY ms.test_run_id
      HAVING count(cgs.control_group_id) = 0
    `,
      testRunIds
    );

    const emptyControlGroups = result.map((row: { test_run_id: string }) => row.test_run_id);

    if (emptyControlGroups.length > 0) {
      // Update status to NO_BASELINES_FOUND for these test runs
      const emptyPlaceholders = emptyControlGroups.map((_: string, i: number) => `$${i + 1}`).join(', ');
      await manager.query(
        `
        UPDATE test_runs
        SET status = jsonb_set(
            COALESCE(status, '{}'),
            '{evaluatingAdapt}',
            '"NO_BASELINES_FOUND"'
        )
        WHERE test_run_id IN (${emptyPlaceholders})
      `,
        emptyControlGroups
      );

      this.logger.warn(
        `Found ${emptyControlGroups.length} test runs with empty control groups: ${emptyControlGroups.join(', ')}`
      );
    }

    return emptyControlGroups;
  }

  /**
   * Perform full pre-processing validation
   *
   * Runs all validation checks and returns the set of processable test runs.
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to validate
   * @returns Validation result with changepoints, empty control groups, and processable test runs
   */
  async runPreProcessingValidation(
    manager: EntityManager,
    testRunIds: string[]
  ): Promise<PreProcessingValidationResult> {
    // Check for changepoints
    const changepoints = await this.checkForChangepoints(manager, testRunIds);
    const nonChangepointTestRuns = testRunIds.filter((id) => !changepoints.includes(id));

    // Check for empty control groups
    const emptyControlGroups = await this.checkEmptyControlGroups(manager, nonChangepointTestRuns);
    const processableTestRuns = nonChangepointTestRuns.filter((id) => !emptyControlGroups.includes(id));

    return {
      changepoints,
      emptyControlGroups,
      processableTestRuns,
    };
  }

  /**
   * Write ds_adapt_conclusion rows for test runs excluded during pre-processing.
   *
   * When all test runs are filtered out (changepoints or empty control groups) the
   * pipeline exits early without generating conclusions. This method fills that gap
   * with an INSUFFICIENT_DATA conclusion so the UI can surface a clear explanation
   * instead of an empty card.
   */
  async writeExclusionConclusions(
    manager: EntityManager,
    changepoints: string[],
    emptyControlGroups: string[],
  ): Promise<void> {
    const allExcluded = [...changepoints, ...emptyControlGroups];
    if (allExcluded.length === 0) { return; }

    // Fetch org/team for ownership columns
    const idPlaceholders = allExcluded.map((_: string, i: number) => `$${i + 1}`).join(', ');
    const testRunRows = await manager.query(
      `SELECT test_run_id, organization_id, team_id FROM test_runs WHERE test_run_id IN (${idPlaceholders})`,
      allExcluded
    );
    const infoMap = new Map<string, { organization_id: string | null; team_id: string | null }>(
      testRunRows.map((r: { test_run_id: string; organization_id: string | null; team_id: string | null }) => [
        r.test_run_id,
        { organization_id: r.organization_id, team_id: r.team_id },
      ])
    );

    // Fetch control run lists for empty-control-group cases
    const controlRunMap = new Map<string, string[]>();
    if (emptyControlGroups.length > 0) {
      const cgPlaceholders = emptyControlGroups.map((_: string, i: number) => `$${i + 1}`).join(', ');
      const cgRows = await manager.query(
        `SELECT control_group_id, test_runs FROM ds_control_groups WHERE control_group_id IN (${cgPlaceholders})`,
        emptyControlGroups
      );
      for (const row of cgRows) {
        controlRunMap.set(row.control_group_id, row.test_runs ?? []);
      }
    }

    for (const testRunId of allExcluded) {
      const info = infoMap.get(testRunId);
      const isChangepoint = changepoints.includes(testRunId);

      let message: string;
      if (isChangepoint) {
        message =
          'This test run is a changepoint — a new baseline was established. ' +
          'ADAPT comparison starts fresh from this run.';
      } else {
        const controlRuns = controlRunMap.get(testRunId) ?? [];
        if (controlRuns.length > 0) {
          const shown = controlRuns.slice(0, 3).join(', ');
          const extra = controlRuns.length > 3 ? ` and ${controlRuns.length - 3} more` : '';
          message =
            `ADAPT requires valid baseline data. The ${controlRuns.length} control run${controlRuns.length === 1 ? '' : 's'} ` +
            `(${shown}${extra}) contained insufficient metrics — they may have been too short or aborted. ` +
            'Run at least one full-duration test to establish a baseline.';
        } else {
          message =
            'ADAPT requires valid baseline data. The control runs contained insufficient metrics — ' +
            'they may have been too short or aborted. Run at least one full-duration test to establish a baseline.';
        }
      }

      await manager.query(
        `INSERT INTO ds_adapt_conclusion (
          test_run_id, control_group_id, regressions, improvements, differences, tracked_regressions,
          conclusion, details, updated_at, organization_id, team_id, created_by, updated_by
        )
        VALUES ($1, $1, '{}', '{}', '{}', '{}', 'INSUFFICIENT_DATA', $2::jsonb, NOW(), $3, $4, 'worker-pipeline', 'worker-pipeline')
        ON CONFLICT (test_run_id) DO UPDATE SET
          conclusion = EXCLUDED.conclusion,
          details    = EXCLUDED.details,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by`,
        [testRunId, JSON.stringify({ message }), info?.organization_id ?? null, info?.team_id ?? null]
      );
    }

    this.logger.info(`Wrote INSUFFICIENT_DATA conclusions for ${allExcluded.length} excluded test run(s)`);
  }

  /**
   * Update status to failed when ADAPT processing fails
   *
   * Sets evaluatingAdapt to FAILED and adaptTestRunOK to false.
   * This is called from the pipeline error handler.
   *
   * @param testRunIds - Test run IDs to update
   */
  async updateFailureStatus(testRunIds: string[]): Promise<void> {
    const { getDatabaseService } = await import('../../../common/database-accessor.js');
    const db = getDatabaseService();

    await db.query(`
      UPDATE test_runs
      SET
        status = jsonb_set(
            COALESCE(status, '{}'),
            '{evaluatingAdapt}',
            '"FAILED"'
        ),
        consolidated_result = jsonb_set(
            COALESCE(consolidated_result, '{}'),
            '{adaptTestRunOK}',
            'false'::jsonb
        ),
        updated_at = NOW()
      WHERE test_run_id = ANY($1)
    `, [testRunIds]);
  }
}

/**
 * Substage timing entry for performance logging
 */
export interface SubstageEntry {
  stage: string;
  duration: number;
  rows?: number;
}

/**
 * Format substage timing breakdown for logging
 *
 * @param subStages - Array of substage timing entries
 * @param totalDuration - Total pipeline duration in milliseconds
 * @returns Formatted timing breakdown string
 */
export function formatSubstageBreakdown(subStages: SubstageEntry[], totalDuration: number): string {
  const safeDuration = totalDuration || 1; // Avoid division by zero
  const breakdown = subStages.map(({ stage, duration, rows }) => {
    const percentage = ((duration / safeDuration) * 100).toFixed(1);
    const barLength = Math.round((duration / safeDuration) * 40);
    const bar = '█'.repeat(barLength);
    const rowsInfo = rows !== undefined ? ` (${rows} rows)` : '';
    return `  ${stage.padEnd(30)} ${duration.toString().padStart(7)}ms ${percentage.padStart(5)}% ${bar}${rowsInfo}`;
  }).join('\n');

  return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 ADAPT SUBSTAGE TIMING BREAKDOWN\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${breakdown}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📈 Total ADAPT Duration: ${totalDuration}ms\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}
