/**
 * Handler for correcting a completed test run's start and/or end time.
 *
 * A load generator's clock, a stale-closed run (end_time = its last heartbeat) or a CI step
 * that posted completion late all leave a run whose recorded window does not match the test.
 * Everything downstream reads that window — metric collection, the perf-test rebuild, the
 * analysis offsets, the rollup — so the caller re-collects after this write; see
 * TestRunsMutationService.updateTestRunTimes.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { withRequestEm, withRequestQuery } from '../../../common/db/request-em';
import { TestRun as TestRunEntity, OwnedResource } from '../../../entities';
import {
  ResourceNotFoundException,
  ValidationException,
} from '../../../common/exceptions/business.exception';
import { TestRun } from '../types/test-run.types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../types/realtime-events.types';
import { mapEntityToTestRun } from './entity-mapper';
import { AuditService } from '../../audit/audit.service';

export interface UpdateTestRunTimesData {
  id: string;
  /** Omitted keeps the stored value. */
  startTime?: Date;
  endTime?: Date;
}

/** A clock a few minutes ahead of the API is not a reason to refuse a correction. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;
/** `duration` is int4. */
const MAX_DURATION_SECONDS = 2_147_483_647;

@Injectable()
export class UpdateTestRunTimesHandler {
  private readonly logger = new Logger(UpdateTestRunTimesHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  async execute(data: UpdateTestRunTimesData): Promise<TestRun> {
    const { id } = data;

    const before = await withRequestEm(this.testRunRepo).findOne({ where: { id } });
    if (!before) {
      throw new ResourceNotFoundException('TestRun', id);
    }

    // A live run's keep-alive posts move end_time to "now" on every update, so an edit
    // would be overwritten within a minute, and the incremental ticks would be collecting
    // against a window that changed under them.
    if (!before.completed) {
      throw new ValidationException('Only a completed test run can have its start or end time changed');
    }

    const start = data.startTime ?? before.startTime;
    const end = data.endTime ?? before.endTime;
    if (!start || !end) {
      throw new ValidationException('Both a start time and an end time are required');
    }
    if (start.getTime() >= end.getTime()) {
      throw new ValidationException('Start time must be before end time');
    }
    if (end.getTime() > Date.now() + FUTURE_SKEW_MS) {
      throw new ValidationException('End time cannot be in the future');
    }
    // Measured from the timestamps, matching RAMP_UP_EXPR and analysisOffsetsFit, which
    // never trust the client-supplied duration.
    const duration = Math.round((end.getTime() - start.getTime()) / 1000);
    if (duration > MAX_DURATION_SECONDS) {
      throw new ValidationException('Test run is too long');
    }

    // Through the request's RLS transaction, as the other test-run mutations do: the API's
    // login role bypasses RLS, so a raw dataSource write would skip the policies.
    await withRequestQuery(this.dataSource).query(
      `UPDATE test_runs
          SET start_time = $1, end_time = $2, duration = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4`,
      [start, end, duration, id],
    );

    const after = await withRequestEm(this.testRunRepo).findOne({
      where: { id },
      relations: ['systemUnderTest'],
    });
    if (!after) {
      throw new ResourceNotFoundException('TestRun', id);
    }

    this.auditService.logUpdate(
      before as unknown as OwnedResource,
      after as unknown as OwnedResource,
      { organizationIdOverride: after.organizationId },
    );

    this.logger.log(
      `Updated time range of test run ${id}: ${start.toISOString()} -> ${end.toISOString()} (${duration}s)`,
    );
    const testRun = mapEntityToTestRun(after);
    const teamId = after.systemUnderTest?.team_id;

    try {
      this.testRunsGateway.emitTestRunUpdated(
        { eventType: TestRunEventType.UPDATED, timestamp: new Date().toISOString(), testRun, teamId },
        undefined,
        undefined,
        teamId,
      );
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      this.logger.warn(`Failed to emit UPDATED event for test run ${testRun.test_run_id}: ${msg}`);
    }

    return testRun;
  }
}
