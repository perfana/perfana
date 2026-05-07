import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { TestRunsTimeSeriesQueryService } from './test-runs-timeseries-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { TestRun as TestRunEntity } from '../../../entities';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';

type MockRepo = jest.Mocked<Pick<Repository<TestRunEntity>, 'query'>> & {
  manager: { transaction: jest.Mock };
};

function createMockRepo(): MockRepo {
  const query = jest.fn();
  const transaction = jest.fn(async (cb: (em: { query: jest.Mock }) => Promise<unknown>) =>
    cb({ query }),
  );
  return { query, manager: { transaction } };
}

describe('TestRunsTimeSeriesQueryService', () => {
  let service: TestRunsTimeSeriesQueryService;
  let repo: MockRepo;
  let authzService: jest.Mocked<AuthorizationService>;

  beforeEach(async () => {
    repo = createMockRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsTimeSeriesQueryService,
        { provide: getRepositoryToken(TestRunEntity), useValue: repo },
        {
          provide: TestRunsMapperService,
          useValue: {
            parseInt: (v: unknown) => (v == null ? 0 : Number.parseInt(String(v), 10)),
            parseFloat: (v: unknown) => (v == null ? 0 : Number.parseFloat(String(v))),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            canAccessResource: jest.fn().mockResolvedValue({ allowed: true }),
            isGlobalAdmin: jest.fn().mockReturnValue(true),
            getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();
    service = module.get(TestRunsTimeSeriesQueryService);
    authzService = module.get(AuthorizationService) as jest.Mocked<AuthorizationService>;
  });

  describe('validateAggregationSeconds', () => {
    // Use the bracket access to reach the private helper for unit testing.
    const validate = (n: number) =>
      (service as unknown as { validateAggregationSeconds: (x: number) => void })
        .validateAggregationSeconds(n);

    it.each([5, 10, 15, 30, 60, 300])('accepts %s', (n) => {
      expect(() => validate(n)).not.toThrow();
    });

    it.each([0, 1, 3, 4, 7, -5, 5.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects %s',
      (n) => {
        expect(() => validate(n)).toThrow(BadRequestException);
      },
    );
  });

  describe('buildTimeSeriesQuery', () => {
    const build = (kind: 'transaction' | 'sampler' | 'sampler-single', aggSec: number) =>
      (service as unknown as {
        buildTimeSeriesQuery: (opts: { kind: typeof kind; aggSec: number }) => string;
      }).buildTimeSeriesQuery({ kind, aggSec });

    describe('transaction kind', () => {
      const sql = () => build('transaction', 10);

      it('reads from transactions_5s', () => {
        expect(sql()).toContain('FROM transactions_5s c');
      });

      it('does NOT scan the raw transactions hypertable in the time-series body', () => {
        // The scenarios CTE intentionally hits raw to derive scenario_name; the
        // main aggregation must NOT. Strip the scenarios CTE before the assertion.
        const body = sql().replace(/scenarios AS \([\s\S]*?\),/, '');
        expect(body).not.toMatch(/FROM\s+transactions\s+(?!_5s)/);
      });

      it('extracts percentiles via approx_percentile(rollup(pct_agg))', () => {
        const q = sql();
        expect(q).toContain('approx_percentile(0.50, rollup(c.pct_agg))');
        expect(q).toContain('approx_percentile(0.90, rollup(c.pct_agg))');
        expect(q).toContain('approx_percentile(0.95, rollup(c.pct_agg))');
        expect(q).toContain('approx_percentile(0.99, rollup(c.pct_agg))');
      });

      it('uses the n-weighted average formula', () => {
        expect(sql()).toContain('sum(c.avg_rt * c.n) / NULLIF(sum(c.n), 0)');
      });

      it('filters by sut/env from test_runs and scenario_name from raw lookup', () => {
        const q = sql();
        expect(q).toContain('c.system_under_test = r.sut');
        expect(q).toContain('c.test_environment  = r.env');
        expect(q).toContain('c.scenario_name IN (SELECT scenario_name FROM scenarios)');
      });

      it('aligns ramp-up cutoff to a 5-second bucket boundary', () => {
        expect(sql()).toContain("c.bucket >= time_bucket('5 seconds', $4::timestamptz)");
      });

      it('interpolates aggregationSeconds into the time_bucket and generate_series', () => {
        expect(build('transaction', 30)).toContain("time_bucket('30 seconds'::interval, c.bucket)");
        expect(build('transaction', 30)).toContain("interval '30 seconds'");
      });
    });

    describe('sampler kind', () => {
      const sql = () => build('sampler', 10);

      it('reads from requests_raw_5s and groups by sampler_name', () => {
        const q = sql();
        expect(q).toContain('FROM requests_raw_5s c');
        expect(q).toMatch(/GROUP BY[\s\S]*sampler_name/);
        expect(q).toContain('c.sampler_name AS sampler_name');
      });
    });

    describe('sampler-single kind', () => {
      const sql = () => build('sampler-single', 10);

      it('reads from requests_raw_5s and filters by sampler_name = $3', () => {
        const q = sql();
        expect(q).toContain('FROM requests_raw_5s c');
        expect(q).toContain('AND c.sampler_name = $3');
        // No GROUP BY on sampler_name (only one sampler in the result set).
        expect(q).not.toMatch(/GROUP BY[\s\S]*sampler_name/);
      });
    });
  });

  describe('getTransactionTimeSeries', () => {
    const TEST_RUN_ID = 'tr-1';
    const TX_NAME = 'checkout';
    const USER = 'user-1';
    const ROLES = ['perfana-admin'];

    function primeOrgAccessAndRamp(mockRepo: MockRepo) {
      // 1. validateOrganizationAccess: SELECT sut.organization_id, sut.created_by ...
      mockRepo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: USER }]);
      // 2. getRampUpCutoffTime (only when excludeRampUp=true): SELECT start_time, ramp_up
      // (skipped when excludeRampUp=false)
    }

    it('rejects aggregationSeconds=1 with BadRequestException', async () => {
      primeOrgAccessAndRamp(repo);
      await expect(
        service.getTransactionTimeSeries(TEST_RUN_ID, TX_NAME, USER, ROLES, 1, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs the transaction CAGG query and the sampler CAGG query', async () => {
      primeOrgAccessAndRamp(repo);
      // 3. transaction CAGG query
      repo.query.mockResolvedValueOnce([
        {
          time_bucket: '2026-05-07T00:00:00Z',
          avg_response_time: '120.50',
          median_response_time: '110.00',
          min_response_time: '50',
          max_response_time: '500',
          p90_response_time: '200.00',
          p95_response_time: '300.00',
          p99_response_time: '450.00',
          total_count: '600',
          passed_count: '590',
          failed_count: '10',
        },
      ]);
      // 4. sampler CAGG query
      repo.query.mockResolvedValueOnce([
        {
          sampler_name: 'GET /api/foo',
          time_bucket: '2026-05-07T00:00:00Z',
          avg_response_time: '110.00',
          median_response_time: '100.00',
          min_response_time: '40',
          max_response_time: '480',
          p90_response_time: '190.00',
          p95_response_time: '290.00',
          p99_response_time: '440.00',
          total_count: '300',
          passed_count: '295',
          failed_count: '5',
        },
      ]);

      const result = await service.getTransactionTimeSeries(
        TEST_RUN_ID,
        TX_NAME,
        USER,
        ROLES,
        10,
        false,
      );

      // 3 calls: org-access query, transaction CAGG query, sampler CAGG query (no ramp-up DB lookup when excludeRampUp=false).
      expect(repo.query).toHaveBeenCalledTimes(3);

      const txCallArgs = repo.query.mock.calls[1]!;
      expect(txCallArgs[0]).toContain('FROM transactions_5s c');
      expect(txCallArgs[1]).toEqual([TEST_RUN_ID, TX_NAME, false, null]);

      const samplerCallArgs = repo.query.mock.calls[2]!;
      expect(samplerCallArgs[0]).toContain('FROM requests_raw_5s c');
      expect(samplerCallArgs[1]).toEqual([TEST_RUN_ID, TX_NAME, false, null]);

      expect(result.transaction_data).toHaveLength(1);
      expect(result.sampler_data['GET /api/foo']).toHaveLength(1);
    });

    it('passes the ramp-up cutoff timestamp when excludeRampUp=true', async () => {
      // org access
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: USER }]);
      // ramp-up lookup
      repo.query.mockResolvedValueOnce([
        { start_time: '2026-05-07T00:00:00Z', ramp_up: 60 },
      ]);
      // transaction CAGG query
      repo.query.mockResolvedValueOnce([]);
      // sampler CAGG query
      repo.query.mockResolvedValueOnce([]);

      await service.getTransactionTimeSeries(
        TEST_RUN_ID,
        TX_NAME,
        USER,
        ROLES,
        10,
        true,
      );

      const txCallArgs = repo.query.mock.calls[2]!;
      const params = txCallArgs[1] as unknown[];
      expect(params[2]).toBe(true);
      expect(params[3]).toBeInstanceOf(Date);
      expect((params[3] as Date).toISOString()).toBe('2026-05-07T00:01:00.000Z');
    });

    it('propagates ResourceNotFoundException (404) from validateOrganizationAccess without wrapping it in DatabaseException', async () => {
      // Return a row so the org-access query succeeds, but deny access via canAccessResource.
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: 'other-user' }]);
      (authzService.canAccessResource as jest.Mock).mockResolvedValueOnce({ allowed: false });

      await expect(
        service.getTransactionTimeSeries(TEST_RUN_ID, TX_NAME, USER, ROLES, 10, false),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });
});
