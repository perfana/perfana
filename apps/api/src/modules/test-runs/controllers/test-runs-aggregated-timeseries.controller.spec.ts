import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TestRunsAggregatedTimeseriesController } from './test-runs-aggregated-timeseries.controller';
import { TestRunsService } from '../test-runs.service';

describe('TestRunsAggregatedTimeseriesController', () => {
  let controller: TestRunsAggregatedTimeseriesController;

  const mockService = {
    getAggregatedMetricTimeseries: jest.fn(),
    getAggregatedMetricStatistics: jest.fn(),
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

  describe('getAggregatedMetricStatistic', () => {
    it('parses comma-separated testRunIds and delegates', async () => {
      mockService.getAggregatedMetricStatistics.mockResolvedValue([
        { testRunId: 'a', value: 10 },
        { testRunId: 'b', value: null },
      ]);

      const res = await controller.getAggregatedMetricStatistic('a', 'request_response_time', 'p90', 'a,b', ctx);

      expect(mockService.getAggregatedMetricStatistics).toHaveBeenCalledWith(
        ['a', 'b'], 'u1', ['user'], 'request_response_time', 'p90',
      );
      expect(res).toEqual([{ testRunId: 'a', value: 10 }, { testRunId: 'b', value: null }]);
    });

    it('defaults testRunIds to the path run when omitted', async () => {
      mockService.getAggregatedMetricStatistics.mockResolvedValue([]);
      await controller.getAggregatedMetricStatistic('a', 'error_percentage', undefined as never, undefined as never, ctx);
      expect(mockService.getAggregatedMetricStatistics).toHaveBeenCalledWith(
        ['a'], 'u1', ['user'], 'error_percentage', 'avg',
      );
    });

    it('rejects a testRunIds list longer than the cap', async () => {
      // Unbounded, every id costs an indexed rollup read, so one request fans out with the list.
      const tooMany = Array.from({ length: 501 }, (_, i) => `run-${i}`).join(',');

      await expect(
        controller.getAggregatedMetricStatistic('a', 'request_response_time', 'p90', tooMany, ctx),
      ).rejects.toThrow('at most 500 runs');
      expect(mockService.getAggregatedMetricStatistics).not.toHaveBeenCalled();
    });

    it('accepts a list exactly at the cap', async () => {
      // Off-by-one guard: the limit is inclusive.
      mockService.getAggregatedMetricStatistics.mockResolvedValue([]);
      const atCap = Array.from({ length: 500 }, (_, i) => `run-${i}`).join(',');

      await controller.getAggregatedMetricStatistic('a', 'request_response_time', 'p90', atCap, ctx);

      expect(mockService.getAggregatedMetricStatistics).toHaveBeenCalled();
    });

    it('rejects rather than truncates, so no aggregate silently omits runs', async () => {
      const tooMany = Array.from({ length: 600 }, (_, i) => `run-${i}`).join(',');

      await expect(
        controller.getAggregatedMetricStatistic('a', 'error_percentage', undefined as never, tooMany, ctx),
      ).rejects.toThrow(/received 600/);
    });

    it('de-duplicates repeated ids', async () => {
      // A repeated id would otherwise be read, aggregated and returned once per occurrence.
      mockService.getAggregatedMetricStatistics.mockResolvedValue([]);

      await controller.getAggregatedMetricStatistic('a', 'request_response_time', 'p90', 'a,b,a,b,a', ctx);

      expect(mockService.getAggregatedMetricStatistics).toHaveBeenCalledWith(
        ['a', 'b'], 'u1', ['user'], 'request_response_time', 'p90',
      );
    });

    it('rejects an unknown metric', async () => {
      await expect(
        controller.getAggregatedMetricStatistic('a', 'bogus', 'avg', 'a', ctx),
      ).rejects.toThrow('metric must be one of');
    });

    it('requires stat for response-time metrics', async () => {
      await expect(
        controller.getAggregatedMetricStatistic('a', 'request_response_time', 'nope', 'a', ctx),
      ).rejects.toThrow('stat must be one of');
    });
  });
});
