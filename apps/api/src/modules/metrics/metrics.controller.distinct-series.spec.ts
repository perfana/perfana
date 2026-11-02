import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { MetricsController } from './metrics.controller';
import type { MetricsService } from './metrics.service';
import type { Benchmark } from '../../entities';
import type { UserContext } from '../../common/decorators/user-context.decorator';

describe('MetricsController — GET ds-metrics/distinct-series', () => {
  const DASH = '3f8b1c7e-2a4d-4e6f-9b1a-7c2d5e8f0a13';
  const ctx = { userId: 'user-1', roles: ['user'] } as unknown as UserContext;

  function build() {
    const service = { getDistinctMetricSeries: jest.fn().mockResolvedValue({ metric_names: ['api'] }) };
    const controller = new MetricsController(
      service as unknown as MetricsService,
      {} as unknown as Repository<Benchmark>,
    );
    return { controller, service };
  }

  it('hands the parsed panel, the run and the members flag to the service', async () => {
    const { controller, service } = build();

    const result = await controller.getDistinctMetricSeries(ctx, DASH, '201', undefined, 'run-1', 'true');

    expect(result).toEqual({ metric_names: ['api'] });
    expect(service.getDistinctMetricSeries).toHaveBeenCalledWith(DASH, 201, 'user-1', ['user'], undefined, 'run-1', true);
  });

  it('reads anything but "true" as the grouped view', async () => {
    const { controller, service } = build();
    await controller.getDistinctMetricSeries(ctx, DASH, '201', undefined, 'run-1', undefined);
    expect(service.getDistinctMetricSeries.mock.calls[0][6]).toBe(false);
  });

  it('refuses a non-numeric panel and a request naming neither dashboard nor source', async () => {
    const { controller } = build();
    await expect(controller.getDistinctMetricSeries(ctx, DASH, 'abc')).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.getDistinctMetricSeries(ctx, undefined as unknown as string, '201'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
