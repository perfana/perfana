import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TestRunsChangepointService } from './test-runs-changepoint.service';
import { TestRun as TestRunEntity, DsChangePoints } from '../../../entities';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';
import { createMockRepository, MockRepository } from '../../../../test/helpers/mock-repository.factory';
import { DatabaseException } from '../../../common/exceptions/business.exception';

// withRequestEm passes through to the same repo in tests
jest.mock('../../../common/db/request-em', () => ({
  withRequestEm: (repo: unknown) => repo,
}));

describe('TestRunsChangepointService — running-test exclusion', () => {
  let service: TestRunsChangepointService;
  let testRunRepo: MockRepository<TestRunEntity>;
  let changePointsRepo: MockRepository<DsChangePoints>;
  let bullmqClientService: jest.Mocked<BullMQClientService>;
  let mockDataSource: { query: jest.Mock };

  const SUT_ID = 'sut-1';
  const ENV = 'production';
  const WORKLOAD = 'load-test';

  const makeTestRun = (overrides: Partial<TestRunEntity>): TestRunEntity =>
    ({
      testRunId: 'tr-1',
      systemUnderTestId: SUT_ID,
      testEnvironment: ENV,
      workload: WORKLOAD,
      completed: false,
      abort: false,
      createdAt: new Date('2024-01-15T10:00:00Z'),
      startTime: new Date('2024-01-15T10:00:00Z'),
      ...overrides,
    } as unknown as TestRunEntity);

  beforeEach(async () => {
    testRunRepo = createMockRepository<TestRunEntity>();
    changePointsRepo = createMockRepository<DsChangePoints>();
    bullmqClientService = { reevaluateBatch: jest.fn().mockResolvedValue({ jobId: 'job-1' }) } as unknown as jest.Mocked<BullMQClientService>;
    mockDataSource = { query: jest.fn().mockResolvedValue([[], 0]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsChangepointService,
        { provide: getRepositoryToken(TestRunEntity), useValue: testRunRepo },
        { provide: getRepositoryToken(DsChangePoints), useValue: changePointsRepo },
        { provide: BullMQClientService, useValue: bullmqClientService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<TestRunsChangepointService>(TestRunsChangepointService);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTestRunsAfterChangepoint
  // ─────────────────────────────────────────────────────────────────────────────
  describe('getTestRunsAfterChangepoint', () => {
    it('returns [] when changepoint test run is not found', async () => {
      testRunRepo.findOne.mockResolvedValue(null);
      const result = await service.getTestRunsAfterChangepoint(SUT_ID, ENV, WORKLOAD, 'missing-id');
      expect(result).toEqual([]);
    });

    it('returns only completed test runs created after the changepoint', async () => {
      const changepointRun = makeTestRun({ testRunId: 'cp-1', createdAt: new Date('2024-01-10T00:00:00Z') });
      const completedAfter = makeTestRun({ testRunId: 'tr-after', completed: true, createdAt: new Date('2024-01-15T00:00:00Z') });
      const completedBefore = makeTestRun({ testRunId: 'tr-before', completed: true, createdAt: new Date('2024-01-05T00:00:00Z') });

      testRunRepo.findOne.mockResolvedValue(changepointRun);
      testRunRepo.find.mockResolvedValue([completedBefore, completedAfter]);

      const result = await service.getTestRunsAfterChangepoint(SUT_ID, ENV, WORKLOAD, 'cp-1');
      expect(result).toEqual(['tr-after']);
    });

    it('includes aborted test runs (abort=true) after the changepoint', async () => {
      const changepointRun = makeTestRun({ testRunId: 'cp-1', createdAt: new Date('2024-01-10T00:00:00Z') });
      const abortedAfter = makeTestRun({ testRunId: 'tr-aborted', abort: true, createdAt: new Date('2024-01-15T00:00:00Z') });

      testRunRepo.findOne.mockResolvedValue(changepointRun);
      testRunRepo.find.mockResolvedValue([abortedAfter]);

      const result = await service.getTestRunsAfterChangepoint(SUT_ID, ENV, WORKLOAD, 'cp-1');
      expect(result).toEqual(['tr-aborted']);
    });

    it('queries with completed=true AND abort=true conditions (OR) to exclude running tests', async () => {
      const changepointRun = makeTestRun({ testRunId: 'cp-1', createdAt: new Date('2024-01-10T00:00:00Z') });
      testRunRepo.findOne.mockResolvedValue(changepointRun);
      testRunRepo.find.mockResolvedValue([]);

      await service.getTestRunsAfterChangepoint(SUT_ID, ENV, WORKLOAD, 'cp-1');

      expect(testRunRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            expect.objectContaining({ completed: true }),
            expect.objectContaining({ abort: true }),
          ],
        }),
      );
    });

    it('returns [] on unexpected error', async () => {
      testRunRepo.findOne.mockRejectedValue(new Error('DB error'));
      const result = await service.getTestRunsAfterChangepoint(SUT_ID, ENV, WORKLOAD, 'cp-1');
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTestRunsMoreRecentThan
  // ─────────────────────────────────────────────────────────────────────────────
  describe('getTestRunsMoreRecentThan', () => {
    it('returns empty testRunIds when base test run is not found', async () => {
      testRunRepo.findOne.mockResolvedValue(null);
      const result = await service.getTestRunsMoreRecentThan(SUT_ID, ENV, WORKLOAD, 'missing');
      expect(result).toEqual({ testRunIds: [] });
    });

    it('returns only completed/aborted test runs created after the base run', async () => {
      const base = makeTestRun({ testRunId: 'base', createdAt: new Date('2024-01-10T00:00:00Z') });
      const completedAfter = makeTestRun({ testRunId: 'tr-after', completed: true, createdAt: new Date('2024-01-15T00:00:00Z') });
      const abortedAfter = makeTestRun({ testRunId: 'tr-aborted', abort: true, createdAt: new Date('2024-01-16T00:00:00Z') });
      const completedBefore = makeTestRun({ testRunId: 'tr-before', completed: true, createdAt: new Date('2024-01-05T00:00:00Z') });

      testRunRepo.findOne.mockResolvedValue(base);
      testRunRepo.find.mockResolvedValue([completedBefore, completedAfter, abortedAfter]);

      const result = await service.getTestRunsMoreRecentThan(SUT_ID, ENV, WORKLOAD, 'base');
      expect(result.testRunIds).toEqual(['tr-after', 'tr-aborted']);
    });

    it('queries with OR filter to exclude running tests (completed=false, abort=false)', async () => {
      const base = makeTestRun({ testRunId: 'base', createdAt: new Date('2024-01-10T00:00:00Z') });
      testRunRepo.findOne.mockResolvedValue(base);
      testRunRepo.find.mockResolvedValue([]);

      await service.getTestRunsMoreRecentThan(SUT_ID, ENV, WORKLOAD, 'base');

      expect(testRunRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            expect.objectContaining({ completed: true }),
            expect.objectContaining({ abort: true }),
          ],
        }),
      );
    });

    it('throws DatabaseException on error', async () => {
      testRunRepo.findOne.mockRejectedValue(new Error('DB error'));
      await expect(service.getTestRunsMoreRecentThan(SUT_ID, ENV, WORKLOAD, 'base')).rejects.toBeInstanceOf(DatabaseException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTestRunsAfterMostRecentChangepoint — no-changepoint fallback
  // ─────────────────────────────────────────────────────────────────────────────
  describe('getTestRunsAfterMostRecentChangepoint', () => {
    it('queries with OR filter when no changepoint exists (excludes running tests)', async () => {
      changePointsRepo.findOne.mockResolvedValue(null);
      testRunRepo.find.mockResolvedValue([]);

      await service.getTestRunsAfterMostRecentChangepoint(SUT_ID, ENV, WORKLOAD);

      expect(testRunRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            expect.objectContaining({ completed: true }),
            expect.objectContaining({ abort: true }),
          ],
        }),
      );
    });

    it('returns all finished test runs when no changepoint exists', async () => {
      const finished1 = makeTestRun({ testRunId: 'tr-1', completed: true });
      const finished2 = makeTestRun({ testRunId: 'tr-2', abort: true });

      changePointsRepo.findOne.mockResolvedValue(null);
      testRunRepo.find.mockResolvedValue([finished1, finished2]);

      const result = await service.getTestRunsAfterMostRecentChangepoint(SUT_ID, ENV, WORKLOAD);
      expect(result.testRunIds).toEqual(['tr-1', 'tr-2']);
      expect(result.changepointTestRunId).toBeUndefined();
    });

    it('returns changepointTestRunId and delegates to getTestRunsAfterChangepoint when changepoint exists', async () => {
      const cp = { test_run_id: 'cp-1', created_at: new Date() } as DsChangePoints;
      const afterRun = makeTestRun({ testRunId: 'tr-after', completed: true, createdAt: new Date('2024-02-01T00:00:00Z') });

      changePointsRepo.findOne.mockResolvedValue(cp);
      // getTestRunsAfterChangepoint calls findOne then find
      testRunRepo.findOne.mockResolvedValue(makeTestRun({ testRunId: 'cp-1', createdAt: new Date('2024-01-01T00:00:00Z') }));
      testRunRepo.find.mockResolvedValue([afterRun]);

      const result = await service.getTestRunsAfterMostRecentChangepoint(SUT_ID, ENV, WORKLOAD);
      expect(result.changepointTestRunId).toBe('cp-1');
      expect(result.testRunIds).toEqual(['tr-after']);
    });

    it('throws DatabaseException on error', async () => {
      changePointsRepo.findOne.mockRejectedValue(new Error('DB error'));
      await expect(service.getTestRunsAfterMostRecentChangepoint(SUT_ID, ENV, WORKLOAD)).rejects.toBeInstanceOf(DatabaseException);
    });
  });
});
