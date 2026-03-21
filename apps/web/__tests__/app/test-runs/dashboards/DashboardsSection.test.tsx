/**
 * Unit tests for DashboardsSection Component
 *
 * Tests dashboard display and management:
 * - Collapsed and expanded rendering states
 * - Dashboard loading and API integration
 * - Tag filtering with OR logic
 * - Text search filtering
 * - Dashboard viewing and interaction
 * - Expand/collapse with auto-focus
 * - Empty states
 * - Error handling
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardsSection from '@/app/test-runs/[id]/components/dashboards/DashboardsSection';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

// Mock authenticated fetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

// Mock filterSystemTags from shared package utils
jest.mock('@perfana/shared/utils', () => ({
  filterSystemTags: jest.fn((tags: string[]) =>
    tags ? tags.filter((tag: string) => !tag.startsWith('system:') && !tag.startsWith('perfana') && !tag.startsWith('$') && tag !== 'no-anomaly-detection') : []
  ),
}));

// Mock sessionStorage
const mockSessionStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
});

describe('DashboardsSection', () => {
  const mockShowToast = jest.fn();
  const mockOnDashboardsExpand = jest.fn();

  const mockTestRun: TestRun = {
    id: '123',
    test_run_id: 'TR-2024-001',
    system_under_test_id: 'system-123',
    systems_under_test: {
      id: 'system-123',
      name: 'My Application',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    test_environment: 'production',
    workload: 'load-test-1',
    application_release: 'v1.2.3',
    start_time: '2024-01-15T10:00:00Z',
    end_time: '2024-01-15T11:00:00Z',
    duration: 3600,
    completed: true,
    abort: false,
    tags: [],
    annotations: [],
    consolidated_result: {
      overall: true,
      passed: true,
      meetsRequirement: true,
      adaptTestRunOK: true,
    },
    status: {
      evaluatingChecks: 'COMPLETED',
      evaluatingComparisons: 'COMPLETED',
      evaluatingAdapt: 'COMPLETED',
    },
    valid: true,
    created_at: '2024-01-15T09:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
  };

  const mockDashboards = [
    {
      id: 'dash-1',
      dashboard_label: 'JVM Metrics',
      dashboard_name: 'JVM Metrics Dashboard',
      dashboard_uid: 'jvm-123',
      dashboard_id: 1,
      grafana_instance: {
        client_url: 'http://localhost:3000',
      },
      tags: ['java', 'jvm', 'performance'],
      variables: [
        { name: 'system_under_test', values: ['My Application'] },
        { name: 'test_environment', values: ['production'] },
      ],
    },
    {
      id: 'dash-2',
      dashboard_label: 'HTTP Metrics',
      dashboard_name: 'HTTP Metrics Dashboard',
      dashboard_uid: 'http-456',
      dashboard_id: 2,
      grafana_instance: {
        client_url: 'http://localhost:3000',
      },
      tags: ['http', 'network', 'performance'],
      variables: [],
    },
    {
      id: 'dash-3',
      dashboard_label: 'Database Metrics',
      dashboard_name: 'Database Performance',
      dashboard_uid: 'db-789',
      dashboard_id: 3,
      grafana_instance: {
        client_url: 'http://localhost:3000',
      },
      tags: ['database', 'sql'],
      variables: [],
    },
  ];

  const defaultProps = {
    testRun: mockTestRun,
    testRunId: '123',
    dashboardsExpanded: false,
    onDashboardsExpand: mockOnDashboardsExpand,
    showToast: mockShowToast,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionStorage.clear();
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockDashboards,
    });
  });

  afterEach(() => {
    // Unmount all rendered components first to stop any pending effects
    cleanup();
  });

  // Helper: render and wait for async dashboard load to complete
  async function renderAndWaitForLoad(props = defaultProps) {
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<DashboardsSection {...props} />);
    });
    // Wait for the fetch to resolve and state to update.
    // Multiple act() cycles needed to flush the full chain:
    // useEffect -> loadApplicationDashboards -> authenticatedFetch -> .json()/.text() -> setState
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }
    return result!;
  }

  describe('Rendering - Collapsed State', () => {
    it('should render collapsed card with correct test ID', async () => {
      await renderAndWaitForLoad();
      expect(screen.getByTestId('dashboards-section-collapsed')).toBeInTheDocument();
    });

    it('should display "Grafana Dashboards" title', async () => {
      await renderAndWaitForLoad();
      expect(screen.getByText('Grafana Dashboards')).toBeInTheDocument();
    });

    it('should display expand icon in collapsed state', async () => {
      await renderAndWaitForLoad();
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should apply pointer cursor in collapsed state', async () => {
      await renderAndWaitForLoad();
      const card = screen.getByTestId('dashboards-section-collapsed');
      expect(card).toHaveStyle({ cursor: 'pointer' });
    });

    it('should show dashboard count after loading', async () => {
      await renderAndWaitForLoad();
      // The KPIDisplay shows the count (3) and the label "Dashboards Configured"
      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('Dashboards Configured')).toBeInTheDocument();
      });
    });

    it('should load dashboards on mount', async () => {
      await renderAndWaitForLoad();

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/grafana/application-dashboards'),
          expect.any(Object)
        );
      });
    });
  });

  describe('Rendering - Expanded State', () => {
    it('should render expanded card with correct test ID', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });
      expect(screen.getByTestId('dashboards-section-expanded')).toBeInTheDocument();
    });

    it('should display "Click to collapse" text when expanded', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });
      expect(screen.getByText('Click to collapse')).toBeInTheDocument();
    });

    it('should apply default cursor when expanded', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });
      const card = screen.getByTestId('dashboards-section-expanded');
      expect(card).toHaveStyle({ cursor: 'default' });
    });

    it('should show settings icon when expanded', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });
      const settingsButton = screen.getByLabelText('dashboard settings');
      expect(settingsButton).toBeInTheDocument();
    });

    it('should display dashboard search field when expanded', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search dashboards by label...')).toBeInTheDocument();
      });
    });

    it('should display tag filters when dashboards have tags', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('Filter by Tags')).toBeInTheDocument();
      });
    });
  });

  describe('Dashboard Loading', () => {
    it('should fetch dashboards with correct query parameters', async () => {
      await renderAndWaitForLoad();

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('systemId=system-123'),
          expect.any(Object)
        );
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('environment=production'),
          expect.any(Object)
        );
      });
    });

    it('should display loading spinner while fetching dashboards', async () => {
      // Use a mock that never resolves immediately - keep it pending
      let resolvePromise: (value: any) => void;
      (authenticatedFetch as jest.Mock).mockImplementation(
        () => new Promise(resolve => { resolvePromise = resolve; })
      );

      await act(async () => {
        render(<DashboardsSection {...defaultProps} dashboardsExpanded={true} />);
        await Promise.resolve();
      });

      // The loading spinner (CircularProgress) should show as a progressbar
      await waitFor(() => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
      });

      // Clean up: resolve the pending promise
      await act(async () => {
        resolvePromise!({ ok: true, json: async () => [] });
        await Promise.resolve();
      });
    });

    it('should display dashboards after successful load', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
        expect(screen.getByText('HTTP Metrics')).toBeInTheDocument();
        expect(screen.getByText('Database Metrics')).toBeInTheDocument();
      });
    });

    it('should handle 404 response gracefully', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText(/No dashboards configured/)).toBeInTheDocument();
      });
    });

    it('should handle API errors gracefully', async () => {
      // First call returns 500, subsequent calls return empty dashboards
      // (Component retries on error because dashboards stay empty and loading resets)
      let callCount = 0;
      (authenticatedFetch as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error',
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      });

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      // After the error and retry, the component should show empty state
      await waitFor(() => {
        expect(screen.getByText(/No dashboards configured/)).toBeInTheDocument();
      });

      // The fetch was called at least once (initial + retry)
      expect(authenticatedFetch).toHaveBeenCalled();
    });

    it('should not fetch when system_under_test_id is missing', async () => {
      const testRunWithoutSystem = { ...mockTestRun, system_under_test_id: undefined as any };
      await renderAndWaitForLoad({ ...defaultProps, testRun: testRunWithoutSystem, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText(/No dashboards configured|No dashboards available/)).toBeInTheDocument();
      });

      expect(authenticatedFetch).not.toHaveBeenCalled();
    });
  });

  describe('Tag Filtering', () => {
    it('should display all unique tags from dashboards', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        // Tags are rendered as MUI Chips in the filter area
        expect(screen.getAllByText('java').length).toBeGreaterThan(0);
        expect(screen.getAllByText('http').length).toBeGreaterThan(0);
        expect(screen.getAllByText('database').length).toBeGreaterThan(0);
        expect(screen.getAllByText('performance').length).toBeGreaterThan(0);
      });
    });

    it('should filter dashboards by selected tag', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      // Click 'database' tag to filter (unique tag - only on one dashboard)
      const databaseTags = screen.getAllByText('database');
      await act(async () => {
        fireEvent.click(databaseTags[0]);
      });

      await waitFor(() => {
        expect(screen.getByText('Database Metrics')).toBeInTheDocument();
        expect(screen.queryByText('JVM Metrics')).not.toBeInTheDocument();
      });
    });

    it('should support OR logic for multiple tag filters', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      // Click 'database' and 'http' tags (both unique to specific dashboards)
      const databaseTags = screen.getAllByText('database');
      const httpTags = screen.getAllByText('http');
      await act(async () => {
        fireEvent.click(databaseTags[0]);
        fireEvent.click(httpTags[0]);
      });

      await waitFor(() => {
        expect(screen.getByText('HTTP Metrics')).toBeInTheDocument();
        expect(screen.getByText('Database Metrics')).toBeInTheDocument();
        expect(screen.queryByText('JVM Metrics')).not.toBeInTheDocument();
      });
    });

    it('should deselect tag when clicked again', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const databaseTags = screen.getAllByText('database');
      await act(async () => {
        fireEvent.click(databaseTags[0]);
      });

      await waitFor(() => {
        expect(screen.queryByText('JVM Metrics')).not.toBeInTheDocument();
      });

      // Click again to deselect
      const databaseTagsAfter = screen.getAllByText('database');
      await act(async () => {
        fireEvent.click(databaseTagsAfter[0]);
      });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
        expect(screen.getByText('HTTP Metrics')).toBeInTheDocument();
        expect(screen.getByText('Database Metrics')).toBeInTheDocument();
      });
    });

    it('should show filter count when tags are selected', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      // Click 'database' tag (unique, on 1 dashboard)
      const databaseTags = screen.getAllByText('database');
      await act(async () => {
        fireEvent.click(databaseTags[0]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Showing 1 of 3 dashboards/)).toBeInTheDocument();
      });
    });
  });

  describe('Text Search Filtering', () => {
    it('should filter dashboards by search text', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search dashboards by label...');
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'JVM' } });
      });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
        expect(screen.queryByText('HTTP Metrics')).not.toBeInTheDocument();
        expect(screen.queryByText('Database Metrics')).not.toBeInTheDocument();
      });
    });

    it('should perform case-insensitive search', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search dashboards by label...');
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'jvm' } });
      });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });
    });

    it('should clear search when close button clicked', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search dashboards by label...');
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'JVM' } });
      });

      await waitFor(() => {
        expect(screen.queryByText('HTTP Metrics')).not.toBeInTheDocument();
      });

      // Click the clear button (IconButton with Close icon)
      const clearButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg')?.getAttribute('data-testid') === 'CloseIcon'
      );
      if (clearButton) {
        await act(async () => {
          fireEvent.click(clearButton);
        });
      }

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
        expect(screen.getByText('HTTP Metrics')).toBeInTheDocument();
      });
    });

    it('should combine text search with tag filters', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      // Apply tag filter - use 'performance' which is on JVM and HTTP
      const performanceTags = screen.getAllByText('performance');
      await act(async () => {
        fireEvent.click(performanceTags[0]);
      });

      // Apply text search
      const searchInput = screen.getByPlaceholderText('Search dashboards by label...');
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'JVM' } });
      });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
        expect(screen.queryByText('HTTP Metrics')).not.toBeInTheDocument();
      });
    });

    it('should show count with search text in message', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search dashboards by label...');
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'HTTP' } });
      });

      await waitFor(() => {
        expect(screen.getByText(/matching "HTTP"/)).toBeInTheDocument();
      });
    });
  });

  describe('Dashboard Interaction', () => {
    it('should open dashboard dialog when View button clicked', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByText('View');
      await act(async () => {
        fireEvent.click(viewButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('should display dashboard in iframe when opened', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByText('View');
      await act(async () => {
        fireEvent.click(viewButtons[0]);
      });

      await waitFor(() => {
        const iframe = screen.getByTitle(/Grafana Dashboard/);
        expect(iframe).toBeInTheDocument();
        expect(iframe).toHaveAttribute('src', expect.stringContaining('localhost:3000'));
      });
    });

    it('should close dashboard dialog when Close button clicked', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByText('View');
      await act(async () => {
        fireEvent.click(viewButtons[0]);
      });

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const closeButtons = screen.getAllByText('Close');
      await act(async () => {
        fireEvent.click(closeButtons[closeButtons.length - 1]);
      });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should open Grafana in new tab when "View in Grafana" clicked', async () => {
      const windowOpen = jest.spyOn(window, 'open').mockImplementation(() => null);

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewInGrafanaButtons = screen.getAllByText('View in Grafana');
      await act(async () => {
        fireEvent.click(viewInGrafanaButtons[0]);
      });

      expect(windowOpen).toHaveBeenCalledWith(
        expect.stringContaining('localhost:3000'),
        '_blank',
        'noopener,noreferrer'
      );

      windowOpen.mockRestore();
    });

    it('should open system config in new tab when settings clicked', async () => {
      const windowOpen = jest.spyOn(window, 'open').mockImplementation(() => null);

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      const settingsButton = screen.getByLabelText('dashboard settings');
      await act(async () => {
        fireEvent.click(settingsButton);
      });

      expect(windowOpen).toHaveBeenCalledWith(
        expect.stringContaining('/systems/system-123/config'),
        '_blank'
      );

      windowOpen.mockRestore();
    });
  });

  describe('Expand/Collapse Behavior', () => {
    it('should call onDashboardsExpand when collapsed card clicked', async () => {
      await renderAndWaitForLoad();

      const card = screen.getByTestId('dashboards-section-collapsed');
      await act(async () => {
        fireEvent.click(card);
      });

      expect(mockOnDashboardsExpand).toHaveBeenCalledTimes(1);
    });

    it('should call onDashboardsExpand when expand icon clicked', async () => {
      await renderAndWaitForLoad();

      const expandButton = screen.getAllByRole('button')[0];
      await act(async () => {
        fireEvent.click(expandButton);
      });

      expect(mockOnDashboardsExpand).toHaveBeenCalled();
    });

    it('should call onDashboardsExpand when header clicked in expanded state', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      const header = screen.getByText('Click to collapse');
      await act(async () => {
        fireEvent.click(header.closest('div')!);
      });

      expect(mockOnDashboardsExpand).toHaveBeenCalled();
    });

    it('should store preselect tag in sessionStorage when chip clicked in collapsed state', async () => {
      await renderAndWaitForLoad();

      // In collapsed state after load, tags appear as SoftBadge elements
      await waitFor(() => {
        const chips = screen.queryAllByText(/java|http|database|performance|jvm|network|sql/);
        expect(chips.length).toBeGreaterThan(0);
      });

      // Click a tag badge - this calls handleDashboardsExpand(tag) which stores in sessionStorage
      const chips = screen.getAllByText(/java|http|database|performance|jvm|network|sql/);
      await act(async () => {
        fireEvent.click(chips[0]);
      });

      expect(mockSessionStorage.getItem('dashboard-preselect-tag')).toBeTruthy();
    });
  });

  describe('Empty States', () => {
    it('should display empty state when no dashboards configured', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText(/No dashboards configured/)).toBeInTheDocument();
      });
    });

    it('should display system and environment info in empty state', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText(/My Application/)).toBeInTheDocument();
        expect(screen.getByText(/production/)).toBeInTheDocument();
      });
    });

    it('should display "no matches" message when filters have no results', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search dashboards by label...');
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'NonExistent' } });
      });

      await waitFor(() => {
        expect(screen.getByText(/No dashboards match the current filters/)).toBeInTheDocument();
      });
    });

    it('should show "Click to load" badge when no dashboards are loaded yet', async () => {
      // Mock a fetch that stays pending so dashboards never load
      (authenticatedFetch as jest.Mock).mockImplementation(
        () => new Promise(() => {})
      );

      await act(async () => {
        render(<DashboardsSection {...defaultProps} />);
        await Promise.resolve();
      });

      // In collapsed state with loading state, KPIDisplay shows a spinner
      // The SoftBadge shows "Click to load" when dashboards array is empty
      expect(screen.getByText('Click to load')).toBeInTheDocument();
    });
  });

  describe('Grafana URL Building', () => {
    it('should include time range in iframe URL', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByText('View');
      await act(async () => {
        fireEvent.click(viewButtons[0]);
      });

      await waitFor(() => {
        const iframe = screen.getByTitle(/Grafana Dashboard/);
        const src = iframe.getAttribute('src') || '';
        expect(src).toContain('from=');
        expect(src).toContain('to=');
      });
    });

    it('should use "now" for end time when test is running', async () => {
      const runningTestRun = { ...mockTestRun, completed: false, end_time: undefined };
      await renderAndWaitForLoad({ ...defaultProps, testRun: runningTestRun, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByText('View');
      await act(async () => {
        fireEvent.click(viewButtons[0]);
      });

      await waitFor(() => {
        const iframe = screen.getByTitle(/Grafana Dashboard/);
        const src = iframe.getAttribute('src') || '';
        expect(src).toContain('to=now');
      });
    });

    it('should include dashboard variables in URL', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByText('View');
      await act(async () => {
        fireEvent.click(viewButtons[0]);
      });

      await waitFor(() => {
        const iframe = screen.getByTitle(/Grafana Dashboard/);
        const src = iframe.getAttribute('src') || '';
        expect(src).toContain('var-system_under_test=');
        expect(src).toContain('var-test_environment=');
      });
    });

    it('should include kiosk mode in iframe URL', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByText('View');
      await act(async () => {
        fireEvent.click(viewButtons[0]);
      });

      await waitFor(() => {
        const iframe = screen.getByTitle(/Grafana Dashboard/);
        const src = iframe.getAttribute('src') || '';
        expect(src).toContain('kiosk');
      });
    });

    it('should not include kiosk mode when opening in new tab', async () => {
      const windowOpen = jest.spyOn(window, 'open').mockImplementation(() => null);

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewInGrafanaButtons = screen.getAllByText('View in Grafana');
      await act(async () => {
        fireEvent.click(viewInGrafanaButtons[0]);
      });

      const openedUrl = (windowOpen.mock.calls[0][0] as string);
      expect(openedUrl).not.toContain('kiosk');

      windowOpen.mockRestore();
    });
  });

  describe('Dashboard Tags Display', () => {
    it('should display tags on dashboard cards', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        // Tags should be visible on the cards
        const tags = screen.getAllByText('java');
        expect(tags.length).toBeGreaterThan(0);
      });
    });

    it('should filter system tags from display', async () => {
      const dashboardsWithSystemTags = [
        {
          ...mockDashboards[0],
          tags: ['system:internal', 'java', 'jvm'],
        },
      ];

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => dashboardsWithSystemTags,
      });

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getAllByText('java').length).toBeGreaterThan(0);
        expect(screen.queryByText('system:internal')).not.toBeInTheDocument();
      });
    });

    it('should display tags in dashboard dialog', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByText('View');
      await act(async () => {
        fireEvent.click(viewButtons[0]);
      });

      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // Tags should be visible in the dialog header
        const tagsInDialog = screen.getAllByText('java');
        expect(tagsInDialog.length).toBeGreaterThan(1);
      });
    });
  });

  describe('Dashboard Variables Display', () => {
    it('should display custom variables on dashboard cards', async () => {
      const dashboardsWithCustomVars = [
        {
          ...mockDashboards[0],
          variables: [
            { name: 'system_under_test', values: ['My Application'] },
            { name: 'custom_var', values: ['value1', 'value2'] },
          ],
        },
      ];

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => dashboardsWithCustomVars,
      });

      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText(/custom_var/)).toBeInTheDocument();
        expect(screen.getByText(/value1, value2/)).toBeInTheDocument();
      });
    });

    it('should not display system_under_test and test_environment variables', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      // These system variables should not be shown in the Variables section
      expect(screen.queryByText(/system_under_test:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/test_environment:/)).not.toBeInTheDocument();
    });

    it('should not display Variables section when only system variables exist', async () => {
      await renderAndWaitForLoad({ ...defaultProps, dashboardsExpanded: true });

      await waitFor(() => {
        expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
      });

      // The card for JVM Metrics has only system variables, so Variables section should not appear
      // Look for the absence of "Variables:" text near the JVM Metrics card
      const jvmCard = screen.getByText('JVM Metrics').closest('[class*="MuiCard"]');
      if (jvmCard) {
        expect(jvmCard.textContent).not.toContain('Variables:');
      }
    });
  });
});
