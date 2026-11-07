import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ANALYSED_SECONDS_SQL } from '@perfana/shared/database/run-window';
import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { TestRun as TestRunEntity } from '../../../entities';
import { JobProgressService } from '../../data-science/services/job-progress.service';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';

const RUN = 'PerfanaWebshop-acc-loadTest-00004';

/**
 * Offsets that do not fit a run are a request to trim, not to discard. These two loaders do their
 * own cutoff arithmetic for the 5 s aggregates, which are not per-run, so without the rule the
 * window inverts and the card reads nothing from a run that has data.
 */
describe('TestRunsPerformanceQueryService on a run too short for its offsets', () => {
  let service: TestRunsPerformanceQueryService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn(async () => []);
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

  const row = (ramp_up: string, ramp_down: string, end_time: string | null = '2025-01-01T11:00:00.000Z') => ({
    sut: 'PerfanaWebshop',
    system_under_test_id: 'sut-1',
    env: 'acc',
    workload: 'loadTest',
    start_time: '2025-01-01T10:00:00.000Z',
    end_time,
    ramp_up,
    ramp_down,
    has_cagg: true,
    has_transactions_cagg: true,
    has_requests_raw_cagg: false,
  });

  describe.each(['loadCaggApdexScope', 'loadThroughputRunInfo'])('%s', (loader) => {
    type Scope = { cutoffTime: Date | null; endCutoffTime: Date | null };
    const load = (excludeRampUp: boolean): Promise<Scope> =>
      (service as unknown as Record<string, (...a: unknown[]) => Promise<Scope>>)[loader]!(RUN, excludeRampUp, true, []);

    it('trims both ends when the offsets fit', async () => {
      query.mockResolvedValueOnce([row('120', '60')]);
      const scope = await load(true);
      expect(scope.cutoffTime!.toISOString()).toBe('2025-01-01T10:02:00.000Z');
      expect(scope.endCutoffTime!.toISOString()).toBe('2025-01-01T10:59:00.000Z');
    });

    it.each([['2000', '2000'], ['1800', '1800'], ['120', '3500'], ['4000', '0'], ['0', '4000']])(
      'trims nothing for ramp_up=%s ramp_down=%s',
      async (up, down) => {
        query.mockResolvedValueOnce([row(up, down)]);
        const scope = await load(true);
        expect(scope.cutoffTime).toBeNull();
        expect(scope.endCutoffTime).toBeNull();
      },
    );

    it('trims nothing when the toggle is off, whatever fits', async () => {
      query.mockResolvedValueOnce([row('120', '60')]);
      const scope = await load(false);
      expect(scope.cutoffTime).toBeNull();
      expect(scope.endCutoffTime).toBeNull();
    });
  });

  it('keeps trimming the head of a run still going, which has no length to compare', async () => {
    query.mockResolvedValueOnce([row('86400', '86400', null)]);
    const scope = await (service as unknown as {
      loadCaggApdexScope: (...a: unknown[]) => Promise<{ cutoffTime: Date | null }>;
    }).loadCaggApdexScope(RUN, true, true, []);
    expect(scope.cutoffTime!.toISOString()).toBe('2025-01-02T10:00:00.000Z');
  });

  it('divides URL throughput by what the rollup rows hold', async () => {
    await service.getUrlMetricStatistics([RUN], 'throughput', true, []);
    const sql = (query.mock.calls as unknown as [string][]).map(([s]) => s).find((s) => /AS throughput/.test(s));
    expect(sql).toContain(ANALYSED_SECONDS_SQL);
  });
});
