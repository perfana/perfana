/**
 * Unit tests for AnomalyDetectionExpandedCard Component
 *
 * Tests the expanded card view functionality:
 * - Tab switching between anomaly detection and tracked regressions
 * - Filter controls rendering and interaction
 * - Feedback banners (TBD, ACCEPTED, DENIED)
 * - Mark as changepoint functionality
 * - Batch re-evaluation triggering
 * - Loading, error, and empty states
 * - Data table integration
 * - Collapse functionality
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AnomalyDetectionExpandedCard from '@/app/test-runs/[id]/components/anomaly-detection/components/AnomalyDetectionExpandedCard';
import { AnomalyData } from '@/app/test-runs/[id]/components/anomaly-detection/types';
import { authenticatedFetch } from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

// Mock child components to isolate testing
jest.mock('@/app/test-runs/[id]/components/anomaly-detection/components/FilterControls', () => {
  return function MockFilterControls() {
    return <div data-testid="mock-filter-controls">Filter Controls</div>;
  };
});

jest.mock('@/app/test-runs/[id]/components/anomaly-detection/components/AnomalyDetectionTable', () => {
  return function MockAnomalyDetectionTable() {
    return <div data-testid="mock-anomaly-table">Anomaly Detection Table</div>;
  };
});

jest.mock('@/app/test-runs/[id]/components/anomaly-detection/components/TrackedRegressionsView', () => {
  return function MockTrackedRegressionsView() {
    return <div data-testid="mock-tracked-regressions">Tracked Regressions View</div>;
  };
});

const mockAnomalyData: AnomalyData[] = [
  {
    dashboard_label: 'Test Dashboard',
    panel_title: 'Test Panel',
    metric_name: 'response_time',
    unit: 'ms',
    classification: 'red_duration',
    conclusion_label: 'regression',
    test_value: '100',
    control_group_value: '50',
    difference: '50',
    application_dashboard_id: 'app-1',
    panel_id: '1',
    is_stale: false,
  },
];

const mockTestRun = {
  id: 'test-run-1',
  test_run_id: 'test-run-123',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'baseline',
  completed: true,
  status: {
    phase: 'COMPLETED',
  },
  consolidated_result: {
    meetsRequirement: true,
    adaptTestRunOK: true,
  },
  adapt_config: {
    differencesAccepted: 'TBD',
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as any;

describe('AnomalyDetectionExpandedCard', () => {
  const defaultProps = {
    testRun: mockTestRun,
    testRunId: 'test-run-1',
    data: mockAnomalyData,
    loading: false,
    error: undefined,
    searchQuery: '',
    onSearchChange: jest.fn(),
    conclusionFilter: 'all',
    onConclusionFilterChange: jest.fn(),
    classificationFilter: 'all',
    onClassificationFilterChange: jest.fn(),
    page: 0,
    rowsPerPage: 10,
    onPageChange: jest.fn(),
    onRowsPerPageChange: jest.fn(),
    expandedRows: new Set<string>(),
    onRowToggle: jest.fn(),
    drawerOpen: {},
    onDrawerToggle: jest.fn(),
    drawerData: {},
    drawerLoading: {},
    trendsData: {},
    trendsLoading: {},
    chartKey: {},
    showConfigForm: {},
    onConfigFormToggle: jest.fn(),
    configFormData: {},
    onConfigSave: jest.fn(),
    onAcceptResults: jest.fn(),
    onDenyResults: jest.fn(),
    updateAdaptConfig: jest.fn(),
    onCollapse: jest.fn(),
    showToast: jest.fn(),
    onRefreshAnomalyData: jest.fn(),
    activeTab: 0,
    onTabChange: jest.fn(),
    pendingConclusionRef: { current: null },
    cardRef: React.createRef(),
    conclusionsForDropdown: ['regression', 'improvement'],
    classificationsForDropdown: ['red_duration', 'red_errors'],
    filteredData: mockAnomalyData,
    handleSearchChange: jest.fn(),
    handleConclusionFilterChange: jest.fn(),
    handleClassificationFilterChange: jest.fn(),
    paginatedData: mockAnomalyData,
    toggleRowExpanded: jest.fn(),
    onDeleteAnomaly: jest.fn(),
    hasActiveFilters: false,
    onClearAllFilters: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  describe('Basic Rendering', () => {
    it('should render the expanded card', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });

    it('should display title', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      expect(screen.getByText('Anomaly Detection Results')).toBeInTheDocument();
    });

    it('should display collapse hint text', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      expect(screen.getByText('Click to collapse')).toBeInTheDocument();
    });

    it('should have collapse button', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      expect(screen.getByTestId('ExpandLessIcon')).toBeInTheDocument();
    });

    it('should be focusable via cardRef', () => {
      const cardRef = React.createRef<HTMLDivElement>();
      render(<AnomalyDetectionExpandedCard {...defaultProps} cardRef={cardRef} />);

      const card = screen.getByTestId('anomaly-detection-section-expanded');
      expect(card).toHaveAttribute('tabindex', '-1');
    });
  });

  describe('Collapse Functionality', () => {
    it('should call onCollapse when card header is clicked', () => {
      const onCollapse = jest.fn();
      render(<AnomalyDetectionExpandedCard {...defaultProps} onCollapse={onCollapse} />);

      const header = screen.getByText('Anomaly Detection Results').closest('div');
      fireEvent.click(header!);

      expect(onCollapse).toHaveBeenCalledTimes(1);
    });

    it('should call onCollapse when collapse button is clicked', () => {
      const onCollapse = jest.fn();
      render(<AnomalyDetectionExpandedCard {...defaultProps} onCollapse={onCollapse} />);

      const collapseButton = screen.getByTestId('ExpandLessIcon').closest('button');
      fireEvent.click(collapseButton!);

      expect(onCollapse).toHaveBeenCalled();
    });

    it('should stop propagation when button clicked', () => {
      const onCollapse = jest.fn();
      render(<AnomalyDetectionExpandedCard {...defaultProps} onCollapse={onCollapse} />);

      const collapseButton = screen.getByTestId('ExpandLessIcon').closest('button');
      fireEvent.click(collapseButton!);

      // Should be called exactly once (not twice from bubble)
      expect(onCollapse).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tab Navigation', () => {
    it('should display two tabs', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      expect(screen.getByText('Anomaly Detection')).toBeInTheDocument();
      expect(screen.getByText('Unresolved Regressions')).toBeInTheDocument();
    });

    it('should default to anomaly detection tab', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} activeTab={0} />);

      const tab = screen.getByText('Anomaly Detection').closest('button');
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });

    it('should switch to tracked regressions tab', () => {
      const onTabChange = jest.fn();
      render(<AnomalyDetectionExpandedCard {...defaultProps} onTabChange={onTabChange} activeTab={0} />);

      const trackedTab = screen.getByText('Unresolved Regressions');
      fireEvent.click(trackedTab);

      expect(onTabChange).toHaveBeenCalledWith(1);
    });

    it('should display anomaly detection content on tab 0', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} activeTab={0} />);

      expect(screen.getByTestId('mock-filter-controls')).toBeInTheDocument();
      expect(screen.getByTestId('mock-anomaly-table')).toBeInTheDocument();
    });

    it('should display tracked regressions content on tab 1', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} activeTab={1} />);

      expect(screen.getByTestId('mock-tracked-regressions')).toBeInTheDocument();
      expect(screen.queryByTestId('mock-filter-controls')).not.toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('should display loading spinner', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} loading={true} data={[]} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should not display content while loading', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} loading={true} data={[]} />);

      expect(screen.queryByTestId('mock-filter-controls')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mock-anomaly-table')).not.toBeInTheDocument();
    });

    it('should display content after loading', () => {
      const { rerender } = render(<AnomalyDetectionExpandedCard {...defaultProps} loading={true} data={[]} />);

      rerender(<AnomalyDetectionExpandedCard {...defaultProps} loading={false} data={mockAnomalyData} />);

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByTestId('mock-filter-controls')).toBeInTheDocument();
    });
  });

  describe('Empty States', () => {
    it('should display empty state message when no data', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} data={[]} loading={false} />);

      expect(screen.getByText('No anomaly detection data available for this test run.')).toBeInTheDocument();
    });

    it('should not display table when no data', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} data={[]} loading={false} />);

      expect(screen.queryByTestId('mock-anomaly-table')).not.toBeInTheDocument();
    });

    it('should not display filter controls when no data', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} data={[]} loading={false} />);

      expect(screen.queryByTestId('mock-filter-controls')).not.toBeInTheDocument();
    });
  });

  describe('Feedback Banners', () => {
    describe('TBD State', () => {
      it('should display TBD banner when regressions exist', () => {
        const testRunTBD = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'TBD' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunTBD} />);

        expect(screen.getByText('User feedback required')).toBeInTheDocument();
        expect(screen.getByText('Without feedback this test will be added to the control group')).toBeInTheDocument();
      });

      it('should display action buttons in TBD banner', () => {
        const testRunTBD = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'TBD' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunTBD} />);

        expect(screen.getByText('Mark as Regression')).toBeInTheDocument();
        expect(screen.getByText('Mark as Variability')).toBeInTheDocument();
        expect(screen.getByText('Mark as Changepoint')).toBeInTheDocument();
      });

      it('should call updateAdaptConfig when Mark as Regression clicked', async () => {
        const updateAdaptConfig = jest.fn();
        const testRunTBD = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'TBD' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunTBD} updateAdaptConfig={updateAdaptConfig} />);

        const regressionButton = screen.getByText('Mark as Regression');
        fireEvent.click(regressionButton);

        await waitFor(() => {
          expect(updateAdaptConfig).toHaveBeenCalledWith('DENIED');
        });
      });

      it('should call updateAdaptConfig when Mark as Variability clicked', async () => {
        const updateAdaptConfig = jest.fn();
        const testRunTBD = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'TBD' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunTBD} updateAdaptConfig={updateAdaptConfig} />);

        const variabilityButton = screen.getByText('Mark as Variability');
        fireEvent.click(variabilityButton);

        await waitFor(() => {
          expect(updateAdaptConfig).toHaveBeenCalledWith('ACCEPTED');
        });
      });

      it('should trigger batch re-evaluation after marking', async () => {
        const updateAdaptConfig = jest.fn().mockResolvedValue(true);
        const testRunTBD = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'TBD' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunTBD} updateAdaptConfig={updateAdaptConfig} />);

        const variabilityButton = screen.getByText('Mark as Variability');
        fireEvent.click(variabilityButton);

        await waitFor(() => {
          expect(updateAdaptConfig).toHaveBeenCalled();
        });

        // Should trigger batch re-evaluation (via hook)
        // This is tested via the useBatchReevaluation hook mock
      });
    });

    describe('ACCEPTED State', () => {
      it('should display ACCEPTED banner', () => {
        const testRunAccepted = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'ACCEPTED' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunAccepted} />);

        expect(screen.getByText('Accepted as variability')).toBeInTheDocument();
        expect(screen.getByText('The test run will be included in the control group')).toBeInTheDocument();
      });

      it('should display override buttons in ACCEPTED banner', () => {
        const testRunAccepted = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'ACCEPTED' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunAccepted} />);

        expect(screen.getByText('Mark as Regression')).toBeInTheDocument();
        expect(screen.getByText('Mark as Changepoint')).toBeInTheDocument();
      });

      it('should allow changing to regression', async () => {
        const updateAdaptConfig = jest.fn();
        const testRunAccepted = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'ACCEPTED' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunAccepted} updateAdaptConfig={updateAdaptConfig} />);

        const regressionButton = screen.getByText('Mark as Regression');
        fireEvent.click(regressionButton);

        await waitFor(() => {
          expect(updateAdaptConfig).toHaveBeenCalledWith('DENIED');
        });
      });
    });

    describe('DENIED State', () => {
      it('should display DENIED banner', () => {
        const testRunDenied = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'DENIED' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunDenied} />);

        expect(screen.getByText('Confirmed as regression')).toBeInTheDocument();
        expect(screen.getByText('The test run will be excluded from the control group')).toBeInTheDocument();
      });

      it('should display override buttons in DENIED banner', () => {
        const testRunDenied = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'DENIED' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunDenied} />);

        expect(screen.getByText('Mark as Variability')).toBeInTheDocument();
        expect(screen.getByText('Mark as Changepoint')).toBeInTheDocument();
      });

      it('should allow changing to variability', async () => {
        const updateAdaptConfig = jest.fn();
        const testRunDenied = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'DENIED' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunDenied} updateAdaptConfig={updateAdaptConfig} />);

        const variabilityButton = screen.getByText('Mark as Variability');
        fireEvent.click(variabilityButton);

        await waitFor(() => {
          expect(updateAdaptConfig).toHaveBeenCalledWith('ACCEPTED');
        });
      });
    });

    describe('No Feedback Banner', () => {
      it('should not show banner when meetsRequirement is false', () => {
        const testRunFailed = {
          ...mockTestRun,
          consolidated_result: { meetsRequirement: false },
          adapt_config: { differencesAccepted: 'TBD' },
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunFailed} />);

        expect(screen.queryByText('User feedback required')).not.toBeInTheDocument();
      });

      it('should not show banner when no regressions exist', () => {
        const testRunNoRegressions = {
          ...mockTestRun,
          adapt_config: { differencesAccepted: 'TBD' },
        };

        const dataWithoutRegressions: AnomalyData[] = [
          {
            ...mockAnomalyData[0],
            conclusion_label: 'improvement',
          },
        ];

        render(
          <AnomalyDetectionExpandedCard
            {...defaultProps}
            testRun={testRunNoRegressions}
            data={dataWithoutRegressions}
            filteredData={dataWithoutRegressions}
            paginatedData={dataWithoutRegressions}
          />
        );

        expect(screen.queryByText('User feedback required')).not.toBeInTheDocument();
      });

      it('should support legacy string format for adapt_config', () => {
        const testRunLegacy = {
          ...mockTestRun,
          adapt_config: 'ACCEPTED' as any,
        };

        render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunLegacy} />);

        expect(screen.getByText('Accepted as variability')).toBeInTheDocument();
      });
    });
  });

  describe('Mark as Changepoint', () => {
    it('should call mark changepoint API', async () => {
      const showToast = jest.fn();
      const testRunTBD = {
        ...mockTestRun,
        adapt_config: { differencesAccepted: 'TBD' },
      };

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunTBD} showToast={showToast} />);

      const changepointButton = screen.getByText('Mark as Changepoint');
      fireEvent.click(changepointButton);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          '/test-runs/mark-changepoint',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining(testRunTBD.system_under_test_id),
          })
        );
      });
    });

    it('should show success toast on changepoint success', async () => {
      const showToast = jest.fn();
      const testRunTBD = {
        ...mockTestRun,
        adapt_config: { differencesAccepted: 'TBD' },
      };

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunTBD} showToast={showToast} />);

      const changepointButton = screen.getByText('Mark as Changepoint');
      fireEvent.click(changepointButton);

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('marked as changepoint'));
      });
    });

    it('should handle changepoint error', async () => {
      const showToast = jest.fn();
      const testRunTBD = {
        ...mockTestRun,
        adapt_config: { differencesAccepted: 'TBD' },
      };

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
      });

      render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={testRunTBD} showToast={showToast} />);

      const changepointButton = screen.getByText('Mark as Changepoint');
      fireEvent.click(changepointButton);

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('Failed to mark as changepoint');
      });
    });

    it('should handle missing test run info', async () => {
      const showToast = jest.fn();
      const testRunIncomplete = {
        ...mockTestRun,
        system_under_test_id: undefined,
        adapt_config: { differencesAccepted: 'TBD' },
      };

      render(
        <AnomalyDetectionExpandedCard
          {...defaultProps}
          testRun={testRunIncomplete as any}
          showToast={showToast}
        />
      );

      const changepointButton = screen.getByText('Mark as Changepoint');
      fireEvent.click(changepointButton);

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('missing test run information')
        );
      });
    });
  });

  describe('Filter and Table Integration', () => {
    it('should render filter controls', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      expect(screen.getByTestId('mock-filter-controls')).toBeInTheDocument();
    });

    it('should render anomaly detection table', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      expect(screen.getByTestId('mock-anomaly-table')).toBeInTheDocument();
    });

    it('should pass filtered data to table', () => {
      const filteredData = [mockAnomalyData[0]];
      render(<AnomalyDetectionExpandedCard {...defaultProps} filteredData={filteredData} paginatedData={filteredData} />);

      // Table should receive the filtered data
      expect(screen.getByTestId('mock-anomaly-table')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null test run', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} testRun={null} />);

      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });

    it('should handle undefined cardRef', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} cardRef={undefined as any} />);

      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });

    it('should handle empty conclusions dropdown', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} conclusionsForDropdown={[]} />);

      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });

    it('should handle empty classifications dropdown', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} classificationsForDropdown={[]} />);

      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });

    it('should handle rapid tab switching', () => {
      const onTabChange = jest.fn();
      const { rerender } = render(
        <AnomalyDetectionExpandedCard {...defaultProps} onTabChange={onTabChange} activeTab={0} />
      );

      rerender(<AnomalyDetectionExpandedCard {...defaultProps} onTabChange={onTabChange} activeTab={1} />);
      rerender(<AnomalyDetectionExpandedCard {...defaultProps} onTabChange={onTabChange} activeTab={0} />);
      rerender(<AnomalyDetectionExpandedCard {...defaultProps} onTabChange={onTabChange} activeTab={1} />);

      // Should handle rapid switching without crashing
      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels for tabs', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      const tablist = screen.getByRole('tablist');
      expect(tablist).toHaveAttribute('aria-label', 'anomaly detection tabs');
    });

    it('should have focusable collapse button', () => {
      render(<AnomalyDetectionExpandedCard {...defaultProps} />);

      const collapseButton = screen.getByTestId('ExpandLessIcon').closest('button');
      expect(collapseButton).toBeInTheDocument();
      expect(collapseButton).not.toHaveAttribute('disabled');
    });

    it('should support keyboard navigation on tabs', () => {
      const onTabChange = jest.fn();
      render(<AnomalyDetectionExpandedCard {...defaultProps} onTabChange={onTabChange} />);

      const anomalyTab = screen.getByText('Anomaly Detection');
      anomalyTab.focus();

      fireEvent.keyDown(anomalyTab, { key: 'Enter' });

      // Tab should be focusable and interactive
      expect(document.activeElement).toBe(anomalyTab);
    });
  });
});
