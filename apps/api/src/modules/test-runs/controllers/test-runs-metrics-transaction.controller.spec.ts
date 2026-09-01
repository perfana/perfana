import { Test } from '@nestjs/testing';
import { HttpStatus, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestRunsMetricsTransactionController } from './test-runs-metrics-transaction.controller';
import { TestRunsService } from '../test-runs.service';

describe('TestRunsMetricsTransactionController', () => {
  let controller: TestRunsMetricsTransactionController;
  const mockService = {
    getTransactionStats: jest.fn(),
    getTransactionSamples: jest.fn(),
    getTransactionTimeSeries: jest.fn(),
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

  describe('getTransactionTimeSeries', () => {
    it('forwards an omitted aggregationSeconds as undefined, not a 5s default', async () => {
      // The query param has no DefaultValuePipe on purpose: undefined is the
      // signal that the service should pick a bucket from the run duration.
      // Reintroducing a default here silently pins every chart back to 5 s.
      mockService.getTransactionTimeSeries.mockResolvedValue({
        transaction_data: [],
        sampler_data: {},
        aggregation_seconds: 30,
      });

      await controller.getTransactionTimeSeries('tr1', 'tx', undefined, false, ctx);

      expect(mockService.getTransactionTimeSeries).toHaveBeenCalledWith(
        'tr1',
        'tx',
        'u1',
        ['user'],
        undefined,
        false,
      );
    });

    it("forwards the caller's explicit aggregationSeconds", async () => {
      mockService.getTransactionTimeSeries.mockResolvedValue({
        transaction_data: [],
        sampler_data: {},
        aggregation_seconds: 60,
      });

      const result = await controller.getTransactionTimeSeries('tr1', 'tx', 60, true, ctx);

      expect(mockService.getTransactionTimeSeries).toHaveBeenCalledWith(
        'tr1',
        'tx',
        'u1',
        ['user'],
        60,
        true,
      );
      expect(result).toMatchObject({ aggregation_seconds: 60 });
    });
  });

  describe('GET .../timeseries query pipes', () => {
    // The unit tests above call the handler directly, so they never run the
    // @Query pipes. Only an HTTP request proves `ParseIntPipe({ optional: true })`
    // is really on the param — a reverted DefaultValuePipe(5) is invisible to
    // a direct call but pins every chart back to the 5 s floor here.
    let app: INestApplication;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [TestRunsMetricsTransactionController],
        providers: [{ provide: TestRunsService, useValue: mockService }],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      mockService.getTransactionTimeSeries.mockResolvedValue({
        transaction_data: [],
        sampler_data: {},
        aggregation_seconds: 30,
      });
    });

    afterEach(async () => {
      await app.close();
    });

    const argsOf = () =>
      mockService.getTransactionTimeSeries.mock.calls[0] as unknown[];

    it('passes undefined to the service when the param is absent', async () => {
      await request(app.getHttpServer())
        .get('/test-runs/tr1/transactions/tx/timeseries')
        .expect(200);

      expect(argsOf()[4]).toBeUndefined();
    });

    it('parses a supplied param to a number', async () => {
      await request(app.getHttpServer())
        .get('/test-runs/tr1/transactions/tx/timeseries?aggregationSeconds=300')
        .expect(200);

      expect(argsOf()[4]).toBe(300);
    });

    it('rejects a non-numeric param with 400', async () => {
      await request(app.getHttpServer())
        .get('/test-runs/tr1/transactions/tx/timeseries?aggregationSeconds=abc')
        .expect(400);

      expect(mockService.getTransactionTimeSeries).not.toHaveBeenCalled();
    });
  });
});
