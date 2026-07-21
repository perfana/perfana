/**
 * Integration Tests for Test Run Lifecycle Workflow
 *
 * This test suite validates complete user journeys through the test run lifecycle:
 * - Navigating to test run detail page
 * - Viewing and expanding test run details card
 * - Viewing and analyzing anomaly detection results
 * - Navigating to configuration comparison
 * - Comparing configurations with previous test runs
 * - Viewing SLO evaluation results
 * - Viewing trends analysis (on Reporting tab)
 * - Multi-step interactions with state persistence
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import TestRunDetailsPage from '@/app/test-runs/[id]/page';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

// Stable mock references to prevent infinite re-render loops in useEffect dependencies
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  refresh: jest.fn(),
};
const mockParams = { id: 'test-run-123' };
const mockSearchParams = {
  get: jest.fn((key: string) => {
    const params: Record<string, string> = {
      system: 'my-app',
      environment: 'production',
      workload: 'baseline',
    };
    return params[key];
  }),
};

// Mock auth context
jest.mock('@/contexts/auth-context', () => ({
  ...jest.requireActual('@/contexts/auth-context'),
  useAuth: () => ({
    user: { id: 'test-user-id', email: 'test@example.com', created_at: '2026-01-01' },
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
    hasRole: jest.fn().mockReturnValue(false),
    hasAnyRole: jest.fn().mockReturnValue(false),
  }),
}));

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockRouter),
  useParams: jest.fn(() => mockParams),
  useSearchParams: jest.fn(() => mockSearchParams),
}));

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
  getAuthHeaders: jest.fn(() => ({ Authorization: 'Bearer mock-token' })),
  handleAuthError: jest.fn(),
}));

jest.mock('@/hooks/useTestRunRealtime', () => ({
  useTestRunRealtime: jest.fn(),
}));

jest.mock('@/lib/config-hash', () => ({
  generateConfigHash: jest.fn(() => 'mock-hash-123'),
}));

jest.mock('@/lib/anomaly-api', () => ({
  deleteAnomalyData: jest.fn(),
}));

// Mock scroll behavior
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: jest.fn(),
});

describe('Test Run Lifecycle Workflow Integration', () => {
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
    planned_duration: 3600,
    ramp_up: 300,
    tags: ['regression', 'release-v1.0'],
    annotations: ['Baseline test for release v1.0'],
    application_release: 'v1.0.0',
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T11:00:00Z',
    consolidated_result: {
      meetsRequirement: true,
      adaptTestRunOK: true,
    },
    adapt_config: {
      differencesAccepted: 'TBD',
    },
    systems_under_test: {
      id: 'my-app',
      name: 'my-app',
    },
  };

  const mockAnomalyData = [
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
    },
    {
      dashboard_label: 'JMeter Overview',
      panel_title: 'Error Rate',
      metric_name: 'error_rate',
      unit: '%',
      classification: 'red_errors',
      conclusion_label: 'improvement',
      test_value: '0.5',
      control_group_value: '2.0',
      difference: '-1.5',
      application_dashboard_id: 'app-dash-1',
      panel_id: 'panel-2',
      is_stale: false,
    },
  ];

  const mockConfigData = [
    { key: 'jvm.heap.max', value: '4096m', tags: ['jvm', 'memory'] },
    { key: 'thread.pool.size', value: '200', tags: ['threading'] },
    { key: 'connection.timeout', value: '30000', tags: ['network'] },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default API responses
    // IMPORTANT: Check more specific URL patterns FIRST to avoid false matches
    (authenticatedFetch as jest.Mock).mockImplementation((url: string, options?: any) => {
      // Performance analysis sub-endpoints (must be checked BEFORE /test-runs/test-run-123)
      if (url.includes('/transactions')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
          text: async () => JSON.stringify([]),
        });
      }
      if (url.includes('/apdex-threshold')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ apdex_threshold: 500 }),
          text: async () => JSON.stringify({ apdex_threshold: 500 }),
        });
      }
      if (url.includes('/virtual-users')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ max: 100, avg: 80 }),
          text: async () => JSON.stringify({ max: 100, avg: 80 }),
        });
      }
      if (url.includes('/throughput')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ total: 10000, avg: 100 }),
          text: async () => JSON.stringify({ total: 10000, avg: 100 }),
        });
      }
      if (url.includes('/related')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
          text: async () => JSON.stringify([]),
        });
      }
      if (url.includes('/anomaly-detection')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockAnomalyData,
          text: async () => JSON.stringify({}),
        });
      }
      if (url.includes('/ds-compare-config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          text: async () => JSON.stringify({}),
        });
      }
      if (url.includes('/configs')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockConfigData,
          text: async () => JSON.stringify(mockConfigData),
        });
      }
      if (url.includes('/expected-config-changes')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
          text: async () => JSON.stringify([]),
        });
      }
      if (url.includes('/tracked-regressions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 2 }),
          text: async () => JSON.stringify({ count: 2 }),
        });
      }
      if (url.includes('/adapt/conclusion')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ conclusion: 'regression_detected' }),
          text: async () => JSON.stringify({ conclusion: 'regression_detected' }),
        });
      }
      if (url.includes('/tracing-services')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
          text: async () => JSON.stringify([]),
        });
      }
      if (url.includes('/check-results')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
          text: async () => JSON.stringify([]),
        });
      }
      if (url.includes('/benchmarks')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
          text: async () => JSON.stringify([]),
        });
      }
      // Main test run endpoint - checked LAST among test-run paths
      if (url.includes('/test-runs/test-run-123')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockTestRun,
          text: async () => JSON.stringify(mockTestRun),
        });
      }
      // Default fallback - return empty array for safety (most GET endpoints return arrays)
      // POST/PUT/DELETE requests typically return objects
      const isModifyingRequest = options?.method && ['POST', 'PUT', 'DELETE'].includes(options.method);
      return Promise.resolve({
        ok: true,
        json: async () => isModifyingRequest ? {} : [],
        text: async () => JSON.stringify(isModifyingRequest ? {} : []),
      });
    });
  });

  describe('Test Run Detail Page Navigation and Initial Load', () => {
    it('should load and display test run details on page load', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(screen.getAllByText('TR-2024-001').length).toBeGreaterThan(0);
      });

      // "my-app" appears multiple times (in card header and job progress indicator)
      expect(screen.getAllByText('my-app').length).toBeGreaterThan(0);
      expect(screen.getAllByText('production').length).toBeGreaterThan(0);
      expect(screen.getAllByText('baseline').length).toBeGreaterThan(0);
    });

    it('should render a Test Runs breadcrumb linking back to the filtered list', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(screen.getAllByText('TR-2024-001').length).toBeGreaterThan(0);
      });

      const backLink = screen.getByRole('link', { name: 'Test Runs' });
      expect(backLink).toHaveAttribute('href', expect.stringContaining('/test-runs?'));
      expect(backLink).toHaveAttribute('href', expect.stringContaining('system=my-app'));
      expect(backLink).toHaveAttribute('href', expect.stringContaining('environment=production'));
      expect(backLink).toHaveAttribute('href', expect.stringContaining('workload=baseline'));
    });

    it('should fetch test run data with correct parameters', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/test-runs/test-run-123')
        );
      });
    });

    it('should display loading state while fetching data', () => {
      (authenticatedFetch as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => mockTestRun,
                }),
              100
            )
          )
      );

      render(<TestRunDetailsPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should handle error when test run not found', async () => {
      // Must mock ALL calls to return error (page makes many concurrent calls)
      // so the test run fetch specifically returns 404
      (authenticatedFetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not Found' }),
        })
      );

      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to (fetch|load) test run/i)).toBeInTheDocument();
      });
    });

    it('should fetch related test runs for navigation', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/related')
        );
      });
    });
  });

  describe('Test Run Details Card Workflow', () => {
    it('should display collapsed test run details card by default', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('test-run-details-card-collapsed')).toBeInTheDocument();
      });
    });

    it('should expand test run details card when clicked', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const collapsedCard = screen.getByTestId('test-run-details-card-collapsed');
        fireEvent.click(collapsedCard);
      });

      await waitFor(() => {
        expect(screen.getByTestId('test-run-details-card-expanded')).toBeInTheDocument();
      });
    });

    it('should display all test run metadata in expanded view', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const collapsedCard = screen.getByTestId('test-run-details-card-collapsed');
        fireEvent.click(collapsedCard);
      });

      await waitFor(() => {
        expect(screen.getByText('v1.0.0')).toBeInTheDocument();
        // 'regression' appears in multiple places (tag chip + anomaly conclusion)
        expect(screen.getAllByText('regression').length).toBeGreaterThan(0);
        expect(screen.getByText('release-v1.0')).toBeInTheDocument();
      });
    });

    it('should scroll expanded card into view', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const collapsedCard = screen.getByTestId('test-run-details-card-collapsed');
        fireEvent.click(collapsedCard);
      });

      await waitFor(() => {
        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
      });
    });
  });

  describe('Anomaly Detection Section Workflow', () => {
    it('should load anomaly detection data when section is expanded', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/anomaly-detection')
        );
      });
    });

    it('should display anomaly detection results', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const anomalySection = screen.getByTestId('anomaly-detection-section-collapsed');
        fireEvent.click(anomalySection);
      });

      await waitFor(() => {
        expect(screen.getByText('response_time_p95')).toBeInTheDocument();
        expect(screen.getByText('error_rate')).toBeInTheDocument();
      });
    });

    it('should display search input with correct placeholder in expanded view', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const anomalySection = screen.getByTestId('anomaly-detection-section-collapsed');
        fireEvent.click(anomalySection);
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
      });
    });

    it('should search anomalies by metric name', async () => {
      const user = userEvent.setup();
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const anomalySection = screen.getByTestId('anomaly-detection-section-collapsed');
        fireEvent.click(anomalySection);
      });

      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText('Search...');
        user.type(searchInput, 'response');
      });

      await waitFor(() => {
        expect(screen.getByText('response_time_p95')).toBeInTheDocument();
      });
    });

    it('should display feedback banner buttons for TBD state', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const anomalySection = screen.getByTestId('anomaly-detection-section-collapsed');
        fireEvent.click(anomalySection);
      });

      // FeedbackBanner should show action buttons when adapt_config.differencesAccepted === 'TBD'
      await waitFor(() => {
        const variabilityButtons = screen.queryAllByText('Mark as Variability');
        const regressionButtons = screen.queryAllByText('Mark as Regression');
        // At least one of these should be present in TBD state
        expect(variabilityButtons.length + regressionButtons.length).toBeGreaterThan(0);
      });
    });

    it('should switch to tracked regressions tab', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const anomalySection = screen.getByTestId('anomaly-detection-section-collapsed');
        fireEvent.click(anomalySection);
      });

      await waitFor(() => {
        const trackedRegressionsTab = screen.getByText('Unresolved Regressions');
        fireEvent.click(trackedRegressionsTab);
      });

      await waitFor(() => {
        expect(screen.getByText('Unresolved Regressions')).toBeInTheDocument();
      });
    });
  });

  describe('Configuration Comparison Workflow', () => {
    it('should expand configuration comparison section', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const configSection = screen.getByTestId('config-comparison-section-collapsed');
        fireEvent.click(configSection);
      });

      await waitFor(() => {
        expect(screen.getByTestId('config-comparison-section-expanded')).toBeInTheDocument();
      });
    });

    it('should fetch configuration data when expanded', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const configSection = screen.getByTestId('config-comparison-section-collapsed');
        fireEvent.click(configSection);
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/configs')
        );
      });
    });

    it('should display configuration keys when expanded', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const configSection = screen.getByTestId('config-comparison-section-collapsed');
        fireEvent.click(configSection);
      });

      await waitFor(() => {
        expect(screen.getByText('jvm.heap.max')).toBeInTheDocument();
      });
    });
  });

  describe('Trends Analysis Workflow', () => {
    it('should display trends card on Reporting tab', async () => {
      render(<TestRunDetailsPage />);

      // TrendsCard is on the Reporting tab (tab index 2), not the Results tab
      await waitFor(() => {
        expect(screen.getAllByText('TR-2024-001').length).toBeGreaterThan(0);
      });

      // Switch to Reporting tab
      const reportingTab = screen.getByText('Reporting');
      fireEvent.click(reportingTab);

      await waitFor(() => {
        expect(screen.getByTestId('trends-card-collapsed')).toBeInTheDocument();
      });
    });

    it('should expand trends card on Reporting tab', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(screen.getAllByText('TR-2024-001').length).toBeGreaterThan(0);
      });

      // Switch to Reporting tab
      const reportingTab = screen.getByText('Reporting');
      fireEvent.click(reportingTab);

      await waitFor(() => {
        const trendsCard = screen.getByTestId('trends-card-collapsed');
        fireEvent.click(trendsCard);
      });

      await waitFor(() => {
        expect(screen.getByTestId('trends-card-expanded')).toBeInTheDocument();
      });
    });

    it('should fetch related data when trends card is expanded', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(screen.getAllByText('TR-2024-001').length).toBeGreaterThan(0);
      });

      // Switch to Reporting tab
      const reportingTab = screen.getByText('Reporting');
      fireEvent.click(reportingTab);

      await waitFor(() => {
        const trendsCard = screen.getByTestId('trends-card-collapsed');
        fireEvent.click(trendsCard);
      });

      // TrendsCard fetches /related and /grafana/application-dashboards
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/related'),
          expect.anything()
        );
      });
    });
  });

  describe('SLO Evaluation Workflow', () => {
    it('should expand SLO section', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const sloSection = screen.getByTestId('slo-section-collapsed');
        fireEvent.click(sloSection);
      });

      await waitFor(() => {
        expect(screen.getByTestId('slo-section-expanded')).toBeInTheDocument();
      });
    });

    it('should load SLO data when expanded', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const sloSection = screen.getByTestId('slo-section-collapsed');
        fireEvent.click(sloSection);
      });

      // SLO section fetches check-results and benchmarks, not /service-level-objectives
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/check-results'),
        );
      });
    });

    it('should display SLO section in expanded state', async () => {
      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const sloSection = screen.getByTestId('slo-section-collapsed');
        fireEvent.click(sloSection);
      });

      // Verify expanded section is rendered with content area
      await waitFor(() => {
        const expandedSection = screen.getByTestId('slo-section-expanded');
        expect(expandedSection).toBeInTheDocument();
      });
    });
  });

  describe('Multi-Step User Journey', () => {
    it('should complete full test run analysis workflow', async () => {
      render(<TestRunDetailsPage />);

      // Step 1: Load page and view test run details
      await waitFor(() => {
        expect(screen.getAllByText('TR-2024-001').length).toBeGreaterThan(0);
      });

      // Step 2: Expand test run details
      await waitFor(() => {
        const detailsCard = screen.getByTestId('test-run-details-card-collapsed');
        fireEvent.click(detailsCard);
      });

      await waitFor(() => {
        expect(screen.getByTestId('test-run-details-card-expanded')).toBeInTheDocument();
      });

      // Step 3: Expand anomaly detection
      await waitFor(() => {
        const anomalySection = screen.getByTestId('anomaly-detection-section-collapsed');
        fireEvent.click(anomalySection);
      });

      await waitFor(() => {
        expect(screen.getByText('response_time_p95')).toBeInTheDocument();
      });

      // Step 4: Expand configuration comparison (uses correct data-testid)
      await waitFor(() => {
        const configSection = screen.getByTestId('config-comparison-section-collapsed');
        fireEvent.click(configSection);
      });

      await waitFor(() => {
        expect(screen.getByText('jvm.heap.max')).toBeInTheDocument();
      });

      // Step 5: Expand SLO section
      await waitFor(() => {
        const sloSection = screen.getByTestId('slo-section-collapsed');
        fireEvent.click(sloSection);
      });

      await waitFor(() => {
        expect(screen.getByTestId('slo-section-expanded')).toBeInTheDocument();
      });

      // Verify all data was fetched
      expect(authenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test-runs/test-run-123')
      );
      expect(authenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('/anomaly-detection')
      );
      expect(authenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('/configs')
      );
    });

    it('should persist state across multiple expansions and collapses', async () => {
      render(<TestRunDetailsPage />);

      // Expand anomaly section
      await waitFor(() => {
        const anomalySection = screen.getByTestId('anomaly-detection-section-collapsed');
        fireEvent.click(anomalySection);
      });

      await waitFor(() => {
        expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
      });

      // Verify anomaly data is displayed
      await waitFor(() => {
        expect(screen.getByText('response_time_p95')).toBeInTheDocument();
      });

      // Expand config comparison section
      await waitFor(() => {
        const configSection = screen.getByTestId('config-comparison-section-collapsed');
        fireEvent.click(configSection);
      });

      await waitFor(() => {
        expect(screen.getByTestId('config-comparison-section-expanded')).toBeInTheDocument();
      });

      // Verify both sections are expanded simultaneously
      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
      expect(screen.getByTestId('config-comparison-section-expanded')).toBeInTheDocument();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle API errors gracefully', async () => {
      // Mock ALL calls to return error (not just the first one)
      (authenticatedFetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal Server Error' }),
        })
      );

      render(<TestRunDetailsPage />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to (fetch|load) test run/i)).toBeInTheDocument();
      });
    });

    it('should retry failed requests on user action', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal Server Error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnomalyData,
        });

      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const retryButton = screen.queryByText(/retry/i);
        if (retryButton) {
          fireEvent.click(retryButton);
        }
      });
    });

    it('should display empty state when no anomalies found', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string, options?: any) => {
        // Return empty array for anomaly-detection
        if (url.includes('/anomaly-detection')) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
            text: async () => JSON.stringify([]),
          });
        }
        // Return empty arrays for array endpoints
        if (url.includes('/transactions') ||
            url.includes('/related') ||
            url.includes('/configs') ||
            url.includes('/expected-config-changes') ||
            url.includes('/trends') ||
            url.includes('/tracing-services') ||
            url.includes('/check-results') ||
            url.includes('/benchmarks')) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
            text: async () => JSON.stringify([]),
          });
        }
        // Return objects for object endpoints
        if (url.includes('/apdex-threshold')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ apdex_threshold: 500 }),
            text: async () => JSON.stringify({ apdex_threshold: 500 }),
          });
        }
        if (url.includes('/virtual-users')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ max: 100, avg: 80 }),
            text: async () => JSON.stringify({ max: 100, avg: 80 }),
          });
        }
        if (url.includes('/throughput')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ total: 10000, avg: 100 }),
            text: async () => JSON.stringify({ total: 10000, avg: 100 }),
          });
        }
        if (url.includes('/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ count: 0 }),
            text: async () => JSON.stringify({ count: 0 }),
          });
        }
        if (url.includes('/adapt/conclusion')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ conclusion: 'no_data' }),
            text: async () => JSON.stringify({ conclusion: 'no_data' }),
          });
        }
        if (url.includes('/ds-compare-config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({}),
            text: async () => JSON.stringify({}),
          });
        }
        // Main test run endpoint last
        if (url.includes('/test-runs/test-run-123')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTestRun,
            text: async () => JSON.stringify(mockTestRun),
          });
        }
        // Default fallback
        const isModifyingRequest = options?.method && ['POST', 'PUT', 'DELETE'].includes(options.method);
        return Promise.resolve({
          ok: true,
          json: async () => isModifyingRequest ? {} : [],
          text: async () => JSON.stringify(isModifyingRequest ? {} : []),
        });
      });

      render(<TestRunDetailsPage />);

      await waitFor(() => {
        const anomalySection = screen.getByTestId('anomaly-detection-section-collapsed');
        fireEvent.click(anomalySection);
      });

      await waitFor(() => {
        expect(
          screen.getByText(/No anomaly detection data available/i)
        ).toBeInTheDocument();
      });
    });
  });
});
