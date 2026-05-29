import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TestRunsAggregatedTimeseriesController } from './test-runs-aggregated-timeseries.controller';
import { TestRunsService } from '../test-runs.service';

describe('TestRunsAggregatedTimeseriesController', () => {
  let controller: TestRunsAggregatedTimeseriesController;

  const mockService = {
    getAggregatedMetricTimeseries: jest.fn(),
  };

  const ctx = { userId: 'u1', roles: ['user'] } as never;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [TestRunsAggregatedTimeseriesController],
      providers: [{ provide: TestRunsService, useValue: mockService }],
    }).compile();
    controller = moduleRef.get(TestRunsAggregatedTimeseriesController);
  });

  describe('getAggregatedMetricTimeseries', () => {
    it('returns service result for valid metric+stat', async () => {
      const expected = { bucketSizeSeconds: 60, buckets: [{ time: '2024-01-01T10:00:00Z', value: 1500 }] };
      mockService.getAggregatedMetricTimeseries.mockResolvedValue(expected);

      const result = await controller.getAggregatedMetricTimeseries(
        'tr1',
        'transaction_response_time',
        'p95',
        'true',
        ctx,
      );

      expect(result).toBe(expected);
      expect(mockService.getAggregatedMetricTimeseries).toHaveBeenCalledWith(
        'tr1',
        'u1',
        ['user'],
        'transaction_response_time',
        'p95',
        true,
      );
    });

    it('throws BadRequestException for invalid metric', async () => {
      await expect(
        controller.getAggregatedMetricTimeseries(
          'tr1',
          'not_a_valid_metric',
          'avg',
          'false',
          ctx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid stat when metric is transaction_response_time', async () => {
      await expect(
        controller.getAggregatedMetricTimeseries(
          'tr1',
          'transaction_response_time',
          'not_a_valid_stat',
          'false',
          ctx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('does NOT throw for missing stat when metric is error_percentage', async () => {
      const expected = { bucketSizeSeconds: 60, buckets: [] };
      mockService.getAggregatedMetricTimeseries.mockResolvedValue(expected);

      await expect(
        controller.getAggregatedMetricTimeseries(
          'tr1',
          'error_percentage',
          undefined as unknown as string, // stat is not provided
          'false',
          ctx,
        ),
      ).resolves.toBe(expected);
    });

    it('parses applyAnalysisWindowRaw="true" as true', async () => {
      mockService.getAggregatedMetricTimeseries.mockResolvedValue({});

      await controller.getAggregatedMetricTimeseries(
        'tr1',
        'error_percentage',
        undefined as unknown as string,
        'true',
        ctx,
      );

      expect(mockService.getAggregatedMetricTimeseries).toHaveBeenCalledWith(
        'tr1',
        'u1',
        ['user'],
        'error_percentage',
        expect.anything(),
        true, // applyAnalysisWindow = true
      );
    });

    it('parses any other value as false (e.g. "false")', async () => {
      mockService.getAggregatedMetricTimeseries.mockResolvedValue({});

      await controller.getAggregatedMetricTimeseries(
        'tr1',
        'error_percentage',
        undefined as unknown as string,
        'false',
        ctx,
      );

      expect(mockService.getAggregatedMetricTimeseries).toHaveBeenCalledWith(
        'tr1',
        'u1',
        ['user'],
        'error_percentage',
        expect.anything(),
        false, // applyAnalysisWindow = false
      );
    });

    it('parses undefined applyAnalysisWindowRaw as false', async () => {
      mockService.getAggregatedMetricTimeseries.mockResolvedValue({});

      await controller.getAggregatedMetricTimeseries(
        'tr1',
        'error_percentage',
        undefined as unknown as string,
        undefined as unknown as string,
        ctx,
      );

      expect(mockService.getAggregatedMetricTimeseries).toHaveBeenCalledWith(
        'tr1',
        'u1',
        ['user'],
        'error_percentage',
        expect.anything(),
        false,
      );
    });
  });
});
