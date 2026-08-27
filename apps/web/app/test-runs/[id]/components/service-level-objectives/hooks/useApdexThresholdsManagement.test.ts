import { renderHook, waitFor, act } from '@testing-library/react';
import { useApdexThresholdsManagement } from './useApdexThresholdsManagement';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const testRunDetails = {
  system_under_test_id: 'sut-1',
  system_name: 'my-sut',
  test_environment: 'staging',
  workload: 'peak',
  test_run_id: 'run-key-1',
};

const previewResponse = {
  scope: 'workload',
  target_apdex: 0.85,
  items: [
    {
      transaction_name: 'checkout',
      scenario_name: 'default',
      current_threshold: 500,
      calculated_threshold: 750,
      current_apdex: 0.7,
      projected_apdex: 0.85,
      sample_count: 120,
      achievable: true,
      message: 'Target achievable with threshold 750ms',
    },
  ],
  workload_summary: {
    current_workload_threshold: 500,
    calculated_workload_threshold: 750,
    current_workload_apdex: 0.7,
    projected_workload_apdex: 0.85,
    total_transactions: 1,
    achievable_count: 1,
  },
};

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, json: () => Promise.resolve(body) } as unknown as Response);

function routeFetch(routes: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) => {
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body));
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.reject(new Error(`Unstubbed URL in test: ${url}`)),
    } as unknown as Response);
  });
}

const props = {
  open: true,
  testRunId: 'run-1',
  apdexCheckResult: null,
  onSuccess: jest.fn(),
  onClose: jest.fn(),
};

const callsTo = (prefix: string) =>
  mockFetch.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith(prefix));

async function renderWithPreview() {
  const hook = renderHook(() => useApdexThresholdsManagement(props));
  await waitFor(() => expect(hook.result.current.testRunDetails).not.toBeNull());
  await act(async () => {
    await hook.result.current.handleCalculatePreview();
  });
  return hook;
}

describe('useApdexThresholdsManagement — save dialog gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routeFetch({
      '/test-runs/test-runs-after-changepoint': { testRunIds: ['run-key-1', 'run-key-0'] },
      '/test-runs/': testRunDetails,
      '/baseline-apdex/preview': previewResponse,
      '/data/reevaluate/batch': {},
    });
  });

  it('opening the dialog applies nothing', async () => {
    const { result } = await renderWithPreview();

    act(() => {
      result.current.handleOpenSaveDialog();
    });

    expect(result.current.saveDialogOpen).toBe(true);
    expect(callsTo('/test-runs/run-1/baseline-apdex/apply')).toHaveLength(0);
  });

  it('applies and re-evaluates every run back to the change point on "all"', async () => {
    routeFetch({
      '/test-runs/test-runs-after-changepoint': { testRunIds: ['run-key-1', 'run-key-0'] },
      '/test-runs/run-1/baseline-apdex/apply': { transactions_updated: 1 },
      '/test-runs/run-1/baseline-apdex/preview': previewResponse,
      '/test-runs/': testRunDetails,
      '/data/reevaluate/batch': {},
    });
    const { result } = await renderWithPreview();

    await act(async () => {
      await result.current.handleApplyThresholds('all');
    });

    expect(callsTo('/test-runs/run-1/baseline-apdex/apply')).toHaveLength(1);
    const reeval = callsTo('/data/reevaluate/batch');
    expect(reeval).toHaveLength(1);
    expect(JSON.parse((reeval[0]![1] as RequestInit).body as string).testRunIds)
      .toEqual(['run-key-1', 'run-key-0']);
  });

  it('sends the caller\'s min_samples on preview and on apply', async () => {
    routeFetch({
      '/test-runs/run-1/baseline-apdex/apply': { transactions_updated: 1 },
      '/test-runs/run-1/baseline-apdex/preview': previewResponse,
      '/test-runs/': testRunDetails,
      '/data/reevaluate/batch': {},
    });
    const hook = renderHook(() => useApdexThresholdsManagement(props));
    await waitFor(() => expect(hook.result.current.testRunDetails).not.toBeNull());

    act(() => {
      hook.result.current.handleMinSamplesChange(3);
    });
    await act(async () => {
      await hook.result.current.handleCalculatePreview();
    });
    await act(async () => {
      await hook.result.current.handleApplyThresholds('none');
    });

    const preview = callsTo('/test-runs/run-1/baseline-apdex/preview');
    const apply = callsTo('/test-runs/run-1/baseline-apdex/apply');
    expect(JSON.parse((preview[0]![1] as RequestInit).body as string).min_samples).toBe(3);
    // apply re-runs the preview server-side; without the same minimum it would
    // skip exactly the transactions the user just approved.
    expect(JSON.parse((apply[0]![1] as RequestInit).body as string).min_samples).toBe(3);
  });

  it('defaults min_samples to 10', async () => {
    const { result } = await renderWithPreview();
    expect(result.current.minSamples).toBe(10);
    const preview = callsTo('/test-runs/run-1/baseline-apdex/preview');
    expect(JSON.parse((preview[0]![1] as RequestInit).body as string).min_samples).toBe(10);
  });

  it('applies without re-evaluating on "none"', async () => {
    routeFetch({
      '/test-runs/run-1/baseline-apdex/apply': { transactions_updated: 1 },
      '/test-runs/run-1/baseline-apdex/preview': previewResponse,
      '/test-runs/': testRunDetails,
      '/data/reevaluate/batch': {},
    });
    const { result } = await renderWithPreview();

    await act(async () => {
      await result.current.handleApplyThresholds('none');
    });

    expect(callsTo('/test-runs/run-1/baseline-apdex/apply')).toHaveLength(1);
    expect(callsTo('/data/reevaluate/batch')).toHaveLength(0);
    expect(result.current.saveDialogOpen).toBe(false);
  });
});
