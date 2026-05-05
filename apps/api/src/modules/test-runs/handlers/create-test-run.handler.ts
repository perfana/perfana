/**
 * Handler for CreateTestRunCommand
 *
 * Executes the business logic for creating a new test run.
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import {
  TestRun as TestRunEntity,
  DsChangePoints,
  OwnedResource,
} from '../../../entities';
import { CreateTestRunCommand, CreateTestRunData } from '../commands/create-test-run.command';
import { ICommandHandler, CommandContext, TestRunMutationResult } from '../commands/types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType, TestRunCreatedEvent } from '../types/realtime-events.types';
import { DatabaseException } from '../../../common/exceptions/business.exception';
import { TestRun } from '../types/test-run.types';
import { AdaptConfig } from '../../../types';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class CreateTestRunHandler implements ICommandHandler<CreateTestRunCommand, TestRunMutationResult> {
  private readonly logger = new Logger(CreateTestRunHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(DsChangePoints)
    private readonly changePointsRepo: Repository<DsChangePoints>,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Execute the create test run command
   */
  async execute(
    command: CreateTestRunCommand,
    context?: CommandContext,
  ): Promise<TestRunMutationResult> {
    const { data, options } = command;

    try {
      this.logger.log(`Creating new test run: ${data.testRunId}`);

      // Create and save the test run entity. Inlined (rather than delegated
      // to a private helper) so the audit lint rule sees the mutation and
      // the `auditService.logCreate` call in the same method body.
      const testRunData: Partial<TestRunEntity> = {
        testRunId: data.testRunId,
        systemUnderTestId: data.systemUnderTestId,
        testEnvironment: data.testEnvironment,
        workload: data.workload,
        applicationRelease: data.applicationRelease,
        duration: data.duration,
        plannedDuration: data.plannedDuration,
        analysisStartOffset: data.analysisStartOffset,
        completed: data.completed,
        ciBuildResultsUrl: data.ciBuildResultsUrl || '',
        annotations: data.annotations || [],
        tags: data.tags || [],
        abort: data.abort || false,
        variables: data.variables || [],
        adaptConfig: {
          mode: data.adaptMode || 'DEFAULT',
          differencesAccepted: data.adaptMode === 'BASELINE' ? 'ACCEPTED' : 'TBD',
        } as AdaptConfig,
        startTime: data.startTime || new Date(),
        endTime: data.endTime || new Date(),
        organizationId: data.organizationId,
        teamId: data.teamId,
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
      };
      const newTestRun = this.testRunRepo.create(testRunData);
      const testRunEntity = await withRequestEm(this.testRunRepo).save(newTestRun);

      // TestRun's column `organization_id` maps to property `organizationId`,
      // so AuditService.dispatch cannot read it from the entity directly —
      // every TestRun audit call site sets organizationIdOverride explicitly.
      this.auditService.logCreate(testRunEntity as unknown as OwnedResource, {
        organizationIdOverride: testRunEntity.organizationId,
      });

      // Fetch with relations for complete response
      const testRunWithRelations = await this.fetchWithRelations(testRunEntity.id);

      // Map to API response format
      const testRun = this.mapEntityToTestRun(testRunWithRelations);

      // Emit WebSocket event (unless skipped)
      if (!options?.skipEvents) {
        this.emitCreatedEvent(testRun, context, testRunWithRelations.systemUnderTest?.team_id);
      }

      // Create changepoint if this is the first test run for this combination
      await this.createChangepointIfFirstTestRun(data);

      this.logger.log(`Successfully created test run: ${data.testRunId}`);

      return {
        success: true,
        data: testRun,
        testRunId: data.testRunId,
        isNew: true,
      };
    } catch (error) {
      this.logger.error(`Failed to create test run ${data.testRunId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch test run with all necessary relations
   */
  private async fetchWithRelations(id: string): Promise<TestRunEntity> {
    const testRunWithRelations = await withRequestEm(this.testRunRepo).findOne({
      where: { id },
      relations: ['systemUnderTest'],
    });

    if (!testRunWithRelations) {
      throw new DatabaseException('Failed to retrieve created test run');
    }

    return testRunWithRelations;
  }

  /**
   * Map TypeORM entity to API response format
   */
  private mapEntityToTestRun(entity: TestRunEntity): TestRun {
    return {
      id: entity.id,
      test_run_id: entity.testRunId,
      system_under_test_id: entity.systemUnderTestId,
      test_environment: entity.testEnvironment,
      workload: entity.workload,
      start_time: entity.startTime?.toISOString(),
      end_time: entity.endTime?.toISOString(),
      duration: entity.duration,
      planned_duration: entity.plannedDuration,
      analysis_start_offset: entity.analysisStartOffset,
      completed: entity.completed || false,
      abort: entity.abort,
      status: entity.status,
      consolidated_result: entity.consolidatedResult,
      annotations: entity.annotations,
      tags: entity.tags,
      application_release: entity.applicationRelease,
      ci_build_results_url: entity.ciBuildResultsUrl,
      expires: entity.expires?.toISOString(),
      expired: entity.expired,
      valid: entity.valid,
      reasons_not_valid: entity.reasonsNotValid,
      data_warnings: entity.dataWarnings,
      adapt_config: entity.adaptConfig,
      variables: entity.variables,
      deep_links: entity.deepLinks,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString(),
      systems_under_test: entity.systemUnderTest ? {
        name: entity.systemUnderTest.name,
        pyroscope_instance_id: entity.systemUnderTest.pyroscope_instance_id,
        pyroscope_configurations: entity.systemUnderTest.pyroscope_configurations,
        pyroscopeInstance: entity.systemUnderTest.pyroscopeInstance ? {
          id: entity.systemUnderTest.pyroscopeInstance.id,
          label: entity.systemUnderTest.pyroscopeInstance.label,
          pyroscope_url: entity.systemUnderTest.pyroscopeInstance.pyroscopeUrl,
          pyroscope_stand_alone: entity.systemUnderTest.pyroscopeInstance.pyroscopeStandAlone,
        } : undefined,
      } : undefined,
    };
  }

  /**
   * Emit WebSocket event for test run creation
   */
  private emitCreatedEvent(
    testRun: TestRun,
    context?: CommandContext,
    teamId?: string,
  ): void {
    try {
      const event: TestRunCreatedEvent = {
        eventType: TestRunEventType.CREATED,
        timestamp: new Date().toISOString(),
        testRun,
        userId: context?.userId,
        organizationId: context?.organizationId,
        teamId: teamId || context?.teamId,
      };

      this.testRunsGateway.emitTestRunCreated(
        event,
        context?.userId,
        context?.organizationId,
        teamId || context?.teamId,
      );

      this.logger.debug(`Emitted CREATED event for test run: ${testRun.test_run_id}`);
    } catch (error) {
      // Log warning but don't throw - event emission should not break mutations
      this.logger.warn(
        `Failed to emit CREATED event for test run ${testRun.test_run_id}: ${
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Creates a changepoint for the first test run of a system/environment/workload combination.
   * This ensures there's always a baseline for comparison.
   */
  private async createChangepointIfFirstTestRun(data: CreateTestRunData): Promise<void> {
    try {
      // Count existing test runs for this combination
      const testRunCount = await withRequestEm(this.testRunRepo).count({
        where: {
          systemUnderTestId: data.systemUnderTestId,
          testEnvironment: data.testEnvironment,
          workload: data.workload,
        },
      });

      // If this is the first (and only) test run, create a changepoint
      if (testRunCount === 1) {
        // Check if a changepoint already exists (shouldn't happen, but be safe)
        const existingChangepoint = await this.changePointsRepo.findOne({
          where: {
            system_under_test_id: data.systemUnderTestId,
            test_environment: data.testEnvironment,
            workload: data.workload,
          },
        });

        if (!existingChangepoint) {
          const changepoint = this.changePointsRepo.create({
            system_under_test_id: data.systemUnderTestId,
            test_environment: data.testEnvironment,
            workload: data.workload,
            test_run_id: data.testRunId,
          });

          // System-derived bootstrap (bucket 2 in the audit decisions doc):
          // first-test-run-of-a-combination automatically seeds a baseline
          // changepoint. Not user-actionable, so no audit row.
          // eslint-disable-next-line audit-mutation-must-log
          await this.changePointsRepo.save(changepoint);
          this.logger.log(
            `Created initial changepoint for first test run: ${data.testRunId} ` +
            `(${data.systemUnderTestId}/${data.testEnvironment}/${data.workload})`
          );
        }
      }
    } catch (error) {
      // Don't fail the test run creation if changepoint creation fails
      this.logger.error(
        `Failed to create initial changepoint for ${data.testRunId}: ${(error as Error).message}`
      );
    }
  }
}
