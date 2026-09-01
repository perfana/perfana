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

  describe('resolveAggregationSeconds', () => {
    const resolve = (durationSeconds: number | null) => {
      repo.query.mockReset();
      repo.query.mockResolvedValue([{ seconds: durationSeconds }]);
      return (service as unknown as {
        resolveAggregationSeconds: (id: string) => Promise<number>;
      }).resolveAggregationSeconds('run-1');
    };

    // Target is ~360 points/series; ladder [5,10,15,20,30,60,120,180,300].
    it.each([
      [360, 5],      // 6 min  -> 72 pts
      [1800, 5],     // 30 min -> 360 pts
      [1801, 10],    // just over -> next rung up
      [3600, 10],    // 1 h    -> 360 pts
      [3601, 15],    // just past 1 h -> 15, not a 3x drop to 30
      [10800, 30],   // 3 h    -> 360 pts, the reported case
      [21601, 120],  // just past 6 h -> 120, not a 5x drop to 300
      [43200, 120],  // 12 h   -> 360 pts
      [64800, 180],  // 18 h   -> 360 pts
    ])('picks %ss duration -> %ss buckets', async (duration, expected) => {
      await expect(resolve(duration)).resolves.toBe(expected);
    });

    it('caps at the coarsest rung rather than returning undefined', async () => {
      await expect(resolve(60 * 60 * 24 * 30)).resolves.toBe(300);
    });

    it.each([[null], [0], [-1]])(
      'falls back to the 5s floor when duration is unusable (%s)',
      async (duration) => {
        await expect(resolve(duration)).resolves.toBe(5);
      },
    );

    it('only returns values validateAggregationSeconds accepts', async () => {
      const validate = (n: number) =>
        (service as unknown as { validateAggregationSeconds: (x: number) => void })
          .validateAggregationSeconds(n);
      for (const duration of [60, 600, 3600, 10800, 86400]) {
        const picked = await resolve(duration);
        expect(() => validate(picked)).not.toThrow();
      }
    });

    it('reaches the 60s rung for a 6 h run', async () => {
      await expect(resolve(6 * 3600)).resolves.toBe(60);
      await expect(resolve(10801)).resolves.toBe(60); // just past the 30s rung
      await expect(resolve(21600)).resolves.toBe(60); // exactly 360 x 60
    });

    it('never drops resolution by more than 2x between adjacent rungs', async () => {
      // Regression: the ladder was [5,10,30,60,300], so a run one second past
      // 6 h fell from 360 points to 72 — one extra second cost 80% of the
      // chart's detail. Every step must stay within 2x.
      const ladder = (
        service.constructor as unknown as { AGGREGATION_LADDER: number[] }
      ).AGGREGATION_LADDER;
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i]! / ladder[i - 1]!).toBeLessThanOrEqual(2);
      }
    });

    it('falls back to the floor when the run row is missing', async () => {
      // `result?.[0]?.seconds` on an empty set: a deleted or unknown run must
      // not blow up mid-chart.
      repo.query.mockReset();
      repo.query.mockResolvedValue([]);
      await expect(
        (
          service as unknown as {
            resolveAggregationSeconds: (id: string) => Promise<number>;
          }
        ).resolveAggregationSeconds('run-1'),
      ).resolves.toBe(5);
    });

    it('handles the numeric-as-string EXTRACT result the pg driver returns', async () => {
      // node-postgres hands back `numeric` as a string, not a number — the real
      // shape of this query's result, which the numeric cases above do not have.
      repo.query.mockReset();
      repo.query.mockResolvedValue([{ seconds: '10800.000000' }]);
      await expect(
        (
          service as unknown as {
            resolveAggregationSeconds: (id: string) => Promise<number>;
          }
        ).resolveAggregationSeconds('run-1'),
      ).resolves.toBe(30);
    });
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

      it('still pads against the generate_series grid', () => {
        // Single series: an idle bucket must plot as a real zero on throughput.
        expect(sql()).toContain('FROM time_series ts');
        expect(sql()).toContain('LEFT JOIN agg a ON a.time_bucket = ts.time_bucket');
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

      it('groups by the time_bucket expression and sampler_name (not by positional ordinal)', () => {
        // Regression: a `GROUP BY 1, c.sampler_name` here resolves position 1
        // to sampler_name (the first SELECT column), leaving the time_bucket
        // ungrouped → Postgres "must appear in the GROUP BY clause" error.
        expect(sql()).toContain(
          "GROUP BY time_bucket('10 seconds'::interval, c.bucket), c.sampler_name",
        );
      });

      it('does not pad against the generate_series grid', () => {
        // Regression: padding buckets x samplers turned a 3 h / 19-sampler run
        // into 41 420 rows (560 with data) and an 11.8 MB response. The stacked
        // area fills its own gaps client-side, so the grid must stay out of here.
        const q = sql();
        expect(q).toContain('FROM agg');
        expect(q).not.toContain('FROM time_series ts');
        expect(q).not.toContain('LEFT JOIN agg');
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

    it('resolves the bucket from the run duration when aggregationSeconds is omitted', async () => {
      primeOrgAccessAndRamp(repo);
      // duration lookup: 3 h -> 30 s buckets
      repo.query.mockResolvedValueOnce([{ seconds: 10800 }]);
      repo.query.mockResolvedValueOnce([]); // transaction CAGG
      repo.query.mockResolvedValueOnce([]); // sampler CAGG

      const result = await service.getTransactionTimeSeries(
        TEST_RUN_ID,
        TX_NAME,
        USER,
        ROLES,
        undefined,
        false,
      );

      // 4 calls now: org access, duration lookup, transaction CAGG, sampler CAGG.
      expect(repo.query).toHaveBeenCalledTimes(4);
      expect(repo.query.mock.calls[1]![0]).toContain(
        'EXTRACT(EPOCH FROM (end_time - start_time))',
      );
      // The resolved bucket reaches both CAGG queries, not the 5 s floor.
      expect(repo.query.mock.calls[2]![0]).toContain("time_bucket('30 seconds'::interval");
      expect(repo.query.mock.calls[3]![0]).toContain("time_bucket('30 seconds'::interval");
      // Echoed back: the client divides counts by it for throughput.
      expect(result.aggregation_seconds).toBe(30);
    });

    it('does not probe the run duration when the caller supplied a bucket', async () => {
      primeOrgAccessAndRamp(repo);
      repo.query.mockResolvedValueOnce([]); // transaction CAGG
      repo.query.mockResolvedValueOnce([]); // sampler CAGG

      const result = await service.getTransactionTimeSeries(
        TEST_RUN_ID,
        TX_NAME,
        USER,
        ROLES,
        10,
        false,
      );

      expect(repo.query).toHaveBeenCalledTimes(3);
      expect(
        repo.query.mock.calls.some((c) => String(c[0]).includes('EXTRACT(EPOCH FROM')),
      ).toBe(false);
      expect(result.aggregation_seconds).toBe(10);
    });

    it('refuses before probing the duration of a run the caller cannot see', async () => {
      // The resolve query must run after validateOrganizationAccess, or an
      // unauthorized caller can time/probe run durations.
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: 'other-user' }]);
      (authzService.canAccessResource as jest.Mock).mockResolvedValueOnce({ allowed: false });

      await expect(
        service.getTransactionTimeSeries(TEST_RUN_ID, TX_NAME, USER, ROLES, undefined, false),
      ).rejects.toThrow(ResourceNotFoundException);

      expect(repo.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSamplerTimeSeries', () => {
    const TEST_RUN_ID = 'tr-1';
    const TX_NAME = 'checkout';
    const SAMPLER = 'GET /api/foo';
    const USER = 'user-1';
    const ROLES = ['perfana-admin'];

    it('rejects aggregationSeconds=4 with BadRequestException', async () => {
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: USER }]);
      await expect(
        service.getSamplerTimeSeries(TEST_RUN_ID, TX_NAME, SAMPLER, USER, ROLES, 4, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs the sampler-single CAGG query with sampler_name as $3', async () => {
      // org access
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: USER }]);
      // sampler-single CAGG query
      repo.query.mockResolvedValueOnce([
        {
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

      const result = await service.getSamplerTimeSeries(
        TEST_RUN_ID,
        TX_NAME,
        SAMPLER,
        USER,
        ROLES,
        10,
        false,
      );

      expect(repo.query).toHaveBeenCalledTimes(2);
      const callArgs = repo.query.mock.calls[1]!;
      expect(callArgs[0]).toContain('FROM requests_raw_5s c');
      expect(callArgs[0]).toContain('AND c.sampler_name = $3');
      expect(callArgs[1]).toEqual([TEST_RUN_ID, TX_NAME, SAMPLER, false, null]);
      expect(result).toHaveLength(1);
    });

    it('propagates ResourceNotFoundException (404) from validateOrganizationAccess without wrapping it in DatabaseException', async () => {
      // Return a row so the org-access query succeeds, but deny access via canAccessResource.
      repo.query.mockResolvedValueOnce([{ organization_id: 'org-1', created_by: 'other-user' }]);
      (authzService.canAccessResource as jest.Mock).mockResolvedValueOnce({ allowed: false });

      await expect(
        service.getSamplerTimeSeries(TEST_RUN_ID, TX_NAME, SAMPLER, USER, ROLES, 10, false),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });
});
