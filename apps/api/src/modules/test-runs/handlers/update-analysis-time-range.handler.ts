/**
 * Handler for updating test run analysis time range (start and end offsets).
 *
 * Allows users to adjust both the analysis start offset (ramp-up) and
 * analysis end offset (ramp-down) for a test run in a single atomic operation.
 * This is useful when the configured analysis window needs to be trimmed from
 * both ends to exclude ramp-up and ramp-down periods from statistical analysis.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { withRequestEm, withRequestQuery } from '../../../common/db/request-em';
import { TestRun as TestRunEntity, OwnedResource } from '../../../entities';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { TestRun } from '../types/test-run.types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../types/realtime-events.types';
import { mapEntityToTestRun } from './entity-mapper';
import { AuditService } from '../../audit/audit.service';

export interface UpdateAnalysisTimeRangeData {
  id: string;
  analysisStartOffset: number;
  analysisEndOffset: number;
  /**
   * Apply the same offsets to every OTHER test run sharing this run's system under
   * test, environment and workload — the unit ADAPT actually compares across.
   *
   * A run and its control group have to be measured over the same window or the
   * comparison is apples to oranges: ds_control_group_statistics pools the baseline
   * runs' ds_metric_statistics, which are computed under whatever offsets each of
   * those runs happens to carry. Narrowing one run's window in isolation silently
   * compares a trimmed run against an untrimmed baseline.
   */
  applyToAll?: boolean;
}

export interface UpdateAnalysisTimeRangeResult {
  testRun: TestRun;
  /**
   * Every run whose offsets changed, including the target. The caller re-analyses
   * these — the offsets alone change nothing until StatisticsPipeline rebakes
   * ds_metrics.ramp_up and rewrites ds_metric_statistics from them.
   */
  affectedTestRunIds: string[];
}

@Injectable()
export class UpdateAnalysisTimeRangeHandler {
  private readonly logger = new Logger(UpdateAnalysisTimeRangeHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  async execute(data: UpdateAnalysisTimeRangeData): Promise<UpdateAnalysisTimeRangeResult> {
    const { id, analysisStartOffset, analysisEndOffset, applyToAll = false } = data;

    try {
      // Fetch the pre-mutation row in full for the audit diff.
      const testRunEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { id },
      });

      if (!testRunEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      // Siblings are resolved BEFORE the write so the audit diff below has a genuine
      // "before" for each of them.
      const siblings = applyToAll
        ? await withRequestEm(this.testRunRepo).find({
            where: {
              systemUnderTestId: testRunEntity.systemUnderTestId,
              testEnvironment: testRunEntity.testEnvironment,
              workload: testRunEntity.workload,
            },
          })
        : [testRunEntity];

      // Through the request's RLS transaction, not the pooled connection: the API's login
      // role bypasses row-level security, so a raw dataSource write would update a row the
      // policies would have refused — the visibility check above is then the only thing
      // standing between a caller and someone else's run.
      //
      // Scoped by id list rather than by (sut, environment, workload) so the rows written
      // are exactly the rows read above: a run created between the two statements would
      // otherwise be mutated with no audit entry and no re-analysis.
      const siblingIds = siblings.map((run) => run.id);
      await withRequestQuery(this.dataSource).query(
        `UPDATE test_runs
         SET ramp_up = $1, ramp_down = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ANY($3::uuid[])`,
        [analysisStartOffset, analysisEndOffset, siblingIds],
      );

      const updatedEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { id },
        relations: ['systemUnderTest'],
      });

      if (!updatedEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      // One audit entry per mutated run. The offsets are the only columns that moved, so
      // the "after" is the "before" with the two values swapped in — cheaper and more
      // faithful than re-selecting every sibling.
      //
      // repo.create(), not an object literal. AuditService.dispatch reads
      // `ref.constructor` to look up the entity's `auditableFields`; a plain `{ ...before }`
      // has constructor Object, finds no field list, and takes the else branch — the row is
      // still written but with action+actor only, no diff, and a resourceType derived from
      // "Object". The bulk path is exactly where the trail matters most.
      //
      // The property names are the ENTITY's, not the column's: `ramp_up` / `ramp_down` are
      // surfaced as analysisStartOffset / analysisEndOffset, and both are in
      // TestRun.auditableFields. Writing rampUp / rampDown here would leave the real fields
      // at their old values and diff to nothing.
      for (const before of siblings) {
        const after = before.id === id
          ? updatedEntity
          : this.testRunRepo.create({
              ...before,
              analysisStartOffset,
              analysisEndOffset,
            });
        this.auditService.logUpdate(
          before as unknown as OwnedResource,
          after as unknown as OwnedResource,
          { organizationIdOverride: after.organizationId },
        );
      }

      this.logger.log(
        `Updated analysis time range to start=${analysisStartOffset}s, end=${analysisEndOffset}s ` +
          `for ${siblings.length} test run(s)${applyToAll ? ` (system=${testRunEntity.systemUnderTestId}, environment=${testRunEntity.testEnvironment}, workload=${testRunEntity.workload})` : ` (${id})`}`,
      );
      const testRun = mapEntityToTestRun(updatedEntity);

      this.emitUpdateEvent(testRun, updatedEntity.systemUnderTest?.team_id);

      return {
        testRun,
        affectedTestRunIds: siblings
          .map((run) => run.testRunId)
          .filter((testRunId): testRunId is string => Boolean(testRunId)),
      };
    } catch (error) {
      this.logger.error(`Failed to update analysis time range for test run ${id}:`, error);
      throw error;
    }
  }

  private emitUpdateEvent(testRun: TestRun, teamId?: string): void {
    try {
      this.testRunsGateway.emitTestRunUpdated(
        {
          eventType: TestRunEventType.UPDATED,
          timestamp: new Date().toISOString(),
          testRun,
          teamId,
        },
        undefined,
        undefined,
        teamId,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to emit UPDATED event for test run ${testRun.test_run_id}: ${
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown error'
        }`,
      );
    }
  }
}
