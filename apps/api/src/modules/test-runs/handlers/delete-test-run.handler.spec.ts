import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DeleteTestRunHandler } from './delete-test-run.handler';
import { DeleteTestRunCommand } from '../commands/delete-test-run.command';
import { TestRun as TestRunEntity } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';

/**
 * Regression guard: bulk deletes run in the BullMQ worker with no HTTP request
 * CLS context, so the audit row is only written if the handler forwards the
 * queuing user's id from CommandContext as an actorOverride. Without it the
 * delete goes unaudited (AuditService.dispatch skips outside a request context).
 */
describe('DeleteTestRunHandler audit actor', () => {
  const testRun = {
    id: 'uuid-1',
    testRunId: 'run-1',
    organizationId: 'org-1',
    systemUnderTest: { team_id: 'team-1' },
    startTime: null,
  };

  async function build() {
    const auditService = { logDelete: jest.fn() };
    const dataSource = {
      // deleteDependentData runs inside transaction(); no-op it.
      transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) =>
        cb({ query: jest.fn().mockResolvedValue([]) }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeleteTestRunHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: { findOne: jest.fn().mockResolvedValue(testRun) } },
        { provide: DataSource, useValue: dataSource },
        { provide: TestRunsGateway, useValue: { emitTestRunDeleted: jest.fn() } },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    return { handler: moduleRef.get(DeleteTestRunHandler), auditService };
  }

  it('forwards context.userId as actorOverride (worker path)', async () => {
    const { handler, auditService } = await build();
    await handler.execute(DeleteTestRunCommand.fromId('uuid-1'), {
      userId: 'user-9',
      timestamp: new Date(),
    });
    expect(auditService.logDelete).toHaveBeenCalledTimes(1);
    const opts = auditService.logDelete.mock.calls[0][1];
    expect(opts.actorOverride).toEqual({ userId: 'user-9' });
    expect(opts.organizationIdOverride).toBe('org-1');
  });

  it('omits actorOverride without a context (in-request path falls back to CLS)', async () => {
    const { handler, auditService } = await build();
    await handler.execute(DeleteTestRunCommand.fromId('uuid-1'));
    expect(auditService.logDelete).toHaveBeenCalledTimes(1);
    expect(auditService.logDelete.mock.calls[0][1].actorOverride).toBeUndefined();
  });
});
