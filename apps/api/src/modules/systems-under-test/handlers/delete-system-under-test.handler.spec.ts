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

    // Series grouping (migration 1819). Both tables are deleted explicitly, like every other
    // table here, so the cascade logs a real count instead of leaving it to an FK.
    describe('series grouping tables', () => {
      type Stmt = { sql: string; params: unknown[] | undefined };

      /** Runs `execute` and returns every statement the transaction issued, in order. */
      const runAndCapture = async (): Promise<Stmt[]> => {
        dataSource.query.mockResolvedValue([
          { id: 'sut-1', name: 'payment-service', organization_id: 'org-1', team_id: null },
        ]);
        const statements: Stmt[] = [];
        dataSource.transaction.mockImplementation(async (fn: (m: unknown) => Promise<void>) => {
          const mockManager = {
            query: jest.fn((sql: string, params?: unknown[]) => {
              statements.push({ sql, params });
              if (/SELECT test_run_id FROM test_runs WHERE system_under_test_id/.test(sql)) {
                return Promise.resolve([{ test_run_id: 'run-a' }]);
              }
              return Promise.resolve(['', 1]);
            }),
          };
          await fn(mockManager);
        });
        await handler.execute('sut-1');
        return statements;
      };

      const indexOfSql = (statements: Stmt[], prefix: string): number =>
        statements.findIndex((s) => s.sql.startsWith(prefix));

      const MEMBERSHIP_DELETE =
        'DELETE FROM ds_metric_series_groups WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)';
      const RULES_DELETE = 'DELETE FROM series_grouping_rules WHERE system_under_test_id = $1';

      it('deletes the membership rows in phase 1, keyed on the SUT\'s runs, before any phase-2 table', async () => {
        const statements = await runAndCapture();

        const membership = statements.filter((s) => s.sql === MEMBERSHIP_DELETE);
        expect(membership).toHaveLength(1);
        expect(membership[0]!.params).toEqual(['sut-1']);

        // Phase 1 is the run-keyed loop; the first phase-2 statement is the control group stats.
        const phase2 = indexOfSql(statements, 'DELETE FROM ds_control_group_statistics');
        expect(phase2).toBeGreaterThan(-1);
        expect(indexOfSql(statements, MEMBERSHIP_DELETE)).toBeLessThan(phase2);
        // ...and it sits with the other run-keyed statistics tables, not after the runs go.
        expect(indexOfSql(statements, MEMBERSHIP_DELETE)).toBeLessThan(
          indexOfSql(statements, 'DELETE FROM test_runs WHERE system_under_test_id'),
        );
      });

      it('deletes the rules explicitly, after the membership rows and before application_dashboards', async () => {
        const statements = await runAndCapture();

        const rules = statements.filter((s) => s.sql === RULES_DELETE);
        expect(rules).toHaveLength(1);
        expect(rules[0]!.params).toEqual(['sut-1']);

        const rulesAt = indexOfSql(statements, RULES_DELETE);
        // rule_id is ON DELETE SET NULL, so either order is SAFE; this one avoids rewriting
        // membership rows that are about to be deleted anyway.
        expect(indexOfSql(statements, MEMBERSHIP_DELETE)).toBeLessThan(rulesAt);
        // series_grouping_rules.application_dashboard_id is ON DELETE CASCADE, so deleting the
        // dashboards first would remove the rules silently and this statement would count 0.
        expect(rulesAt).toBeLessThan(indexOfSql(statements, 'DELETE FROM application_dashboards WHERE system_under_test_id'));
        expect(rulesAt).toBeLessThan(indexOfSql(statements, 'DELETE FROM systems_under_test WHERE id'));
      });

      it('never touches ds_metrics for this feature', async () => {
        const statements = await runAndCapture();
        // ds_metrics is read-only for series grouping; the only deletes on it are the
        // pre-existing per-run, test_run_id-only ones.
        const dsMetricsDeletes = statements.filter((s) => /FROM ds_metrics\b/.test(s.sql));
        expect(dsMetricsDeletes.map((s) => s.sql)).toEqual(['DELETE FROM ds_metrics WHERE test_run_id = $1']);
      });
    });
  });

  describe('getDeletePreview', () => {
    it('counts the series grouping rules and the membership rows of the SUT\'s runs', async () => {
      const seen: string[] = [];
      dataSource.query.mockImplementation((sql: string) => {
        seen.push(sql);
        if (/FROM systems_under_test WHERE id/.test(sql)) return Promise.resolve([{ id: 'sut-1', name: 'webshop' }]);
        if (/FROM series_grouping_rules/.test(sql)) return Promise.resolve([{ count: '3' }]);
        if (/FROM ds_metric_series_groups/.test(sql)) return Promise.resolve([{ count: '412' }]);
        return Promise.resolve([{ count: '0' }]);
      });

      const preview = await handler.getDeletePreview('sut-1');

      expect(preview.counts.seriesGroupingRules).toBe(3);
      expect(preview.counts.seriesGroups).toBe(412);

      const rulesSql = seen.find((q) => /FROM series_grouping_rules/.test(q))!;
      expect(rulesSql).toContain('WHERE system_under_test_id = $1');
      // Same scoping as the delete: the SUT's runs, through test_runs.test_run_id.
      const groupsSql = seen.find((q) => /FROM ds_metric_series_groups/.test(q))!;
      expect(groupsSql).toContain('test_run_id IN (SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)');
    });

    it('reports zero for both when the system has none', async () => {
      dataSource.query.mockImplementation((sql: string) =>
        Promise.resolve(
          /FROM systems_under_test WHERE id/.test(sql) ? [{ id: 'sut-1', name: 'webshop' }] : [{ count: '0' }],
        ),
      );

      const preview = await handler.getDeletePreview('sut-1');

      expect(preview.counts.seriesGroupingRules).toBe(0);
      expect(preview.counts.seriesGroups).toBe(0);
    });
  });
});
