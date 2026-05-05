/**
 * Handler for UpdateTagsCommand
 *
 * Executes the business logic for updating test run tags.
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import { TestRun as TestRunEntity, OwnedResource } from '../../../entities';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { TestRun } from '../types/test-run.types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../types/realtime-events.types';
import { mapEntityToTestRun } from './entity-mapper';
import { AuditService } from '../../audit/audit.service';

export interface UpdateTagsData {
  id: string;
  tags: string[];
}

@Injectable()
export class UpdateTagsHandler {
  private readonly logger = new Logger(UpdateTagsHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  async execute(data: UpdateTagsData): Promise<TestRun> {
    const { id, tags } = data;

    try {
      // Fetch the pre-mutation row in full for the audit diff (raw SQL
      // update doesn't return prior state). The existence check below also
      // relies on this load.
      const testRunEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { id },
      });

      if (!testRunEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      await this.dataSource.query(
        `UPDATE test_runs
         SET tags = $1::text[], updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [tags, id],
      );

      const updatedEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { id },
        relations: ['systemUnderTest'],
      });

      if (!updatedEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      this.auditService.logUpdate(
        testRunEntity as unknown as OwnedResource,
        updatedEntity as unknown as OwnedResource,
        { organizationIdOverride: updatedEntity.organizationId },
      );

      this.logger.log(`Updated tags for test run ${id}`);
      const testRun = mapEntityToTestRun(updatedEntity);

      this.emitUpdateEvent(testRun, updatedEntity.systemUnderTest?.team_id);

      return testRun;
    } catch (error) {
      this.logger.error(`Failed to update tags for test run ${id}:`, error);
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
