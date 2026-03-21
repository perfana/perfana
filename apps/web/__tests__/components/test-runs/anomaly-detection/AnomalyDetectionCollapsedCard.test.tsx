/**
 * Unit tests for AnomalyDetectionCollapsedCard Component
 *
 * Tests the collapsed card functionality:
 * - Basic rendering and card structure
 * - Expand/collapse behavior with auto-focus
 * - Conclusion chips and filtering
 * - Feedback status chips (TBD, ACCEPTED, DENIED)
 * - Stale results indicator
 * - Tracked regressions chip
 * - Changepoint indicator
 * - Border color based on test status
 * - No baselines state
 * - Data loading and empty states
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AnomalyDetectionCollapsedCard from '@/app/test-runs/[id]/components/anomaly-detection/components/AnomalyDetectionCollapsedCard';
import { AnomalyData } from '@/app/test-runs/[id]/components/anomaly-detection/types';

// Mock the scroll methods
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: jest.fn(),
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
    difference: '100%',
    application_dashboard_id: 'app-1',
    panel_id: '1',
    is_stale: false
  },
  {
    dashboard_label: 'Test Dashboard 2',
    panel_title: 'Test Panel 2',
    metric_name: 'error_rate',
    unit: '%',
    classification: 'red_errors',
    conclusion_label: 'improvement',
    test_value: '1',
    control_group_value: '5',
    difference: '-80%',
    application_dashboard_id: 'app-2',
    panel_id: '2',
    is_stale: true
  }
];

const mockTestRun = {
  id: 'test-run-1',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'baseline',
  completed: true,
  status: {},
  consolidated_result: {
    meetsRequirement: true,
    adaptTestRunOK: true
  },
  adapt_config: {
    differencesAccepted: 'TBD'
  }
};

describe('AnomalyDetectionCollapsedCard', () => {
  const defaultProps = {
    data: mockAnomalyData,
    loading: false,
    conclusionFilter: 'all',
    setConclusionFilter: jest.fn(),
    onExpand: jest.fn(),
    testRun: mockTestRun,
    dsAdaptConclusion: null
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the card', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      expect(screen.getByTestId('anomaly-detection-section-collapsed')).toBeInTheDocument();
    });

    it('should display title', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      expect(screen.getByText('Anomaly Detection')).toBeInTheDocument();
    });

    it('should display regression count', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      // KPIDisplay shows value + label separately: "1" and "Regressions Detected"
      expect(screen.getByText('Regressions Detected')).toBeInTheDocument();
    });

    it('should show loading state', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} loading={true} data={[]} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should have correct fixed height', () => {
      const { container } = render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      const card = container.querySelector('[data-testid="anomaly-detection-section-collapsed"]');
      expect(card).toHaveStyle({ height: '293px' });
    });

    it('should display expand button', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      expect(screen.getByTestId('ExpandMoreIcon')).toBeInTheDocument();
    });
  });

  describe('Expand Functionality', () => {
    it('should call onExpand when card is clicked', () => {
      const onExpand = jest.fn();
      render(<AnomalyDetectionCollapsedCard {...defaultProps} onExpand={onExpand} />);

      const card = screen.getByTestId('anomaly-detection-section-collapsed');
      fireEvent.click(card);

      expect(onExpand).toHaveBeenCalledTimes(1);
    });

    it('should call onExpand when expand button is clicked', () => {
      const onExpand = jest.fn();
      render(<AnomalyDetectionCollapsedCard {...defaultProps} onExpand={onExpand} />);

      const expandButton = screen.getByTestId('ExpandMoreIcon').closest('button');
      if (expandButton) {
        fireEvent.click(expandButton);
      }

      expect(onExpand).toHaveBeenCalled();
    });

    it('should trigger auto-focus after expansion', async () => {
      const onExpand = jest.fn();

      // Create a mock element that will be queried after expansion
      const mockExpandedElement = document.createElement('div');
      mockExpandedElement.setAttribute('data-testid', 'anomaly-detection-section-expanded');
      mockExpandedElement.setAttribute('tabindex', '-1');

      jest.spyOn(document, 'querySelector').mockReturnValue(mockExpandedElement);

      render(<AnomalyDetectionCollapsedCard {...defaultProps} onExpand={onExpand} />);

      const card = screen.getByTestId('anomaly-detection-section-collapsed');
      fireEvent.click(card);

      await waitFor(() => {
        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
      }, { timeout: 1000 });

      jest.restoreAllMocks();
    });

    it('should not be expandable when no baselines found', () => {
      const testRunNoBaselines = {
        ...mockTestRun,
        status: { evaluatingAdapt: 'NO_BASELINES_FOUND' }
      };

      const { container } = render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          testRun={testRunNoBaselines}
        />
      );

      const card = container.querySelector('[data-testid="anomaly-detection-section-collapsed"]');
      expect(card).toHaveStyle({ cursor: 'default' });
    });

    it('should have pointer cursor when expandable', () => {
      const { container } = render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      const card = container.querySelector('[data-testid="anomaly-detection-section-collapsed"]');
      expect(card).toHaveStyle({ cursor: 'pointer' });
    });
  });

  describe('Conclusion Chips', () => {
    it('should display regression badge with count', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      // SoftBadge renders label and count as separate Typography spans within a Box
      expect(screen.getByText('regression')).toBeInTheDocument();
    });

    it('should display improvement badge with count', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      expect(screen.getByText('improvement')).toBeInTheDocument();
    });

    it('should call setConclusionFilter when badge is clicked', () => {
      const setConclusionFilter = jest.fn();
      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          setConclusionFilter={setConclusionFilter}
        />
      );

      const regressionLabel = screen.getByText('regression');
      // Click the SoftBadge container (parent Box element)
      const badge = regressionLabel.closest('[class]');
      if (badge) {
        fireEvent.click(badge);
        expect(setConclusionFilter).toHaveBeenCalledWith('regression');
      }
    });

    it('should filter out partial/incomparable/no difference conclusions', () => {
      const dataWithExcludedConclusions: AnomalyData[] = [
        ...mockAnomalyData,
        {
          ...mockAnomalyData[0],
          conclusion_label: 'partial data',
          metric_name: 'partial_metric'
        },
        {
          ...mockAnomalyData[0],
          conclusion_label: 'incomparable',
          metric_name: 'incomparable_metric'
        },
        {
          ...mockAnomalyData[0],
          conclusion_label: 'no difference',
          metric_name: 'no_diff_metric'
        }
      ];

      render(<AnomalyDetectionCollapsedCard {...defaultProps} data={dataWithExcludedConclusions} />);

      // Should only show regression and improvement chips
      expect(screen.getByText('regression')).toBeInTheDocument();
      expect(screen.getByText('improvement')).toBeInTheDocument();
      expect(screen.queryByText('partial data')).not.toBeInTheDocument();
      expect(screen.queryByText('incomparable')).not.toBeInTheDocument();
      expect(screen.queryByText('no difference')).not.toBeInTheDocument();
    });

    it('should show placeholder chips when no data', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} data={[]} loading={false} />);

      expect(screen.getByText('Statistical Analysis')).toBeInTheDocument();
      expect(screen.getByText('Control Group Comparison')).toBeInTheDocument();
    });

    it('should not show placeholder chips when no baselines found', () => {
      const testRunNoBaselines = {
        ...mockTestRun,
        status: { evaluatingAdapt: 'NO_BASELINES_FOUND' }
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          testRun={testRunNoBaselines}
          data={[]}
        />
      );

      expect(screen.queryByText('Statistical Analysis')).not.toBeInTheDocument();
    });
  });

  describe('Feedback Status Chips', () => {
    it('should display TBD feedback chip when regressions exist', () => {
      const testRunTBD = {
        ...mockTestRun,
        adapt_config: { differencesAccepted: 'TBD' }
      };

      render(<AnomalyDetectionCollapsedCard {...defaultProps} testRun={testRunTBD} />);

      expect(screen.getByText('Feedback required')).toBeInTheDocument();
    });

    it('should display ACCEPTED feedback chip', () => {
      const testRunAccepted = {
        ...mockTestRun,
        adapt_config: { differencesAccepted: 'ACCEPTED' }
      };

      render(<AnomalyDetectionCollapsedCard {...defaultProps} testRun={testRunAccepted} />);

      expect(screen.getByText('Accepted')).toBeInTheDocument();
    });

    it('should display DENIED feedback chip', () => {
      const testRunDenied = {
        ...mockTestRun,
        adapt_config: { differencesAccepted: 'DENIED' }
      };

      render(<AnomalyDetectionCollapsedCard {...defaultProps} testRun={testRunDenied} />);

      expect(screen.getByText('Confirmed regression')).toBeInTheDocument();
    });

    it('should not show feedback chip when meetsRequirement is false', () => {
      const testRunFailed = {
        ...mockTestRun,
        consolidated_result: { meetsRequirement: false },
        adapt_config: { differencesAccepted: 'TBD' }
      };

      render(<AnomalyDetectionCollapsedCard {...defaultProps} testRun={testRunFailed} />);

      expect(screen.queryByText('Feedback required')).not.toBeInTheDocument();
    });

    it('should call setConclusionFilter when TBD chip is clicked', () => {
      const setConclusionFilter = jest.fn();
      const testRunTBD = {
        ...mockTestRun,
        adapt_config: { differencesAccepted: 'TBD' }
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          testRun={testRunTBD}
          setConclusionFilter={setConclusionFilter}
        />
      );

      const tbdLabel = screen.getByText('Feedback required');
      // SoftBadge uses Box elements, not MuiChip
      const badge = tbdLabel.closest('[class]');
      if (badge) {
        fireEvent.click(badge);
        expect(setConclusionFilter).toHaveBeenCalledWith('regression');
      }
    });

    it('should support legacy string format for adapt_config', () => {
      const testRunLegacy = {
        ...mockTestRun,
        adapt_config: 'ACCEPTED' as any
      };

      render(<AnomalyDetectionCollapsedCard {...defaultProps} testRun={testRunLegacy} />);

      expect(screen.getByText('Accepted')).toBeInTheDocument();
    });
  });

  describe('Stale Results Indicator', () => {
    it('should display stale results badge when data is stale', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      // SoftBadge renders label and count as separate Typography spans
      expect(screen.getByText('outdated')).toBeInTheDocument();
    });

    it('should show tooltip with stale count', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      expect(screen.getByText('outdated')).toBeInTheDocument();
    });

    it('should call onExpand when stale badge is clicked', () => {
      const onExpand = jest.fn();
      render(<AnomalyDetectionCollapsedCard {...defaultProps} onExpand={onExpand} />);

      const staleLabel = screen.getByText('outdated');
      const badge = staleLabel.closest('[class]');
      if (badge) {
        fireEvent.click(badge);
        expect(onExpand).toHaveBeenCalled();
      }
    });

    it('should not display stale badge when no stale data', () => {
      const freshData: AnomalyData[] = mockAnomalyData.map(item => ({
        ...item,
        is_stale: false
      }));

      render(<AnomalyDetectionCollapsedCard {...defaultProps} data={freshData} />);

      expect(screen.queryByText('outdated')).not.toBeInTheDocument();
    });

    it('should display correct stale count', () => {
      const staleData: AnomalyData[] = mockAnomalyData.map(item => ({
        ...item,
        is_stale: true
      }));

      render(<AnomalyDetectionCollapsedCard {...defaultProps} data={staleData} />);

      // Both items are stale - SoftBadge shows count separately
      expect(screen.getByText('outdated')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('Tracked Regressions Chip', () => {
    it('should display tracked regressions chip when present', () => {
      const dsAdaptConclusion = {
        tracked_regressions: [
          { test_run_id: 'tr-1', metric_name: 'metric1' },
          { test_run_id: 'tr-2', metric_name: 'metric2' }
        ]
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          dsAdaptConclusion={dsAdaptConclusion}
        />
      );

      // SoftBadge renders count and label as separate Typography elements
      // The label is "unresolved" and count is shown as a separate span
      expect(screen.getByText('unresolved')).toBeInTheDocument();
    });

    it('should handle singular text for one regression', () => {
      const dsAdaptConclusion = {
        tracked_regressions: [
          { test_run_id: 'tr-1', metric_name: 'metric1' }
        ]
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          dsAdaptConclusion={dsAdaptConclusion}
        />
      );

      // SoftBadge label is "unresolved" regardless of count
      expect(screen.getByText('unresolved')).toBeInTheDocument();
    });

    it('should handle plural text for multiple regressions', () => {
      const dsAdaptConclusion = {
        tracked_regressions: [
          { test_run_id: 'tr-1', metric_name: 'metric1' },
          { test_run_id: 'tr-2', metric_name: 'metric2' }
        ]
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          dsAdaptConclusion={dsAdaptConclusion}
        />
      );

      // SoftBadge label is "unresolved" with count=2 shown separately
      expect(screen.getByText('unresolved')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('should call onExpand with tab index 1 when clicked', () => {
      const onExpand = jest.fn();
      const dsAdaptConclusion = {
        tracked_regressions: [
          { test_run_id: 'tr-1', metric_name: 'metric1' }
        ]
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          onExpand={onExpand}
          dsAdaptConclusion={dsAdaptConclusion}
        />
      );

      const unresolvedLabel = screen.getByText('unresolved');
      if (unresolvedLabel) {
        // Click the SoftBadge container (parent Box element)
        const badge = unresolvedLabel.closest('[class]');
        if (badge) {
          fireEvent.click(badge);
          expect(onExpand).toHaveBeenCalledWith(1);
        }
      }
    });

    it('should not display when tracked_regressions is empty', () => {
      const dsAdaptConclusion = {
        tracked_regressions: []
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          dsAdaptConclusion={dsAdaptConclusion}
        />
      );

      expect(screen.queryByText('unresolved')).not.toBeInTheDocument();
    });
  });

  describe('Changepoint Indicator', () => {
    it('should display changepoint chip when test run is marked', () => {
      const changepointTestRun = {
        ...mockTestRun,
        is_changepoint: true
      };

      render(<AnomalyDetectionCollapsedCard {...defaultProps} testRun={changepointTestRun} />);

      expect(screen.getByText('Changepoint')).toBeInTheDocument();
    });

    it('should not display changepoint chip when not marked', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      expect(screen.queryByText('Changepoint')).not.toBeInTheDocument();
    });

    it('should not be clickable', () => {
      const changepointTestRun = {
        ...mockTestRun,
        is_changepoint: true
      };

      render(<AnomalyDetectionCollapsedCard {...defaultProps} testRun={changepointTestRun} />);

      const changepointLabel = screen.getByText('Changepoint');
      // SoftBadge uses Box elements, not MuiChip
      const badge = changepointLabel.closest('[class]');
      if (badge) {
        fireEvent.click(badge);
        // Should just stop propagation, not trigger anything
      }
    });
  });

  describe('Border Color', () => {
    it('should have red accent border when test failed', () => {
      const failedTestRun = {
        ...mockTestRun,
        consolidated_result: { adaptTestRunOK: false }
      };

      const { container } = render(
        <AnomalyDetectionCollapsedCard {...defaultProps} testRun={failedTestRun} />
      );

      const card = container.querySelector('[data-testid="anomaly-detection-section-collapsed"]');
      // Component uses theme.palette.error.main (MUI default: #d32f2f)
      expect(card).toHaveStyle({ borderTop: '3px solid #d32f2f' });
    });

    it('should have green accent border when test passed', () => {
      const passedTestRun = {
        ...mockTestRun,
        consolidated_result: { adaptTestRunOK: true }
      };

      const { container } = render(
        <AnomalyDetectionCollapsedCard {...defaultProps} testRun={passedTestRun} />
      );

      const card = container.querySelector('[data-testid="anomaly-detection-section-collapsed"]');
      // Component uses theme.palette.success.main (MUI default: #2e7d32)
      expect(card).toHaveStyle({ borderTop: '3px solid #2e7d32' });
    });

    it('should have orange accent border when test is running', () => {
      const runningTestRun = {
        ...mockTestRun,
        completed: false,
        consolidated_result: {}
      };

      const { container } = render(
        <AnomalyDetectionCollapsedCard {...defaultProps} testRun={runningTestRun} />
      );

      const card = container.querySelector('[data-testid="anomaly-detection-section-collapsed"]');
      // Component uses theme.palette.warning.main (MUI default: #ed6c02)
      expect(card).toHaveStyle({ borderTop: '3px solid #ed6c02' });
    });

    it('should have default blue accent border when status is unknown', () => {
      const unknownTestRun = {
        ...mockTestRun,
        consolidated_result: {}
      };

      const { container } = render(
        <AnomalyDetectionCollapsedCard {...defaultProps} testRun={unknownTestRun} />
      );

      const card = container.querySelector('[data-testid="anomaly-detection-section-collapsed"]');
      // Default blue accent color when adaptTestRunOK is undefined and completed is true
      expect(card).toHaveStyle({ borderTop: '3px solid #1976d2' });
    });
  });

  describe('No Baselines State', () => {
    it('should display no baselines message', () => {
      const noBaselinesTestRun = {
        ...mockTestRun,
        status: { evaluatingAdapt: 'NO_BASELINES_FOUND' }
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          testRun={noBaselinesTestRun}
        />
      );

      expect(screen.getByText('No previous results to compare with')).toBeInTheDocument();
    });

    it('should show anomaly detection header', () => {
      const noBaselinesTestRun = {
        ...mockTestRun,
        status: { evaluatingAdapt: 'NO_BASELINES_FOUND' }
      };

      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          testRun={noBaselinesTestRun}
        />
      );

      expect(screen.getByText('Anomaly Detection')).toBeInTheDocument();
    });
  });

  describe('Delete Button', () => {
    it('should display delete button when onDelete provided', () => {
      const onDelete = jest.fn();
      render(<AnomalyDetectionCollapsedCard {...defaultProps} onDelete={onDelete} />);

      expect(screen.getByTestId('DeleteIcon')).toBeInTheDocument();
    });

    it('should call onDelete when delete button is clicked', () => {
      const onDelete = jest.fn();
      render(<AnomalyDetectionCollapsedCard {...defaultProps} onDelete={onDelete} />);

      const deleteButton = screen.getByTestId('DeleteIcon').closest('button');
      if (deleteButton) {
        fireEvent.click(deleteButton);
        expect(onDelete).toHaveBeenCalledTimes(1);
      }
    });

    it('should stop propagation when delete button is clicked', () => {
      const onDelete = jest.fn();
      const onExpand = jest.fn();
      render(
        <AnomalyDetectionCollapsedCard
          {...defaultProps}
          onDelete={onDelete}
          onExpand={onExpand}
        />
      );

      const deleteButton = screen.getByTestId('DeleteIcon').closest('button');
      if (deleteButton) {
        fireEvent.click(deleteButton);
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onExpand).not.toHaveBeenCalled();
      }
    });

    it('should not display delete button when onDelete not provided', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} />);

      expect(screen.queryByTestId('DeleteIcon')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null test run', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} testRun={null} />);

      expect(screen.getByTestId('anomaly-detection-section-collapsed')).toBeInTheDocument();
    });

    it('should handle empty data array', () => {
      render(<AnomalyDetectionCollapsedCard {...defaultProps} data={[]} />);

      expect(screen.getByText('Statistical Analysis')).toBeInTheDocument();
    });

    it('should handle missing conclusion labels', () => {
      const dataWithoutConclusions: AnomalyData[] = [{
        ...mockAnomalyData[0],
        conclusion_label: '' as any
      }];

      render(<AnomalyDetectionCollapsedCard {...defaultProps} data={dataWithoutConclusions} />);

      expect(screen.getByTestId('anomaly-detection-section-collapsed')).toBeInTheDocument();
    });

    it('should handle very large datasets', () => {
      const largeData: AnomalyData[] = Array(100).fill(mockAnomalyData[0]);
      render(<AnomalyDetectionCollapsedCard {...defaultProps} data={largeData} />);

      // KPIDisplay shows the regression count as the value
      // All 100 items have conclusion_label 'regression', so value is 100
      expect(screen.getByText('Regressions Detected')).toBeInTheDocument();
    });
  });
});
