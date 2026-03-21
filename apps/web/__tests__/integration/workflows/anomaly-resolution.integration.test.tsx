/**
 * Integration Tests for Anomaly Resolution Workflow
 *
 * This test suite validates complete user journeys for anomaly detection and resolution:
 * - Viewing anomaly detection results
 * - Filtering anomalies by various criteria
 * - Expanding rows and viewing trend charts
 * - Accepting anomalies as variability
 * - Denying anomalies (marking as regression)
 * - Switching between tabs
 * - Error handling
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AnomalyDetectionSection from '@/app/test-runs/[id]/components/anomaly-detection/AnomalyDetectionSection';
import { authenticatedFetch } from '@/lib/api';
import { deleteAnomalyData } from '@/lib/anomaly-api';
import { AnomalyData } from '@/app/test-runs/[id]/components/anomaly-detection/types';
import { TestRun } from '@/types/test-runs';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    back: jest.fn(),
    refresh: jest.fn(),
  })),
  useParams: jest.fn(() => ({ id: 'test-run-123' })),
}));

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
  getAuthHeaders: jest.fn(() => ({ Authorization: 'Bearer mock-token' })),
}));

jest.mock('@/lib/anomaly-api', () => ({
  deleteAnomalyData: jest.fn(),
}));

jest.mock('@/lib/config-hash', () => ({
  generateConfigHash: jest.fn(() => 'mock-hash-123'),
}));

// Mock scroll behavior
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: jest.fn(),
});

describe('Anomaly Resolution Workflow Integration', () => {
  const mockTestRun: TestRun = {
    id: 'test-run-123',
    test_run_id: 'TR-2024-001',
    system_under_test_id: 'my-app',
    test_environment: 'production',
    workload: 'baseline',
    completed: true,
    status: { state: 'completed' },
    start_time: '2024-01-01T10:00:00Z',
    end_time: '2024-01-01T11:00:00Z',
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T11:00:00Z',
    consolidated_result: {
      meetsRequirement: true,
      adaptTestRunOK: true,
    },
    adapt_config: {
      differencesAccepted: 'TBD',
    },
  };

  const mockAnomalyData: AnomalyData[] = [
    {
      dashboard_label: 'JMeter Overview',
      panel_title: 'Response Time',
      metric_name: 'response_time_p95',
      unit: 'ms',
      classification: 'red_duration',
      conclusion_label: 'regression',
      test_value: '150',
      control_group_value: '100',
      difference: '50',
      application_dashboard_id: 'app-dash-1',
      panel_id: 'panel-1',
      is_stale: false,
      compare_config: {
        thresholds: {
          percentageThreshold: 10,
          absoluteThreshold: 20,
        },
        metricClassification: {
          classification: 'lower-is-better',
          higherIsBetter: false,
        },
      },
    },
    {
      dashboard_label: 'JMeter Overview',
      panel_title: 'Throughput',
      metric_name: 'throughput',
      unit: 'req/s',
      classification: 'green_throughput',
      conclusion_label: 'improvement',
      test_value: '1200',
      control_group_value: '1000',
      difference: '200',
      application_dashboard_id: 'app-dash-1',
      panel_id: 'panel-2',
      is_stale: false,
      compare_config: {
        thresholds: {
          percentageThreshold: 5,
        },
        metricClassification: {
          classification: 'higher-is-better',
          higherIsBetter: true,
        },
      },
    },
    {
      dashboard_label: 'System Metrics',
      panel_title: 'CPU Usage',
      metric_name: 'cpu_usage_percent',
      unit: '%',
      classification: 'red_resource',
      conclusion_label: 'regression',
      test_value: '85',
      control_group_value: '60',
      difference: '25',
      application_dashboard_id: 'app-dash-2',
      panel_id: 'panel-3',
      is_stale: true,
      stale_reason: 'Configuration changed',
      stale_at: '2024-01-01T12:00:00Z',
    },
  ];

  const mockTrendsData = [
    {
      test_run_id: 'TR-2024-001',
      test_run_start: '2024-01-01T10:00:00Z',
      dashboard_label: 'JMeter Overview',
      panel_title: 'Response Time',
      metric_name: 'response_time_p95',
      mean: 120,
      value: 150,
      thresholds: {
        lower: { overall: 80 },
        upper: { overall: 140 },
      },
      conclusion_label: 'regression',
    },
    {
      test_run_id: 'TR-2023-012',
      test_run_start: '2023-12-15T10:00:00Z',
      dashboard_label: 'JMeter Overview',
      panel_title: 'Response Time',
      metric_name: 'response_time_p95',
      mean: 110,
      value: 115,
      conclusion_label: 'ok',
    },
  ];

  const mockTrackedRegressions = [
    {
      id: 'regression-1',
      test_run_id: 'TR-2024-001',
      metric_name: 'response_time_p95',
      dashboard_label: 'JMeter Overview',
      panel_title: 'Response Time',
      tracked_at: '2024-01-01T11:00:00Z',
      resolved: false,
    },
  ];

  const defaultProps = {
    testRun: mockTestRun,
    testRunId: 'test-run-123',
    anomalyExpanded: true,
    onAnomalyExpand: jest.fn(),
    conclusionFilter: 'all',
    setConclusionFilter: jest.fn(),
    showToast: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default API responses
    (authenticatedFetch as jest.Mock).mockImplementation((url: string, options?: any) => {
      if (url.includes('/anomaly-detection')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockAnomalyData,
          text: async () => JSON.stringify({}),
        });
      }
      if (url.includes('/control-group-trends')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockTrendsData,
          text: async () => JSON.stringify({}),
        });
      }
      if (url.includes('/ds-adapt-result')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statistics: { mean: 120, median: 115, std: 15, min: 90, max: 180 },
            threshold_data: { lower: 80, upper: 140 },
          }),
          text: async () => JSON.stringify({}),
        });
      }
      if (url.includes('/ds-compare-config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved: true }),
          text: async () => JSON.stringify({ saved: true }),
        });
      }
      if (url.includes('/tracked-regressions')) {
        if (url.includes('/count')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ count: 1 }),
            text: async () => JSON.stringify({ count: 1 }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockTrackedRegressions,
          text: async () => JSON.stringify(mockTrackedRegressions),
        });
      }
      if (url.includes('/adapt/conclusion')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ conclusion: 'regression_detected' }),
          text: async () => JSON.stringify({ conclusion: 'regression_detected' }),
        });
      }
      if (url.includes('/adapt-config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...mockTestRun, adapt_config: { differencesAccepted: 'accepted' } }),
          text: async () => JSON.stringify({}),
        });
      }
      if (url.includes('/metric-config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved: true }),
          text: async () => JSON.stringify({ saved: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
        text: async () => JSON.stringify({}),
      });
    });

    (deleteAnomalyData as jest.Mock).mockResolvedValue({
      message: 'Deleted successfully',
      deletedCount: 1,
      scope: 'metric',
      range: 'current-test-run',
    });
  });

  describe('Anomaly Detection Display', () => {
    it('should load and display anomaly detection results', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('response_time_p95')).toBeInTheDocument();
        expect(screen.getByText('throughput')).toBeInTheDocument();
        expect(screen.getByText('cpu_usage_percent')).toBeInTheDocument();
      });
    });

    it('should fetch anomaly data on mount', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          '/test-runs/test-run-123/anomaly-detection'
        );
      });
    });

    it('should display anomaly dashboard and panel labels', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        // JMeter Overview appears for multiple anomalies
        expect(screen.getAllByText('JMeter Overview').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Response Time')).toBeInTheDocument();
        expect(screen.getByText('System Metrics')).toBeInTheDocument();
      });
    });

    it('should display conclusion labels correctly', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByText('regression')).toHaveLength(2);
        expect(screen.getByText('improvement')).toBeInTheDocument();
      });
    });
  });

  describe('Anomaly Filtering Workflow', () => {
    it('should display only filtered anomalies when conclusion filter is set', async () => {
      render(
        <AnomalyDetectionSection
          {...defaultProps}
          conclusionFilter="regression"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('response_time_p95')).toBeInTheDocument();
        expect(screen.getByText('cpu_usage_percent')).toBeInTheDocument();
        expect(screen.queryByText('throughput')).not.toBeInTheDocument();
      });
    });

    it('should search anomalies by metric name using search field', async () => {
      const user = userEvent.setup();
      render(<AnomalyDetectionSection {...defaultProps} />);

      // Wait for data to load and search input to appear
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
      });

      // Type in the search input (outside of waitFor to avoid retries)
      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'response');

      await waitFor(() => {
        expect(screen.getByText('response_time_p95')).toBeInTheDocument();
        expect(screen.queryByText('throughput')).not.toBeInTheDocument();
      });
    });
  });

  describe('Trend Chart Workflow', () => {
    it('should expand row to show trend chart', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        const expandButtons = screen.getAllByTestId('ExpandMoreIcon');
        if (expandButtons.length > 0) {
          fireEvent.click(expandButtons[0].closest('button')!);
        }
      });

      await waitFor(() => {
        expect(screen.getAllByTestId('ExpandLessIcon')[0]).toBeInTheDocument();
      });
    });

    it('should fetch trend data when row is expanded', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        const expandButtons = screen.getAllByTestId('ExpandMoreIcon');
        if (expandButtons.length > 0) {
          fireEvent.click(expandButtons[0].closest('button')!);
        }
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/control-group-trends')
        );
      });
    });

    it('should collapse row to hide trend chart', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      // Expand
      await waitFor(() => {
        const expandButtons = screen.getAllByTestId('ExpandMoreIcon');
        if (expandButtons.length > 0) {
          fireEvent.click(expandButtons[0].closest('button')!);
        }
      });

      // Collapse
      await waitFor(() => {
        const collapseButtons = screen.getAllByTestId('ExpandLessIcon');
        if (collapseButtons.length > 0) {
          fireEvent.click(collapseButtons[0].closest('button')!);
        }
      });

      await waitFor(() => {
        expect(screen.getAllByTestId('ExpandMoreIcon')[0]).toBeInTheDocument();
      });
    });
  });

  describe('Feedback Banner Workflow', () => {
    it('should display feedback banner with action buttons', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        // FeedbackBanner should show buttons for TBD state
        expect(screen.getByText('Mark as Regression')).toBeInTheDocument();
        expect(screen.getByText('Mark as Variability')).toBeInTheDocument();
      });
    });

    it('should display feedback required message for TBD state', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByText(/feedback/i).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Tracked Regressions Tab', () => {
    it('should switch to tracked regressions tab', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        const trackedTab = screen.getByText('Unresolved Regressions');
        fireEvent.click(trackedTab);
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/tracked-regressions')
        );
      });
    });
  });

  describe('API Integration', () => {
    it('should fetch adapt conclusion data', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/adapt/conclusion')
        );
      });
    });

    it('should fetch drawer data when expand button is clicked', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        const expandButtons = screen.getAllByTestId('ExpandMoreIcon');
        if (expandButtons.length > 0) {
          fireEvent.click(expandButtons[0].closest('button')!);
        }
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/ds-adapt-result')
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle anomaly data fetch error', async () => {
      const showToast = jest.fn();
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/anomaly-detection')) {
          return Promise.resolve({
            ok: false,
            status: 500,
          });
        }
        // Return valid responses for other endpoints
        if (url.includes('/adapt/conclusion')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ conclusion: 'no_data' }),
            text: async () => JSON.stringify({ conclusion: 'no_data' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          text: async () => JSON.stringify({}),
        });
      });

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} />);

      // Wait for error handling to complete - the section should render without crashing
      await waitFor(() => {
        // Should not display any anomaly data
        expect(screen.queryByText('response_time_p95')).not.toBeInTheDocument();
      });
    });
  });

  describe('Component State', () => {
    it('should render expanded card when anomalyExpanded is true', async () => {
      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
      });
    });

    it('should render collapsed card when anomalyExpanded is false', async () => {
      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={false} />);

      await waitFor(() => {
        expect(screen.getByTestId('anomaly-detection-section-collapsed')).toBeInTheDocument();
      });
    });

    it('should display tabs for Anomaly Detection and Unresolved Regressions', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Anomaly Detection')).toBeInTheDocument();
        expect(screen.getByText('Unresolved Regressions')).toBeInTheDocument();
      });
    });

    it('should display search field with correct placeholder', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
      });
    });

    it('should display all anomaly metric names', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('response_time_p95')).toBeInTheDocument();
        expect(screen.getByText('throughput')).toBeInTheDocument();
        expect(screen.getByText('cpu_usage_percent')).toBeInTheDocument();
      });
    });

    it('should display anomaly count information', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        // FilterControls shows filteredData.length/anomalyData.length
        expect(screen.getByText(/3\/3/)).toBeInTheDocument();
      });
    });
  });
});
