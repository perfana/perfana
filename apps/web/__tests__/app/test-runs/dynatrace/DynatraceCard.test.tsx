/**
 * Unit tests for DynatraceCard Component
 *
 * Tests the Dynatrace integration card functionality:
 * - Rendering in collapsed and expanded states
 * - Fetching configurations, entities, and metric names
 * - Tab navigation between services
 * - Request filtering (metric name, duration)
 * - Multidimensional analysis buttons
 * - Deep link generation and navigation
 * - Performance comparison functionality
 * - Loading and error states
 * - Auto-focus on expand
 * - Empty states
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DynatraceCard from '@/app/test-runs/[id]/components/dynatrace/DynatraceCard';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

// Mock authenticated fetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

describe('DynatraceCard', () => {
  const mockOnExpand = jest.fn();
  const mockWindowOpen = jest.fn();

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
    start_time: '2024-01-15T10:00:00Z',
    end_time: '2024-01-15T11:00:00Z',
    duration: 3600,
    completed: true,
    created_at: '2024-01-15T09:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
  };

  const mockConfigs = [
    {
      id: 'config-1',
      host: 'https://dynatrace.example.com',
      apiToken: 'mock-token',
      dynatraceType: 'saas' as const,
      perfanaTestRunIdAttribute: 'testRunId',
      perfanaRequestNameAttribute: 'requestName',
    },
  ];

  const mockEntityMappings = [
    {
      id: 'mapping-1',
      entityId: 'SERVICE-123',
      entityDisplayName: 'Frontend Service',
      entityType: 'SERVICE',
      systemUnderTestId: 'system-123',
      testEnvironment: 'production',
      workload: 'load-test-1',
      level: 'primary',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'mapping-2',
      entityId: 'SERVICE-456',
      entityDisplayName: 'Backend Service',
      entityType: 'SERVICE',
      systemUnderTestId: 'system-123',
      testEnvironment: 'production',
      workload: 'load-test-1',
      level: 'secondary',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ];

  // Metric names in pipe-delimited format: scenario|transaction|sampler
  const mockMetricNames = [
    'load-test|/api/users|HTTP Request',
    'load-test|/api/products|HTTP Request',
    'load-test|/api/orders|HTTP Request',
    'stress-test|/api/users|HTTP Request',
    'stress-test|/api/products|HTTP Request',
  ];

  // Initial filters to enable deeplinks and analysis buttons
  // These must match entries in mockMetricNames for isFullFilterSelected to be true
  const mockInitialFilters = {
    scenario: 'load-test',
    transaction: '/api/users',
    sampler: 'HTTP Request',
  };

  const mockRelatedTestRuns = [
    {
      test_run_id: 'TR-2024-000',
      created_at: '2024-01-14T10:00:00Z',
      completed: true,
      application_release: 'v1.2.2',
      start_time: '2024-01-14T10:00:00Z',
    },
    {
      test_run_id: 'TR-2024-002',
      created_at: '2024-01-16T10:00:00Z',
      completed: true,
      start_time: '2024-01-16T10:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    global.window.open = mockWindowOpen;
  });

  describe('Rendering - No Configuration', () => {
    it('should not render when no configurations exist and not loading', () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const { container } = render(
        <DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />
      );

      waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });
  });

  describe('Rendering - Collapsed State', () => {
    beforeEach(() => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => mockConfigs })
        .mockResolvedValueOnce({ ok: true, json: async () => mockEntityMappings })
        .mockResolvedValueOnce({ ok: true, json: async () => mockMetricNames });
    });

    it('should render collapsed card with correct test ID', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByTestId('dynatrace-card-collapsed')).toBeInTheDocument();
      });
    });

    it('should display "Dynatrace" title', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Dynatrace')).toBeInTheDocument();
      });
    });

    it('should show service count in primary info box', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Services / Hosts')).toBeInTheDocument();
        expect(screen.getByText('2 / 0')).toBeInTheDocument(); // 2 services, 0 hosts
      });
    });

    it('should show expand icon in collapsed state', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      });
    });

    it('should display service names as chips in collapsed state', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        const frontendElements = screen.getAllByText('Frontend Service');
        const backendElements = screen.getAllByText('Backend Service');
        expect(frontendElements.length).toBeGreaterThan(0);
        expect(backendElements.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
    });

    it('should show metrics count chip when metrics available', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        const metricsCount = screen.getAllByText('5');
        const metricsLabel = screen.getAllByText('metrics');
        expect(metricsCount.length).toBeGreaterThan(0);
        expect(metricsLabel.length).toBeGreaterThan(0);
      });
    });

    it('should show only first 3 services and "+n more" chip when more than 3', async () => {
      // Clear mocks set by beforeEach to use test-specific mocks
      (authenticatedFetch as jest.Mock).mockReset();

      const manyMappings = [
        ...mockEntityMappings,
        {
          id: 'mapping-3',
          entityId: 'SERVICE-789',
          entityDisplayName: 'Service 3',
          entityType: 'SERVICE',
          systemUnderTestId: 'system-123',
          testEnvironment: 'production',
          workload: 'load-test-1',
          level: 'secondary',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'mapping-4',
          entityId: 'SERVICE-012',
          entityDisplayName: 'Service 4',
          entityType: 'SERVICE',
          systemUnderTestId: 'system-123',
          testEnvironment: 'production',
          workload: 'load-test-1',
          level: 'secondary',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'mapping-5',
          entityId: 'SERVICE-345',
          entityDisplayName: 'Service 5',
          entityType: 'SERVICE',
          systemUnderTestId: 'system-123',
          testEnvironment: 'production',
          workload: 'load-test-1',
          level: 'secondary',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => mockConfigs })
        .mockResolvedValueOnce({ ok: true, json: async () => manyMappings })
        .mockResolvedValueOnce({ ok: true, json: async () => mockMetricNames });

      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        const countElements = screen.getAllByText('2');
        const moreElements = screen.getAllByText('more');
        expect(countElements.length).toBeGreaterThan(0);
        expect(moreElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Rendering - Expanded State', () => {
    beforeEach(() => {
      // Use mockImplementation to handle all calls dynamically
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        if (url.includes('/dynatrace')) {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        return Promise.resolve({ ok: false });
      });
    });

    it('should render expanded card with correct test ID', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByTestId('dynatrace-card-expanded')).toBeInTheDocument();
      });
    });

    it('should show tabs for each service', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        const frontendElements = screen.getAllByText('Frontend Service');
        const backendElements = screen.getAllByText('Backend Service');
        expect(frontendElements.length).toBeGreaterThan(0);
        expect(backendElements.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
    });

    it('should show request filtering section', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Request Filtering')).toBeInTheDocument();
      });
    });

    it('should show multidimensional analysis section', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Multidimensional Analysis')).toBeInTheDocument();
      });
    });

    it('should show performance insights section', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Performance Insights')).toBeInTheDocument();
      });
    });

    it('should show performance comparison section', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Performance Comparison')).toBeInTheDocument();
      });
    });
  });

  describe('API Data Fetching', () => {
    it('should fetch Dynatrace configurations on mount', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        return Promise.resolve({ ok: false });
      });

      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          '/dynatrace',
          expect.objectContaining({ method: 'GET' })
        );
      });
    });

    it('should fetch entity mappings with query parameters', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        return Promise.resolve({ ok: false });
      });

      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        // Check that entity mappings endpoint was called with the expected URL containing all query params
        const calls = (authenticatedFetch as jest.Mock).mock.calls;
        const mappingsCall = calls.find((call: [string, object?]) =>
          call[0].includes('/dynatrace/entities/mappings')
        );
        expect(mappingsCall).toBeDefined();
        expect(mappingsCall[0]).toContain('systemId=system-123');
        expect(mappingsCall[0]).toContain('environment=production');
        expect(mappingsCall[0]).toContain('workload=load-test-1');
      });
    });

    it('should fetch metric names', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        return Promise.resolve({ ok: false });
      });

      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        // Request names endpoint is called without options object
        expect(authenticatedFetch).toHaveBeenCalledWith('/test-runs/TR-2024-001/request-names');
      });
    });

    it('should fetch related test runs when expanded', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        return Promise.resolve({ ok: false });
      });

      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        // Related test runs endpoint is called without options object but with query params
        const calls = (authenticatedFetch as jest.Mock).mock.calls;
        const relatedCall = calls.find((call: [string, object?]) =>
          call[0].includes('/test-runs/TR-2024-001/related')
        );
        expect(relatedCall).toBeDefined();
        expect(relatedCall[0]).toContain('system=');
        expect(relatedCall[0]).toContain('environment=production');
        expect(relatedCall[0]).toContain('workload=load-test-1');
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading indicator while fetching data', async () => {
      (authenticatedFetch as jest.Mock).mockReturnValue(new Promise(() => {})); // Never resolves

      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      // Wait for the loading state to be set after the effect triggers
      await waitFor(() => {
        expect(screen.getByText('Loading entities...')).toBeInTheDocument();
      });
    });

    it('should show loading spinner in expanded view', async () => {
      (authenticatedFetch as jest.Mock).mockReturnValue(new Promise(() => {}));

      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Loading Dynatrace data...')).toBeInTheDocument();
      });
    });

    it('should show loading indicator for related test runs', async () => {
      // Use mockImplementation to handle all calls dynamically
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          // Never resolve to keep comparisonLoading=true
          return new Promise(() => {});
        }
        return Promise.resolve({ ok: false });
      });

      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Loading test runs...')).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('Error Handling', () => {
    it('should display error message on fetch failure', async () => {
      (authenticatedFetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should display error when API returns non-ok response', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: false });

      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText(/failed to fetch.*dynatrace/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should show configuration error chip in collapsed state', async () => {
      (authenticatedFetch as jest.Mock).mockRejectedValue(new Error('Config error'));

      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Configuration error')).toBeInTheDocument();
      });
    });
  });

  describe('Empty States', () => {
    it('should show empty state when no entity mappings exist', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        return Promise.resolve({ ok: false });
      });

      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('No Dynatrace entity mappings found for this test run.')).toBeInTheDocument();
      });
    });

    it('should show empty state for no related test runs', async () => {
      // Use mockImplementation for more reliable async handling
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          // Return empty array for related test runs
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        return Promise.resolve({ ok: false });
      });

      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('No Related Test Runs')).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('Expand/Collapse Behavior', () => {
    beforeEach(() => {
      // Use mockImplementation for more reliable handling of all API calls
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        return Promise.resolve({ ok: false });
      });
    });

    it('should call onExpand when card is clicked in collapsed state', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByTestId('dynatrace-card-collapsed')).toBeInTheDocument();
      });

      const card = screen.getByTestId('dynatrace-card-collapsed');
      fireEvent.click(card);

      expect(mockOnExpand).toHaveBeenCalledTimes(1);
    });

    it('should call onExpand when expand button is clicked', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      });

      const expandButton = screen.getAllByRole('button')[0];
      fireEvent.click(expandButton);

      expect(mockOnExpand).toHaveBeenCalled();
    });

    it('should not expand when clicking expanded card body', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByTestId('dynatrace-card-expanded')).toBeInTheDocument();
      });

      const card = screen.getByTestId('dynatrace-card-expanded');
      fireEvent.click(card);

      expect(mockOnExpand).not.toHaveBeenCalled();
    });
  });

  describe('Tab Navigation', () => {
    beforeEach(() => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        return Promise.resolve({ ok: false });
      });
    });

    it('should render primary tabs for entity types', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        // Get the primary tabs (Services/Hosts) using the aria-label
        const primaryTabList = screen.getByRole('tablist', { name: 'entity type tabs' });
        expect(primaryTabList).toBeInTheDocument();

        // Should show Services and Hosts tabs
        expect(screen.getByRole('tab', { name: /Services \(2\)/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Hosts \(0\)/ })).toBeInTheDocument();
      });
    });

    it('should render service tabs within Services panel', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        // Get the service tabs using the aria-label
        const serviceTabList = screen.getByRole('tablist', { name: 'dynatrace service tabs' });
        expect(serviceTabList).toBeInTheDocument();
      });

      // There should be tabs for each service entity (2 services)
      const serviceTabList = screen.getByRole('tablist', { name: 'dynatrace service tabs' });
      const serviceTabs = serviceTabList.querySelectorAll('[role="tab"]');
      expect(serviceTabs).toHaveLength(2);
    });

    it('should switch between service tabs', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        const serviceTabList = screen.getByRole('tablist', { name: 'dynatrace service tabs' });
        expect(serviceTabList).toBeInTheDocument();
      });

      // Get only the service tabs from the service tab list
      const serviceTabList = screen.getByRole('tablist', { name: 'dynatrace service tabs' });
      const serviceTabs = serviceTabList.querySelectorAll('[role="tab"]');

      // Click the second service tab
      fireEvent.click(serviceTabs[1]);

      // Tab should be switched (checked via MUI tab state)
      expect(serviceTabs[1]).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Request Filtering', () => {
    beforeEach(() => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        if (url.includes('/dynatrace')) {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        return Promise.resolve({ ok: false });
      });
    });

    it('should show scenario autocomplete when metrics available', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Scenario')).toBeInTheDocument();
      });
    });

    it('should show transaction and sampler autocompletes', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Transaction')).toBeInTheDocument();
        expect(screen.getByLabelText('Sampler')).toBeInTheDocument();
      });
    });

    it('should show min duration input', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Min Duration (ms)')).toBeInTheDocument();
      });
    });

    it('should show max duration input', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Max Duration (ms)')).toBeInTheDocument();
      });
    });

    it('should allow entering duration values', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Min Duration (ms)')).toBeInTheDocument();
      });

      const minDurationInput = screen.getByLabelText('Min Duration (ms)');
      fireEvent.change(minDurationInput, { target: { value: '100' } });

      expect(minDurationInput).toHaveValue(100);
    });
  });

  describe('Multidimensional Analysis', () => {
    beforeEach(() => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        if (url.includes('/dynatrace')) {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        return Promise.resolve({ ok: false });
      });
    });

    it('should show all multidimensional analysis buttons', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Response Times')).toBeInTheDocument();
        expect(screen.getByText('Failure Rate')).toBeInTheDocument();
        expect(screen.getByText('CPU Time')).toBeInTheDocument();
        expect(screen.getByText('I/O Time')).toBeInTheDocument();
        expect(screen.getByText('Database Calls')).toBeInTheDocument();
        expect(screen.getByText('Service Calls')).toBeInTheDocument();
        expect(screen.getByText('Wait Time')).toBeInTheDocument();
        expect(screen.getByText('Lock Time')).toBeInTheDocument();
      });
    });

    it('should open Dynatrace URL when analysis button clicked', async () => {
      // Use initialFilters to enable the buttons (isFullFilterSelected = true)
      render(
        <DynatraceCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
          initialFilters={mockInitialFilters}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Response Times')).toBeInTheDocument();
      });

      // Wait for filters to be applied and button to be enabled
      await waitFor(() => {
        const responseTimesButton = screen.getByText('Response Times').closest('button');
        expect(responseTimesButton).not.toBeDisabled();
      });

      const responseTimesButton = screen.getByText('Response Times').closest('button');
      expect(responseTimesButton).not.toBeNull();
      fireEvent.click(responseTimesButton!);

      await waitFor(() => {
        expect(mockWindowOpen).toHaveBeenCalled();
      });
    });
  });

  describe('Performance Insights (Deep Links)', () => {
    beforeEach(() => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        if (url.includes('/dynatrace')) {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        return Promise.resolve({ ok: false });
      });
    });

    it('should show all deep link buttons', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByText('Response Time Hotspots')).toBeInTheDocument();
        expect(screen.getByText('Distributed Tracing')).toBeInTheDocument();
        expect(screen.getByText('Outlier Analysis')).toBeInTheDocument();
        expect(screen.getByText('Method Hotspots')).toBeInTheDocument();
        expect(screen.getByText('Top Web Requests')).toBeInTheDocument();
        expect(screen.getByText('Exception Analysis')).toBeInTheDocument();
        expect(screen.getByText('Service Flow')).toBeInTheDocument();
      });
    });

    it('should open Dynatrace URL when deep link button clicked', async () => {
      // Use initialFilters to enable the buttons (isFullFilterSelected = true)
      render(
        <DynatraceCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
          initialFilters={mockInitialFilters}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Distributed Tracing')).toBeInTheDocument();
      });

      // Wait for filters to be applied and button to be enabled
      await waitFor(() => {
        const purePathsButton = screen.getByText('Distributed Tracing').closest('button');
        expect(purePathsButton).not.toBeDisabled();
      });

      const purePathsButton = screen.getByText('Distributed Tracing').closest('button');
      expect(purePathsButton).not.toBeNull();
      fireEvent.click(purePathsButton!);

      await waitFor(() => {
        expect(mockWindowOpen).toHaveBeenCalled();
      });
    });
  });

  describe('Performance Comparison', () => {
    beforeEach(() => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        if (url.includes('/dynatrace')) {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        return Promise.resolve({ ok: false });
      });
    });

    it('should show test run selection autocomplete', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Select Test Run for Comparison')).toBeInTheDocument();
      });
    });

    it('should display available test runs in autocomplete', async () => {
      render(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      // Wait for autocomplete to be rendered
      const autocomplete = await screen.findByLabelText('Select Test Run for Comparison');

      // Open the dropdown (MUI Autocomplete requires mouseDown, not click)
      fireEvent.mouseDown(autocomplete);

      // Related test runs should be available in dropdown
      await waitFor(() => {
        expect(screen.queryByText(/TR-2024-000/)).toBeInTheDocument();
      });
    });

    it('should show comparison button when test run selected', async () => {
      // Use initialFilters so compare button will be enabled
      render(
        <DynatraceCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
          initialFilters={mockInitialFilters}
        />
      );

      // Wait for autocomplete to be rendered
      const autocomplete = await screen.findByLabelText('Select Test Run for Comparison');

      // Open the dropdown
      fireEvent.mouseDown(autocomplete);

      // Wait for dropdown options to appear and select one
      const option = await screen.findByText('TR-2024-000');
      fireEvent.click(option);

      // Comparison button should appear
      await waitFor(() => {
        expect(screen.getByText('Compare in Dynatrace')).toBeInTheDocument();
      });
    });

    it('should open comparison URL when compare button clicked', async () => {
      // Use initialFilters to enable the compare button (isFullFilterSelected = true)
      render(
        <DynatraceCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
          initialFilters={mockInitialFilters}
        />
      );

      // Wait for autocomplete to be rendered
      const autocomplete = await screen.findByLabelText('Select Test Run for Comparison');

      // Open the dropdown
      fireEvent.mouseDown(autocomplete);

      // Wait for dropdown options to appear and select one
      const option = await screen.findByText('TR-2024-000');
      fireEvent.click(option);

      // Wait for compare button to appear and be enabled
      await waitFor(() => {
        const compareButton = screen.getByText('Compare in Dynatrace').closest('button');
        expect(compareButton).not.toBeDisabled();
      });

      const compareButton = screen.getByText('Compare in Dynatrace').closest('button');
      fireEvent.click(compareButton!);

      await waitFor(() => {
        expect(mockWindowOpen).toHaveBeenCalled();
      });
    });

    it('should clear selected test run when clear button clicked', async () => {
      // Use initialFilters for proper button states
      render(
        <DynatraceCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
          initialFilters={mockInitialFilters}
        />
      );

      // Wait for autocomplete to be rendered
      const autocomplete = await screen.findByLabelText('Select Test Run for Comparison');

      // Open the dropdown
      fireEvent.mouseDown(autocomplete);

      // Wait for dropdown options to appear and select one
      const option = await screen.findByText('TR-2024-000');
      fireEvent.click(option);

      // Click clear button
      await waitFor(() => {
        const clearButton = screen.getByText('Clear Selection');
        fireEvent.click(clearButton);
      });

      // Compare button should be hidden
      await waitFor(() => {
        expect(screen.queryByText('Compare in Dynatrace')).not.toBeInTheDocument();
      });
    });
  });

  describe('Auto-Focus on Expand', () => {
    beforeEach(() => {
      // Use mockImplementation for consistent handling of all API calls including rerenders
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/dynatrace') {
          return Promise.resolve({ ok: true, json: async () => mockConfigs });
        }
        if (url.includes('/dynatrace/entities/mappings')) {
          return Promise.resolve({ ok: true, json: async () => mockEntityMappings });
        }
        if (url.includes('/request-names')) {
          return Promise.resolve({ ok: true, json: async () => mockMetricNames });
        }
        if (url.includes('/related')) {
          return Promise.resolve({ ok: true, json: async () => mockRelatedTestRuns });
        }
        return Promise.resolve({ ok: false });
      });
    });

    it('should attempt to focus card after expansion', async () => {
      jest.useFakeTimers();
      const { rerender } = render(<DynatraceCard testRun={mockTestRun} expanded={false} onExpand={mockOnExpand} />);

      // Expand the card
      await waitFor(() => {
        expect(screen.getByTestId('dynatrace-card-collapsed')).toBeInTheDocument();
      });

      rerender(<DynatraceCard testRun={mockTestRun} expanded={true} onExpand={mockOnExpand} />);

      // Fast-forward time to trigger setTimeout
      jest.advanceTimersByTime(300);

      // Card should exist with expanded test ID
      await waitFor(() => {
        expect(screen.getByTestId('dynatrace-card-expanded')).toBeInTheDocument();
      });

      jest.useRealTimers();
    });
  });
});
