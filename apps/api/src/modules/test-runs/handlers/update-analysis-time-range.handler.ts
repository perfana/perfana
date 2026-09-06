/**
 * Handler for updating test run analysis time range (start and end offsets).
 *
 * Allows users to adjust both the analysis start offset (ramp-up) and
 * analysis end offset (ramp-down) for a test run in a single atomic operation.
 * This is useful when the configured analysis window needs to be trimmed from
 * both ends to exclude ramp-up and ramp-down periods from statistical analysis.
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
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
 * How long did this run actually last, in seconds?
 *
 * `end_time - start_time`, matching `RAMP_UP_EXPR` in StatisticsPipeline and its twin in
 * MetricsPipeline — those are what actually decide whether a sample falls inside the
 * analysis window, so anything else here would let the API and the pipeline disagree
 * about the same run.
 *
 * `test_runs.duration` is only a fallback. It is CLIENT-SUPPLIED (an updating test posts
 * it, see update-test-run.handler.ts), so it can be seeded from a planned duration or
 * left behind by an aborted run and differ from the timestamps arbitrarily. Trusting it
 * would let the API accept offsets the pipeline then rejects — the user is told the trim
 * was applied, and on those runs it silently was not.
 */
export function runLengthSeconds(run: {
  startTime?: Date | null;
  endTime?: Date | null;
  duration?: number | null;
}): number | null {
  if (run.startTime && run.endTime) {
    return (new Date(run.endTime).getTime() - new Date(run.startTime).getTime()) / 1000;
  }
  return run.duration ?? null;
}

/**
 * Can this run take these offsets?
 *
 * The analysis window is [start + startOffset, end - endOffset]. When the two exclusions
 * overlap, every sample is outside the window. Two different failures follow, and neither
 * is reported as a misconfiguration:
 *
 *  - `AdaptValidator.checkTooShortTestRuns` tests `ramp_up >= duration` ONLY — it never
 *    looks at ramp_down — and force-writes NO_BASELINES_FOUND on a match.
 *  - When only the SUM overruns, that check passes and the run instead falls through to
 *    the v0.2.93.3 "analyse the whole run" fallback, silently ignoring the trim.
 *
 * So the guard is the sum, against the same run length the pipeline uses. A run whose
 * length cannot be determined at all is treated as applicable: refusing on missing data
 * would exclude runs that are probably fine, and the pipeline's own fallback still covers
 * it. Strict inequality — at exactly `start + end` the window is empty, not minimal.
 */
export function offsetsFitRun(
  run: { startTime?: Date | null; endTime?: Date | null; duration?: number | null },
  analysisStartOffset: number,
  analysisEndOffset: number,
): boolean {
  const length = runLengthSeconds(run);
  if (length === null) { return true; }
  return length > analysisStartOffset + analysisEndOffset;
}

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
    } else if (!offsetsFitRun(run, analysisStartOffset, analysisEndOffset)) {
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

      // The TARGET is checked too, not just the siblings. Skipping a sibling as
      // `too-short` while writing the same impossible offsets onto the run the user is
      // looking at is the inconsistency the sibling check exists to prevent — and it is
      // the run most likely to get them, since the dialog's slider is bounded by the
      // summary timeseries duration rather than by end_time - start_time.
      //
      // Rejecting rather than silently falling back: an inverted window empties
      // ds_metric_statistics, makes the Apdex rollup miss every transaction and leaves
      // ADAPT reporting INSUFFICIENT_DATA on a run that plainly has data. The pipeline's
      // whole-run fallback keeps that from being destructive, but it is still not what
      // the user asked for, and nothing tells them.
      if (!offsetsFitRun(testRunEntity, analysisStartOffset, analysisEndOffset)) {
        const length = runLengthSeconds(testRunEntity);
        throw new BadRequestException(
          `Analysis offsets do not fit this test run: ${analysisStartOffset}s + ${analysisEndOffset}s ` +
            `leaves no analysis window in a run of ${length === null ? 'unknown' : Math.round(length)}s`,
        );
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
