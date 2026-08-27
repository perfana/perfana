import { TestRunsBaselineApdexService } from './test-runs-baseline-apdex.service';
import { BaselineApdexScope } from '../dto/baseline-apdex.dto';

/**
 * Covers the min_samples override only: a transaction with fewer samples than
 * the default MIN_SAMPLES (10) is skipped as "not achievable" unless the caller
 * lowers the bar, in which case it gets a threshold plus a low-confidence note.
 */
describe('TestRunsBaselineApdexService — min_samples', () => {
  let service: TestRunsBaselineApdexService;
  let setTransactionThreshold: jest.Mock;

  // 4 samples: below the default minimum, enough for a ballpark.
  const RESPONSE_TIMES = [100, 120, 140, 900];

  beforeEach(() => {
    setTransactionThreshold = jest.fn().mockResolvedValue(undefined);
    service = new TestRunsBaselineApdexService(
      {} as never, // testRunRepo — unused, the queries below are stubbed
      {} as never, // systemRepo
      { setWorkloadTransactionApdexThreshold: setTransactionThreshold } as never,
      {} as never, // authzService
    );

    jest.spyOn(service as never as { getTestRunDetails: unknown }, 'getTestRunDetails' as never)
      .mockResolvedValue({
        id: 'uuid',
        test_run_id: 'run-1',
        system_under_test_id: 'sut-1',
        system_name: 'sut',
        test_environment: 'acc',
        workload: 'load',
      } as never);
    jest.spyOn(service as never as { validateSystemAccess: unknown }, 'validateSystemAccess' as never)
      .mockResolvedValue(undefined as never);
    jest.spyOn(
      service as never as { getTransactionResponseTimes: unknown },
      'getTransactionResponseTimes' as never,
    ).mockResolvedValue([
      {
        transaction_name: 'rare-call',
        scenario_name: 'default',
        response_times: RESPONSE_TIMES,
        current_threshold: 500,
        current_apdex: 0.5,
      },
    ] as never);
  });

  const preview = (min_samples?: number) =>
    service.previewBaselineApdex(
      'run-1',
      { target_apdex: 0.9, scope: BaselineApdexScope.TRANSACTION, min_samples },
      'user-1',
      [],
    );

  it('skips a low-sample transaction at the default minimum', async () => {
    const result = await preview();
    expect(result.items[0]!.achievable).toBe(false);
    expect(result.items[0]!.calculated_threshold).toBeNull();
    expect(result.items[0]!.message).toContain('Insufficient samples (4 < 10)');
  });

  it('calculates a ballpark threshold when the minimum is lowered', async () => {
    const result = await preview(3);
    const item = result.items[0]!;
    expect(item.achievable).toBe(true);
    expect(item.calculated_threshold).toBeGreaterThan(0);
    expect(item.projected_apdex).toBeGreaterThanOrEqual(0.9);
    expect(item.message).toContain('low confidence: 4 samples');
  });

  it('still skips when the sample count is below the lowered minimum', async () => {
    const result = await preview(5);
    expect(result.items[0]!.achievable).toBe(false);
    expect(result.items[0]!.message).toContain('Insufficient samples (4 < 5)');
  });

  // apply runs its own preview; without forwarding min_samples it would skip
  // exactly the transactions the user just approved in the preview they saw.
  it('applies the thresholds the lowered minimum made available', async () => {
    const result = await service.applyBaselineApdex(
      'run-1',
      { target_apdex: 0.9, scope: BaselineApdexScope.TRANSACTION, min_samples: 3 },
      'user-1',
      [],
    );

    expect(result.transactions_updated).toBe(1);
    expect(setTransactionThreshold).toHaveBeenCalledTimes(1);
    expect(setTransactionThreshold.mock.calls[0]![3]).toBe('rare-call');
  });

  it('applies nothing at the default minimum', async () => {
    const result = await service.applyBaselineApdex(
      'run-1',
      { target_apdex: 0.9, scope: BaselineApdexScope.TRANSACTION },
      'user-1',
      [],
    );

    expect(result.transactions_updated).toBe(0);
    expect(setTransactionThreshold).not.toHaveBeenCalled();
  });
});
