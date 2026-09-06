/**
 * Test Runs Mutation Service - Orchestrator
 *
 * This service acts as an orchestrator for test run mutations.
 * All business logic is delegated to specialized handlers.
 *
 * Authorization:
 * - All mutation methods accept userId and roles parameters for authorization
 * - Every mutation of an existing run goes through `assertCanModify` /
 *   `assertHasWriteCapability` before touching it (see those methods for why
 *   RLS alone is not the gate)
 * - Global admins bypass all authorization checks
 *
 * @pattern Orchestrator Pattern + Command Pattern
 */

import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, FindOptionsWhere, Repository } from 'typeorm';
import { withRequestEm, runAfterRequestCommit } from '../../../common/db/request-em';
import { TestRun as TestRunEntity, OwnedResource } from '../../../entities';
import { UpdateRunningTestDto } from '../dto/update-running-test.dto';
import { InitTestDto, InitTestResponse } from '../dto/init-test.dto';
import { ResourceExistsException, DatabaseException } from '../../../common/exceptions/business.exception';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';
import { CreateTestRunCommand } from '../commands/create-test-run.command';
import { UpdateTestRunCommand } from '../commands/update-test-run.command';
import { DeleteTestRunCommand } from '../commands/delete-test-run.command';
import { CreateTestRunHandler } from '../handlers/create-test-run.handler';
import { UpdateTestRunHandler } from '../handlers/update-test-run.handler';
import { DeleteTestRunHandler } from '../handlers/delete-test-run.handler';
import { UpdateTagsHandler } from '../handlers/update-tags.handler';
import { UpdateApplicationReleaseHandler } from '../handlers/update-application-release.handler';
import { UpdateAnnotationsHandler } from '../handlers/update-annotations.handler';
import { UpdateAnalysisStartOffsetHandler } from '../handlers/update-analysis-start-offset.handler';
import {
  UpdateAnalysisTimeRangeHandler,
  partitionAnalysisTimeRangeScope,
  type AnalysisTimeRangeScopeEntry,
} from '../handlers/update-analysis-time-range.handler';
import { UpdateAdaptConfigHandler } from '../handlers/update-adapt-config.handler';
import { InitTestHandler } from '../handlers/init-test.handler';
import { TestRunLookupService } from './test-run-lookup.service';
import { TestRunsMetricsService } from './test-runs-metrics.service';
import { TestRun, SystemUnderTest, TestEnvironment, Workload } from '../types/test-run.types';
import { mapEntityToTestRun } from '../handlers/entity-mapper';
import { AuditService } from '../../audit/audit.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { Capability } from '../../../constants/capabilities.constants';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../types/realtime-events.types';

// Re-export types for backward compatibility
export { TestRun, SystemUnderTest, TestEnvironment, Workload };

/**
 * Ceiling on how many runs one "apply to all" may rewrite.
 *
 * The bulk apply has no natural bound — it is every run a system/environment/workload
 * has ever produced, which on a long-lived nightly workload is thousands. Each one costs
 * an audit row, a rollup job and a slot in the re-evaluate batch, all inside a single
 * request. 100 matches the existing in-repo bound on a caller-supplied run set
 * (`data-science.controller.ts` truncates `dto.testRunIds` with `.slice(0, 100)`), but
 * this one REFUSES rather than truncates: silently applying the window to the first 100
 * runs of a workload would leave the rest as an untrimmed baseline, which is the exact
 * apples-to-oranges comparison the feature exists to prevent.
 */
export const MAX_BULK_ANALYSIS_TIME_RANGE_RUNS = 100;

/**
 * Columns the scope decision reads, and nothing else.
 *
 * `partitionAnalysisTimeRangeScope` needs id / testRunId / completed / duration /
 * organizationId / teamId; the workload triple is what the candidate query is keyed on.
 * Without a projection this hydrates every column of every run of the workload —
 * `variables` and `deep_links` are jsonb and `status` / `consolidated_result` are
 * unbounded — to compute six booleans per row.
 */
const ANALYSIS_TIME_RANGE_SCOPE_COLUMNS: FindOptionsSelect<TestRunEntity> = {
  id: true,
  testRunId: true,
  completed: true,
  // startTime/endTime are what offsetsFitRun actually measures — `duration` is only its
  // fallback, because it is client-supplied and can disagree with the timestamps. Drop
  // either of these and the PREVIEW silently answers the fit question from `duration`
  // while the WRITE answers it from the timestamps, so the count the user confirms stops
  // matching the rows that get written. Keep this list in step with everything
  // partitionAnalysisTimeRangeScope reads.
  startTime: true,
  endTime: true,
  duration: true,
  organizationId: true,
  teamId: true,
  systemUnderTestId: true,
  testEnvironment: true,
  workload: true,
};

@Injectable()
export class TestRunsMutationService {
  private readonly logger = new Logger(TestRunsMutationService.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly bullmqClientService: BullMQClientService,
    private readonly createTestRunHandler: CreateTestRunHandler,
    private readonly updateTestRunHandler: UpdateTestRunHandler,
    private readonly deleteTestRunHandler: DeleteTestRunHandler,
    private readonly updateTagsHandler: UpdateTagsHandler,
    private readonly updateAnnotationsHandler: UpdateAnnotationsHandler,
    private readonly updateApplicationReleaseHandler: UpdateApplicationReleaseHandler,
    private readonly updateAnalysisStartOffsetHandler: UpdateAnalysisStartOffsetHandler,
    private readonly updateAnalysisTimeRangeHandler: UpdateAnalysisTimeRangeHandler,
    private readonly updateAdaptConfigHandler: UpdateAdaptConfigHandler,
    private readonly initTestHandler: InitTestHandler,
    private readonly lookupService: TestRunLookupService,
    private readonly metricsService: TestRunsMetricsService,
    private readonly auditService: AuditService,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly authzService: AuthorizationService,
  ) {}


  // ============================================
  // Write gate
  // ============================================

  /**
   * Reject callers who may READ a run but not WRITE it.
   *
   * RLS is not this gate. `rls_test_runs_update` calls `can_modify_resource`,
   * whose last branch grants modify to any member of the resource's org — its
   * own comment says so: "Coarse backstop ... Loose vs service layer; precise
   * gates live there." This is there. Without it an `org-viewer` could edit
   * every run they can see, which is every run in their organization.
   *
   * API-key principals are exempt. A key has no `organization_members` row, so
   * `getCapabilities` returns an empty set for every key and gating on it would
   * deny all programmatic writes. Issuing a key needs `api-key:create`, which
   * only org-admins hold, so possession of one already implies write intent.
   */
  private async assertHasWriteCapability(
    run: Pick<TestRunEntity, 'id' | 'organizationId' | 'teamId'>,
    userId: string,
    roles: string[],
  ): Promise<void> {
    if (userId.startsWith('api-key:')) return;

    const caps = await this.authzService.getCapabilities(
      userId,
      roles,
      run.organizationId ?? null,
      run.teamId ?? null,
    );

    if (!caps.includes(Capability.TestRunUpdate)) {
      this.logger.warn(
        `Write denied: capability=${Capability.TestRunUpdate} userId=${userId} ` +
          `testRun=${run.id} orgId=${run.organizationId ?? 'null'}`,
      );
      throw new ForbiddenException('You do not have permission to modify this test run');
    }
  }

  /**
   * Load a run for mutation and check write permission in one step.
   *
   * The load runs through `withRequestEm`, so a run the caller cannot even see
   * comes back null and is refused as not-found — identical to what the handlers
   * already do, and it keeps existence unlearnable. `label` is what the
   * not-found message reports (the UUID, or the test run id for lookups keyed
   * on that).
   */
  private async assertCanModify(
    where: FindOptionsWhere<TestRunEntity>,
    label: string,
    userId: string,
    roles: string[],
  ): Promise<void> {
    const run = await withRequestEm(this.testRunRepo).findOne({
      where,
      select: { id: true, organizationId: true, teamId: true },
    });

    if (!run) {
      throw new NotFoundException(`Test run not found: ${label}`);
    }

    await this.assertHasWriteCapability(run, userId, roles);
  }

  /**
   * Update or create a running test run.
   *
   * @param updateDto - The update data
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   */
  async updateRunningTest(
    updateDto: UpdateRunningTestDto,
    userId: string,
    roles: string[],
    organizationId: string,
  ): Promise<TestRun> {
    this.logger.debug(
      `updateRunningTest: testRunId=${updateDto.testRunId}, userId=${userId}, organizationId=${organizationId}`,
    );

    const systemUnderTest = await this.lookupService.findOrCreateSystemUnderTest(
      updateDto.systemUnderTest,
      userId,
      organizationId,
    );
    const testEnvironment = await this.lookupService.findOrCreateTestEnvironment(systemUnderTest.id, updateDto.testEnvironment);
    const workload = await this.lookupService.findOrCreateWorkload(testEnvironment.id, updateDto.workload, updateDto.testRunId);

    const existingTestRun = await this.findTestRun(updateDto.testRunId, systemUnderTest.id, updateDto.testEnvironment, updateDto.workload);

    // Only the update branch is gated. Creating a run is the ingest contract —
    // the caller already had to resolve an organization to get here — whereas
    // overwriting a run that exists is editing someone else's data.
    if (existingTestRun) {
      await this.assertHasWriteCapability(
        {
          id: existingTestRun.id,
          organizationId: existingTestRun.organization_id,
          teamId: existingTestRun.team_id,
        },
        userId,
        roles,
      );
    }

    if (existingTestRun?.completed) {
      throw new ResourceExistsException('Test run', `${updateDto.testRunId} for system ${updateDto.systemUnderTest}`);
    }

    const { duration, plannedDuration } = this.calculateDurations(updateDto, existingTestRun);
    const testRun = await this.upsertTestRun({
      testRunId: updateDto.testRunId,
      systemUnderTestId: systemUnderTest.id,
      testEnvironment: updateDto.testEnvironment,
      workload: updateDto.workload,
      workloadConfig: workload?.config,
      updateDto,
      duration,
      plannedDuration,
      existingTestRun,
      userId,
      organizationId,
    });

    this.logger.log(`Processed running test for system: ${systemUnderTest.name}, testRunId: ${testRun.test_run_id}`);

    if (testRun.completed) {
      await this.handleCompletedTest(testRun);
    }

    return testRun;
  }

  /**
   * Abort a running test run.
   *
   * @param id - The test run UUID
   * @param userId - The user ID for ownership tracking
   * @param _roles - The user's roles (reserved for future authorization)
   * @param userIdentifier - Human-readable identifier (email) for the abort message
   */
  async abortTestRun(id: string, userId: string, roles: string[], userIdentifier: string): Promise<TestRun> {
    const entity = await withRequestEm(this.testRunRepo).findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Test run not found: ${id}`);
    }

    await this.assertHasWriteCapability(entity, userId, roles);

    if (entity.completed) {
      throw new BadRequestException('Test run is already completed');
    }

    if (entity.abort) {
      throw new BadRequestException('Test run is already aborted');
    }

    const before = { ...entity };

    entity.abort = true;
    entity.abortMessage = `Aborted manually by ${userIdentifier}`;
    entity.updatedBy = userId;
    entity.endTime = new Date();
    entity.completed = true;

    await withRequestEm(this.testRunRepo).save(entity);

    await this.auditService.logUpdate(
      before as unknown as OwnedResource,
      entity as unknown as OwnedResource,
      { organizationIdOverride: entity.organizationId },
    );

    const testRun = mapEntityToTestRun(entity);

    try {
      this.testRunsGateway.emitTestRunUpdated(
        {
          eventType: TestRunEventType.UPDATED,
          timestamp: new Date().toISOString(),
          testRun,
          userId,
          organizationId: entity.organizationId,
          teamId: entity.teamId ?? undefined,
        },
        userId,
        entity.organizationId,
        entity.teamId ?? undefined,
      );
    } catch (err) {
      this.logger.warn(`Failed to emit UPDATED event after abort for ${entity.testRunId}: ${
        err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error'
      }`);
    }

    await this.handleCompletedTest(testRun);

    return testRun;
  }

  async findOrCreateSystemUnderTest(
    name: string,
    userId: string,
    organizationId: string,
  ): Promise<SystemUnderTest> {
    return this.lookupService.findOrCreateSystemUnderTest(name, userId, organizationId);
  }

  async findOrCreateTestEnvironment(systemUnderTestId: string, name: string): Promise<TestEnvironment> {
    return this.lookupService.findOrCreateTestEnvironment(systemUnderTestId, name);
  }

  async findOrCreateWorkload(testEnvironmentId: string, name: string, baselineTestRunId?: string): Promise<Workload> {
    return this.lookupService.findOrCreateWorkload(testEnvironmentId, name, baselineTestRunId);
  }

  async findTestRun(testRunId: string, systemUnderTestId: string, testEnvironment: string, workload: string): Promise<TestRun | null> {
    const entity = await withRequestEm(this.testRunRepo).findOne({ where: { testRunId, systemUnderTestId, testEnvironment, workload } });
    return entity ? mapEntityToTestRun(entity) : null;
  }

  private calculateDurations(dto: UpdateRunningTestDto, existing?: TestRun | null) {
    const planned = dto.duration ? parseInt(String(dto.duration)) + parseInt(String(dto.analysisStartOffset || '0')) : existing?.planned_duration ?? -1;
    const duration = dto.end && dto.start ? Math.floor((new Date(dto.end).getTime() - new Date(dto.start).getTime()) / 1000) : existing?.start_time ? Math.floor((Date.now() - new Date(existing.start_time).getTime()) / 1000) : 0;
    return { duration, plannedDuration: planned };
  }

  private async upsertTestRun(p: {
    testRunId: string;
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    workloadConfig?: Record<string, unknown>;
    updateDto: UpdateRunningTestDto;
    duration: number;
    plannedDuration: number;
    existingTestRun?: TestRun | null;
    userId: string;
    organizationId: string;
  }): Promise<TestRun> {
    const { testRunId, systemUnderTestId, testEnvironment, workload, workloadConfig, updateDto: d, duration, plannedDuration, existingTestRun, userId, organizationId } = p;

    // Ownership tracking - assign API key's organization to test run
    const common = {
      testRunId,
      systemUnderTestId,
      testEnvironment,
      workload,
      applicationRelease: d.version,
      duration,
      plannedDuration,
      analysisStartOffset: d.analysisStartOffset != null ? parseInt(String(d.analysisStartOffset)) : undefined,
      analysisEndOffset: d.analysisEndOffset != null ? parseInt(String(d.analysisEndOffset)) : undefined,
      completed: d.completed,
      ciBuildResultsUrl: d.CIBuildResultsUrl || d.buildResultsUrl,
      annotations: d.annotations ? [d.annotations] : [],
      tags: d.tags || [],
      abort: d.abort || false,
      variables: d.variables || [],
      // Ownership tracking (use API key's organization)
      organizationId: existingTestRun?.organization_id || organizationId,
      createdBy: existingTestRun ? undefined : userId,
      updatedBy: userId,
      // ADAPT mode: DTO override > workload config > DEFAULT
      adaptMode: (d.adaptMode as string | undefined) || (workloadConfig?.adaptMode as string | undefined),
    };

    // Create context for handlers to use in event emission
    const context = {
      userId,
      organizationId: existingTestRun?.organization_id || organizationId,
      teamId: existingTestRun?.team_id,
      timestamp: new Date(),
    };

    const result = existingTestRun
      ? await this.updateTestRunHandler.execute(UpdateTestRunCommand.fromParams({ ...common, endTime: d.end ? new Date(d.end) : new Date() }), context)
      : await this.createTestRunHandler.execute(CreateTestRunCommand.fromUpdateDto({ ...common, startTime: d.start ? new Date(d.start) : new Date(), endTime: new Date() }), context);

    if (!result.success || !result.data) {
      throw new DatabaseException(`Failed to ${existingTestRun ? 'update' : 'create'} test run`);
    }

    this.logger.debug(`Test run ${existingTestRun ? 'updated' : 'created'} by user ${userId}`);
    return result.data;
  }

  private async handleCompletedTest(testRun: TestRun): Promise<void> {
    // Apply golden-path metric classifications before analysis
    try {
      const result = await this.metricsService.applyGoldenPathClassifications({
        systemUnderTestId: testRun.system_under_test_id,
        testEnvironment: testRun.test_environment,
        workload: testRun.workload,
      });
      if (result.compareConfigsCreated > 0) {
        this.logger.log(
          `Golden-path applied for ${testRun.test_run_id}: ${result.compareConfigsCreated} compare configs created`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to apply golden-path classifications for ${testRun.test_run_id}:`, error);
    }

    // Trigger ADAPT analysis
    try {
      this.logger.log(`Triggering ADAPT analysis for test run ${testRun.test_run_id}`);
      const result = await this.bullmqClientService.analyzeTest(testRun.test_run_id, { adapt: true, benchmarksOnly: false });
      this.logger.log(`ADAPT analysis initiated for test run ${testRun.test_run_id}, job ID: ${result.jobId}`);
    } catch (error) {
      this.logger.error(`Failed to trigger analysis for test run ${testRun.test_run_id}:`, error);
    }
  }

  async getDefaultTeam(): Promise<{ id: string; name: string } | null> {
    return this.lookupService.getDefaultTeam();
  }

  /**
   * Delete a test run by ID.
   *
   * @param id - The test run UUID
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async deleteTestRun(id: string, userId: string, roles: string[]): Promise<void> {
    this.logger.debug(`deleteTestRun: id=${id}, userId=${userId}`);

    // Gated on TestRunUpdate, not TestRunDelete: the capability map reserves
    // TestRunDelete for org-admins, and org-members delete their own runs today.
    // Viewers are excluded either way, which is the hole being closed here.
    await this.assertCanModify({ id }, id, userId, roles);

    const command = DeleteTestRunCommand.fromId(id);
    await this.deleteTestRunHandler.execute(command);

    this.logger.log(`Test run ${id} deleted by user ${userId}`);
  }

  /**
   * Initialize a test run.
   *
   * @param initDto - The initialization data
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param organizationId - The organization ID for ownership tracking
   */
  async initTest(initDto: InitTestDto, userId: string, _roles: string[], organizationId: string): Promise<InitTestResponse> {
    this.logger.debug(`initTest: systemUnderTest=${initDto.systemUnderTest}, userId=${userId}, organizationId=${organizationId}`);

    // Pass organizationId to handler for system lookup/creation with proper ownership
    return this.initTestHandler.execute(initDto, userId, organizationId);
  }

  /**
   * Update tags for a test run.
   *
   * @param id - The test run UUID
   * @param tags - The new tags
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async updateTags(id: string, tags: string[], userId: string, roles: string[]): Promise<TestRun> {
    this.logger.debug(`updateTags: id=${id}, userId=${userId}`);

    await this.assertCanModify({ id }, id, userId, roles);

    return this.updateTagsHandler.execute({ id, tags });
  }

  /**
   * Update annotations for a test run.
   *
   * @param id - The test run UUID
   * @param annotations - The new annotations
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async updateApplicationRelease(id: string, applicationRelease: string, userId: string, roles: string[]): Promise<TestRun> {
    this.logger.debug(`updateApplicationRelease: id=${id}, userId=${userId}`);

    await this.assertCanModify({ id }, id, userId, roles);

    return this.updateApplicationReleaseHandler.execute({ id, applicationRelease });
  }

  async updateAnnotations(id: string, annotations: string[], userId: string, roles: string[]): Promise<TestRun> {
    this.logger.debug(`updateAnnotations: id=${id}, userId=${userId}`);

    await this.assertCanModify({ id }, id, userId, roles);

    return this.updateAnnotationsHandler.execute({ id, annotations });
  }

  async updateAnalysisStartOffset(id: string, analysisStartOffset: number, userId: string, roles: string[]): Promise<TestRun> {
    this.logger.debug(`updateAnalysisStartOffset: id=${id}, analysisStartOffset=${analysisStartOffset}, userId=${userId}`);

    await this.assertCanModify({ id }, id, userId, roles);

    const result = await this.updateAnalysisStartOffsetHandler.execute({ id, analysisStartOffset });

    // Editing ramp-up on a completed run invalidates the `ramp_up_excluded=true`
    // rows in test_run_transaction_stats / test_run_sampler_stats — they were
    // computed against the previous cutoff. Re-enqueue the rollup job so the
    // dashboard shows numbers consistent with the new ramp-up setting.
    // See: issues #150, #151.
    if (result?.completed && result?.test_run_id) {
      try {
        await this.bullmqClientService.enqueueTransactionStatsRollup(result.test_run_id);
      } catch (err) {
        this.logger.error(
          `Failed to re-enqueue stats rollup after ramp-up edit for ${result.test_run_id}:`,
          err,
        );
        // Intentionally swallowed — the mutation itself succeeded, and the
        // dashboard falls back to live aggregation if the rollup is stale.
      }
    }

    return result;
  }

  /**
   * What would "apply to all test runs" actually change?
   *
   * Read-only twin of updateAnalysisTimeRange, so the dialog can state the blast radius
   * before the user commits instead of after. Shares
   * `partitionAnalysisTimeRangeScope` with the write path — two implementations would
   * drift and the drift would be invisible, since the dialog would promise a count the
   * write does not honour.
   */
  async previewAnalysisTimeRangeScope(
    id: string,
    analysisStartOffset: number,
    analysisEndOffset: number,
    userId: string,
    roles: string[],
  ): Promise<{
    total: number;
    applicable: number;
    skipped: AnalysisTimeRangeScopeEntry[];
    /**
     * The write would refuse this apply: more than MAX_BULK_ANALYSIS_TIME_RANGE_RUNS runs
     * are applicable. Reported here rather than left to the 400, so the dialog can say so
     * before the user commits instead of previewing a scope the PUT will reject.
     */
    exceedsCap: boolean;
  }> {
    await this.assertCanModify({ id }, id, userId, roles);

    const { total, applicable, skipped } = await this.resolveAnalysisTimeRangeScope(
      id,
      analysisStartOffset,
      analysisEndOffset,
    );

    return {
      total,
      applicable: applicable.length,
      skipped,
      exceedsCap: applicable.length > MAX_BULK_ANALYSIS_TIME_RANGE_RUNS,
    };
  }

  /**
   * Resolve the target's workload and partition its runs against the proposed offsets.
   *
   * Shared by the preview and by the write path's cap check so the two cannot disagree
   * about how many runs an apply would touch — a dialog that promises a count the write
   * refuses is worse than no dialog.
   *
   * Projected (`ANALYSIS_TIME_RANGE_SCOPE_COLUMNS`) because this reads EVERY run of the
   * workload; without it, a long-lived nightly workload hydrates thousands of fully
   * populated entities to compute a handful of booleans per row.
   */
  private async resolveAnalysisTimeRangeScope(
    id: string,
    analysisStartOffset: number,
    analysisEndOffset: number,
  ): Promise<{
    total: number;
    applicable: TestRunEntity[];
    skipped: AnalysisTimeRangeScopeEntry[];
  }> {
    const target = await withRequestEm(this.testRunRepo).findOne({
      where: { id },
      select: ANALYSIS_TIME_RANGE_SCOPE_COLUMNS,
    });
    if (!target) {
      throw new NotFoundException(`Test run not found: ${id}`);
    }

    const candidates = await withRequestEm(this.testRunRepo).find({
      where: {
        systemUnderTestId: target.systemUnderTestId,
        testEnvironment: target.testEnvironment,
        workload: target.workload,
      },
      select: ANALYSIS_TIME_RANGE_SCOPE_COLUMNS,
    });

    const { applicable, skipped } = partitionAnalysisTimeRangeScope(
      candidates,
      target,
      analysisStartOffset,
      analysisEndOffset,
    );

    return { total: candidates.length, applicable, skipped };
  }

  async updateAnalysisTimeRange(
    id: string,
    analysisStartOffset: number,
    analysisEndOffset: number,
    userId: string,
    roles: string[],
    applyToAll = false,
  ): Promise<TestRun & { affectedCount?: number; skipped?: AnalysisTimeRangeScopeEntry[] }> {
    this.logger.debug(
      `updateAnalysisTimeRange: id=${id}, startOffset=${analysisStartOffset}, endOffset=${analysisEndOffset}, applyToAll=${applyToAll}, userId=${userId}`,
    );

    await this.assertCanModify({ id }, id, userId, roles);

    if (applyToAll) {
      // Refuse before the handler writes anything. The bulk apply is unbounded on its
      // own — it is every run the system/environment/workload has ever produced — and
      // each one costs an audit row, a rollup job and a slot in the re-evaluate batch,
      // all inside one request.
      //
      // This repeats the scope read the handler does for itself. It is deliberate and
      // it is the cheaper of the two: the handler needs FULL entities for the audit
      // "before" diff, while this one is projected to the nine columns the decision
      // reads. There is no way to hand the handler a verdict without changing it, and
      // checking AFTER it returns would mean the rows are already written.
      const { applicable } = await this.resolveAnalysisTimeRangeScope(
        id,
        analysisStartOffset,
        analysisEndOffset,
      );
      if (applicable.length > MAX_BULK_ANALYSIS_TIME_RANGE_RUNS) {
        throw new BadRequestException(
          `Applying this analysis time range would rewrite ${applicable.length} test runs, ` +
            `more than the limit of ${MAX_BULK_ANALYSIS_TIME_RANGE_RUNS}. Narrow the scope, ` +
            `or apply it to this run only.`,
        );
      }
    }

    const { testRun: result, affectedTestRunIds, completedTestRunIds, skipped } =
      await this.updateAnalysisTimeRangeHandler.execute({
        id,
        analysisStartOffset,
        analysisEndOffset,
        applyToAll,
      });

    // Deferred out of the request's RLS transaction on purpose. Awaiting a Redis round
    // trip inside it holds a pooled Postgres connection idle-in-transaction for the
    // length of a Redis stall, and at pool max 50 that starves unrelated endpoints from
    // a cheap GET. Same reason repairEmptySamplerRollup defers its enqueue.
    runAfterRequestCommit(() =>
      this.enqueueAnalysisTimeRangeFollowUp({
        targetId: id,
        target: result,
        applyToAll,
        affectedTestRunIds,
        completedTestRunIds,
      }),
    );

    // The caller cannot see the blast radius otherwise: the response body is the single
    // target run, so without these the UI has no way to say what it just changed.
    return applyToAll
      ? { ...result, affectedCount: affectedTestRunIds.length, skipped }
      : result;
  }

  /**
   * Queue the work an analysis-window edit implies, once the request's transaction has
   * committed.
   *
   * NOT after the response is sent. When `DB_ENABLE_RLS_ROLE=true`,
   * `RlsTransactionInterceptor` awaits every after-commit hook inside its `.then()`
   * BEFORE re-emitting the value Nest turns into the response, so the caller waits for
   * everything in here. What deferring actually buys is the Postgres connection: the
   * interceptor nulls `REQ_EM` and the transaction is committed and its query runner
   * released before the hooks run, so a Redis stall no longer holds a pooled connection
   * idle-in-transaction — at pool max 50 that is what starves unrelated endpoints. It
   * also guarantees the worker can see the rows this request wrote.
   *
   * Because the caller is waiting, the Redis round trips here are on the critical path
   * and have to be batched rather than looped — hence `enqueueTransactionStatsRollupBulk`.
   *
   * Never rejects. `runAfterRequestCommit` dispatches its hook as
   * `void Promise.resolve().then(fn)` when there is no request entity manager (RLS off,
   * `@SkipRls`, or outside an HTTP request), so an escaping rejection is an unhandled
   * rejection — which terminates the process on this Node version. Nothing in here is
   * worth taking the API down for, so every failure is logged and swallowed.
   */
  private async enqueueAnalysisTimeRangeFollowUp(args: {
    targetId: string;
    target: TestRun;
    applyToAll: boolean;
    affectedTestRunIds: string[];
    completedTestRunIds: string[];
  }): Promise<void> {
    const { targetId, target, applyToAll, affectedTestRunIds, completedTestRunIds } = args;
    try {
      // The rollup recomputes the ramp_up_excluded rows from the offsets. Every COMPLETED
      // run that was written needs it, not just the target: getRollupStatus reads a
      // populated table and answers `ready` forever, so a sibling that is never
      // re-enqueued serves previous-window numbers in Performance Analysis indefinitely,
      // with nothing logged anywhere.
      //
      // One `addBulk` round trip, not one `add` per run: see the note above about the
      // caller waiting on this hook. A 100-run workload was 100 sequential Redis round
      // trips wired straight into the PUT's latency.
      if (completedTestRunIds.length > 0) {
        try {
          await this.bullmqClientService.enqueueTransactionStatsRollupBulk(completedTestRunIds);
        } catch (err) {
          // `addBulk` is not atomic. Idempotency covers DUPLICATION, which is not the risk
          // here — the risk is OMISSION: the runs after the failure point get no rollup at
          // all, and nothing retries them. `repairEmptySamplerRollup` does not cover it
          // either, because it only fires when test_run_sampler_stats is EMPTY, whereas
          // these tables are populated with the PREVIOUS window's numbers, so
          // getRollupStatus answers `ready` forever. That is exactly the silent staleness
          // this whole completedTestRunIds path exists to prevent.
          //
          // So retry per run. The deterministic jobId makes anything already queued a
          // no-op, and a run that fails again is named individually in the log for the
          // backfill script to pick up.
          this.logger.error(
            `Bulk stats-rollup enqueue failed for ${completedTestRunIds.length} test run(s), ` +
              `falling back to one enqueue per run:`,
            err,
          );
          for (const testRunId of completedTestRunIds) {
            try {
              await this.bullmqClientService.enqueueTransactionStatsRollup(testRunId);
            } catch (perRunErr) {
              this.logger.error(
                `Stats rollup could not be enqueued for ${testRunId} — its Performance Analysis ` +
                  `will show previous-window numbers until apps/worker/scripts/backfill-test-run-stats-rollup.ts runs:`,
                perRunErr,
              );
            }
          }
        }
      }

      // The offsets on their own change nothing anyone can see: they take effect only once
      // StatisticsPipeline rebakes ds_metrics.ramp_up and rewrites ds_metric_statistics,
      // and ADAPT recomputes off that.
      try {
        if (applyToAll) {
          // Branch on applyToAll ALONE. Gating on `affectedTestRunIds.length > 1` meant a
          // single-run workload fell through to analyzeTest — which includes
          // metrics-collection and re-hits Grafana, the exact thing this path exists to
          // avoid — or, when the run was not completed, enqueued nothing at all while the
          // UI still reported that re-analysis had started.
          //
          // reevaluateBatch, not analyzeTest per run: analyze-test collects data. The batch
          // path skips collection, and recalculateStatistics is what makes it still rebuild
          // the statistics the new window implies. It must stay ONE job: the orchestrator's
          // scope lock is keyed on sut:env:workload, so a second job for the same workload
          // is refused rather than queued — the chunking happens inside that one job.
          if (affectedTestRunIds.length === 0) {
            this.logger.warn(`No writable runs to re-evaluate after time range edit for ${targetId}`);
            return;
          }
          await this.bullmqClientService.reevaluateBatch(affectedTestRunIds, {
            checks: true,
            adapt: true,
            recalculateStatistics: true,
          });
          this.logger.log(
            `Re-evaluation enqueued for ${affectedTestRunIds.length} test run(s) after time range update (applyToAll)`,
          );
        } else if (target?.completed && target?.test_run_id) {
          await this.bullmqClientService.analyzeTest(target.test_run_id, { adapt: true, benchmarksOnly: false });
          this.logger.log(`Re-analysis enqueued for test run ${target.test_run_id} after time range update`);
        }
      } catch (err) {
        this.logger.error(
          `Failed to enqueue re-analysis after time range edit for ${target?.test_run_id ?? targetId}:`,
          err,
        );
      }
    } catch (err) {
      this.logger.error(`Post-commit work failed after time range edit for ${targetId}:`, err);
    }
  }

  /**
   * Update ADAPT config for a test run.
   *
   * @param testRunId - The test run identifier
   * @param differencesAccepted - The acceptance status
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   * @param systemUnderTestId - Optional system ID for disambiguation
   * @param environment - Optional environment for disambiguation
   * @param workload - Optional workload for disambiguation
   */
  async updateAdaptConfig(
    testRunId: string,
    differencesAccepted: 'ACCEPTED' | 'DENIED' | 'TBD',
    userId: string,
    roles: string[],
    systemUnderTestId?: string,
    environment?: string,
    workload?: string,
    mode?: 'DEFAULT' | 'BASELINE',
  ): Promise<TestRun> {
    this.logger.debug(`updateAdaptConfig: testRunId=${testRunId}, userId=${userId}`);

    // Same where-clause the handler resolves with, so the row checked is the row written.
    await this.assertCanModify(
      systemUnderTestId && environment && workload
        ? { testRunId, systemUnderTestId, testEnvironment: environment, workload }
        : { testRunId },
      testRunId,
      userId,
      roles,
    );

    return this.updateAdaptConfigHandler.execute({
      testRunId,
      differencesAccepted,
      mode,
      systemUnderTestId,
      environment,
      workload,
    });
  }

  async getWorkloadConfig(systemUnderTestId: string, testEnvironment: string, workload: string): Promise<Record<string, unknown> | null> {
    return this.lookupService.getWorkloadConfig(systemUnderTestId, testEnvironment, workload);
  }

  async updateWorkloadConfig(systemUnderTestId: string, testEnvironment: string, workload: string, adaptMode: string): Promise<void> {
    const configUpdate: Record<string, unknown> = { adaptMode };
    return this.lookupService.updateWorkloadConfig(systemUnderTestId, testEnvironment, workload, configUpdate);
  }

  public mapEntityToTestRun(entity: TestRunEntity): TestRun {
    return mapEntityToTestRun(entity);
  }
}
