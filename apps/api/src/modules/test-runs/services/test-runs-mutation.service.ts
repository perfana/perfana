/**
 * Test Runs Mutation Service - Orchestrator
 *
 * This service acts as an orchestrator for test run mutations.
 * All business logic is delegated to specialized handlers.
 *
 * Authorization:
 * - All mutation methods accept userId and roles parameters for authorization
 * - Permission checks are performed before mutations
 * - Ownership (created_by, updated_by) will be assigned when entity columns exist
 * - Global admins bypass all authorization checks
 *
 * @pattern Orchestrator Pattern + Command Pattern
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
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
import { UpdateAnnotationsHandler } from '../handlers/update-annotations.handler';
import { UpdateAnalysisStartOffsetHandler } from '../handlers/update-analysis-start-offset.handler';
import { UpdateAdaptConfigHandler } from '../handlers/update-adapt-config.handler';
import { InitTestHandler } from '../handlers/init-test.handler';
import { TestRunLookupService } from './test-run-lookup.service';
import { TestRunsMetricsService } from './test-runs-metrics.service';
import { TestRun, SystemUnderTest, TestEnvironment, Workload } from '../types/test-run.types';
import { mapEntityToTestRun } from '../handlers/entity-mapper';

// Re-export types for backward compatibility
export { TestRun, SystemUnderTest, TestEnvironment, Workload };

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
    private readonly updateAnalysisStartOffsetHandler: UpdateAnalysisStartOffsetHandler,
    private readonly updateAdaptConfigHandler: UpdateAdaptConfigHandler,
    private readonly initTestHandler: InitTestHandler,
    private readonly lookupService: TestRunLookupService,
    private readonly metricsService: TestRunsMetricsService,
  ) {}

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
    _roles: string[],
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

    // NOTE: Permission check will be added here when TestRun entity has organization_id
    // For now, all test runs can be updated (treated as legacy data)

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
    const entity = await this.testRunRepo.findOne({ where: { testRunId, systemUnderTestId, testEnvironment, workload } });
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
      analysisStartOffset: d.analysisStartOffset ? parseInt(String(d.analysisStartOffset)) : undefined,
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
      this.logger.log(`Test run ${testRun.test_run_id} completed - triggering ADAPT analysis`);
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
  async deleteTestRun(id: string, userId: string, _roles: string[]): Promise<void> {
    this.logger.debug(`deleteTestRun: id=${id}, userId=${userId}`);

    // NOTE: Permission check will be added here when TestRun entity has organization_id
    // For now, all test runs can be deleted (treated as legacy data)

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
  async updateTags(id: string, tags: string[], userId: string, _roles: string[]): Promise<TestRun> {
    this.logger.debug(`updateTags: id=${id}, userId=${userId}`);

    // NOTE: Permission check will be added here when TestRun entity has organization_id

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
  async updateAnnotations(id: string, annotations: string[], userId: string, _roles: string[]): Promise<TestRun> {
    this.logger.debug(`updateAnnotations: id=${id}, userId=${userId}`);

    // NOTE: Permission check will be added here when TestRun entity has organization_id

    return this.updateAnnotationsHandler.execute({ id, annotations });
  }

  async updateAnalysisStartOffset(id: string, analysisStartOffset: number, userId: string, _roles: string[]): Promise<TestRun> {
    this.logger.debug(`updateAnalysisStartOffset: id=${id}, analysisStartOffset=${analysisStartOffset}, userId=${userId}`);

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
    _roles: string[],
    systemUnderTestId?: string,
    environment?: string,
    workload?: string,
    mode?: 'DEFAULT' | 'BASELINE',
  ): Promise<TestRun> {
    this.logger.debug(`updateAdaptConfig: testRunId=${testRunId}, userId=${userId}`);

    // NOTE: Permission check will be added here when TestRun entity has organization_id

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
