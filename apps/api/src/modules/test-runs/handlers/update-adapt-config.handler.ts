/**
 * Handler for UpdateAdaptConfigCommand
 *
 * Executes the business logic for updating test run ADAPT configuration.
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { TestRun } from '../types/test-run.types';
import { AdaptConfig } from '../../../types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../types/realtime-events.types';
import { mapEntityToTestRun } from './entity-mapper';

export interface UpdateAdaptConfigData {
  testRunId: string;
  differencesAccepted: 'ACCEPTED' | 'DENIED' | 'TBD';
  systemUnderTestId?: string;
  environment?: string;
  workload?: string;
}

@Injectable()
export class UpdateAdaptConfigHandler {
  private readonly logger = new Logger(UpdateAdaptConfigHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly testRunsGateway: TestRunsGateway,
  ) {}

  async execute(data: UpdateAdaptConfigData): Promise<TestRun> {
    const { testRunId, differencesAccepted, systemUnderTestId, environment, workload } = data;

    try {
      let testRun: TestRunEntity | null = null;

      if (systemUnderTestId && environment && workload) {
        testRun = await this.testRunRepo.findOne({
          where: {
            testRunId,
            systemUnderTestId,
            testEnvironment: environment,
            workload,
          },
          relations: ['systemUnderTest'],
        });
      } else {
        testRun = await this.testRunRepo.findOne({
          where: { testRunId },
          relations: ['systemUnderTest'],
        });
      }

      if (!testRun) {
        throw new ResourceNotFoundException('TestRun', testRunId);
      }

      const updatedAdaptConfig: AdaptConfig = {
        ...(testRun.adaptConfig || {}),
        differencesAccepted,
      };

      const updateData: Partial<TestRunEntity> = {
        adaptConfig: updatedAdaptConfig,
      };

      if (differencesAccepted === 'ACCEPTED') {
        const adaptMode = testRun.adaptConfig?.mode;
        // In SCALING mode, overall depends only on adaptTestRunOK (SLOs are irrelevant during scaling)
        const meetsRequirement = adaptMode === 'SCALING'
          ? true
          : (testRun.consolidatedResult?.meetsRequirement ?? true);
        const adaptTestRunOK = true;
        const overall = meetsRequirement && adaptTestRunOK;

        updateData.consolidatedResult = {
          ...(testRun.consolidatedResult || {}),
          adaptTestRunOK: true,
          overall: overall,
        };
      }

      await this.testRunRepo.update({ id: testRun.id }, updateData);

      const updatedEntity = await this.testRunRepo.findOne({
        where: { id: testRun.id },
        relations: ['systemUnderTest'],
      });

      if (!updatedEntity) {
        throw new ResourceNotFoundException('TestRun', testRunId);
      }

      this.logger.log(
        `Updated adapt config for test run ${testRunId}: ${differencesAccepted}` +
          `${differencesAccepted === 'ACCEPTED' ? ' (consolidated result set to OK)' : ''}`,
      );

      const testRunResult = mapEntityToTestRun(updatedEntity);

      this.emitUpdateEvent(testRunResult, updatedEntity.systemUnderTest?.team_id);

      return testRunResult;
    } catch (error) {
      this.logger.error(`Failed to update adapt config for test run ${testRunId}:`, error);
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
