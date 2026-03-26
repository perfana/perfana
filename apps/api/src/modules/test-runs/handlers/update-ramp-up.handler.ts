/**
 * Handler for updating test run ramp-up value.
 *
 * Allows users to adjust the ramp-up period (in seconds) for a test run.
 * This is useful when the configured ramp-up exceeds the actual test duration,
 * causing all data points to be excluded from statistical analysis.
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

export interface UpdateRampUpData {
  id: string;
  rampUp: number;
}

@Injectable()
export class UpdateRampUpHandler {
  private readonly logger = new Logger(UpdateRampUpHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
  ) {}

  async execute(data: UpdateRampUpData): Promise<TestRun> {
    const { id, rampUp } = data;

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
         SET ramp_up = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [rampUp, id],
      );

      const updatedEntity = await this.testRunRepo.findOne({
        where: { id },
        relations: ['systemUnderTest'],
      });

      if (!updatedEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      this.logger.log(`Updated ramp-up to ${rampUp}s for test run ${id}`);
      const testRun = mapEntityToTestRun(updatedEntity);

      this.emitUpdateEvent(testRun, updatedEntity.systemUnderTest?.team_id);

      return testRun;
    } catch (error) {
      this.logger.error(`Failed to update ramp-up for test run ${id}:`, error);
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
