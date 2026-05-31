import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ApdexSloDialog from '@/app/test-runs/[id]/components/performance-analysis/ApdexSloDialog';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const testRun = {
  system_under_test_id: 'sut-1',
  system_name: 'my-sut',
  systems_under_test: { name: 'my-sut' },
  test_environment: 'staging',
  workload: 'peak',
};

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, json: () => Promise.resolve(body) } as unknown as Response);

function routeFetch(routes: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) => {
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return Promise.resolve(jsonResponse(body));
      }
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.reject(new Error(`Unstubbed URL in test: ${url}`)),
    } as unknown as Response);
  });
}

function findBodyFor(url: string, method: string): Record<string, unknown> | undefined {
  const call = mockFetch.mock.calls.find(
    ([u, init]) =>
      typeof u === 'string' &&
      u === url &&
      (init as RequestInit | undefined)?.method === method,
  );
  if (!call) return undefined;
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

async function enableSlo(user: ReturnType<typeof userEvent.setup>) {
  // The first switch in the dialog is "Create Apdex SLO" / "Enable Apdex SLO"
  const switches = screen.getAllByRole('switch');
  await user.click(switches[0]);
  // Wait for the SLO config panel to expand (its toggles render conditionally)
  await waitFor(() => {
    expect(screen.getByText(/Apply to analysis timerange only/i)).toBeInTheDocument();
  });
}

describe('ApdexSloDialog - excludeRampUpTime toggle', () => {
  const onClose = jest.fn();
  const onSuccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the apply to analysis timerange only toggle, defaulted on, once SLO is enabled', async () => {
    routeFetch({
      '/test-runs/': testRun,
      '/benchmarks?': [],
    });

    const user = userEvent.setup();
    render(
      <ApdexSloDialog
        open
        onClose={onClose}
        testRunId="run-1"
        currentThreshold={500}
        onSuccess={onSuccess}
      />,
    );

    // Wait for the test run fetch to settle and "Create Apdex SLO" to appear
    await waitFor(() => expect(screen.getByText(/Create Apdex SLO/i)).toBeInTheDocument());

    await enableSlo(user);

    const excludeLabel = screen.getByText(/Apply to analysis timerange only/i);
    const row = excludeLabel.closest('label');
    expect(row).not.toBeNull();
    const toggle = within(row as HTMLElement).getByRole('switch');
    expect(toggle).toBeChecked();
  });

  it('loads excludeRampUpTime=false from an existing SLO', async () => {
    routeFetch({
      '/test-runs/': testRun,
      '/benchmarks?': [
        {
          id: 'slo-7',
          min_apdex_score: 0.9,
          include_failed_requests: false,
          exclude_ramp_up_time: false,
          enabled: true,
          apdex_threshold_ms: 500,
        },
      ],
    });

    render(
      <ApdexSloDialog
        open
        onClose={onClose}
        testRunId="run-1"
        currentThreshold={500}
        onSuccess={onSuccess}
      />,
    );

    // When an SLO exists, the dialog enables the SLO automatically, so the
    // config panel is visible without toggling.
    await waitFor(() => {
      expect(screen.getByText(/Apply to analysis timerange only/i)).toBeInTheDocument();
    });

    const excludeLabel = screen.getByText(/Apply to analysis timerange only/i);
    const row = excludeLabel.closest('label');
    const toggle = within(row as HTMLElement).getByRole('switch');
    expect(toggle).not.toBeChecked();
  });

  it('sends excludeRampUpTime in the POST body when creating a new SLO', async () => {
    routeFetch({
      '/test-runs/': testRun,
      '/benchmarks?': [],
    });

    const user = userEvent.setup();
    render(
      <ApdexSloDialog
        open
        onClose={onClose}
        testRunId="run-1"
        currentThreshold={500}
        onSuccess={onSuccess}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Create Apdex SLO/i)).toBeInTheDocument());
    await enableSlo(user);

    // Flip the ramp-up toggle off
    const excludeLabel = screen.getByText(/Apply to analysis timerange only/i);
    const row = excludeLabel.closest('label') as HTMLElement;
    const toggle = within(row).getByRole('switch');
    await user.click(toggle);
    expect(toggle).not.toBeChecked();

    // Pre-save: stub further calls as generic 200
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const body = findBodyFor('/benchmarks/apdex', 'POST');
      expect(body).toBeDefined();
      expect(body!.excludeRampUpTime).toBe(false);
    });

    const body = findBodyFor('/benchmarks/apdex', 'POST')!;
    expect(body.systemUnderTestId).toBe('sut-1');
    expect(body.workload).toBe('peak');
    expect(body.apdexThresholdMs).toBe(500);
  });

  it('surfaces an error when the existing SLO check fails (issue #171 Bug B)', async () => {
    // /test-runs/ resolves, /benchmarks? errors out
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/test-runs/')) return Promise.resolve(jsonResponse(testRun));
      if (url.startsWith('/benchmarks?')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ message: 'Server error' }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.reject(new Error(`Unstubbed URL in test: ${url}`)),
      } as unknown as Response);
    });

    render(
      <ApdexSloDialog
        open
        onClose={onClose}
        testRunId="run-1"
        currentThreshold={500}
        onSuccess={onSuccess}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/existing (apdex )?slo/i)).toBeInTheDocument();
    });
  });

  it('sends excludeRampUpTime in the PUT body when updating an existing SLO', async () => {
    routeFetch({
      '/test-runs/': testRun,
      '/benchmarks?': [
        {
          id: 'slo-42',
          min_apdex_score: 0.85,
          include_failed_requests: false,
          exclude_ramp_up_time: true,
          enabled: true,
          apdex_threshold_ms: 500,
        },
      ],
    });

    const user = userEvent.setup();
    render(
      <ApdexSloDialog
        open
        onClose={onClose}
        testRunId="run-1"
        currentThreshold={500}
        onSuccess={onSuccess}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Apply to analysis timerange only/i)).toBeInTheDocument();
    });

    // Toggle off ramp-up exclusion
    const excludeLabel = screen.getByText(/Apply to analysis timerange only/i);
    const row = excludeLabel.closest('label') as HTMLElement;
    const toggle = within(row).getByRole('switch');
    expect(toggle).toBeChecked();
    await user.click(toggle);

    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const body = findBodyFor('/benchmarks/apdex/slo-42', 'PUT');
      expect(body).toBeDefined();
      expect(body!.excludeRampUpTime).toBe(false);
      expect(body!.enabled).toBe(true);
    });
  });
});
