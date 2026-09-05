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

/** A run considered for the bulk apply, and what happened to it. */
export interface AnalysisTimeRangeScopeEntry {
  testRunId: string;
  completed: boolean;
  /** Reason it was left alone; absent when the run was written. */
  skipped?: 'running' | 'too-short' | 'not-writable';
}

export interface UpdateAnalysisTimeRangeResult {
  testRun: TestRun;
  /**
   * Every run whose offsets changed, including the target. The caller re-analyses
   * these — the offsets alone change nothing until StatisticsPipeline rebakes
   * ds_metrics.ramp_up and rewrites ds_metric_statistics from them.
   */
  affectedTestRunIds: string[];
  /**
   * The runs that were written and are `completed`. Only these get a
   * transaction-stats rollup: the rollup recomputes the `ramp_up_excluded` rows from
   * the offsets, and `getRollupStatus` reads a populated table and answers `ready`
   * forever, so a sibling that never gets re-enqueued shows previous-window numbers
   * in Performance Analysis indefinitely with nothing logged.
   */
  completedTestRunIds: string[];
  /** Runs deliberately left alone, with the reason. Surfaced to the caller, never silent. */
  skipped: AnalysisTimeRangeScopeEntry[];
}

/**
 * Can this run take these offsets?
 *
 * The analysis window is [start + startOffset, end - endOffset]. When the two
 * exclusions overlap, every sample is outside the window. Two different failures
 * follow, and neither is reported as a misconfiguration:
 *
 *  - `AdaptValidator.checkTooShortTestRuns` tests `ramp_up >= duration` ONLY — it never
 *    looks at ramp_down — and force-writes NO_BASELINES_FOUND on a match.
 *  - When only the SUM overruns, that check passes and the run instead falls through to
 *    the v0.2.93.3 "analyse the whole run" fallback, silently ignoring the trim.
 *
 * So the guard has to be the sum, matching RAMP_UP_EXPR and MetricsPipeline. A run with
 * no recorded duration is treated as applicable: refusing on missing data would exclude
 * runs that are probably fine, and the pipeline's own fallback still covers it.
 */
export function offsetsFitRun(
  duration: number | null | undefined,
  analysisStartOffset: number,
  analysisEndOffset: number,
): boolean {
  if (duration === null || duration === undefined) return true;
  return duration > analysisStartOffset + analysisEndOffset;
}

/**
 * Decide which of a workload's runs may take a new analysis window, and why the rest
 * may not.
 *
 * Exported and pure so the preview endpoint and the write path share ONE definition of
 * the scope. Two implementations would drift, and the drift is invisible: the dialog
 * would promise a count the write does not honour.
 *
 * The target is always applicable — the user edited that run, and refusing it would make
 * the single-run and bulk paths disagree about the same click.
 */
export function partitionAnalysisTimeRangeScope(
  candidates: TestRunEntity[],
  target: TestRunEntity,
  analysisStartOffset: number,
  analysisEndOffset: number,
): { applicable: TestRunEntity[]; skipped: AnalysisTimeRangeScopeEntry[] } {
  const applicable: TestRunEntity[] = [];
  const skipped: AnalysisTimeRangeScopeEntry[] = [];

  for (const run of candidates) {
    if (run.id === target.id) {
      applicable.push(run);
      continue;
    }
    const entry: AnalysisTimeRangeScopeEntry = {
      testRunId: run.testRunId,
      completed: run.completed === true,
    };
    if (run.organizationId !== target.organizationId || run.teamId !== target.teamId) {
      // team_id is per-row and nullable, not derived from the system under test, so a
      // workload can span teams. The caller proved write permission on the target's
      // (org, team) pair only.
      skipped.push({ ...entry, skipped: 'not-writable' });
    } else if (run.completed !== true) {
      // MetricsPipeline bakes ds_metrics.ramp_up at INGESTION, so moving the offsets
      // mid-run leaves the run carrying rows flagged under two different settings —
      // one of the ways a run ends up with partial statistics.
      skipped.push({ ...entry, skipped: 'running' });
    } else if (!offsetsFitRun(run.duration, analysisStartOffset, analysisEndOffset)) {
      skipped.push({ ...entry, skipped: 'too-short' });
    } else {
      applicable.push(run);
    }
  }

  return { applicable, skipped };
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
      //
      // Scoped to the target's organization AND team, not just the workload triple.
      // `test_runs.team_id` is a per-row nullable column, NOT derived from the system
      // under test, so a workload can hold runs on different teams; the caller proved
      // write permission on the target's (org, team) pair only, and RLS is a coarse
      // backstop that grants modify to any org member. Anything outside that pair is
      // reported as `not-writable` rather than quietly written.
      const candidates = applyToAll
        ? await withRequestEm(this.testRunRepo).find({
            where: {
              systemUnderTestId: testRunEntity.systemUnderTestId,
              testEnvironment: testRunEntity.testEnvironment,
              workload: testRunEntity.workload,
            },
          })
        : [testRunEntity];

      const { applicable: siblings, skipped } = partitionAnalysisTimeRangeScope(
        candidates,
        testRunEntity,
        analysisStartOffset,
        analysisEndOffset,
      );

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
      if (skipped.length > 0) {
        const bucket = (reason: string) => skipped.filter((e) => e.skipped === reason).length;
        this.logger.log(
          `Left ${skipped.length} run(s) of the workload unchanged: ` +
            `${bucket('running')} still running, ${bucket('too-short')} shorter than the offsets, ` +
            `${bucket('not-writable')} on another team or organization`,
        );
      }
      const testRun = mapEntityToTestRun(updatedEntity);

      this.emitUpdateEvent(testRun, updatedEntity.systemUnderTest?.team_id);

      const affectedTestRunIds = siblings.map((run) => run.testRunId);

      return {
        testRun,
        affectedTestRunIds,
        completedTestRunIds: siblings.filter((run) => run.completed === true).map((run) => run.testRunId),
        skipped,
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
