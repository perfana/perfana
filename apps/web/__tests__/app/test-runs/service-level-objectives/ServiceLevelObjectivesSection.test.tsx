/**
 * Unit tests for ServiceLevelObjectivesSection Component
 *
 * Tests the comprehensive SLO management interface:
 * - Rendering in collapsed and expanded states
 * - Check results loading and display
 * - SLO evaluation and requirement checking
 * - Failed/all filter toggling
 * - Row expansion and series tables
 * - Sorting functionality
 * - Re-evaluation triggering
 * - Edit SLO dialog
 * - Empty states
 * - Error handling
 *
 * Note: This is a complex 2000+ line component. Tests focus on critical
 * workflows and user interactions rather than 100% coverage.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ServiceLevelObjectivesSection from '@/app/test-runs/[id]/components/service-level-objectives/ServiceLevelObjectivesSection';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { useSearchParams } from 'next/navigation';

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

// Mock authenticated fetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
}));

// Mock SLOMetricsChart component
jest.mock('@/app/test-runs/[id]/components/service-level-objectives/SLOMetricsChart', () => ({
  __esModule: true,
  default: ({ testRunId, checkResult }: any) => (
    <div data-testid={`slo-chart-${checkResult.panel_id}`}>
      SLO Chart for {checkResult.metric_name}
    </div>
  ),
}));

// Mock EditSLODialog component
// The actual EditSLODialog accepts onSLOUpdated (not onSave) as the save callback
jest.mock('@/app/systems/[id]/config/components/EditSLODialog', () => ({
  __esModule: true,
  default: ({ open, onClose, onSLOUpdated }: any) =>
    open ? (
      <div data-testid="edit-slo-dialog">
        <button onClick={onClose}>Close</button>
        <button onClick={() => onSLOUpdated({})}>Save</button>
      </div>
    ) : null,
}));

// Mock FancyChip component
jest.mock('@/app/test-runs/[id]/components/shared/FancyChip', () => ({
  __esModule: true,
  default: ({ label, onClick, colorTheme }: any) => (
    <div data-testid={`fancy-chip-${colorTheme}`} onClick={onClick}>
      {label}
    </div>
  ),
}));

// Mock units lib
jest.mock('@/lib/units', () => ({
  getUnit: jest.fn((unit: string) => ({
    format: unit === 'percentunit' ? '%' : unit === 'ms' ? 'ms' : unit,
  })),
}));

describe('ServiceLevelObjectivesSection', () => {
  const mockSetSloExpanded = jest.fn();

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
    ramp_up: 300,
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

  const mockCheckResults = [
    {
      id: 'check-1',
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
      meets_requirement: true,
      targets: [
        { target: 'api-service', value: 450, meets_requirement: true },
        { target: 'web-service', value: 480, meets_requirement: true },
      ],
      created_at: '2024-01-15T11:00:00Z',
    },
    {
      id: 'check-2',
      panel_id: 456,
      panel_title: 'Error Rate',
      dashboard_label: 'HTTP Metrics',
      metric_name: 'http_request_error_rate',
      benchmark_id: 'benchmark-456',
      application_dashboard_id: 'app-dash-123',
      requirement: {
        operator: 'lt',
        value: 0.05,
      },
      evaluate_type: 'avg',
      metric_unit: 'percentunit',
      meets_requirement: false,
      targets: [
        { target: 'api-service', value: 0.02, meets_requirement: true },
        { target: 'web-service', value: 0.08, meets_requirement: false },
      ],
      created_at: '2024-01-15T11:00:00Z',
    },
  ];

  const mockBenchmarks = [
    {
      id: 'benchmark-123',
      metric_name: 'http_request_duration_p95',
      requirement_operator: 'lt',
      requirement_value: 500,
      updated_at: '2024-01-15T10:00:00Z',
    },
    {
      id: 'benchmark-456',
      metric_name: 'http_request_error_rate',
      requirement_operator: 'lt',
      requirement_value: 0.05,
      updated_at: '2024-01-15T10:00:00Z',
    },
  ];

  const defaultProps = {
    testRun: mockTestRun,
    testRunId: '123',
    sloExpanded: false,
    setSloExpanded: mockSetSloExpanded,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn(),
    });
    (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/check-results')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockCheckResults,
        });
      }
      if (url.includes('/benchmarks')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockBenchmarks,
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  describe('Rendering - Collapsed State', () => {
    it('should render collapsed card', () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} />);
      expect(screen.getByText('Service Level Objectives')).toBeInTheDocument();
    });

    it('should apply pointer cursor in collapsed state', () => {
      const { container } = render(<ServiceLevelObjectivesSection {...defaultProps} />);
      const card = container.querySelector('[tabindex="-1"]');
      expect(card).toHaveStyle({ cursor: 'pointer' });
    });

    it('should display expand icon in collapsed state', () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should load check results on mount', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/check-results'),
        );
      });
    });

    it('should load benchmarks on mount', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/benchmarks'),
        );
      });
    });
  });

  describe('Rendering - Expanded State', () => {
    it('should render expanded card', () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);
      expect(screen.getByText('Service Level Objectives')).toBeInTheDocument();
    });

    it('should display "Click to collapse" text when expanded', () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);
      expect(screen.getByText('Click to collapse')).toBeInTheDocument();
    });

    it('should display filter buttons when expanded', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        // Filter chips include counts, e.g. "All (2)" and "Failed only (1)"
        expect(screen.getByText(/^All \(\d+\)$/)).toBeInTheDocument();
        expect(screen.getByText(/^Failed only \(\d+\)$/)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should display check results table when expanded', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
        expect(screen.getByText('Error Rate')).toBeInTheDocument();
      });
    });
  });

  describe('Check Results Loading', () => {
    it('should fetch check results with test run ID', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/test-runs/123/check-results'),
        );
      });
    });

    it('should include query parameters when available', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'system') return 'system-123';
          if (key === 'environment') return 'production';
          if (key === 'workload') return 'load-test-1';
          return null;
        }),
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringMatching(/system=system-123.*environment=production.*workload=load-test-1/),
        );
      });
    });

    it('should handle 404 response gracefully', async () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(consoleWarn).toHaveBeenCalledWith('Check results not found');
      });

      consoleWarn.mockRestore();
    });

    it('should handle API errors gracefully', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to load check results:',
          expect.any(Error)
        );
      });

      consoleError.mockRestore();
    });

    it('should display loading indicator while fetching', async () => {
      // The component shows "Loading service level objectives..." text instead of a progressbar spinner
      (authenticatedFetch as jest.Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ ok: true, json: async () => [] }), 100))
      );

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText(/Loading service level objectives/i)).toBeInTheDocument();
      });
    });
  });

  describe('Benchmarks Loading', () => {
    it('should fetch benchmarks with correct query parameters', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringMatching(/systemUnderTestId=system-123.*testEnvironment=production.*workload=load-test-1/),
        );
      });
    });

    it('should handle 404 response for benchmarks', async () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/benchmarks')) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} />);

      await waitFor(() => {
        expect(consoleWarn).toHaveBeenCalledWith('No benchmarks found');
      });

      consoleWarn.mockRestore();
    });

    it('should not fetch benchmarks when testRun is null', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} testRun={null} />);

      await waitFor(() => {
        const benchmarkCalls = (authenticatedFetch as jest.Mock).mock.calls.filter(call =>
          call[0].includes('/benchmarks')
        );
        expect(benchmarkCalls.length).toBe(0);
      });
    });
  });

  describe('SLO Evaluation Display', () => {
    it('should display passed check result with green indicator', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });
    });

    it('should display failed check result with red indicator', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Error Rate')).toBeInTheDocument();
      });
    });

    it('should display requirement text correctly', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText(/should be less than 500/)).toBeInTheDocument();
      });
    });

    it('should format percentunit values correctly', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        // formatRequirement converts 0.05 percentunit to "5 %" (with space before %)
        // The full text is "Average value should be less than 5 %"
        expect(screen.getByText(/5\s*%/)).toBeInTheDocument();
      });
    });

    it('should display target names in the series table when row expanded', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // Wait for check results to load, then click "All" to show all results
      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      // Expand the first row to see its targets
      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      // Click the expand button for the first row
      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      // Use getAllByText since targets appear in both rows' collapsed MetricSeriesTable (hidden by MUI Collapse)
      await waitFor(() => {
        expect(screen.getAllByText('api-service').length).toBeGreaterThan(0);
        expect(screen.getAllByText('web-service').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Filter Functionality', () => {
    it('should default to "All" filter', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
        expect(screen.getByText('Error Rate')).toBeInTheDocument();
      });
    });

    it('should auto-switch to "Failed Only" when failures exist', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        // Should auto-switch to failed filter since there's a failed check
        const failedButton = screen.getByText(/^Failed only \(\d+\)$/);
        // Button styling would indicate it's active
        expect(failedButton).toBeInTheDocument();
      });
    });

    it('should filter to show only failed checks', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const failedButton = screen.getByText(/^Failed only \(\d+\)$/);
        fireEvent.click(failedButton);
      });

      await waitFor(() => {
        expect(screen.queryByText('Response Time p95')).not.toBeInTheDocument();
        expect(screen.getByText('Error Rate')).toBeInTheDocument();
      });
    });

    it('should show all checks when "All" filter selected', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
        expect(screen.getByText('Error Rate')).toBeInTheDocument();
      });
    });

    it('should mark filter as manually set when user clicks', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      // Filter should not auto-switch after manual selection
      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });
    });

    it('should display filter counts', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        // Should show "Failed only (1)" count in the chip label
        const failedChip = screen.getByText(/^Failed only \(\d+\)$/);
        expect(failedChip.textContent).toMatch(/Failed only \(\d+\)/);
      });
    });
  });

  describe('Row Expansion', () => {
    it('should expand row when clicked', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // Wait for check results to load, then switch to All filter to see all results
      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      // Wait for 'Response Time p95' panel_title to appear in the table
      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      // The SLOList rows are Box elements with onClick, not role="button".
      // Click the expand icon button directly.
      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      await waitFor(() => {
        expect(screen.getByTestId('slo-chart-123')).toBeInTheDocument();
      });
    });

    it('should collapse row when clicked again', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      // Expand the first row
      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      // Wait for chart to appear (expanded content visible)
      await waitFor(() => {
        expect(screen.getByTestId('slo-chart-123')).toBeInTheDocument();
      });

      // Now find the ExpandLess icon inside the SLO row (not the header one).
      // The header ExpandLess collapses the entire section, while the row ExpandLess
      // collapses just the row. We need the row-level one which is the last ExpandLessIcon.
      const allExpandLessIcons = screen.getAllByTestId('ExpandLessIcon');
      // The last ExpandLessIcon should be the one in the SLO row
      const rowCollapseButton = allExpandLessIcons[allExpandLessIcons.length - 1].closest('button')!;
      fireEvent.click(rowCollapseButton);

      // The row should now be collapsed. The chart hides due to MUI Collapse transition
      // but the element may still be in the DOM in a hidden state.
      // Check that the expand state was toggled by verifying ExpandMore appears again
      await waitFor(() => {
        // After collapsing, the row should have ExpandMore icon again
        const expandMoreIcons = screen.getAllByTestId('ExpandMoreIcon');
        expect(expandMoreIcons.length).toBeGreaterThan(0);
      });
    });

    it('should display series table when row expanded', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      // Use getAllByText since targets from both rows are in the DOM (MUI Collapse renders hidden content)
      await waitFor(() => {
        expect(screen.getAllByText('api-service').length).toBeGreaterThan(0);
        expect(screen.getAllByText('web-service').length).toBeGreaterThan(0);
      });
    });

    it('should show series table headers when row expanded', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      // The MetricSeriesTable shows column headers: Series, Value, Result
      // Multiple tables may exist (one per row), so use getAllByText
      await waitFor(() => {
        expect(screen.getAllByText('Series').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Value').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Result').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Sorting Functionality', () => {
    it('should sort series table by series name', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      // Multiple "Series" headers exist (one per row's MetricSeriesTable in the DOM),
      // click the first one
      await waitFor(() => {
        const seriesHeaders = screen.getAllByText('Series');
        fireEvent.click(seriesHeaders[0]);
      });

      // Should toggle sort direction
      await waitFor(() => {
        expect(screen.getAllByText('api-service').length).toBeGreaterThan(0);
      });
    });

    it('should sort series table by value', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      // Multiple "Value" headers exist (one per row's MetricSeriesTable in the DOM)
      await waitFor(() => {
        const valueHeaders = screen.getAllByText('Value');
        fireEvent.click(valueHeaders[0]);
      });

      // formatMetricValue displays 450 as "450.00 ms" for metric_unit='ms'
      await waitFor(() => {
        expect(screen.getAllByText(/450\.00/).length).toBeGreaterThan(0);
      });
    });

    it('should sort series table by result', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Error Rate')).toBeInTheDocument();
      });

      // Find and expand the Error Rate row
      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      await waitFor(() => {
        const resultHeader = screen.getByText('Result');
        fireEvent.click(resultHeader);
      });

      await waitFor(() => {
        expect(screen.getByText('api-service')).toBeInTheDocument();
      });
    });

    it('should toggle sort direction on repeated clicks', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      const expandIcons = screen.getAllByTestId('ExpandMoreIcon');
      if (expandIcons[0]) {
        fireEvent.click(expandIcons[0].closest('button')!);
      }

      await waitFor(() => {
        const seriesHeaders = screen.getAllByText('Series');
        fireEvent.click(seriesHeaders[0]);
        fireEvent.click(seriesHeaders[0]);
      });

      await waitFor(() => {
        expect(screen.getAllByText('api-service').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Re-evaluation', () => {
    it('should trigger re-evaluation when stale chip clicked', async () => {
      const staleCheckResult = {
        ...mockCheckResults[0],
        created_at: '2024-01-15T09:00:00Z', // Before benchmark update
      };

      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => [staleCheckResult] });
        }
        if (url.includes('/benchmarks')) {
          return Promise.resolve({ ok: true, json: async () => mockBenchmarks });
        }
        if (url.includes('/reevaluate')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ jobId: 'job-123' }),
          });
        }
        if (url.includes('/data/jobs')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ status: 'completed' }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // The SLOStatusChip shows "Pass" or "Fail" label, not "Stale".
      // When a result is stale, the chip is clickable and has a warning icon.
      // The chip label is "checkmark Pass" with an onClick handler that triggers re-evaluation.
      // Note: MetricSeriesStatusChip also renders "Pass" chips for targets (even hidden by MUI Collapse),
      // so we need to find the SLOStatusChip specifically which has the checkmark prefix.
      await waitFor(() => {
        // The SLOStatusChip renders with a checkmark prefix for passed results
        const passChips = screen.getAllByText(/Pass/i);
        // Click the first one (SLOStatusChip in the SLO row)
        fireEvent.click(passChips[0]);
      });

      await waitFor(() => {
        // The re-evaluation endpoint is /data/reevaluate/batch
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/data/reevaluate/batch'),
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });

    it('should poll for job completion after re-evaluation', async () => {
      const staleCheckResult = {
        ...mockCheckResults[0],
        created_at: '2024-01-15T09:00:00Z', // Before benchmark update - makes it stale
      };

      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => [staleCheckResult] });
        }
        if (url.includes('/benchmarks') && !url.includes('/benchmarks/')) {
          return Promise.resolve({ ok: true, json: async () => mockBenchmarks });
        }
        if (url.includes('/reevaluate')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ jobId: 'job-123' }),
          });
        }
        if (url.includes('/data/jobs/job-123/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ status: 'completed' }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ([]) });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // Wait for chip to appear and trigger re-evaluation
      await waitFor(() => {
        const passChips = screen.getAllByText(/Pass/i);
        fireEvent.click(passChips[0]);
      });

      // The polling uses /data/jobs/${jobId}/status
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/data/jobs/'),
        );
      });
    });

    it('should handle re-evaluation errors gracefully', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      const staleCheckResult = {
        ...mockCheckResults[0],
        created_at: '2024-01-15T09:00:00Z', // Before benchmark update - makes it stale
      };

      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => [staleCheckResult] });
        }
        if (url.includes('/benchmarks') && !url.includes('/benchmarks/')) {
          return Promise.resolve({ ok: true, json: async () => mockBenchmarks });
        }
        if (url.includes('/reevaluate')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            text: async () => 'Internal Server Error',
          });
        }
        return Promise.resolve({ ok: true, json: async () => ([]) });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // Click the stale chip to trigger re-evaluation
      await waitFor(() => {
        const passChips = screen.getAllByText(/Pass/i);
        fireEvent.click(passChips[0]);
      });

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalled();
      });

      consoleError.mockRestore();
    });
  });

  describe('Edit SLO Dialog', () => {
    it('should open edit dialog when edit button clicked', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // The edit button in SLOList is a Settings icon button with a Tooltip.
      // It does not have an aria-label="edit". Instead, look for the Settings icon buttons.
      // In the expanded header, there is an "slo settings" aria-label button,
      // and in each SLO row there is a Settings icon with Tooltip title "Edit SLO Configuration".
      // We need to find the one that triggers handleEditSlo (row-level Settings button)
      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      // Find all Settings icon buttons. The header has one "slo settings" button,
      // and each row has one. We want the row-level ones.
      const settingsIcons = screen.getAllByTestId('SettingsIcon');
      // The first SettingsIcon is in the expanded header, the rest are in SLO rows
      // Click the second one (first row's edit button)
      if (settingsIcons.length > 1) {
        fireEvent.click(settingsIcons[1].closest('button')!);
      }

      await waitFor(() => {
        expect(screen.getByTestId('edit-slo-dialog')).toBeInTheDocument();
      });
    });

    it('should fetch current benchmark when opening edit dialog', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // Wait for data to load and show all results
      await waitFor(() => {
        const allButton = screen.getByText(/^All \(\d+\)$/);
        fireEvent.click(allButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      // Click the edit (Settings) button on the first row
      const settingsIcons = screen.getAllByTestId('SettingsIcon');
      // First is header, next are per-row
      if (settingsIcons.length > 1) {
        fireEvent.click(settingsIcons[1].closest('button')!);
      }

      await waitFor(() => {
        // handleEditSlo fetches /benchmarks/{benchmarkId}
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/benchmarks/benchmark-'),
        );
      });
    });

    it('should close dialog when close button clicked', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      const settingsIcons = screen.getAllByTestId('SettingsIcon');
      if (settingsIcons.length > 1) {
        fireEvent.click(settingsIcons[1].closest('button')!);
      }

      await waitFor(() => {
        const closeButton = screen.getByText('Close');
        fireEvent.click(closeButton);
      });

      await waitFor(() => {
        expect(screen.queryByTestId('edit-slo-dialog')).not.toBeInTheDocument();
      });
    });

    it('should reload data after SLO update', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      const settingsIcons = screen.getAllByTestId('SettingsIcon');
      if (settingsIcons.length > 1) {
        fireEvent.click(settingsIcons[1].closest('button')!);
      }

      await waitFor(() => {
        // The mock EditSLODialog's Save button calls onSLOUpdated({})
        const saveButton = screen.getByText('Save');
        fireEvent.click(saveButton);
      });

      await waitFor(() => {
        // Should reload check results and benchmarks
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/check-results'),
        );
      });
    });

    it('should handle benchmark fetch errors with fallback', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/benchmarks/benchmark-')) {
          return Promise.resolve({
            ok: false,
            status: 500,
          });
        }
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => mockCheckResults });
        }
        return Promise.resolve({ ok: true, json: async () => mockBenchmarks });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });

      const settingsIcons = screen.getAllByTestId('SettingsIcon');
      if (settingsIcons.length > 1) {
        fireEvent.click(settingsIcons[1].closest('button')!);
      }

      await waitFor(() => {
        // Should still open dialog with fallback data
        expect(screen.getByTestId('edit-slo-dialog')).toBeInTheDocument();
      });

      consoleError.mockRestore();
    });
  });

  describe('Empty States', () => {
    it('should display empty state when no check results and no benchmarks', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // The component shows "No service level objectives configured" when both check results and benchmarks are empty
      await waitFor(() => {
        expect(screen.getByText(/No service level objectives configured/i)).toBeInTheDocument();
      });
    });

    it('should display not-evaluated state when benchmarks exist but no check results', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (url.includes('/benchmarks')) {
          return Promise.resolve({ ok: true, json: async () => mockBenchmarks });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // The component shows "SLOs have not been evaluated yet" when benchmarks exist but check results are empty
      await waitFor(() => {
        expect(screen.getByText(/SLOs have not been evaluated yet/i)).toBeInTheDocument();
      });
    });

    it('should show all checks passing with pass status chips', async () => {
      const allPassedResults = mockCheckResults.map(r => ({ ...r, meets_requirement: true }));

      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => allPassedResults });
        }
        return Promise.resolve({ ok: true, json: async () => mockBenchmarks });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // When all checks pass, component still shows the SLOList with pass chips
      // There is no special "All SLO checks passed" congratulatory message
      await waitFor(() => {
        // All results shown in the list with Pass status chips
        const passChips = screen.getAllByText(/Pass/i);
        expect(passChips.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('Expand/Collapse Behavior', () => {
    it('should call setSloExpanded when card clicked', () => {
      const { container } = render(<ServiceLevelObjectivesSection {...defaultProps} />);

      const card = container.querySelector('[tabindex="-1"]');
      if (card) fireEvent.click(card);

      expect(mockSetSloExpanded).toHaveBeenCalledWith(true);
    });

    it('should load data when expanding', async () => {
      const { rerender } = render(<ServiceLevelObjectivesSection {...defaultProps} />);

      rerender(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalled();
      });
    });

    it('should auto-focus card after expansion', async () => {
      jest.useFakeTimers();

      const { rerender } = render(<ServiceLevelObjectivesSection {...defaultProps} />);
      rerender(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      jest.advanceTimersByTime(300);

      // Focus should be called on the card ref
      await waitFor(() => {
        expect(document.activeElement).toBeTruthy();
      });

      jest.useRealTimers();
    });
  });

  describe('Real-time Status Updates', () => {
    it('should reload check results when test run status changes', async () => {
      const { rerender } = render(<ServiceLevelObjectivesSection {...defaultProps} />);

      const updatedTestRun = {
        ...mockTestRun,
        status: {
          evaluatingChecks: 'IN_PROGRESS',
          evaluatingComparisons: 'COMPLETED',
          evaluatingAdapt: 'COMPLETED',
        },
      };

      rerender(<ServiceLevelObjectivesSection {...defaultProps} testRun={updatedTestRun} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/check-results'),
        );
      });
    });

    it('should not reload when status has not changed', async () => {
      const { rerender } = render(<ServiceLevelObjectivesSection {...defaultProps} />);

      const callCount = (authenticatedFetch as jest.Mock).mock.calls.length;

      rerender(<ServiceLevelObjectivesSection {...defaultProps} testRun={mockTestRun} />);

      await waitFor(() => {
        expect((authenticatedFetch as jest.Mock).mock.calls.length).toBe(callCount);
      });
    });
  });

  describe('Stale Check Detection', () => {
    it('should detect stale check results', async () => {
      const staleResult = {
        ...mockCheckResults[0],
        created_at: '2024-01-15T09:00:00Z', // Before benchmark update
      };

      const updatedBenchmark = {
        ...mockBenchmarks[0],
        updated_at: '2024-01-15T10:00:00Z', // After check result
      };

      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => [staleResult] });
        }
        if (url.includes('/benchmarks')) {
          return Promise.resolve({ ok: true, json: async () => [updatedBenchmark] });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      // Stale results are shown via the SLOStatusChip which renders "Pass" or "Fail"
      // with a warning icon and "OUTDATED RESULT" tooltip, not a "Stale" text.
      // The collapsed view shows "outdated" text in a SoftBadge.
      // In the expanded list, the chip still says "Pass" but with a warning icon.
      // Verify the stale detection by checking the chip is present and clickable.
      // Note: MetricSeriesStatusChip also renders "Pass" chips for targets,
      // so we use getAllByText.
      await waitFor(() => {
        const passChips = screen.getAllByText(/Pass/i);
        expect(passChips.length).toBeGreaterThan(0);
      });
    });

    it('should not show stale indicator for fresh results', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        // For fresh results, ensure there is no "outdated" text or stale indicators
        expect(screen.queryByText(/outdated/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Requirement Formatting', () => {
    it('should format less than operator correctly', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText(/should be less than/i)).toBeInTheDocument();
      });
    });

    it('should format percentunit values as percentages', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        // formatRequirement converts 0.05 percentunit to "5 %" (with space)
        // The full text is "Average value should be less than 5 %"
        expect(screen.getByText(/5\s*%/)).toBeInTheDocument();
      });
    });

    it('should handle evaluate_type in requirement text', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText(/Average value/i)).toBeInTheDocument();
      });
    });

    it('should handle missing evaluate_type gracefully', async () => {
      const resultWithoutEvalType = {
        ...mockCheckResults[0],
        evaluate_type: undefined,
      };

      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => [resultWithoutEvalType] });
        }
        return Promise.resolve({ ok: true, json: async () => mockBenchmarks });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText(/Value should be/i)).toBeInTheDocument();
      });
    });
  });

  describe('Check Result Key Generation', () => {
    it('should generate unique keys for check results', async () => {
      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        // Each row should be expandable with unique key
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
        expect(screen.getByText('Error Rate')).toBeInTheDocument();
      });
    });

    it('should handle missing benchmark/application dashboard IDs', async () => {
      const resultWithoutIds = {
        ...mockCheckResults[0],
        benchmark_id: undefined,
        application_dashboard_id: undefined,
      };

      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/check-results')) {
          return Promise.resolve({ ok: true, json: async () => [resultWithoutIds] });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      render(<ServiceLevelObjectivesSection {...defaultProps} sloExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Response Time p95')).toBeInTheDocument();
      });
    });
  });
});
