import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TestRunsUrlMetricsController } from './test-runs-url-metrics.controller';
import { TestRunsService } from '../test-runs.service';

describe('TestRunsUrlMetricsController', () => {
  let controller: TestRunsUrlMetricsController;
  const svc = {
    getUrlMetricStatistics: jest.fn(),
    getUrlDistinctNames: jest.fn(),
  };
  const ctx = { userId: 'u1', roles: ['user'] } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [TestRunsUrlMetricsController],
      providers: [{ provide: TestRunsService, useValue: svc }],
    }).compile();
    controller = mod.get(TestRunsUrlMetricsController);
  });

  it('rejects an unknown metric', async () => {
    await expect(
      controller.getUrlMetricStatistics('run-1', 'bogus', 'run-1,run-2', ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('parses testRunIds csv and forwards to the service', async () => {
    svc.getUrlMetricStatistics.mockResolvedValue([{ test_run_id: 'run-1' }]);
    const out = await controller.getUrlMetricStatistics('run-1', 'response_time', 'run-1, run-2', ctx);
    expect(svc.getUrlMetricStatistics).toHaveBeenCalledWith(
      ['run-1', 'run-2'], 'u1', ['user'], 'response_time',
    );
    expect(out).toEqual([{ test_run_id: 'run-1' }]);
  });

  it('defaults testRunIds to the path run when csv is absent', async () => {
    svc.getUrlMetricStatistics.mockResolvedValue([]);
    await controller.getUrlMetricStatistics('run-1', 'throughput', '', ctx);
    expect(svc.getUrlMetricStatistics).toHaveBeenCalledWith(['run-1'], 'u1', ['user'], 'throughput');
  });

  it('forwards distinct names', async () => {
    svc.getUrlDistinctNames.mockResolvedValue(['/api/user/{id}']);
    const out = await controller.getUrlDistinctNames('run-1', ctx);
    expect(svc.getUrlDistinctNames).toHaveBeenCalledWith('run-1', 'u1', ['user']);
    expect(out).toEqual(['/api/user/{id}']);
  });
});
