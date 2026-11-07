import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { TestRun as TestRunEntity } from '../../../entities';
import { JobProgressService } from '../../data-science/services/job-progress.service';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';

const RUN = 'PerfanaWebshop-acc-loadTest-00004';
const ORG = 'b6a1f6f0-0000-4000-8000-000000000001';

const overall = (p95: string | null, p99: string | null) =>
  ({ scenario_name: null, is_overall: 1, p95_response_time: p95, p99_response_time: p99 });
const scenario = (name: string | null, p95: string | null, p99: string | null) =>
  ({ scenario_name: name, is_overall: 0, p95_response_time: p95, p99_response_time: p99 });

const PENDING = { status: 'rollup-pending', stage: 'transaction-stats-rollup' };
const SCOPE = {
  sut: 'PerfanaWebshop',
  systemUnderTestId: 'sut-1',
  env: 'acc',
  workload: 'loadTest',
  startTime: new Date('2025-01-01T10:00:00.000Z'),
  endTime: new Date('2025-01-01T11:00:00.000Z'),
  cutoffTime: new Date('2025-01-01T10:02:00.000Z'),
  endCutoffTime: new Date('2025-01-01T10:59:00.000Z'),
  hasTransactionsCagg: true,
  hasRequestsRawCagg: false,
};
const RUN_WINDOW_ROW = [{
  start_time: '2025-01-01T10:00:00.000Z',
  ramp_up: '120',
  end_time: '2025-01-01T11:00:00.000Z',
  ramp_down: '60',
}];

describe('TestRunsPerformanceQueryService.getTransactionPercentiles', () => {
  let service: TestRunsPerformanceQueryService;
  let query: jest.Mock;
  let dataRows: unknown[];

  /** The statement that reads the figures, and the parameters it was bound with. */
  const percentileRead = () => {
    const call = (query.mock.calls as [string, unknown[]][]).find(([sql]) => sql.includes('GROUPING SETS'));
    expect(call).toBeDefined();
    return { sql: call![0], params: call![1] };
  };

  const useSource = (rollup: unknown, cagg: unknown = null) => {
    jest.spyOn(service as never, 'getRollupStatus').mockResolvedValue(rollup as never);
    jest.spyOn(service as never, 'loadCaggApdexScope').mockResolvedValue(cagg as never);
  };

  beforeEach(async () => {
    dataRows = [];
    query = jest.fn(async (sql: unknown) => {
      if (typeof sql !== 'string') return [];
      if (sql.includes('GROUPING SETS')) return dataRows;
      if (/SELECT start_time, ramp_up, end_time, ramp_down FROM test_runs/.test(sql)) return RUN_WINDOW_ROW;
      return [];
    });
    const repo = { query, manager: { transaction: (cb: (em: unknown) => unknown) => cb({ query }) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsPerformanceQueryService,
        TestRunsMapperService,
        { provide: getRepositoryToken(TestRunEntity), useValue: repo },
        { provide: JobProgressService, useValue: { getActiveJobForScope: jest.fn().mockResolvedValue(null) } },
        { provide: BullMQClientService, useValue: { enqueue: jest.fn() } },
      ],
    }).compile();
    service = module.get(TestRunsPerformanceQueryService);
  });

  describe('the answer', () => {
    beforeEach(() => useSource({ status: 'ready' }));

    it('tells the whole-scope row apart from a scenario with no name', async () => {
      dataRows = [
        scenario('Checkout', '990.83', '1190.60'),
        scenario(null, '12.50', '20.00'),
        overall('844.19', '1122.87'),
      ];

      await expect(service.getTransactionPercentiles(RUN, true, true, [])).resolves.toEqual({
        overall: { p95_response_time: 844.19, p99_response_time: 1122.87 },
        by_scenario: [
          { scenario_name: 'Checkout', p95_response_time: 990.83, p99_response_time: 1190.6 },
          { scenario_name: null, p95_response_time: 12.5, p99_response_time: 20 },
        ],
      });
    });

    it('reports a scope with no executions as no figure, not as 0 ms', async () => {
      dataRows = [overall(null, null)];
      await expect(service.getTransactionPercentiles(RUN, true, true, [])).resolves.toEqual({
        overall: null,
        by_scenario: [],
      });
    });

    it('drops a scenario whose digests are all NULL', async () => {
      dataRows = [scenario('Checkout', null, null), scenario('Browse', '5', '6'), overall('5', '6')];
      const result = await service.getTransactionPercentiles(RUN, true, true, []);
      expect(result).toMatchObject({ by_scenario: [{ scenario_name: 'Browse' }] });
    });

    it('asks nothing for a caller with no organizations', async () => {
      await expect(service.getTransactionPercentiles(RUN, true, false, [])).resolves.toEqual({
        overall: null,
        by_scenario: [],
      });
      expect(query).not.toHaveBeenCalled();
    });

    it('wraps a database failure', async () => {
      query.mockRejectedValueOnce(new Error('boom'));
      await expect(service.getTransactionPercentiles(RUN, true, true, [])).rejects.toThrow(
        'Failed to retrieve transaction percentiles',
      );
    });
  });

  describe('the store it reads', () => {
    it('merges the rollup digests of the requested window', async () => {
      useSource({ status: 'ready' });
      await service.getTransactionPercentiles(RUN, true, true, []);

      const { sql, params } = percentileRead();
      expect(sql).toContain('FROM test_run_transaction_stats trs');
      expect(sql).toContain('rollup(trs.pct_agg)');
      expect(sql).toContain('trs.ramp_up_excluded = $2');
      expect(sql).toContain('trs.total_count > 0');
      expect(sql).not.toContain('organization_id');
      expect(params).toEqual([RUN, true]);
    });

    it('filters the rollup on the caller\'s organizations', async () => {
      useSource({ status: 'ready' });
      await service.getTransactionPercentiles(RUN, false, false, [ORG]);

      const { sql, params } = percentileRead();
      expect(sql).toContain('sut.organization_id = ANY($3::uuid[])');
      expect(params).toEqual([RUN, false, [ORG]]);
    });

    it('narrows to the named scenarios, keeping the no-scenario rows reachable', async () => {
      useSource({ status: 'ready' });
      await service.getTransactionPercentiles(RUN, true, false, [ORG], undefined, ['Checkout', '']);

      const { sql, params } = percentileRead();
      expect(sql).toContain(`COALESCE(trs.scenario_name, '') = ANY($4::text[])`);
      expect(params).toEqual([RUN, true, [ORG], ['Checkout', '']]);
    });

    it('does not filter on scenario when none are named', async () => {
      useSource({ status: 'ready' });
      await service.getTransactionPercentiles(RUN, true, true, [], undefined, []);
      expect(percentileRead().sql).not.toContain('= ANY(');
    });

    it('reads the 5 s aggregate when there is no rollup, up to the end cutoff', async () => {
      useSource({ status: 'unavailable' }, SCOPE);
      await service.getTransactionPercentiles(RUN, true, true, [], undefined, ['Checkout']);

      const { sql, params } = percentileRead();
      expect(sql).toContain('FROM transactions_5s c');
      expect(sql).toContain('rollup(c.pct_agg)');
      expect(sql).toContain(`COALESCE(c.scenario_name, '') = ANY($7::text[])`);
      expect(params).toEqual([
        SCOPE.sut, SCOPE.env, SCOPE.startTime, SCOPE.endCutoffTime, true, SCOPE.cutoffTime, ['Checkout'],
      ]);
    });

    it('serves live numbers from the aggregate rather than the 202 while the rollup is pending', async () => {
      useSource(PENDING, SCOPE);
      dataRows = [overall('1', '2')];
      await expect(service.getTransactionPercentiles(RUN, true, true, [])).resolves.toMatchObject({
        overall: { p95_response_time: 1 },
      });
    });

    it('never reads the rollup for a live window, which it cannot answer', async () => {
      const status = jest.spyOn(service as never, 'getRollupStatus');
      jest.spyOn(service as never, 'loadCaggApdexScope').mockResolvedValue(SCOPE as never);
      jest.spyOn(Date, 'now').mockReturnValue(SCOPE.endTime.getTime());

      await service.getTransactionPercentiles(RUN, true, true, [], 5);

      expect(status).not.toHaveBeenCalled();
      const { sql, params } = percentileRead();
      expect(sql).toContain('FROM transactions_5s c');
      expect(params[2]).toEqual(new Date('2025-01-01T10:55:00.000Z'));
      jest.restoreAllMocks();
    });

    it('passes the pending marker through when nothing can answer yet', async () => {
      useSource(PENDING);
      await expect(service.getTransactionPercentiles(RUN, true, true, [])).resolves.toEqual(PENDING);
      expect(query).not.toHaveBeenCalled();
    });

    it('falls back to a bounded raw read, every placeholder lining up with its parameter', async () => {
      useSource({ status: 'unavailable' });
      await service.getTransactionPercentiles(RUN, true, false, [ORG], 5, ['Checkout']);

      const { sql, params } = percentileRead();
      expect(sql).toContain('FROM transactions t');
      expect(sql).toContain('percentile_agg(t.response_time::double precision)');
      expect(sql).toContain('t.time >= $2');
      expect(sql).toContain(`NOW() - ($4::numeric * interval '1 minute')`);
      expect(sql).toContain('sut.organization_id = ANY($5::uuid[])');
      expect(sql).toContain(`COALESCE(t.scenario_name, '') = ANY($6::text[])`);
      expect(params).toEqual([
        RUN,
        new Date('2025-01-01T10:02:00.000Z'),
        new Date('2025-01-01T10:59:00.000Z'),
        5,
        [ORG],
        ['Checkout'],
      ]);
    });

    it('caps a live window at the same limit as the per-transaction read', async () => {
      useSource({ status: 'unavailable' });
      await service.getTransactionPercentiles(RUN, true, true, [], 100_000);
      expect(percentileRead().params[3]).toBe(60);
    });
  });
});
