/**
 * Handler for UpdateTestRunCommand
 *
 * Executes the business logic for updating an existing test run.
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
import { UpdateTestRunCommand, UpdateTestRunData } from '../commands/update-test-run.command';
import { ICommandHandler, CommandContext, TestRunMutationResult } from '../commands/types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType, TestRunUpdatedEvent } from '../types/realtime-events.types';
import { DatabaseException } from '../../../common/exceptions/business.exception';
import { TestRun } from '../types/test-run.types';

@Injectable()
export class UpdateTestRunHandler implements ICommandHandler<UpdateTestRunCommand, TestRunMutationResult> {
  private readonly logger = new Logger(UpdateTestRunHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly testRunsGateway: TestRunsGateway,
  ) {}

  /**
   * Execute the update test run command
   */
  async execute(
    command: UpdateTestRunCommand,
    context?: CommandContext,
  ): Promise<TestRunMutationResult> {
    const { data, options } = command;

    try {
      this.logger.log(`Updating test run: ${data.testRunId}`);

      // Update the test run entity
      await this.updateTestRunEntity(data);

      // Fetch with relations for complete response
      const testRunWithRelations = await this.fetchWithRelations(data);

      // Map to API response format
      const testRun = this.mapEntityToTestRun(testRunWithRelations);

      // Emit WebSocket event (unless skipped)
      if (!options?.skipEvents) {
        this.emitUpdatedEvent(testRun, context, testRunWithRelations.systemUnderTest?.team_id);
      }

      this.logger.log(`Successfully updated test run: ${data.testRunId}`);

      return {
        success: true,
        data: testRun,
        testRunId: data.testRunId,
        isNew: false,
      };
    } catch (error) {
      this.logger.error(`Failed to update test run ${data.testRunId}:`, error);
      throw error;
    }
  }

  /**
   * Update the test run entity
   */
  private async updateTestRunEntity(data: UpdateTestRunData): Promise<void> {
    const testRunData: Partial<TestRunEntity> = {
      applicationRelease: data.applicationRelease,
      duration: data.duration,
      plannedDuration: data.plannedDuration,
      rampUp: data.rampUp,
      completed: data.completed,
      ciBuildResultsUrl: data.ciBuildResultsUrl || '',
      annotations: data.annotations || [],
      tags: data.tags || [],
      abort: data.abort || false,
      variables: data.variables,
      endTime: data.endTime || new Date(),
      // Ownership tracking - update the updatedBy field
      updatedBy: data.updatedBy,
    };

    await this.testRunRepo.update(
      {
        testRunId: data.testRunId,
        systemUnderTestId: data.systemUnderTestId,
        testEnvironment: data.testEnvironment,
        workload: data.workload,
      },
      testRunData,
    );
  }

  /**
   * Fetch test run with all necessary relations
   */
  private async fetchWithRelations(data: UpdateTestRunData): Promise<TestRunEntity> {
    const testRunWithRelations = await this.testRunRepo.findOne({
      where: {
        testRunId: data.testRunId,
        systemUnderTestId: data.systemUnderTestId,
        testEnvironment: data.testEnvironment,
        workload: data.workload,
      },
      relations: ['systemUnderTest'],
    });

    if (!testRunWithRelations) {
      throw new DatabaseException('Failed to retrieve updated test run');
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
      ramp_up: entity.rampUp,
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
   * Emit WebSocket event for test run update
   */
  private emitUpdatedEvent(
    testRun: TestRun,
    context?: CommandContext,
    teamId?: string,
  ): void {
    try {
      const event: TestRunUpdatedEvent = {
        eventType: TestRunEventType.UPDATED,
        timestamp: new Date().toISOString(),
        testRun,
        userId: context?.userId,
        organizationId: context?.organizationId,
        teamId: teamId || context?.teamId,
      };

      this.testRunsGateway.emitTestRunUpdated(
        event,
        context?.userId,
        context?.organizationId,
        teamId || context?.teamId,
      );

      this.logger.debug(`Emitted UPDATED event for test run: ${testRun.test_run_id}`);
    } catch (error) {
      // Log warning but don't throw - event emission should not break mutations
      this.logger.warn(
        `Failed to emit UPDATED event for test run ${testRun.test_run_id}: ${
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown error'
        }`
      );
    }
  }
}
