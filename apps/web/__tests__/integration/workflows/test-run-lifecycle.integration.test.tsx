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
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import TestRunDetailsPage from '@/app/test-runs/[id]/page';
import { useTestRunRealtime } from '@/hooks/useTestRunRealtime';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

// Stable mock references to prevent infinite re-render loops in useEffect dependencies
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  refresh: jest.fn(),
};
const mockParams = { id: 'test-run-123' };
// A real URLSearchParams: the "Open in …" menu copies the page's params into its links.
const mockSearchParams = new URLSearchParams({ system: 'my-app', environment: 'production', workload: 'baseline' });

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

// The real cascade, plus a hidden probe of the in-page link request it receives: the page's
// hand-off of a plain "Open in …" click to the card's picker is otherwise invisible here.
jest.mock('@/app/test-runs/[id]/components/shared/MetricSeriesCascade', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('@/app/test-runs/[id]/components/shared/MetricSeriesCascade');
  const { CardLinkRequestContext } = jest.requireActual('@/app/test-runs/[id]/components/shared/metric-card-links');
  const Probed = (props: { card: string }) => {
    const { request } = React.useContext(CardLinkRequestContext);
    return React.createElement(React.Fragment, null,
      React.createElement('span', { 'data-testid': `link-request-${props.card}`, hidden: true },
        request && request.card === props.card ? `${request.id}:${request.ref.metricName}` : ''),
      React.createElement(actual.MetricSeriesCascade, props));
  };
  return { ...actual, __esModule: true, default: Probed, MetricSeriesCascade: Probed, SeriesCascadePanel: Probed };
});

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

      // TrendsCard loads the dashboards for its picker (the /related prefetch it used to
      // make was read by nobody and is gone)
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/grafana/application-dashboards'),
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

  describe('Tabs: re-click collapses, a visited tab stays mounted, links reveal their card', () => {
    const tab = (name: string) => screen.getByRole('tab', { name });
    // The header carries an "actions" menu too; a row's menu is the one inside the section.
    const rowActions = () => within(screen.getByTestId('anomaly-detection-section-expanded')).getAllByLabelText('actions');
    const ok =(body: unknown) => Promise.resolve({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
    // The RCA tab's AWR and Dynatrace cards read react-query; the app's providers.tsx supplies it.
    const renderPage = () => render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TestRunDetailsPage />
      </QueryClientProvider>,
    );

    it('collapses only the ACTIVE tab\'s cards on a re-click of that tab, and nothing on a switch', async () => {
      // Value: protects=re-clicking a tab collapses that tab's cards and no other tab's; switching collapses none; fails_when=a Tab onClick drops its guard, checks the wrong index, or collapses every tab; why_new=no page test clicks a tab twice; seam=none; no_claim=scroll position after the collapse
      renderPage();
      fireEvent.click(await screen.findByTestId('test-run-details-card-collapsed'));
      fireEvent.click(await screen.findByTestId('config-comparison-section-collapsed'));
      await screen.findByTestId('test-run-details-card-expanded');
      await screen.findByTestId('config-comparison-section-expanded');

      // Away and back, through both other tabs, is three switches and no re-click: nothing collapses.
      fireEvent.click(tab('Reporting'));
      fireEvent.click(await screen.findByTestId('trends-card-collapsed'));
      await screen.findByTestId('trends-card-expanded');
      fireEvent.click(tab('Root Cause Analysis'));
      await screen.findByTestId('dynatrace-card-collapsed');
      fireEvent.click(tab('Results'));
      expect(screen.getByTestId('test-run-details-card-expanded')).toBeInTheDocument();
      expect(screen.getByTestId('config-comparison-section-expanded')).toBeInTheDocument();

      // A re-click collapses this tab's cards; Trends, open on the hidden Reporting tab, stays open.
      fireEvent.click(tab('Results'), { detail: 1 });
      await waitFor(() => expect(screen.getByTestId('test-run-details-card-collapsed')).toBeInTheDocument());
      expect(screen.getByTestId('config-comparison-section-collapsed')).toBeInTheDocument();
      expect(screen.getByTestId('trends-card-expanded')).toBeInTheDocument();

      // Reporting and RCA each carry their own index in their handler.
      fireEvent.click(tab('Reporting'));
      fireEvent.click(tab('Reporting'), { detail: 1 });
      await waitFor(() => expect(screen.getByTestId('trends-card-collapsed')).toBeInTheDocument());
      fireEvent.click(tab('Root Cause Analysis'));
      fireEvent.click(screen.getByTestId('awr-report-card-collapsed'));
      await screen.findByTestId('awr-report-card-expanded');
      fireEvent.click(tab('Root Cause Analysis'), { detail: 1 });
      await waitFor(() => expect(screen.getByTestId('awr-report-card-collapsed')).toBeInTheDocument());
    });

    it('collapses nothing on a double-click into another tab, or on keyboard activation of the active one', async () => {
      // Value: protects=only a single pointer click on the active tab collapses; fails_when=the detail===1 guard is dropped (a double-click's second click, or Enter/Space, would collapse); why_new=red-team + design cycle 2; seam=none; no_claim=real keyboard focus handling (jsdom click with detail 0 stands in for Enter)
      renderPage();
      fireEvent.click(await screen.findByTestId('test-run-details-card-collapsed'));
      await screen.findByTestId('test-run-details-card-expanded');
      fireEvent.click(tab('Reporting'));
      fireEvent.click(await screen.findByTestId('trends-card-collapsed'));
      await screen.findByTestId('trends-card-expanded');
      fireEvent.click(tab('Results'));

      // Double-click on Reporting: the first click switches, the second (detail 2) lands on the now-active tab.
      fireEvent.click(tab('Reporting'), { detail: 1 });
      fireEvent.click(tab('Reporting'), { detail: 2 });
      expect(screen.getByTestId('trends-card-expanded')).toBeInTheDocument();

      // Keyboard activation (Enter/Space) arrives as a click with detail 0.
      fireEvent.click(tab('Reporting'), { detail: 0 });
      expect(screen.getByTestId('trends-card-expanded')).toBeInTheDocument();
    });

    it('mounts a tab on its first visit, then keeps it (and its cards\' own state) mounted while hidden', async () => {
      // Value: protects=a hidden tab keeps card-internal state, is not visible, unvisited tabs stay unmounted, and showing a tab relayouts only its own charts; fails_when=panels go back to activeTab===N, all tabs mount eagerly, hidden is dropped, or the resize stops being panel-scoped; why_new=no test switches away and back; seam=none; no_claim=Plotly relayout itself (window.Plotly stubbed)
      const resize = jest.fn(() => Promise.resolve());
      (window as unknown as { Plotly?: unknown }).Plotly = { Plots: { resize } };
      try {
        renderPage();
        fireEvent.click(await screen.findByTestId('anomaly-detection-section-collapsed'));
        fireEvent.change(await screen.findByPlaceholderText('Search...'), { target: { value: 'response' } });

        // Neither other tab has been visited, so nothing in them is mounted (or fetching).
        expect(screen.queryByTestId('trends-card-collapsed')).not.toBeInTheDocument();
        expect(screen.queryByTestId('dynatrace-card-collapsed')).not.toBeInTheDocument();

        fireEvent.click(tab('Reporting'));
        await screen.findByTestId('trends-card-collapsed');
        // Stand-in charts, one per panel: a shown panel's chart is relaid out, a hidden one's is not.
        const reportingChart = document.createElement('div');
        reportingChart.className = 'js-plotly-plot';
        reportingChart.id = 'stand-in-reporting-chart';
        document.getElementById('tabpanel-reporting')!.appendChild(reportingChart);
        const resultsChart = document.createElement('div');
        resultsChart.className = 'js-plotly-plot';
        resultsChart.id = 'stand-in-results-chart';
        document.getElementById('tabpanel-results')!.appendChild(resultsChart);

        fireEvent.click(tab('Results'));
        // The anomaly search lives inside the section, not on the page: it survived the round trip.
        expect(screen.getByPlaceholderText('Search...')).toHaveValue('response');
        expect(screen.getByTestId('trends-card-collapsed')).toBeInTheDocument();
        expect(screen.getByTestId('trends-card-collapsed')).not.toBeVisible();
        expect(screen.queryByTestId('dynatrace-card-collapsed')).not.toBeInTheDocument();

        resize.mockClear();
        fireEvent.click(tab('Reporting'));
        await waitFor(() => expect(resize).toHaveBeenCalledWith(reportingChart));
        expect(resize).not.toHaveBeenCalledWith(resultsChart);
      } finally {
        delete (window as unknown as { Plotly?: unknown }).Plotly;
      }
    });

    it('lands a ?card= link on Reporting without mounting the Results tab it never showed', async () => {
      // Value: protects=a card deep link mounts only the tab it lands on; fails_when=visitedTabs records Results while the loading spinner shows; why_new=every other page test starts without ?card; seam=none; no_claim=the series walk
      (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams({ system: 'my-app', environment: 'production', workload: 'baseline', card: 'graphs' }));
      try {
        renderPage();
        await screen.findByTestId('graphs-card-expanded');
        expect(screen.queryByTestId('anomaly-detection-section-collapsed')).not.toBeInTheDocument();
        expect(screen.queryByTestId('performance-analysis-card-collapsed')).not.toBeInTheDocument();
      } finally {
        (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
      }
    });

    it('holds a hidden tab on the testRun it last showed, and catches it up when shown', async () => {
      // Value: protects=a live-run update re-renders only the shown tab's cards; a hidden tab catches up on show; fails_when=hidden panels get the live testRun again, or never get the update; why_new=no test pushes a realtime update while another tab is shown; seam=none; no_claim=which fetches a frozen card skips
      renderPage();
      const details = await screen.findByTestId('test-run-details-card-collapsed');
      expect(within(details).queryAllByText('Stale')).toHaveLength(0);

      fireEvent.click(tab('Reporting'));
      await screen.findByTestId('trends-card-collapsed');
      const { onTestRunUpdated } = (useTestRunRealtime as jest.Mock).mock.calls.at(-1)![0];
      act(() => onTestRunUpdated({ ...mockTestRun, is_stale: true }));
      // Results is hidden: its card still shows the run as it was.
      expect(within(screen.getByTestId('test-run-details-card-collapsed')).queryAllByText('Stale')).toHaveLength(0);

      fireEvent.click(tab('Results'));
      await waitFor(() => expect(within(screen.getByTestId('test-run-details-card-collapsed')).queryAllByText('Stale').length).toBeGreaterThan(0));
    });

    it('reveals the Reporting card from a row\'s "Open in …" click even when the URL does not change', async () => {
      // Value: protects=a plain Open-in click is handed to OpenCardLinkContext, which switches to the card's tab, expands it, and gives its picker a fresh request each click; fails_when=the page stops providing OpenCardLinkContext or CardLinkRequestContext, or revealCard stops switching/expanding; why_new=menu and cascade tests each supply their own provider; seam=none; no_claim=the series walk itself (cascade tests)
      // The mocked search params never change here, so the ?card effect cannot be what reveals it.
      render(<TestRunDetailsPage />);
      fireEvent.click(await screen.findByTestId('anomaly-detection-section-collapsed'));
      await screen.findByText('response_time_p95');
      fireEvent.click(rowActions()[0]);
      fireEvent.click(await screen.findByText('Open in Trends'));

      await waitFor(() => expect(tab('Reporting')).toHaveAttribute('aria-selected', 'true'));
      await screen.findByTestId('trends-card-expanded');
      // The row's series reached the Trends picker as an in-page request…
      await waitFor(() => expect(screen.getByTestId('link-request-trends')).toHaveTextContent(/^\d+:response_time_p95$/));
      const firstId = screen.getByTestId('link-request-trends').textContent!.split(':')[0];

      // …and the same row again is a new request, so its series is walked again.
      fireEvent.click(tab('Results'));
      fireEvent.click(rowActions()[0]);
      fireEvent.click(await screen.findByText('Open in Trends'));
      await waitFor(() => expect(screen.getByTestId('link-request-trends').textContent!.split(':')[0]).not.toBe(firstId));
    });

    it('opens a Dynatrace drill-down on Services even after the RCA tab was visited without one', async () => {
      // Value: protects=every row drill-down to Dynatrace lands on the Services tab; fails_when=the RCA tab stays mounted and the card's once-only primary-tab default already chose Hosts; why_new=no test drills down after a plain RCA visit; seam=none; no_claim=Distributed Tracing card
      // Regression: before tabs stayed mounted, leaving RCA unmounted DynatraceCard, so every
      // drill-down remounted it with initialFilters and useDynatraceData's default picked Services.
      const perfRow = {
        dashboard_label: 'Performance test metrics S', panel_title: 'Transaction RT', metric_name: 'T01', unit: 'ms',
        classification: 'red_duration', conclusion_label: 'regression', test_value: '150', control_group_value: '100',
        difference: '50', application_dashboard_id: 'app-dash-2', panel_id: 101, is_stale: false,
      };
      const defaults = (authenticatedFetch as jest.Mock).getMockImplementation()!;
      (authenticatedFetch as jest.Mock).mockImplementation((url: string, options?: any) => {
        if (url === '/dynatrace') return ok([{ id: 'dt-1', name: 'tenant', host: 'https://t.live.dynatrace.com' }]);
        if (url.startsWith('/dynatrace/entities/mappings')) {
          return ok([
            { id: 'm-1', entityId: 'HOST-1', entityType: 'HOST', entityDisplayName: 'host-a' },
            { id: 'm-2', entityId: 'SERVICE-1', entityType: 'SERVICE', entityDisplayName: 'svc-a' },
          ]);
        }
        if (url.includes('/request-names')) return ok([]);
        if (url.includes('/anomaly-detection')) return ok([perfRow]);
        return defaults(url, options);
      });

      renderPage();
      await screen.findAllByText('TR-2024-001');

      // A plain visit: no filters, hosts exist, so the card opens on Hosts.
      fireEvent.click(tab('Root Cause Analysis'));
      fireEvent.click(await screen.findByTestId('dynatrace-card-collapsed'));
      await waitFor(() => expect(tab('Hosts (1)')).toHaveAttribute('aria-selected', 'true'));

      fireEvent.click(tab('Results'));
      fireEvent.click(await screen.findByTestId('anomaly-detection-section-collapsed'));
      await screen.findAllByText('T01');
      fireEvent.click(rowActions()[0]);
      fireEvent.click(await screen.findByText('View in Dynatrace'));

      await waitFor(() => expect(tab('Root Cause Analysis')).toHaveAttribute('aria-selected', 'true'));
      // The drill-down remounts the card, which refetches its mappings before defaulting the tab:
      // past waitFor's 1 s default under a full parallel run. A regression never selects
      // Services, so it fails at any timeout.
      await waitFor(() => expect(tab('Services (1)')).toHaveAttribute('aria-selected', 'true'), { timeout: 5000 });
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
