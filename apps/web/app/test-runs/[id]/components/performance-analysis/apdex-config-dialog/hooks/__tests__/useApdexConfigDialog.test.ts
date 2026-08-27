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
  systems_under_test: { name: 'my-sut' },
  test_environment: 'staging',
  workload: 'peak',
};

type MockResponse = { ok: boolean; json: () => Promise<unknown> };
const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, json: () => Promise.resolve(body) } as unknown as Response);

function routeFetch(routes: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) => {
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return Promise.resolve(jsonResponse(body));
      }
    }
    // Fail loudly on unstubbed URLs so missing mocks show up instead of
    // silently returning ok:true with an empty body.
    return Promise.resolve({
      ok: false,
      json: () => Promise.reject(new Error(`Unstubbed URL in test: ${url}`)),
    } as unknown as Response);
  });
}

const defaultProps = {
  open: true,
  testRunId: 'run-1',
  transactionName: undefined,
  currentThreshold: 500,
  onSuccess: jest.fn(),
  onClose: jest.fn(),
};

describe('useApdexConfigDialog - excludeRampUpTime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('default state and reset behavior', () => {
    it('defaults excludeRampUpTime to true when opening with no existing SLO', async () => {
      routeFetch({
        '/test-runs/': testRunDetails,
        '/benchmarks?': [],
      });

      const { result } = renderHook(() => useApdexConfigDialog(defaultProps));

      await waitFor(() => {
        expect(result.current.testRunDetails).not.toBeNull();
      });

      expect(result.current.excludeRampUpTime).toBe(true);
    });

    it('resets excludeRampUpTime to true when dialog re-opens', async () => {
      routeFetch({
        '/test-runs/': testRunDetails,
        '/benchmarks?': [],
      });

      const { result, rerender } = renderHook(
        (props: typeof defaultProps) => useApdexConfigDialog(props),
        { initialProps: defaultProps },
      );

      await waitFor(() => expect(result.current.testRunDetails).not.toBeNull());

      act(() => {
        result.current.setExcludeRampUpTime(false);
      });
      expect(result.current.excludeRampUpTime).toBe(false);

      rerender({ ...defaultProps, open: false });
      rerender({ ...defaultProps, open: true });

      await waitFor(() => {
        expect(result.current.excludeRampUpTime).toBe(true);
      });
    });
  });

  describe('loading from existing SLO (!== false tri-state)', () => {
    it('treats exclude_ramp_up_time === true as true', async () => {
      routeFetch({
        '/test-runs/': testRunDetails,
        '/benchmarks?': [
          {
            id: 'slo-1',
            min_apdex_score: 0.9,
            include_failed_requests: false,
            exclude_ramp_up_time: true,
            enabled: true,
          },
        ],
      });

      const { result } = renderHook(() => useApdexConfigDialog(defaultProps));

      await waitFor(() => expect(result.current.existingSlo).not.toBeNull());
      expect(result.current.excludeRampUpTime).toBe(true);
    });

    it('treats exclude_ramp_up_time === false as false', async () => {
      routeFetch({
        '/test-runs/': testRunDetails,
        '/benchmarks?': [
          {
            id: 'slo-1',
            min_apdex_score: 0.9,
            include_failed_requests: false,
            exclude_ramp_up_time: false,
            enabled: true,
          },
        ],
      });

      const { result } = renderHook(() => useApdexConfigDialog(defaultProps));

      await waitFor(() => expect(result.current.existingSlo).not.toBeNull());
      expect(result.current.excludeRampUpTime).toBe(false);
      expect(result.current.existingSlo?.exclude_ramp_up_time).toBe(false);
    });

    it('treats missing exclude_ramp_up_time as true (legacy rows)', async () => {
      routeFetch({
        '/test-runs/': testRunDetails,
        '/benchmarks?': [
          {
            id: 'slo-1',
            min_apdex_score: 0.9,
            include_failed_requests: false,
            enabled: true,
            // exclude_ramp_up_time absent
          },
        ],
      });

      const { result } = renderHook(() => useApdexConfigDialog(defaultProps));

      await waitFor(() => expect(result.current.existingSlo).not.toBeNull());
      expect(result.current.excludeRampUpTime).toBe(true);
    });
  });

  describe('handleSave wire format', () => {
    async function openHookWithoutExistingSlo() {
      routeFetch({
        '/test-runs/': testRunDetails,
        '/benchmarks?': [],
      });

      const { result } = renderHook(() => useApdexConfigDialog(defaultProps));
      await waitFor(() => expect(result.current.testRunDetails).not.toBeNull());
      return result;
    }

    it('sends excludeRampUpTime on POST when creating a new SLO', async () => {
      const result = await openHookWithoutExistingSlo();

      // Stub the subsequent save calls
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

      act(() => {
        result.current.setEnableSlo(true);
        result.current.setExcludeRampUpTime(false);
        result.current.setMinApdexScore(0.9);
        result.current.setIncludeFailedRequests(true);
      });

      // handleSave only opens the re-evaluation dialog; the write happens on
      // confirm. Two act() blocks so the pending-action state commits between.
      await act(async () => {
        await result.current.handleSave();
      });
      await act(async () => {
        await result.current.handleSaveDialogConfirm('none');
      });

      const apdexCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url === '/benchmarks/apdex' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );

      expect(apdexCall).toBeDefined();
      const body = JSON.parse(
        (apdexCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;

      expect(body.excludeRampUpTime).toBe(false);
      expect(body.includeFailedRequests).toBe(true);
      expect(body.minApdexScore).toBe(0.9);
      expect(body.apdexThresholdMs).toBe(500);
      expect(body.systemUnderTestId).toBe('sut-1');
      expect(body.workload).toBe('peak');
    });

    it('sends excludeRampUpTime on PUT when updating an existing SLO', async () => {
      routeFetch({
        '/test-runs/': testRunDetails,
        '/benchmarks?': [
          {
            id: 'slo-42',
            min_apdex_score: 0.85,
            include_failed_requests: false,
            exclude_ramp_up_time: true,
            enabled: true,
          },
        ],
      });

      const { result } = renderHook(() => useApdexConfigDialog(defaultProps));
      await waitFor(() => expect(result.current.existingSlo).not.toBeNull());

      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

      act(() => {
        result.current.setExcludeRampUpTime(false);
      });

      // handleSave only opens the re-evaluation dialog; the write happens on
      // confirm. Two act() blocks so the pending-action state commits between.
      await act(async () => {
        await result.current.handleSave();
      });
      await act(async () => {
        await result.current.handleSaveDialogConfirm('none');
      });

      const updateCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.startsWith('/benchmarks/apdex/slo-42') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      );

      expect(updateCall).toBeDefined();
      const body = JSON.parse(
        (updateCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;

      expect(body.excludeRampUpTime).toBe(false);
      expect(body.enabled).toBe(true);
    });

    it('preserves excludeRampUpTime in the disable PUT body (no silent drop)', async () => {
      routeFetch({
        '/test-runs/': testRunDetails,
        '/benchmarks?': [
          {
            id: 'slo-99',
            min_apdex_score: 0.85,
            include_failed_requests: false,
            exclude_ramp_up_time: true,
            enabled: true,
          },
        ],
      });

      const { result } = renderHook(() => useApdexConfigDialog(defaultProps));
      await waitFor(() => expect(result.current.existingSlo).not.toBeNull());

      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

      act(() => {
        result.current.setEnableSlo(false);
        result.current.setExcludeRampUpTime(false);
      });

      // handleSave only opens the re-evaluation dialog; the write happens on
      // confirm. Two act() blocks so the pending-action state commits between.
      await act(async () => {
        await result.current.handleSave();
      });
      await act(async () => {
        await result.current.handleSaveDialogConfirm('none');
      });

      const disableCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.startsWith('/benchmarks/apdex/slo-99') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(disableCall).toBeDefined();
      const body = JSON.parse(
        (disableCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;

      expect(body.enabled).toBe(false);
      expect(body.excludeRampUpTime).toBe(false);
    });

    it('captures current excludeRampUpTime in handleSave (no stale closure)', async () => {
      const result = await openHookWithoutExistingSlo();

      act(() => {
        result.current.setEnableSlo(true);
        result.current.setExcludeRampUpTime(true);
      });

      // Flip right before save — the useCallback deps must see this value
      act(() => {
        result.current.setExcludeRampUpTime(false);
      });

      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

      // handleSave only opens the re-evaluation dialog; the write happens on
      // confirm. Two act() blocks so the pending-action state commits between.
      await act(async () => {
        await result.current.handleSave();
      });
      await act(async () => {
        await result.current.handleSaveDialogConfirm('none');
      });

      const apdexCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url === '/benchmarks/apdex' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );

      expect(apdexCall).toBeDefined();
      const body = JSON.parse(
        (apdexCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(body.excludeRampUpTime).toBe(false);
    });
  });
});

describe('useApdexConfigDialog - testRunId change while open (issue #171 Bug A)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('re-fetches and resets state when testRunId changes while open=true', async () => {
    const testRun1 = {
      system_under_test_id: 'sut-1',
      system_name: 'sut-1',
      test_environment: 'staging',
      workload: 'peak',
    };
    const testRun2 = {
      system_under_test_id: 'sut-2',
      system_name: 'sut-2',
      test_environment: 'prod',
      workload: 'baseline',
    };

    mockFetch.mockImplementation((url: string) => {
      if (url === '/test-runs/run-1') return Promise.resolve(jsonResponse(testRun1));
      if (url === '/test-runs/run-2') return Promise.resolve(jsonResponse(testRun2));
      if (url.startsWith('/benchmarks?') && url.includes('sut-1')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'slo-run-1',
              min_apdex_score: 0.85,
              include_failed_requests: false,
              exclude_ramp_up_time: false,
              enabled: true,
            },
          ]),
        );
      }
      if (url.startsWith('/benchmarks?') && url.includes('sut-2')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.reject(new Error(`Unstubbed URL in test: ${url}`)),
      } as unknown as Response);
    });

    const { result, rerender } = renderHook(
      (props: typeof defaultProps) => useApdexConfigDialog(props),
      { initialProps: defaultProps },
    );

    // Wait for run-1's existing SLO to load
    await waitFor(() => expect(result.current.existingSlo).not.toBeNull());
    expect(result.current.existingSlo?.id).toBe('slo-run-1');
    expect(result.current.excludeRampUpTime).toBe(false);

    // Swap to run-2 while open=true (URL-level navigation while dialog stays mounted)
    rerender({ ...defaultProps, testRunId: 'run-2' });

    // testRunDetails must point at run-2
    await waitFor(() =>
      expect(result.current.testRunDetails?.system_under_test_id).toBe('sut-2'),
    );

    // existingSlo and excludeRampUpTime must reset — no leak from run-1
    await waitFor(() => expect(result.current.existingSlo).toBeNull());
    expect(result.current.excludeRampUpTime).toBe(true);
  });
});

describe('useApdexConfigDialog - checkExistingSlo error handling (issue #171 Bug B)', () => {
  const testRunDetails = {
    system_under_test_id: 'sut-1',
    system_name: 'my-sut',
    systems_under_test: { name: 'my-sut' },
    test_environment: 'staging',
    workload: 'peak',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('surfaces an error when /benchmarks? returns ok=false', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/test-runs/')) {
        return Promise.resolve(jsonResponse(testRunDetails));
      }
      if (url.startsWith('/benchmarks?')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ message: 'Server error' }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.reject(new Error(`Unstubbed URL: ${url}`)),
      } as unknown as Response);
    });

    const { result } = renderHook(() => useApdexConfigDialog(defaultProps));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatch(/existing (apdex )?slo/i);
    expect(result.current.loadingSlo).toBe(false);
  });

  it('surfaces an error when /benchmarks? rejects', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/test-runs/')) {
        return Promise.resolve(jsonResponse(testRunDetails));
      }
      if (url.startsWith('/benchmarks?')) {
        return Promise.reject(new Error('Network failure'));
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.reject(new Error(`Unstubbed URL: ${url}`)),
      } as unknown as Response);
    });

    const { result } = renderHook(() => useApdexConfigDialog(defaultProps));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatch(/existing (apdex )?slo/i);
  });

  it('blocks save (no POST to /benchmarks/apdex) when the SLO check failed', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/test-runs/')) {
        return Promise.resolve(jsonResponse(testRunDetails));
      }
      if (url.startsWith('/benchmarks?')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.reject(new Error(`Unstubbed URL: ${url}`)),
      } as unknown as Response);
    });

    const { result } = renderHook(() => useApdexConfigDialog(defaultProps));

    await waitFor(() => expect(result.current.error).not.toBeNull());

    // Subsequent calls (threshold PUT, apdex POST) would succeed if they were made
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    act(() => {
      result.current.setEnableSlo(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    const apdexPost = mockFetch.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url === '/benchmarks/apdex' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(apdexPost).toBeUndefined();
  });
});
