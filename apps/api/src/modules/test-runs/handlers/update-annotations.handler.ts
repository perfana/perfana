/**
 * Handler for UpdateAnnotationsCommand
 *
 * Executes the business logic for updating test run annotations.
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { TestRun } from '../types/test-run.types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../types/realtime-events.types';
import { mapEntityToTestRun } from './entity-mapper';

export interface UpdateAnnotationsData {
  id: string;
  annotations: string[];
}

@Injectable()
export class UpdateAnnotationsHandler {
  private readonly logger = new Logger(UpdateAnnotationsHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
  ) {}

  async execute(data: UpdateAnnotationsData): Promise<TestRun> {
    const { id, annotations } = data;

    try {
      const testRunEntity = await this.testRunRepo.findOne({
        where: { id },
        select: ['id'],
      });

      if (!testRunEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      await this.dataSource.query(
        `UPDATE test_runs
         SET annotations = $1::text[], updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [annotations, id],
      );

      const updatedEntity = await this.testRunRepo.findOne({
        where: { id },
        relations: ['systemUnderTest'],
      });

      if (!updatedEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      this.logger.log(`Updated annotations for test run ${id}`);
      const testRun = mapEntityToTestRun(updatedEntity);

      this.emitUpdateEvent(testRun, updatedEntity.systemUnderTest?.team_id);

      return testRun;
    } catch (error) {
      this.logger.error(`Failed to update annotations for test run ${id}:`, error);
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
