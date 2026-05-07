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
});
