import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';

interface TestRunStatusRow {
  test_run_id: string;
  checks_status: string;
  comparisons_status: string;
  adapt_status: string;
  last_update: string | null;
}

interface TestRunQueryRow {
  test_run_id: string;
  system_under_test_id: string;
  workload: string;
  test_environment: string;
  start_time: Date;
  adapt_config: unknown;
  consolidated_result: unknown;
  organization_id: string | null;
  team_id: string | null;
}

interface ControlGroupsInput {
  testRunIds: string[];
}

/**
 * Control Group structure matching Python implementation
 * Control groups are created at the TEST RUN level, not metric level
 */
export interface ControlGroup {
  control_group_id: string;           // Same as test_run_id
  system_under_test_id: string;       // Application identifier
  workload: string;                   // Test type
  test_environment: string;           // Environment
  test_runs: string[];                // List of control test run IDs (shared across ALL metrics)
  n_test_runs: number;                // Count of control test runs
  change_point?: {                    // Optional changepoint information
    test_run_id: string;
    start_time: Date;
  };
  first_datetime?: Date;              // Earliest control run start time
  last_datetime?: Date;               // Latest control run start time
  created_at: Date;
  updated_at: Date;
}

export class ControlGroupsPipeline extends BasePipelineTypeORM {
  validateInput(input: unknown): boolean {
    if (!input || typeof input !== 'object') {return false;}
    const typedInput = input as { testRunIds?: unknown[] };
    return Array.isArray(typedInput.testRunIds) &&
           typedInput.testRunIds.length > 0 &&
           typedInput.testRunIds.every((id: unknown) => typeof id === 'string');
  }

  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    if (!this.validateInput(input)) {
      return this.createErrorResult('Invalid input: expected { testRunIds: string[] }', 'INVALID_INPUT');
    }

    const { testRunIds } = input as ControlGroupsInput;

    try {
      this.logger.info(`Starting control groups creation for ${testRunIds.length} test runs`);

      const result = await this.withTransaction(async (manager: EntityManager) => {
        let totalControlGroups = 0;

        // Step 1: Wait for test runs to be ready (check evaluation complete)
        await this.waitForTestRunsReady(manager, testRunIds);

        // Step 2: Create control groups for each test run (one per test run)
        const controlGroups: ControlGroup[] = [];
        for (const testRunId of testRunIds) {
          const controlGroup = await this.createControlGroupForTestRun(manager, testRunId);
          if (controlGroup) {
            controlGroups.push(controlGroup);
            totalControlGroups++;
          }
        }

        // Step 3: Calculate control group statistics (separate from creation)
        // This will be handled by a separate statistics pipeline, matching Python architecture
        this.logger.info(`Created ${totalControlGroups} control groups, statistics calculation will be triggered separately`);

        return {
          controlGroups,
          totalControlGroups
        };
      });

      const duration = Date.now() - startTime;

      this.logPerformance('control-groups-creation', startTime, {
        testRunIds: testRunIds.length,
        controlGroupsCreated: result.totalControlGroups
      });

      return this.createSuccessResult({
        controlGroupsCreated: result.totalControlGroups,
        testRunIds: testRunIds.length,
        controlGroups: result.controlGroups
      }, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logError(error as Error, { testRunIds });
      return this.createErrorResult(
        error as Error,
        'CONTROL_GROUPS_CREATION_FAILED',
        { testRunIds },
        duration
      );
    }
  }

  /**
   * Wait for test runs to complete evaluation (matching Python wait_until_test_runs_are_ready)
   * A test run is ready when it has completed all prerequisite evaluations
   */
  private async waitForTestRunsReady(manager: EntityManager, testRunIds: string[], maxWaitSeconds: number = 120): Promise<void> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;

    // First, reset any stuck IN_PROGRESS statuses that are older than 10 minutes
    await this.resetStuckInProgressStatuses(manager, testRunIds);

    while ((Date.now() - startTime) < maxWaitMs) {
      const checkQuery = `
        SELECT test_run_id,
               status->>'evaluatingChecks' as checks_status,
               status->>'evaluatingComparisons' as comparisons_status,
               status->>'evaluatingAdapt' as adapt_status,
               status->>'lastUpdate' as last_update
        FROM test_runs
        WHERE test_run_id = ANY($1::varchar[])
      `;

      const result = await manager.query<TestRunStatusRow[]>(checkQuery, [testRunIds]);

      // Check each test run's status
      const notReadyRuns = result.filter((row) => {
        const checksStatus = row.checks_status;
        const comparisonsStatus = row.comparisons_status;
        const adaptStatus = row.adapt_status;

        // Test run is NOT ready if:
        // 1. evaluatingChecks is not COMPLETED (and not ERROR - ERROR means failed, can proceed)
        // 2. OR evaluatingComparisons is IN_PROGRESS (if it exists and is not null)
        // 3. OR evaluatingAdapt is IN_PROGRESS

        const checksNotReady = checksStatus && checksStatus !== 'COMPLETED' && checksStatus !== 'ERROR' && checksStatus !== 'NOT_CONFIGURED';
        const comparisonsInProgress = comparisonsStatus === 'IN_PROGRESS';
        const adaptInProgress = adaptStatus === 'IN_PROGRESS';

        return checksNotReady || comparisonsInProgress || adaptInProgress;
      });

      if (notReadyRuns.length === 0) {
        this.logger.info('All test runs are ready for control group creation');
        return;
      }

      // Log which runs are not ready and why
      for (const run of notReadyRuns) {
        this.logger.info(`Test run ${run.test_run_id} not ready: checks=${run.checks_status}, comparisons=${run.comparisons_status}, adapt=${run.adapt_status}, lastUpdate=${run.last_update}`);
      }

      this.logger.info(`Waiting for ${notReadyRuns.length} test runs to complete evaluation...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
    }

    throw new Error(`Timeout waiting for test runs to be ready after ${maxWaitSeconds} seconds`);
  }

  /**
   * Reset IN_PROGRESS statuses that have been stuck for more than 10 minutes
   * This handles cases where a previous process died and left statuses in IN_PROGRESS
   */
  private async resetStuckInProgressStatuses(manager: EntityManager, testRunIds: string[]): Promise<void> {
    const resetQuery = `
      UPDATE test_runs
      SET status = jsonb_set(
        jsonb_set(
          jsonb_set(
            status,
            '{evaluatingAdapt}',
            CASE
              WHEN status->>'evaluatingAdapt' = 'IN_PROGRESS'
                   AND (status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes'
              THEN '"FAILED"'::jsonb
              ELSE status->'evaluatingAdapt'
            END
          ),
          '{evaluatingComparisons}',
          CASE
            WHEN status->>'evaluatingComparisons' = 'IN_PROGRESS'
                 AND (status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes'
            THEN '"FAILED"'::jsonb
            ELSE status->'evaluatingComparisons'
          END
        ),
        '{lastUpdate}',
        to_jsonb(NOW()::text)
      )
      WHERE test_run_id = ANY($1::varchar[])
        AND (
          (status->>'evaluatingAdapt' = 'IN_PROGRESS' AND (status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes')
          OR (status->>'evaluatingComparisons' = 'IN_PROGRESS' AND (status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes')
        )
      RETURNING test_run_id, status->>'evaluatingAdapt' as adapt_status, status->>'evaluatingComparisons' as comparisons_status
    `;

    const result = await manager.query(resetQuery, [testRunIds]);

    if (result.length > 0) {
      for (const row of result) {
        this.logger.info(`Reset stuck status for test run ${row.test_run_id}: adapt=${row.adapt_status}, comparisons=${row.comparisons_status}`);
      }
    }
  }

  /**
   * Create a control group for a single test run (matching Python logic exactly)
   * One control group per test run, containing control runs shared across ALL metrics
   */
  private async createControlGroupForTestRun(
    manager: EntityManager,
    testRunId: string
  ): Promise<ControlGroup | null> {

    // Get test run information
    const testRunQuery = `
      SELECT
        test_run_id,
        system_under_test_id,
        workload,
        test_environment,
        start_time,
        end_time,
        adapt_config,
        consolidated_result,
        organization_id,
        team_id
      FROM test_runs
      WHERE test_run_id = $1
    `;

    const testRunResult = await manager.query<TestRunQueryRow[]>(testRunQuery, [testRunId]);
    if (testRunResult.length === 0) {
      throw new Error(`Test run not found: ${testRunId}`);
    }

    const testRun = testRunResult[0];

    // Control group ID is the same as test run ID (following Python pattern)
    const controlGroupId = testRunId;

    // Check for changepoint first (matching Python changepoint detection)
    const changePoint = await this.detectChangePoint(manager, testRun);

    // Find control test runs (shared across ALL metrics for this test run)
    const controlTestRuns = await this.findControlTestRuns(manager, testRun, changePoint);

    // Calculate first and last datetime from control runs
    let firstDatetime: Date | null = null;
    let lastDatetime: Date | null = null;

    if (controlTestRuns.length > 0) {
      const dateQuery = `
        SELECT
          MIN(start_time) as first_datetime,
          MAX(start_time) as last_datetime
        FROM test_runs
        WHERE test_run_id = ANY($1::varchar[])
      `;
      const dateResult = await manager.query<{ first_datetime: Date | null; last_datetime: Date | null }[]>(dateQuery, [controlTestRuns]);
      if (dateResult.length > 0) {
        firstDatetime = dateResult[0].first_datetime;
        lastDatetime = dateResult[0].last_datetime;
      }
    }

    // Insert or update the control group
    const upsertQuery = `
      INSERT INTO ds_control_groups (
        control_group_id,
        system_under_test_id,
        workload,
        test_environment,
        test_runs,
        n_test_runs,
        change_point,
        first_datetime,
        last_datetime,
        created_at,
        updated_at,
        organization_id,
        team_id,
        created_by,
        updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10, $11, $12, $13
      )
      ON CONFLICT (control_group_id)
      DO UPDATE SET
        test_runs = EXCLUDED.test_runs,
        n_test_runs = EXCLUDED.n_test_runs,
        change_point = EXCLUDED.change_point,
        first_datetime = EXCLUDED.first_datetime,
        last_datetime = EXCLUDED.last_datetime,
        updated_at = NOW(),
        organization_id = EXCLUDED.organization_id,
        team_id = EXCLUDED.team_id,
        updated_by = EXCLUDED.updated_by
      RETURNING *
    `;

    const result = await manager.query(upsertQuery, [
      controlGroupId,
      testRun.system_under_test_id,
      testRun.workload,
      testRun.test_environment,
      controlTestRuns,
      controlTestRuns.length,
      changePoint ? JSON.stringify(changePoint) : null,
      firstDatetime,
      lastDatetime,
      testRun.organization_id || null,
      testRun.team_id || null,
      'worker-pipeline',
      'worker-pipeline'
    ]);

    this.logger.info(`Created control group for test run ${testRunId} with ${controlTestRuns.length} control runs`);

    return result[0] as ControlGroup;
  }

  /**
   * Detect changepoint for a test run (matching Python changepoint detection logic)
   */
  private async detectChangePoint(
    manager: EntityManager,
    testRun: unknown
  ): Promise<{ test_run_id: string; start_time: Date } | null> {
    const tr = testRun as TestRunQueryRow;

    let changePointQuery = `
      SELECT
        cp.test_run_id,
        tr.start_time
      FROM ds_change_points cp
      INNER JOIN test_runs tr ON tr.test_run_id = cp.test_run_id
      WHERE cp.system_under_test_id = $1
        AND cp.workload = $2
        AND cp.test_environment = $3
        AND tr.start_time <= $4
    `;

    const changePointParams: unknown[] = [
      tr.system_under_test_id,
      tr.workload,
      tr.test_environment,
      tr.start_time
    ];

    // RBAC: Filter change points by organization (backward compatible with NULL)
    if (tr.organization_id) {
      changePointQuery += `        AND (cp.organization_id = $5 OR cp.organization_id IS NULL)\n`;
      changePointParams.push(tr.organization_id);
    }

    changePointQuery += `      ORDER BY tr.start_time DESC
      LIMIT 1
    `;

    const result = await manager.query<{ test_run_id: string; start_time: Date }[]>(changePointQuery, changePointParams);

    if (result.length > 0) {
      this.logger.info(`Found changepoint for test run ${tr.test_run_id}: ${result[0].test_run_id}`);
      return {
        test_run_id: result[0].test_run_id,
        start_time: result[0].start_time
      };
    }

    return null;
  }

  /**
   * Find control test runs matching Python logic exactly
   * Returns a list of test run IDs that will be used as controls for ALL metrics
   */
  private async findControlTestRuns(
    manager: EntityManager,
    testRun: unknown,
    changePoint: { test_run_id: string; start_time: Date } | null
  ): Promise<string[]> {

    return this.findDefaultControlTestRuns(manager, testRun, changePoint);
  }

  /**
   * Find last 10 successful control runs
   */
  private async findDefaultControlTestRuns(
    manager: EntityManager,
    testRun: unknown,
    changePoint: { test_run_id: string; start_time: Date } | null
  ): Promise<string[]> {
    const tr = testRun as TestRunQueryRow;

    let controlRunQuery = `
      SELECT DISTINCT
        test_run_id,
        start_time
      FROM test_runs
      WHERE system_under_test_id = $1
        AND workload = $2
        AND test_environment = $3
        AND test_run_id != $4
        AND start_time < $5
        AND end_time IS NOT NULL
    `;

    const queryParams: unknown[] = [
      tr.system_under_test_id,
      tr.workload,
      tr.test_environment,
      tr.test_run_id,
      tr.start_time
    ];

    // Add changepoint constraint if exists
    // Note: Using >= to INCLUDE the changepoint test run itself in the control group
    if (changePoint) {
      controlRunQuery += ` AND start_time >= $${queryParams.length + 1}`;
      queryParams.push(changePoint.start_time);
    }

    // RBAC: Filter control runs by organization (backward compatible with NULL)
    if (tr.organization_id) {
      controlRunQuery += `        AND (organization_id = $${queryParams.length + 1} OR organization_id IS NULL)\n`;
      queryParams.push(tr.organization_id);
    }

    // Add ADAPT filtering (matching Python logic)
    controlRunQuery += `
      AND (
        -- Exclude runs with DENIED differences
        (adapt_config->>'differencesAccepted' IS NULL OR adapt_config->>'differencesAccepted' != 'DENIED')
        AND (
          -- Include runs that meet requirements
          (consolidated_result->>'meetsRequirement')::boolean = true
          -- OR include runs with no SLOs configured (meetsRequirement not set)
          OR consolidated_result->>'meetsRequirement' IS NULL
          -- OR include BASELINE mode runs
          OR (adapt_config->>'mode' = 'BASELINE')
        )
      )
    `;

    // Order by start time descending and limit to 10 most recent
    controlRunQuery += `
      ORDER BY start_time DESC
      LIMIT 10
    `;

    const result = await manager.query<{ test_run_id: string }[]>(controlRunQuery, queryParams);

    const controlTestRunIds = result.map((row) => row.test_run_id);

    this.logger.info(`Found ${controlTestRunIds.length} control test runs for test run ${tr.test_run_id}`);

    // If this is a changepoint test run, it will have 0 control runs (expected behavior)
    if (changePoint && changePoint.test_run_id === tr.test_run_id) {
      this.logger.info(`Test run ${tr.test_run_id} is a changepoint, returning empty control group`);
      return [];
    }

    return controlTestRunIds;
  }
}