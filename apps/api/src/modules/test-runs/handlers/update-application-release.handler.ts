/**
 * Handler for UpdateApplicationReleaseCommand
 *
 * Executes the business logic for updating a test run's application release (its version).
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
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

export interface UpdateApplicationReleaseData {
  id: string;
  /** Empty string clears it — the run then reads as having no version. */
  applicationRelease: string;
}

@Injectable()
export class UpdateApplicationReleaseHandler {
  private readonly logger = new Logger(UpdateApplicationReleaseHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  async execute(data: UpdateApplicationReleaseData): Promise<TestRun> {
    const { id, applicationRelease } = data;

    try {
      // Fetch the pre-mutation row in full for the audit diff (raw SQL
      // update doesn't return prior state).
      const testRunEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { id },
      });

      if (!testRunEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      // Through the request's RLS transaction, not the pooled connection: the API's login
      // role bypasses row-level security, so a raw dataSource write would update a row the
      // policies would have refused — the visibility check above is then the only thing
      // standing between a caller and someone else's run.
      await withRequestQuery(this.dataSource).query(
        `UPDATE test_runs
         SET application_release = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [applicationRelease.trim() || null, id],
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

      this.logger.log(`Updated application release for test run ${id}`);
      const testRun = mapEntityToTestRun(updatedEntity);

      this.emitUpdateEvent(testRun, updatedEntity.systemUnderTest?.team_id);

      return testRun;
    } catch (error) {
      this.logger.error(`Failed to update application release for test run ${id}:`, error);
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
