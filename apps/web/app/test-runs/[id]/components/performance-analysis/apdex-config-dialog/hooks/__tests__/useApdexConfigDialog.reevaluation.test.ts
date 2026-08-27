import { renderHook, waitFor, act } from '@testing-library/react';
import { useApdexConfigDialog } from '../useApdexConfigDialog';
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

const transactionProps = {
  open: true,
  testRunId: 'run-1',
  transactionName: 'checkout',
  currentThreshold: 500,
  onSuccess: jest.fn(),
  onClose: jest.fn(),
};

const callsTo = (predicate: (url: string, init?: RequestInit) => boolean) =>
  mockFetch.mock.calls.filter(([url, init]) =>
    typeof url === 'string' ? predicate(url, init as RequestInit | undefined) : false,
  );

describe('useApdexConfigDialog — re-evaluation gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routeFetch({
      '/test-runs/': testRunDetails,
      '/benchmarks?': [],
      '/data/reevaluate/batch': {},
    });
  });

  it('writes nothing until the save dialog is confirmed', async () => {
    const { result } = renderHook(() => useApdexConfigDialog(transactionProps));
    await waitFor(() => expect(result.current.testRunDetails).not.toBeNull());

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.saveDialogOpen).toBe(true);
    expect(callsTo((url, init) => url.includes('/apdex-threshold') && init?.method === 'PUT'))
      .toHaveLength(0);
  });

  it('saves and queues a re-evaluation of this run on confirm', async () => {
    const { result } = renderHook(() => useApdexConfigDialog(transactionProps));
    await waitFor(() => expect(result.current.testRunDetails).not.toBeNull());

    await act(async () => {
      await result.current.handleSave();
    });
    await act(async () => {
      await result.current.handleSaveDialogConfirm('current');
    });

    expect(callsTo((url, init) => url.includes('/apdex-threshold') && init?.method === 'PUT'))
      .toHaveLength(1);

    const reeval = callsTo((url) => url === '/data/reevaluate/batch');
    expect(reeval).toHaveLength(1);
    // The batch endpoint matches on test_run_id, not the uuid in props.
    expect(JSON.parse((reeval[0]![1] as RequestInit).body as string).testRunIds)
      .toEqual(['run-key-1']);
  });

  it('does not queue a re-evaluation when the user chose "none"', async () => {
    const { result } = renderHook(() => useApdexConfigDialog(transactionProps));
    await waitFor(() => expect(result.current.testRunDetails).not.toBeNull());

    await act(async () => {
      await result.current.handleSave();
    });
    await act(async () => {
      await result.current.handleSaveDialogConfirm('none');
    });

    expect(callsTo((url) => url === '/data/reevaluate/batch')).toHaveLength(0);
  });

  it('gates "Reset to Test Default" behind the same dialog', async () => {
    const { result } = renderHook(() => useApdexConfigDialog(transactionProps));
    await waitFor(() => expect(result.current.testRunDetails).not.toBeNull());

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(result.current.saveDialogOpen).toBe(true);
    expect(callsTo((url, init) => init?.method === 'DELETE')).toHaveLength(0);

    await act(async () => {
      await result.current.handleSaveDialogConfirm('current');
    });

    expect(callsTo((url, init) => url.includes('/apdex-threshold') && init?.method === 'DELETE'))
      .toHaveLength(1);
    expect(callsTo((url) => url === '/data/reevaluate/batch')).toHaveLength(1);
  });

  it('cancelling the dialog drops the pending action', async () => {
    const { result } = renderHook(() => useApdexConfigDialog(transactionProps));
    await waitFor(() => expect(result.current.testRunDetails).not.toBeNull());

    await act(async () => {
      await result.current.handleSave();
    });
    act(() => {
      result.current.handleSaveDialogClose();
    });
    await act(async () => {
      await result.current.handleSaveDialogConfirm('current');
    });

    expect(result.current.saveDialogOpen).toBe(false);
    expect(callsTo((url, init) => url.includes('/apdex-threshold') && init?.method === 'PUT'))
      .toHaveLength(0);
  });
});
