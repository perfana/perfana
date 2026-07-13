import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { DeleteSystemUnderTestHandler } from './delete-system-under-test.handler';
import { AuditService } from '../../audit/audit.service';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';

describe('DeleteSystemUnderTestHandler', () => {
  let handler: DeleteSystemUnderTestHandler;
  let auditService: jest.Mocked<AuditService>;
  let dataSource: { query: jest.Mock; transaction: jest.Mock };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn().mockImplementation(async (fn) => {
        const mockManager = { query: jest.fn().mockResolvedValue([[], 0]) };
        await fn(mockManager);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteSystemUnderTestHandler,
        { provide: DataSource, useValue: dataSource },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(DeleteSystemUnderTestHandler);
    auditService = module.get(AuditService);
  });

  describe('execute', () => {
    it('throws ResourceNotFoundException when SUT does not exist', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(handler.execute('missing-sut')).rejects.toThrow(ResourceNotFoundException);
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it('logs DELETE before the cascade transaction begins', async () => {
      dataSource.query.mockResolvedValue([
        { id: 'sut-1', name: 'payment-service', organization_id: 'org-1', team_id: null },
      ]);

      await handler.execute('sut-1');

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      const [ref] = (auditService.logDelete as jest.Mock).mock.calls[0];
      expect(ref).toMatchObject({
        id: 'sut-1',
        name: 'payment-service',
        organization_id: 'org-1',
      });

      // log-before-mutation ordering: audit dispatched before the transaction starts
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan((dataSource.transaction as jest.Mock).mock.invocationCallOrder[0]);
    });

    // Regression: compressed TimescaleDB hypertables (segmentby = test_run_id)
    // must be deleted per-run with a constant equality predicate. A subquery
    // `test_run_id IN (SELECT …)` forces inline decompression and trips
    // timescaledb.max_tuples_decompressed_per_dml_transaction on large SUTs.
    it('deletes compressed hypertables per-run with constant equality, never a subquery', async () => {
      dataSource.query.mockResolvedValue([
        { id: 'sut-1', name: 'payment-service', organization_id: 'org-1', team_id: null },
      ]);

      const managerQueries: string[] = [];
      dataSource.transaction.mockImplementation(async (fn: (m: unknown) => Promise<void>) => {
        const mockManager = {
          query: jest.fn((sql: string) => {
            managerQueries.push(sql);
            if (/SELECT test_run_id FROM test_runs WHERE system_under_test_id/.test(sql)) {
              return Promise.resolve([{ test_run_id: 'run-a' }, { test_run_id: 'run-b' }]);
            }
            return Promise.resolve(['', 1]);
          }),
        };
        await fn(mockManager);
      });

      await handler.execute('sut-1');

      for (const table of ['ds_metrics', 'requests_raw', 'requests_error', 'transactions', 'virtual_users']) {
        // one DELETE per test_run_id, all constant-equality, none subquery-based
        const deletes = managerQueries.filter((q) => q.startsWith(`DELETE FROM ${table} WHERE`));
        expect(deletes).toEqual([
          `DELETE FROM ${table} WHERE test_run_id = $1`,
          `DELETE FROM ${table} WHERE test_run_id = $1`,
        ]);
        expect(deletes.some((q) => /IN \(SELECT/.test(q))).toBe(false);
      }
    });
  });
});
