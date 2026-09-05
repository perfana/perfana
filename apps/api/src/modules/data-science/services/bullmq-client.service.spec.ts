import { Logger } from '@nestjs/common';
import { BullMQClientService } from './bullmq-client.service';

/**
 * Unit tests for `enqueueStatisticsCalculation` (#552).
 *
 * The constructor opens real Redis/BullMQ connections, so these build the instance
 * from the prototype and inject the private fields directly. That keeps the test on
 * the enqueue logic — queue choice, job name, deterministic jobId — which is what the
 * #552 escape hatch depends on: it must land on `perfana-analyze`, not the batch queue.
 */
function makeService(overrides?: {
  add?: jest.Mock;
  redisAvailable?: boolean;
}): { service: BullMQClientService; add: jest.Mock; errors: string[] } {
  const add = overrides?.add ?? jest.fn().mockResolvedValue({ id: 'statistics-run-001' });
  const errors: string[] = [];

  const service = Object.create(BullMQClientService.prototype) as BullMQClientService;
  const internals = service as unknown as Record<string, unknown>;

  internals.isRedisAvailable = overrides?.redisAvailable ?? true;
  internals.analysisQueue = { add, name: 'perfana-analyze' };
  internals.batchQueue = { add: jest.fn(), name: 'perfana-batch' };
  internals.reevalQueue = { add: jest.fn(), name: 'perfana-reevaluate' };
  internals.flowProducer = { add: jest.fn() };
  internals.logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn((message: string) => {
      errors.push(message);
    }),
  } as unknown as Logger;

  return { service, add, errors };
}

describe('BullMQClientService.enqueueStatisticsCalculation (#552)', () => {
  describe('Happy Path', () => {
    it('should enqueue statistics-calculation on the analyze queue and return the job id', async () => {
      const { service, add } = makeService();

      const jobId = await service.enqueueStatisticsCalculation('run-001');

      expect(jobId).toBe('statistics-run-001');
      expect(add).toHaveBeenCalledTimes(1);

      const call = add.mock.calls.at(0);
      expect(call).toBeDefined();
      const [jobName, payload, options] = call as [string, unknown, Record<string, unknown>];

      // Must target the analyze queue's job name — the batch queue would never run it.
      expect(jobName).toBe('statistics-calculation');
      // StatisticsPipeline takes an array of ids, not a bare testRunId.
      expect(payload).toEqual({ testRunIds: ['run-001'] });
      expect(options).toMatchObject({ jobId: 'statistics-run-001' });
    });

    it('should use a deterministic job id so repeated clicks coalesce', async () => {
      const { service, add } = makeService();

      await service.enqueueStatisticsCalculation('run-001');
      await service.enqueueStatisticsCalculation('run-001');

      const first = add.mock.calls.at(0)?.[2] as Record<string, unknown> | undefined;
      const second = add.mock.calls.at(1)?.[2] as Record<string, unknown> | undefined;

      expect(first?.jobId).toBe('statistics-run-001');
      expect(second?.jobId).toBe(first?.jobId);
    });

    it('should keep the job retryable but bounded', async () => {
      const { service, add } = makeService();

      await service.enqueueStatisticsCalculation('run-001');

      const options = add.mock.calls.at(0)?.[2] as Record<string, unknown> | undefined;
      expect(options?.attempts).toBe(2);
      expect(options?.backoff).toEqual({ type: 'exponential', delay: 5000 });
    });

    it('should not touch the batch or re-evaluate queues', async () => {
      const { service } = makeService();
      const internals = service as unknown as Record<string, { add: jest.Mock }>;

      await service.enqueueStatisticsCalculation('run-001');

      expect(internals.batchQueue?.add).not.toHaveBeenCalled();
      expect(internals.reevalQueue?.add).not.toHaveBeenCalled();
    });
  });

  describe('Error Scenarios', () => {
    it('should rethrow when Redis is unavailable, without enqueuing', async () => {
      const { service, add } = makeService({ redisAvailable: false });

      await expect(service.enqueueStatisticsCalculation('run-001')).rejects.toThrow(
        /Redis\/BullMQ is not available/,
      );
      expect(add).not.toHaveBeenCalled();
    });

    it('should log and rethrow when the queue rejects the job', async () => {
      const add = jest.fn().mockRejectedValue(new Error('connection reset'));
      const { service, errors } = makeService({ add });

      await expect(service.enqueueStatisticsCalculation('run-001')).rejects.toThrow(
        'connection reset',
      );
      expect(errors.some((message) => message.includes('connection reset'))).toBe(true);
      expect(errors.some((message) => message.includes('run-001'))).toBe(true);
    });

    it('should log Unknown error when the rejection is not an Error', async () => {
      const add = jest.fn().mockRejectedValue('boom');
      const { service, errors } = makeService({ add });

      await expect(service.enqueueStatisticsCalculation('run-001')).rejects.toBe('boom');
      expect(errors.some((message) => message.includes('Unknown error'))).toBe(true);
    });
  });
});

/**
 * `recalculateStatistics` pass-through on the re-evaluate batch path.
 *
 * "Apply to all test runs of this workload" edits every sibling run's ramp_up /
 * ramp_down and then has to make the new window take effect. The two worker
 * refreshMode branches run StatisticsPipeline only after a fetch returned new rows,
 * so neither covers "the data is unchanged but the analysis window moved" — this
 * flag is the only thing that reaches the worker's third branch. If it is dropped
 * here the batch runs checks and ADAPT against the PREVIOUS window's statistics and
 * the user's edit silently does nothing.
 */
function makeReevaluateService(overrides?: {
  batchAdd?: jest.Mock;
  testRunRows?: unknown[];
}): { service: BullMQClientService; batchAdd: jest.Mock } {
  const batchAdd = overrides?.batchAdd ?? jest.fn().mockResolvedValue({ id: 'batch-job-1' });

  const service = Object.create(BullMQClientService.prototype) as BullMQClientService;
  const internals = service as unknown as Record<string, unknown>;

  internals.isRedisAvailable = true;
  internals.analysisQueue = { add: jest.fn(), name: 'perfana-analyze' };
  internals.batchQueue = { add: batchAdd, name: 'perfana-batch' };
  internals.reevalQueue = { add: jest.fn(), name: 'perfana-reevaluate' };
  internals.flowProducer = { add: jest.fn() };
  // determineConfigurationScope reads test_runs; an empty result short-circuits it
  // to metric scope without touching ds_compare_config.
  internals.dataSource = { query: jest.fn().mockResolvedValue(overrides?.testRunRows ?? []) };
  internals.logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  return { service, batchAdd };
}

const jobDataOf = (batchAdd: jest.Mock): Record<string, unknown> =>
  batchAdd.mock.calls.at(0)?.[1] as Record<string, unknown>;

describe('BullMQClientService.reevaluateBatch — recalculateStatistics', () => {
  it('forwards recalculateStatistics onto the orchestrate job data', async () => {
    const { service, batchAdd } = makeReevaluateService();

    await service.reevaluateBatch(['run-001', 'run-002'], {
      checks: true,
      adapt: true,
      recalculateStatistics: true,
    });

    expect(batchAdd).toHaveBeenCalledTimes(1);
    expect(batchAdd.mock.calls.at(0)?.[0]).toBe('orchestrate-reevaluate-batch');

    const jobData = jobDataOf(batchAdd);
    expect(jobData.recalculateStatistics).toBe(true);
    expect(jobData.testRunIds).toEqual(['run-001', 'run-002']);
    expect(jobData.checks).toBe(true);
    expect(jobData.adapt).toBe(true);
    // No refreshMode: the worker must skip data collection and still recalculate.
    expect(jobData.refreshMode).toBeUndefined();
  });

  it('omits the key entirely when the caller does not ask for it', async () => {
    const { service, batchAdd } = makeReevaluateService();

    await service.reevaluateBatch(['run-001'], { checks: true, adapt: true });

    expect(jobDataOf(batchAdd)).not.toHaveProperty('recalculateStatistics');
  });

  it('omits the key when it is explicitly false, so the worker keeps its default branch', async () => {
    const { service, batchAdd } = makeReevaluateService();

    await service.reevaluateBatch(['run-001'], { recalculateStatistics: false });

    expect(jobDataOf(batchAdd)).not.toHaveProperty('recalculateStatistics');
  });

  it('rethrows without enqueuing when Redis is unavailable', async () => {
    const { service, batchAdd } = makeReevaluateService();
    (service as unknown as Record<string, unknown>).isRedisAvailable = false;

    await expect(
      service.reevaluateBatch(['run-001'], { recalculateStatistics: true }),
    ).rejects.toThrow(/Redis\/BullMQ is not available/);
    expect(batchAdd).not.toHaveBeenCalled();
  });
});
