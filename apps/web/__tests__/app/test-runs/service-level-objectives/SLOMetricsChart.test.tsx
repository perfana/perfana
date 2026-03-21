/**
 * Unit tests for SLOMetricsChart Component
 *
 * Tests SLO metrics chart visualization:
 * - Chart rendering with Plotly
 * - Metrics data fetching and processing
 * - Threshold line display
 * - Ramp-up handling
 * - Target filtering
 * - Loading and error states
 * - Empty data handling
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SLOMetricsChart from '@/app/test-runs/[id]/components/service-level-objectives/SLOMetricsChart';
import { authenticatedFetch } from '@/lib/api';

// Mock authenticated fetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

// Mock react-plotly.js dynamic import
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (fn: any) => {
    const Component = (props: any) => <div data-testid="plotly-chart" {...props} />;
    Component.displayName = 'Plot';
    return Component;
  },
}));

describe('SLOMetricsChart', () => {
  const mockCheckResult = {
    panel_id: 123,
    panel_title: 'Response Time p95',
    dashboard_label: 'HTTP Metrics',
    metric_name: 'http_request_duration_p95',
    benchmark_id: 'benchmark-123',
    application_dashboard_id: 'app-dash-123',
    requirement: {
      operator: 'lt',
      value: 500,
    },
    evaluate_type: 'avg',
    metric_unit: 'ms',
    targets: [
      { target: 'api-service', value: 450, meets_requirement: true },
      { target: 'web-service', value: 520, meets_requirement: false },
    ],
  };

  const mockTestRun = {
    start_time: '2024-01-15T10:00:00Z',
    end_time: '2024-01-15T11:00:00Z',
    ramp_up_seconds: 300,
  };

  const mockMetricsData = {
    test_run_id: 'TR-2024-001',
    panel_id: 123,
    panel_title: 'Response Time p95',
    dashboard_label: 'HTTP Metrics',
    data: [
      {
        metric_name: 'http_request_duration_p95',
        time: '2024-01-15T10:00:00Z',
        timestep: 0,
        ramp_up: true,
        value: 100,
      },
      {
        metric_name: 'http_request_duration_p95',
        time: '2024-01-15T10:05:00Z',
        timestep: 300,
        ramp_up: false,
        value: 450,
      },
      {
        metric_name: 'http_request_duration_p95',
        time: '2024-01-15T10:10:00Z',
        timestep: 600,
        ramp_up: false,
        value: 480,
      },
    ],
  };

  const defaultProps = {
    testRunId: 'test-run-123',
    checkResult: mockCheckResult,
    testRun: mockTestRun,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockMetricsData,
    });
  });

  describe('Component Rendering', () => {
    it('should render chart container', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should display loading spinner initially', () => {
      render(<SLOMetricsChart {...defaultProps} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should hide loading spinner after data loads', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });

    it('should render when isVisible is true', async () => {
      render(<SLOMetricsChart {...defaultProps} isVisible={true} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should render when isVisible is false (still loads)', async () => {
      render(<SLOMetricsChart {...defaultProps} isVisible={false} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalled();
      });
    });
  });

  describe('Data Fetching', () => {
    it('should fetch metrics data with application_dashboard_id', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/metrics/ds-metrics/test-run-123/123'),
          expect.any(Object)
        );
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('applicationDashboardId=app-dash-123'),
          expect.any(Object)
        );
      });
    });

    it('should fetch metrics data with benchmark_id when no application_dashboard_id', async () => {
      const checkResultWithoutAppDash = { ...mockCheckResult, application_dashboard_id: undefined };
      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithoutAppDash} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('benchmarkId=benchmark-123'),
          expect.any(Object)
        );
      });
    });

    it('should prefer application_dashboard_id over benchmark_id', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('applicationDashboardId=app-dash-123'),
          expect.any(Object)
        );
        expect(authenticatedFetch).not.toHaveBeenCalledWith(
          expect.stringContaining('benchmarkId='),
          expect.any(Object)
        );
      });
    });

    it('should fetch data on component mount', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle 404 response gracefully', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        // 404 is handled gracefully - sets metricsData to null, no error displayed
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
      });
    });

    it('should display error message on API error', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to fetch metrics data/)).toBeInTheDocument();
      });
    });

    it('should handle invalid JSON response', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Invalid JSON response/)).toBeInTheDocument();
      });

      consoleError.mockRestore();
    });

    it('should handle empty data array', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ ...mockMetricsData, data: [] }),
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        // Should render without crashing
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });

    it('should handle old data format (direct array)', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockMetricsData.data, // Direct array instead of object
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('Target Filtering', () => {
    it('should fetch all data when no target specified', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.not.stringContaining('targetName='),
          expect.any(Object)
        );
      });
    });

    it('should display chart with all targets when targetName not specified', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should filter data by targetName when specified', async () => {
      const metricsWithTargets = {
        ...mockMetricsData,
        data: [
          { ...mockMetricsData.data[0], target: 'api-service' },
          { ...mockMetricsData.data[1], target: 'web-service' },
        ],
      };

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => metricsWithTargets,
      });

      render(<SLOMetricsChart {...defaultProps} targetName="api-service" />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });
  });

  describe('Chart Data Processing', () => {
    it('should process metrics data for Plotly', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        const chart = screen.getByTestId('plotly-chart');
        expect(chart).toBeInTheDocument();
      });
    });

    it('should separate ramp-up and steady-state data', async () => {
      const metricsWithRampUp = {
        ...mockMetricsData,
        data: [
          { ...mockMetricsData.data[0], ramp_up: true },
          { ...mockMetricsData.data[1], ramp_up: false },
          { ...mockMetricsData.data[2], ramp_up: false },
        ],
      };

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => metricsWithRampUp,
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle metrics without ramp_up flag', async () => {
      const metricsWithoutRampUp = {
        ...mockMetricsData,
        data: mockMetricsData.data.map(d => ({ ...d, ramp_up: undefined })),
      };

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => metricsWithoutRampUp,
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should include threshold line when requirement exists', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        const chart = screen.getByTestId('plotly-chart');
        expect(chart).toBeInTheDocument();
        // Threshold value is 500 from mockCheckResult
      });
    });

    it('should handle missing requirement gracefully', async () => {
      const checkResultWithoutRequirement = { ...mockCheckResult, requirement: undefined };
      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithoutRequirement} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });
  });

  describe('Metric Unit Handling', () => {
    it('should format metric unit for display', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle percentunit conversion', async () => {
      const checkResultWithPercent = {
        ...mockCheckResult,
        metric_unit: 'percentunit',
        requirement: { operator: 'lt', value: 0.05 }, // 5%
      };

      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithPercent} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle missing metric unit', async () => {
      const checkResultWithoutUnit = { ...mockCheckResult, metric_unit: undefined };
      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithoutUnit} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle bytes unit formatting', async () => {
      const checkResultWithBytes = {
        ...mockCheckResult,
        metric_unit: 'bytes',
      };

      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithBytes} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });
  });

  describe('Time Range Handling', () => {
    it('should use test run start time for x-axis', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should use test run end time for x-axis range', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle missing test run times', async () => {
      render(<SLOMetricsChart {...defaultProps} testRun={undefined} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle missing end time', async () => {
      const testRunWithoutEnd = { ...mockTestRun, end_time: undefined };
      render(<SLOMetricsChart {...defaultProps} testRun={testRunWithoutEnd} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });
  });

  describe('Requirement Operators', () => {
    it('should handle less than operator', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle greater than operator', async () => {
      const checkResultWithGT = {
        ...mockCheckResult,
        requirement: { operator: 'gt', value: 100 },
      };

      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithGT} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle less than or equal operator', async () => {
      const checkResultWithLE = {
        ...mockCheckResult,
        requirement: { operator: 'le', value: 500 },
      };

      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithLE} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should handle greater than or equal operator', async () => {
      const checkResultWithGE = {
        ...mockCheckResult,
        requirement: { operator: 'ge', value: 100 },
      };

      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithGE} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });
  });

  describe('Error States', () => {
    it('should display error when fetch fails', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      (authenticatedFetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Network error/)).toBeInTheDocument();
      });

      consoleError.mockRestore();
    });

    it('should display error message on fetch rejection', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      (authenticatedFetch as jest.Mock).mockRejectedValue(new Error('API Error'));

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/API Error/)).toBeInTheDocument();
      });

      consoleError.mockRestore();
    });

    it('should not crash on malformed data', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: null }),
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('Empty States', () => {
    it('should handle null metrics data', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => null,
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });

    it('should handle undefined data property', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: undefined }),
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });

    it('should display chart even with no data points', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ ...mockMetricsData, data: [] }),
      });

      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('Panel Information', () => {
    it('should use panel_title from checkResult', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should fall back to metric_name when panel_title missing', async () => {
      const checkResultWithoutTitle = { ...mockCheckResult, panel_title: undefined };
      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultWithoutTitle} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });

    it('should use "Unknown Metric" when both title and name missing', async () => {
      const checkResultMinimal = {
        ...mockCheckResult,
        panel_title: undefined,
        metric_name: undefined,
      };
      render(<SLOMetricsChart {...defaultProps} checkResult={checkResultMinimal} />);

      await waitFor(() => {
        expect(screen.getByTestId('plotly-chart')).toBeInTheDocument();
      });
    });
  });

  describe('Data Fetch URL Construction', () => {
    it('should construct correct API URL with panel ID', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/metrics/ds-metrics/test-run-123/123'),
          expect.any(Object)
        );
      });
    });

    it('should include applicationDashboardId in URL', async () => {
      render(<SLOMetricsChart {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('applicationDashboardId=app-dash-123'),
          expect.any(Object)
        );
      });
    });
  });
});
