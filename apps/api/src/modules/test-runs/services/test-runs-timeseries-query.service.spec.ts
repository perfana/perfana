import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { TestRunsTimeSeriesQueryService } from './test-runs-timeseries-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { TestRun as TestRunEntity } from '../../../entities';

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
});
