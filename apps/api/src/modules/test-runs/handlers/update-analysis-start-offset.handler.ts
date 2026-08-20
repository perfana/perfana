/**
 * Handler for updating test run analysis start offset value.
 *
 * Allows users to adjust the analysis start offset (in seconds) for a test run.
 * This is the initial period excluded from statistical analysis.
 * This is useful when the configured analysis start offset exceeds the actual test duration,
 * causing all data points to be excluded from statistical analysis.
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

export interface UpdateAnalysisStartOffsetData {
  id: string;
  analysisStartOffset: number;
}

@Injectable()
export class UpdateAnalysisStartOffsetHandler {
  private readonly logger = new Logger(UpdateAnalysisStartOffsetHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  async execute(data: UpdateAnalysisStartOffsetData): Promise<TestRun> {
    const { id, analysisStartOffset } = data;

    try {
      // Fetch the pre-mutation row in full for the audit diff.
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
         SET ramp_up = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [analysisStartOffset, id],
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

      this.logger.log(`Updated analysis start offset to ${analysisStartOffset}s for test run ${id}`);
      const testRun = mapEntityToTestRun(updatedEntity);

      this.emitUpdateEvent(testRun, updatedEntity.systemUnderTest?.team_id);

      return testRun;
    } catch (error) {
      this.logger.error(`Failed to update analysis start offset for test run ${id}:`, error);
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
