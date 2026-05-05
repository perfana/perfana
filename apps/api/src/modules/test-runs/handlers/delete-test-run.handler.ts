/**
 * Handler for DeleteTestRunCommand
 *
 * Executes the business logic for deleting a test run and all its dependent data.
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import { TestRun as TestRunEntity, OwnedResource } from '../../../entities';
import { DeleteTestRunCommand } from '../commands/delete-test-run.command';
import { ICommandHandler, CommandContext, CommandResult } from '../commands/types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType, TestRunDeletedEvent } from '../types/realtime-events.types';
import { ResourceNotFoundException, DatabaseException } from '../../../common/exceptions/business.exception';
import { AuditService } from '../../audit/audit.service';

/**
 * Result type for delete operations
 */
export interface DeleteTestRunResult extends CommandResult<void> {
  /** The deleted test run ID */
  testRunId?: string;
  /** UUID of the deleted test run */
  id?: string;
}

@Injectable()
export class DeleteTestRunHandler implements ICommandHandler<DeleteTestRunCommand, DeleteTestRunResult> {
  private readonly logger = new Logger(DeleteTestRunHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Execute the delete test run command
   */
  async execute(
    command: DeleteTestRunCommand,
    context?: CommandContext,
  ): Promise<DeleteTestRunResult> {
    const { data, options } = command;
    const { id } = data;

    try {
      // First verify the test run exists. Load all columns (instead of a
      // narrow select) so the audit envelope captures the full pre-delete
      // snapshot of `auditableFields` and the camelCase `organizationId`.
      const testRun = await withRequestEm(this.testRunRepo).findOne({
        where: { id },
        relations: ['systemUnderTest'],
      });

      if (!testRun) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      const testRunId = testRun.testRunId;
      const teamId = testRun.systemUnderTest?.team_id;
      this.logger.log(`Starting cascade deletion for test run ${id} (test_run_id: ${testRunId})`);

      // Audit DELETE before tearing down the row + cascades. Cascaded child
      // table deletions (ds_change_points, check_results, ds_*, transactions,
      // etc.) are intentionally not individually audited — they are implied
      // by the test_run delete and the raw `manager.query('DELETE …')` calls
      // would not surface to the audit lint rule's matcher anyway. The same
      // pattern is used for organization delete (PR6).
      this.auditService.logDelete(testRun as unknown as OwnedResource, {
        organizationIdOverride: testRun.organizationId,
      });

      // Perform cascade deletion with deadlock retry logic.
      // TimescaleDB compressed chunk decompression requires exclusive locks;
      // concurrent deletions can cause deadlock (PostgreSQL 40P01).
      const MAX_DEADLOCK_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_DEADLOCK_RETRIES; attempt++) {
        try {
          await this.dataSource.transaction(async (transactionalEntityManager) => {
            // Set a lock timeout so we fail fast instead of waiting indefinitely
            await transactionalEntityManager.query("SET LOCAL lock_timeout = '30s'");

            const affectedControlGroups = await this.findAffectedControlGroups(transactionalEntityManager, testRunId);
            const controlGroupIdsToReevaluate = await this.findControlGroupsToReevaluate(
              transactionalEntityManager,
              testRun,
              testRunId
            );

            await this.deleteDependentData(transactionalEntityManager, testRunId, id);
            await this.updateAffectedControlGroups(transactionalEntityManager, affectedControlGroups, testRunId);

            if (controlGroupIdsToReevaluate.length > 0) {
              this.logger.log(`Control groups to re-evaluate: ${controlGroupIdsToReevaluate.join(', ')}`);
              // Note: Re-evaluation would be triggered here via BullMQ
            }
          });
          break; // Success — exit retry loop
        } catch (txError) {
          const pgCode = txError && typeof txError === 'object' && 'code' in txError
            ? (txError as { code: string }).code
            : undefined;

          if (pgCode === '40P01' && attempt < MAX_DEADLOCK_RETRIES) {
            this.logger.warn(
              `Deadlock detected (40P01) on attempt ${attempt}/${MAX_DEADLOCK_RETRIES} for test run ${id}, retrying in ${attempt}s...`,
            );
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          throw txError;
        }
      }

      this.logger.log(`Successfully deleted test run ${id}`);

      // Emit deleted event (after successful transaction, unless skipped)
      if (!options?.skipEvents) {
        this.emitDeletedEvent(id, testRunId, testRun, context, teamId);
      }

      return {
        success: true,
        testRunId,
        id,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete test run ${id}:`, error);
      throw new DatabaseException('Failed to delete test run', error);
    }
  }

  /**
   * Find control groups affected by test run deletion
   */
  private async findAffectedControlGroups(
    manager: EntityManager,
    testRunId: string
  ): Promise<Array<{ control_group_id: string; test_runs: string[] }>> {
    const affectedControlGroups = await manager.query(
      `SELECT control_group_id, test_runs
       FROM ds_control_groups
       WHERE test_runs @> ARRAY[$1]::text[]`,
      [testRunId]
    );

    this.logger.log(`Found ${affectedControlGroups?.length || 0} control groups affected by deletion`);
    return affectedControlGroups || [];
  }

  /**
   * Find control groups that need re-evaluation after test run deletion
   */
  private async findControlGroupsToReevaluate(
    manager: EntityManager,
    testRun: TestRunEntity,
    testRunId: string
  ): Promise<string[]> {
    if (!testRun.startTime) {
      return [];
    }

    const moreRecentControlGroups = await manager.query(
      `SELECT control_group_id, test_runs, created_at
       FROM ds_control_groups
       WHERE system_under_test_id = $1
       AND test_environment = $2
       AND workload = $3
       AND created_at > $4`,
      [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload, testRun.startTime]
    );

    if (!moreRecentControlGroups || moreRecentControlGroups.length === 0) {
      return [];
    }

    const reevaluationSet = new Set<string>();
    for (const controlGroup of moreRecentControlGroups) {
      if (controlGroup.test_runs?.includes(testRunId)) {
        reevaluationSet.add(controlGroup.control_group_id);
      }
    }

    return Array.from(reevaluationSet);
  }

  /**
   * Delete all dependent data for a test run
   */
  private async deleteDependentData(
    manager: EntityManager,
    testRunId: string,
    testRunUuid: string
  ): Promise<void> {
    const deletions = [
      { table: 'ds_change_points', param: testRunId, label: 'change points' },
      { table: 'check_results', param: testRunId, label: 'check results' },
      { table: 'ds_adapt_results', param: testRunId, label: 'adapt results' },
      { table: 'ds_adapt_conclusion', param: testRunId, label: 'adapt conclusion' },
      { table: 'ds_adapt_tracked_results', param: testRunId, label: 'adapt tracked results' },
      { table: 'ds_metric_statistics', param: testRunId, label: 'metric statistics' },
      { table: 'ds_metric_collection_status', param: testRunId, label: 'metric collection status' },
      { table: 'ds_panels', param: testRunId, label: 'panels' },
      { table: 'ds_metrics', param: testRunId, label: 'metrics' },
      // Per-test-run transaction / sampler stats rollup (#150, #151)
      { table: 'test_run_transaction_stats', param: testRunId, label: 'transaction stats rollup' },
      { table: 'test_run_sampler_stats', param: testRunId, label: 'sampler stats rollup' },
      // Performance test data tables (TimescaleDB hypertables)
      { table: 'transactions', param: testRunId, label: 'performance test transactions' },
      { table: 'requests_raw', param: testRunId, label: 'performance test requests' },
      { table: 'requests_error', param: testRunId, label: 'performance test error requests' },
      { table: 'virtual_users', param: testRunId, label: 'performance test virtual users' },
    ];

    for (const { table, param, label } of deletions) {
      await manager.query(`DELETE FROM ${table} WHERE test_run_id = $1`, [param]);
      this.logger.log(`Deleted ${label} for test_run_id: ${testRunId}`);
    }

    // Delete control group where control_group_id equals test_run_id
    await manager.query('DELETE FROM ds_control_groups WHERE control_group_id = $1', [testRunId]);
    this.logger.log(`Deleted control group with control_group_id: ${testRunId}`);

    await manager.query('DELETE FROM ds_control_group_statistics WHERE control_group_id = $1', [testRunId]);
    this.logger.log(`Deleted control group statistics for control_group_id: ${testRunId}`);

    // Delete test_run_configs
    await manager.query('DELETE FROM test_run_configs WHERE test_run_id = $1', [testRunUuid]);
    this.logger.log(`Deleted test_run_configs for test run UUID: ${testRunUuid}`);

    await manager.query('DELETE FROM test_run_configs WHERE test_run_id_string = $1', [testRunId]);
    this.logger.log(`Deleted test_run_configs for test_run_id string: ${testRunId}`);

    // Delete the test run itself
    await manager.query('DELETE FROM test_runs WHERE id = $1', [testRunUuid]);
    this.logger.log(`Deleted test run: ${testRunUuid}`);
  }

  /**
   * Update affected control groups after test run deletion
   */
  private async updateAffectedControlGroups(
    manager: EntityManager,
    affectedControlGroups: Array<{ control_group_id: string; test_runs: string[] }>,
    testRunId: string
  ): Promise<void> {
    if (!affectedControlGroups || affectedControlGroups.length === 0) {
      return;
    }

    for (const controlGroup of affectedControlGroups) {
      const updatedTestRuns = controlGroup.test_runs.filter((tr: string) => tr !== testRunId);
      const newCount = updatedTestRuns.length;

      if (newCount === 0) {
        await this.deleteEmptyControlGroup(manager, controlGroup.control_group_id);
      } else {
        await this.updateControlGroup(manager, controlGroup.control_group_id, updatedTestRuns, newCount, testRunId);
      }
    }
  }

  /**
   * Delete an empty control group
   */
  private async deleteEmptyControlGroup(manager: EntityManager, controlGroupId: string): Promise<void> {
    await manager.query('DELETE FROM ds_control_groups WHERE control_group_id = $1', [controlGroupId]);
    await manager.query('DELETE FROM ds_control_group_statistics WHERE control_group_id = $1', [controlGroupId]);
    this.logger.log(`Deleted empty control group: ${controlGroupId}`);
  }

  /**
   * Update a control group after removing a test run
   */
  private async updateControlGroup(
    manager: EntityManager,
    controlGroupId: string,
    updatedTestRuns: string[],
    newCount: number,
    testRunId: string
  ): Promise<void> {
    await manager.query(
      `UPDATE ds_control_groups
       SET test_runs = $1, n_test_runs = $2, updated_at = NOW()
       WHERE control_group_id = $3`,
      [updatedTestRuns, newCount, controlGroupId]
    );
    await manager.query('DELETE FROM ds_control_group_statistics WHERE control_group_id = $1', [controlGroupId]);
    this.logger.log(`Updated control group ${controlGroupId}: removed test_run_id ${testRunId}`);
  }

  /**
   * Emit WebSocket event for test run deletion
   */
  private emitDeletedEvent(
    id: string,
    testRunId: string,
    _testRun: TestRunEntity,
    context?: CommandContext,
    teamId?: string,
  ): void {
    try {
      const event: TestRunDeletedEvent = {
        eventType: TestRunEventType.DELETED,
        timestamp: new Date().toISOString(),
        testRunId,
        id,
        userId: context?.userId,
        organizationId: context?.organizationId,
        teamId: teamId || context?.teamId,
      };

      this.testRunsGateway.emitTestRunDeleted(
        event,
        context?.userId,
        context?.organizationId,
        teamId || context?.teamId,
      );

      this.logger.debug(`Emitted DELETED event for test run: ${testRunId}`);
    } catch (error) {
      // Log warning but don't throw - event emission should not break mutations
      this.logger.warn(
        `Failed to emit DELETED event for test run ${testRunId}: ${
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown error'
        }`
      );
    }
  }
}
