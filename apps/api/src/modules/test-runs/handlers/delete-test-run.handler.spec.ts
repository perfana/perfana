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

/**
 * Series grouping (migration 1819): `ds_metric_series_groups` is keyed on the canonical
 * `test_run_id` string and has no foreign key to `test_runs`, so nothing cascades from the run
 * to its membership rows. Without an explicit delete they outlive the run — and the
 * run-keyed primary key would hand a stale mapping to any later run that reuses the key.
 */
describe('DeleteTestRunHandler series grouping cleanup', () => {
  const testRun = {
    id: 'uuid-1',
    testRunId: 'run-1',
    organizationId: 'org-1',
    systemUnderTest: { team_id: 'team-1' },
    startTime: null,
  };

  type Stmt = { sql: string; params: unknown[] | undefined };

  async function runAndCapture(): Promise<Stmt[]> {
    const statements: Stmt[] = [];
    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) =>
        cb({
          query: jest.fn((sql: string, params?: unknown[]) => {
            statements.push({ sql, params });
            return Promise.resolve([]);
          }),
        }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeleteTestRunHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: { findOne: jest.fn().mockResolvedValue(testRun) } },
        { provide: DataSource, useValue: dataSource },
        { provide: TestRunsGateway, useValue: { emitTestRunDeleted: jest.fn() } },
        { provide: AuditService, useValue: { logDelete: jest.fn() } },
      ],
    }).compile();
    await moduleRef.get(DeleteTestRunHandler).execute(DeleteTestRunCommand.fromId('uuid-1'));
    return statements;
  }

  const indexOfSql = (statements: Stmt[], sql: string): number =>
    statements.findIndex((s) => s.sql === sql);

  it('deletes the run\'s membership rows by its canonical test_run_id string', async () => {
    const statements = await runAndCapture();

    const matches = statements.filter((s) => s.sql === 'DELETE FROM ds_metric_series_groups WHERE test_run_id = $1');
    expect(matches).toHaveLength(1);
    // The varchar run key, never the entity uuid ('uuid-1').
    expect(matches[0]!.params).toEqual(['run-1']);
  });

  it('deletes them before the run row itself, with the other statistics tables', async () => {
    const statements = await runAndCapture();

    const groups = indexOfSql(statements, 'DELETE FROM ds_metric_series_groups WHERE test_run_id = $1');
    expect(groups).toBeGreaterThan(-1);
    expect(groups).toBeLessThan(indexOfSql(statements, 'DELETE FROM test_runs WHERE id = $1'));
    // Beside ds_metric_statistics, which is written in the same StatisticsPipeline transaction.
    expect(indexOfSql(statements, 'DELETE FROM ds_metric_statistics WHERE test_run_id = $1')).toBeGreaterThan(-1);
  });
});
