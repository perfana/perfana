/**
 * Unit tests for AggregatedSloChart component
 *
 * Tests:
 * - Loading state while fetching
 * - Empty state when API returns no buckets
 * - Error state on non-ok response
 * - Error state on network throw
 * - Chart render after successful fetch with data
 * - No fetch when metric is undefined
 * - Visibility-gated fetching (isVisible=false → no fetch; true → fetches)
 * - stat included / excluded from URL based on aggregate_stat presence
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createTheme, ThemeProvider } from '@mui/material';
import AggregatedSloChart from '@/app/test-runs/[id]/components/service-level-objectives/AggregatedSloChart';
import { authenticatedFetch } from '@/lib/api';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (fn: unknown) => {
    const Component = (props: Record<string, unknown>) => (
      <div data-testid="plotly-chart" {...props} />
    );
    Component.displayName = 'Plot';
    return Component;
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockAuthenticatedFetch = authenticatedFetch as jest.Mock;

const theme = createTheme();

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const mockBuckets = [
  { time: '2024-01-01T10:00:00Z', value: 1500 },
  { time: '2024-01-01T10:01:00Z', value: 1600 },
];

const baseCheckResult = {
  panel_id: 1,
  requirement: {
    operator: 'lt',
    value: 2000,
    aggregate_metric: 'transaction_response_time',
    aggregate_stat: 'p95',
  },
  metric_unit: 'ms',
};

const baseTestRun = {
  start_time: '2024-01-01T10:00:00Z',
  end_time: '2024-01-01T11:00:00Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AggregatedSloChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: successful response with data
    mockAuthenticatedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ bucketSizeSeconds: 60, buckets: mockBuckets }),
    });
  });

  it('shows loading state initially', () => {
    renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={baseCheckResult}
        testRun={baseTestRun}
      />,
    );

    // CircularProgress is rendered by ChartLoadingState
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows empty state when buckets array is empty', async () => {
    mockAuthenticatedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ bucketSizeSeconds: 60, buckets: [] }),
    });

    renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={baseCheckResult}
        testRun={baseTestRun}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/No metrics data available/i)).toBeInTheDocument();
    });
  });

  it('shows error state when fetch returns non-ok response', async () => {
    mockAuthenticatedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={baseCheckResult}
        testRun={baseTestRun}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Error loading chart/i)).toBeInTheDocument();
    });
  });

  it('shows error state when fetch throws (network error)', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAuthenticatedFetch.mockRejectedValue(new Error('Network failure'));

    renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={baseCheckResult}
        testRun={baseTestRun}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Error loading chart/i)).toBeInTheDocument();
    });

    consoleError.mockRestore();
  });

  it('renders the chart after successful fetch with data', async () => {
    renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={baseCheckResult}
        testRun={baseTestRun}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
    });
  });

  it('does NOT fetch when metric is undefined', async () => {
    const checkResultNoMetric = {
      ...baseCheckResult,
      requirement: {
        operator: 'lt',
        value: 2000,
        aggregate_metric: undefined,
        aggregate_stat: undefined,
      },
    };

    renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={checkResultNoMetric}
        testRun={baseTestRun}
      />,
    );

    // Give the component a moment to run effects
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
  });

  it('does NOT fetch when isVisible=false; fetches when isVisible becomes true', async () => {
    const { rerender } = renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={baseCheckResult}
        testRun={baseTestRun}
        isVisible={false}
      />,
    );

    // Give effects time to fire (they should NOT call fetch)
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();

    // Now make it visible
    rerender(
      <ThemeProvider theme={theme}>
        <AggregatedSloChart
          testRunId="tr1"
          checkResult={baseCheckResult}
          testRun={baseTestRun}
          isVisible={true}
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    });
  });

  it('includes stat in the URL when stat is defined', async () => {
    renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={baseCheckResult}
        testRun={baseTestRun}
      />,
    );

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('stat=p95'),
        expect.any(Object),
      );
    });
  });

  it('does NOT include stat in the URL when stat is undefined', async () => {
    const checkResultNoStat = {
      ...baseCheckResult,
      requirement: {
        operator: 'lt',
        value: 2000,
        aggregate_metric: 'error_percentage',
        aggregate_stat: undefined,
      },
    };

    renderWithTheme(
      <AggregatedSloChart
        testRunId="tr1"
        checkResult={checkResultNoStat}
        testRun={baseTestRun}
      />,
    );

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalled();
    });

    const calledUrl = mockAuthenticatedFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('stat=');
  });
});
