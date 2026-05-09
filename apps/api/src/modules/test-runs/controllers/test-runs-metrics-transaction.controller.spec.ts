import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { TestRunsMetricsTransactionController } from './test-runs-metrics-transaction.controller';
import { TestRunsService } from '../test-runs.service';

describe('TestRunsMetricsTransactionController', () => {
  let controller: TestRunsMetricsTransactionController;
  const mockService = {
    getTransactionStats: jest.fn(),
    getTransactionSamples: jest.fn(),
  };
  const ctx = { userId: 'u1', roles: ['user'] } as never;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [TestRunsMetricsTransactionController],
      providers: [{ provide: TestRunsService, useValue: mockService }],
    }).compile();
    controller = moduleRef.get(TestRunsMetricsTransactionController);
  });

  describe('getTransactionStats', () => {
    it('returns the array when service returns transaction stats', async () => {
      const stats = [{ transaction_name: 'tx', total_count: 10 }];
      mockService.getTransactionStats.mockResolvedValue(stats);

      const result = await controller.getTransactionStats('tr1', false, ctx);
      expect(result).toBe(stats);
    });

    it('throws 202 HttpException when service returns RollupPendingResult', async () => {
      mockService.getTransactionStats.mockResolvedValue({
        status: 'rollup-pending',
        stage: 'transaction-stats-rollup',
        progress: { stageName: 'transaction-stats-rollup', stageIndex: 4, totalStages: 11 },
      });

      await expect(controller.getTransactionStats('tr1', false, ctx)).rejects.toMatchObject({
        status: HttpStatus.ACCEPTED,
        response: expect.objectContaining({
          status: 'rollup-pending',
          stage: 'transaction-stats-rollup',
          progress: expect.objectContaining({ stageIndex: 4, totalStages: 11 }),
        }),
      });
    });
  });

  describe('getTransactionSamples', () => {
    it('returns the array when service returns sampler stats', async () => {
      const samples = [{ sampler_name: 's', total_count: 5 }];
      mockService.getTransactionSamples.mockResolvedValue(samples);

      const result = await controller.getTransactionSamples('tr1', 'tx', false, ctx);
      expect(result).toBe(samples);
    });

    it('throws 202 HttpException when service returns RollupPendingResult', async () => {
      mockService.getTransactionSamples.mockResolvedValue({
        status: 'rollup-pending',
        stage: 'transaction-stats-rollup',
      });

      await expect(controller.getTransactionSamples('tr1', 'tx', false, ctx)).rejects.toMatchObject({
        status: HttpStatus.ACCEPTED,
      });
    });
  });
});
