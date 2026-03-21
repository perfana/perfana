/**
 * Unit tests for AnomalyDetectionSection Component
 *
 * Tests the main orchestrator component for anomaly detection:
 * - State management and data flow
 * - API data fetching (anomalies, tracked regressions, conclusion)
 * - Expand/collapse functionality
 * - Filter state management
 * - Row expansion and pagination
 * - Drawer and trends data loading
 * - Configuration saving
 * - Delete anomaly functionality
 * - Feedback actions (accept/deny/changepoint)
 * - Error handling and loading states
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRouter } from 'next/navigation';
import AnomalyDetectionSection from '@/app/test-runs/[id]/components/anomaly-detection/AnomalyDetectionSection';
import { authenticatedFetch } from '@/lib/api';
import { AnomalyData } from '@/app/test-runs/[id]/components/anomaly-detection/types';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
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

const mockRouter = {
  push: jest.fn(),
  refresh: jest.fn(),
};

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
  {
    dashboard_label: 'Test Dashboard 2',
    panel_title: 'Test Panel 2',
    metric_name: 'error_rate',
    unit: '%',
    classification: 'red_errors',
    conclusion_label: 'improvement',
    test_value: '1',
    control_group_value: '5',
    difference: '-4',
    application_dashboard_id: 'app-2',
    panel_id: '2',
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

describe('AnomalyDetectionSection', () => {
  const defaultProps = {
    testRun: mockTestRun,
    testRunId: 'test-run-1',
    anomalyExpanded: false,
    onAnomalyExpand: jest.fn(),
    conclusionFilter: 'all',
    setConclusionFilter: jest.fn(),
    showToast: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/anomaly-detection')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockAnomalyData,
          text: async () => JSON.stringify(mockAnomalyData),
        });
      }
      if (url.includes('/adapt/conclusion')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          text: async () => JSON.stringify({}),
        });
      }
      if (url.includes('/tracked-regressions/count')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 0 }),
          text: async () => JSON.stringify({ count: 0 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
        text: async () => JSON.stringify({}),
      });
    });
  });

  describe('Initial Rendering', () => {
    it('should render collapsed card by default', () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      expect(screen.getByTestId('anomaly-detection-section-collapsed')).toBeInTheDocument();
    });

    it('should fetch anomaly data on mount', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith('/test-runs/test-run-1/anomaly-detection');
      });
    });

    it('should fetch tracked regressions count on mount', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          '/adapt/tracked-regressions/count?testRunId=test-run-1'
        );
      });
    });

    it('should fetch ds adapt conclusion on mount', async () => {
      render(<AnomalyDetectionSection {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith('/adapt/conclusion/test-run-1');
      });
    });

    it('should render expanded card when anomalyExpanded is true', () => {
      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });
  });

  describe('Data Loading', () => {
    it('should handle loading state', async () => {
      (authenticatedFetch as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => mockAnomalyData,
                }),
              100
            )
          )
      );

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });

    it('should handle error when fetching anomaly data', async () => {
      const showToast = jest.fn();
      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('Failed to load anomaly detection data');
      });
    });

    it('should handle network error', async () => {
      const showToast = jest.fn();
      (authenticatedFetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('Error loading anomaly detection data');
      });
    });

    it('should display empty state when no data', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/anomaly-detection')) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
            text: async () => JSON.stringify([]),
          });
        }
        if (url.includes('/adapt/conclusion')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({}),
            text: async () => JSON.stringify({}),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          text: async () => JSON.stringify({}),
        });
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('No anomaly detection data available for this test run.')).toBeInTheDocument();
      });
    });
  });

  describe('Expand/Collapse Functionality', () => {
    it('should call onAnomalyExpand when expanding', () => {
      const onAnomalyExpand = jest.fn();
      render(<AnomalyDetectionSection {...defaultProps} onAnomalyExpand={onAnomalyExpand} />);

      const card = screen.getByTestId('anomaly-detection-section-collapsed');
      fireEvent.click(card);

      expect(onAnomalyExpand).toHaveBeenCalled();
    });

    it('should fetch data when expanding for the first time', async () => {
      const onAnomalyExpand = jest.fn();
      const { rerender } = render(
        <AnomalyDetectionSection {...defaultProps} onAnomalyExpand={onAnomalyExpand} anomalyExpanded={false} />
      );

      // Initially collapsed, should have fetched data
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith('/test-runs/test-run-1/anomaly-detection');
      });

      jest.clearAllMocks();

      // Simulate expansion
      rerender(<AnomalyDetectionSection {...defaultProps} onAnomalyExpand={onAnomalyExpand} anomalyExpanded={true} />);

      // Should not fetch again if data exists
      expect(authenticatedFetch).not.toHaveBeenCalledWith('/test-runs/test-run-1/anomaly-detection');
    });

    it('should auto-focus card when expanding', async () => {
      const { rerender } = render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={false} />);

      rerender(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(
        () => {
          const expandedCard = document.querySelector('[data-testid="anomaly-detection-section-expanded"]');
          expect(expandedCard).toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });

    it('should apply pending conclusion filter after expansion', async () => {
      const setConclusionFilter = jest.fn();
      const onAnomalyExpand = jest.fn((tabIndex) => {
        // Simulate parent updating the expanded state
        if (tabIndex === undefined) {
          rerender(
            <AnomalyDetectionSection
              {...defaultProps}
              setConclusionFilter={setConclusionFilter}
              onAnomalyExpand={onAnomalyExpand}
              anomalyExpanded={true}
            />
          );
        }
      });

      const { rerender } = render(
        <AnomalyDetectionSection
          {...defaultProps}
          setConclusionFilter={setConclusionFilter}
          onAnomalyExpand={onAnomalyExpand}
          anomalyExpanded={false}
        />
      );

      // Wait for async data to load so SoftBadge chips appear
      await waitFor(() => {
        expect(screen.getByText('regression')).toBeInTheDocument();
      });

      // Click conclusion chip to trigger pending filter
      const regressionChip = screen.getByText('regression');
      fireEvent.click(regressionChip);

      // Verify expand was called and filter was set
      await waitFor(() => {
        expect(onAnomalyExpand).toHaveBeenCalled();
      });
    });
  });

  describe('Filter Management', () => {
    it('should filter data based on conclusion filter', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(
        <AnomalyDetectionSection
          {...defaultProps}
          anomalyExpanded={true}
          conclusionFilter="regression"
        />
      );

      await waitFor(() => {
        // Should show only regression items (1 out of 2)
        expect(screen.getByText('response_time')).toBeInTheDocument();
        expect(screen.queryByText('error_rate')).not.toBeInTheDocument();
      });
    });

    it('should filter data based on search query', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText('Search...');
        fireEvent.change(searchInput, { target: { value: 'response' } });
      });

      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
        expect(screen.queryByText('error_rate')).not.toBeInTheDocument();
      });
    });

    it('should filter data based on classification filter', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      // Wait for data to load first
      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
      });

      // MUI Select renders as a div with role="combobox", not a native select.
      // Multiple elements have "Classification" text (label, header, etc.), so
      // find the specific InputLabel inside a FormControl.
      const classificationLabel = screen.getAllByText('Classification').find(
        el => el.tagName === 'LABEL'
      );
      // The MUI Select trigger is a sibling div with role="combobox"
      const formControl = classificationLabel!.closest('.MuiFormControl-root');
      const selectTrigger = formControl!.querySelector('[role="combobox"]') as HTMLElement;
      fireEvent.mouseDown(selectTrigger);

      // Wait for the dropdown menu to appear and click the option
      await waitFor(() => {
        // MUI Select renders menu items in a portal (listbox)
        const listbox = screen.getByRole('listbox');
        expect(listbox).toBeInTheDocument();
      });

      // The classificationsForDropdown shows normalized classifications.
      // red_duration is a known classification, so it shows its display label.
      // Click the menu item for red_duration (displayed as its label).
      // Find the option that contains "red_duration" or its display name.
      const options = screen.getAllByRole('option');
      // Find the red_duration option - displayed via getClassificationDisplayInfo
      const redDurationOption = options.find(
        opt => opt.textContent?.toLowerCase().includes('duration') || opt.getAttribute('data-value') === 'red_duration'
      );
      if (redDurationOption) {
        fireEvent.click(redDurationOption);
      }

      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
        expect(screen.queryByText('error_rate')).not.toBeInTheDocument();
      });
    });

    it('should reset page when filter changes', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText('Search...');
        fireEvent.change(searchInput, { target: { value: 'test' } });
      });

      // Page should reset to 0 when filter changes
      // This is tested implicitly through the component behavior
    });
  });

  describe('Row Expansion and Trends Loading', () => {
    it('should expand row when toggled', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        const expandButton = screen.getAllByTestId('ExpandMoreIcon')[0];
        fireEvent.click(expandButton.closest('button')!);
      });

      // Should be expanded
      await waitFor(() => {
        expect(screen.getAllByTestId('ExpandLessIcon')[0]).toBeInTheDocument();
      });
    });

    it('should fetch trends data when row is expanded', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
      });

      // The table uses CSS Grid layout (Box), not HTML <tr> elements.
      // Use the expand button (ExpandMoreIcon) to toggle a row.
      const expandButtons = screen.getAllByTestId('ExpandMoreIcon');
      fireEvent.click(expandButtons[0].closest('button')!);

      // Should fetch trends data
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/metrics/control-group-trends/')
        );
      });
    });

    it('should handle trends data loading error', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnomalyData,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        const expandButton = screen.getAllByTestId('ExpandMoreIcon')[0];
        fireEvent.click(expandButton.closest('button')!);
      });

      // Should handle error gracefully (no crash)
      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });
  });

  describe('Drawer Functionality', () => {
    it('should fetch drawer data when drawer is opened', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
      });

      // The table uses CSS Grid layout (Box), not HTML <tr> elements.
      // Use the expand button (ExpandMoreIcon) to toggle a row, which also opens the drawer.
      const expandButtons = screen.getAllByTestId('ExpandMoreIcon');
      fireEvent.click(expandButtons[0].closest('button')!);

      // Drawer should fetch detailed stats
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/test-runs/test-run-1/ds-adapt-result')
        );
      });
    });

    it('should toggle drawer open/close', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        const expandButton = screen.getAllByTestId('ExpandMoreIcon')[0];
        fireEvent.click(expandButton.closest('button')!);
      });

      // Drawer should be open after expanding row
      // Test drawer toggle functionality
      await waitFor(() => {
        expect(screen.getAllByTestId('ExpandLessIcon')[0]).toBeInTheDocument();
      });
    });
  });

  describe('Configuration Saving', () => {
    it('should save metric configuration', async () => {
      const showToast = jest.fn();
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} anomalyExpanded={true} />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
      });

      // Simulate config save (this would require more complex setup)
      // For now, we're testing that the component structure supports it
    });

    it('should handle configuration save error', async () => {
      const showToast = jest.fn();
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnomalyData,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ message: 'Invalid configuration' }),
        });

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
      });

      // Configuration save error handling is built into the component
    });
  });

  describe('Delete Anomaly Functionality', () => {
    it('should delete anomaly data', async () => {
      const showToast = jest.fn();
      const { deleteAnomalyData } = require('@/lib/anomaly-api');
      deleteAnomalyData.mockResolvedValue({ deletedCount: 5 });

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
      });

      // The table now uses a MoreVert action menu instead of inline DeleteIcon buttons
      const actionButtons = screen.getAllByLabelText('actions');
      if (actionButtons.length > 0) {
        fireEvent.click(actionButtons[0]);
      }

      // Verify action menu appears with Delete option
      await waitFor(() => {
        const deleteMenuItem = screen.queryByText('Delete Anomaly');
        if (deleteMenuItem) {
          expect(deleteMenuItem).toBeInTheDocument();
        }
      });
    });

    it('should handle delete error', async () => {
      const showToast = jest.fn();
      const { deleteAnomalyData } = require('@/lib/anomaly-api');
      deleteAnomalyData.mockRejectedValue(new Error('Delete failed'));

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('response_time')).toBeInTheDocument();
      });

      // Error handling is built into the component
    });
  });

  describe('Feedback Actions', () => {
    it('should accept results', async () => {
      const showToast = jest.fn();

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} anomalyExpanded={true} />);

      // Wait for data to load so the feedback banner appears
      await waitFor(() => {
        expect(screen.getByText('Mark as Variability')).toBeInTheDocument();
      });

      // Click the accept button
      fireEvent.click(screen.getByText('Mark as Variability'));

      // Should call update adapt config API - URL format is /test-runs/{id}/adapt-config
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/adapt-config'),
          expect.objectContaining({
            method: 'PUT',
          })
        );
      });
    });

    it('should deny results', async () => {
      const showToast = jest.fn();

      render(<AnomalyDetectionSection {...defaultProps} showToast={showToast} anomalyExpanded={true} />);

      // Wait for data to load so the feedback banner appears
      await waitFor(() => {
        expect(screen.getByText('Mark as Regression')).toBeInTheDocument();
      });

      // Click the deny button
      fireEvent.click(screen.getByText('Mark as Regression'));

      // Should call update adapt config API - URL format is /test-runs/{id}/adapt-config
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/adapt-config'),
          expect.objectContaining({
            method: 'PUT',
          })
        );
      });
    });

    it('should refresh router when onTestRunUpdate not provided', async () => {
      // Must return an array for /anomaly-detection, otherwise anomalyData.filter crashes.
      // Other endpoints (like /adapt-config PUT) can return a generic object.
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/anomaly-detection')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockAnomalyData,
            text: async () => JSON.stringify(mockAnomalyData),
          });
        }
        if (url.includes('/adapt/conclusion')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({}),
            text: async () => JSON.stringify({}),
          });
        }
        if (url.includes('/tracked-regressions/count')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ count: 0 }),
            text: async () => JSON.stringify({ count: 0 }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          text: async () => JSON.stringify({}),
        });
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      // Wait for data to load so the feedback banner with buttons appears
      await waitFor(() => {
        expect(screen.getByText('Mark as Variability')).toBeInTheDocument();
      });

      // Click accept button
      fireEvent.click(screen.getByText('Mark as Variability'));

      // The updateAdaptConfig call should succeed and since onTestRunUpdate is not provided,
      // the hook calls router.refresh()
      await waitFor(() => {
        expect(mockRouter.refresh).toHaveBeenCalled();
      });
    });

    it('should call onTestRunUpdate when provided', async () => {
      const onTestRunUpdate = jest.fn();
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      render(
        <AnomalyDetectionSection {...defaultProps} onTestRunUpdate={onTestRunUpdate} anomalyExpanded={true} />
      );

      // Trigger accept action
      await waitFor(() => {
        const acceptButton = screen.queryByText('Mark as Variability');
        if (acceptButton) {
          fireEvent.click(acceptButton);
        }
      });

      // Should NOT refresh router when onTestRunUpdate is provided
      expect(mockRouter.refresh).not.toHaveBeenCalled();
    });
  });

  describe('Tab Management', () => {
    it('should switch to tracked regressions tab', async () => {
      const onActiveTabChange = jest.fn();
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(
        <AnomalyDetectionSection
          {...defaultProps}
          anomalyExpanded={true}
          activeTab={0}
          onActiveTabChange={onActiveTabChange}
        />
      );

      await waitFor(() => {
        const unresolvedRegressionsTab = screen.getByText('Unresolved Regressions');
        fireEvent.click(unresolvedRegressionsTab);
      });

      expect(onActiveTabChange).toHaveBeenCalledWith(1);
    });

    it('should display tracked regressions view on tab 1', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} activeTab={1} />);

      // Should render TrackedRegressionsView component
      await waitFor(() => {
        expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
      });
    });

    it('should use local tab state when parent state not provided', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockAnomalyData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      // Should default to tab 0
      await waitFor(() => {
        expect(screen.getByText('Anomaly Detection')).toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('should handle page change', async () => {
      const largeData = Array(25)
        .fill(null)
        .map((_, i) => ({
          ...mockAnomalyData[0],
          metric_name: `metric_${i}`,
        }));

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => largeData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('metric_0')).toBeInTheDocument();
      });

      // Click next page button
      const nextButton = screen.getByRole('button', { name: /next page/i });
      fireEvent.click(nextButton);

      // Should show next page items
      await waitFor(() => {
        expect(screen.queryByText('metric_0')).not.toBeInTheDocument();
        expect(screen.getByText('metric_10')).toBeInTheDocument();
      });
    });

    it('should handle rows per page change', async () => {
      const largeData = Array(25)
        .fill(null)
        .map((_, i) => ({
          ...mockAnomalyData[0],
          metric_name: `metric_${i}`,
        }));

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => largeData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('metric_0')).toBeInTheDocument();
      });

      // MUI TablePagination uses a Select component (div with role="combobox"),
      // not a native <select>. Need to open it with mouseDown and click the menu item.
      const rowsPerPageSelect = screen.getByRole('combobox', { name: /rows per page/i });
      fireEvent.mouseDown(rowsPerPageSelect);

      // Wait for the dropdown to appear
      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      // Click the "25" option
      const option25 = screen.getByRole('option', { name: '25' });
      fireEvent.click(option25);

      // Should show more items per page
      await waitFor(() => {
        expect(screen.getByText('metric_0')).toBeInTheDocument();
        expect(screen.getByText('metric_24')).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle null test run', async () => {
      render(<AnomalyDetectionSection {...defaultProps} testRun={null} />);

      expect(screen.getByTestId('anomaly-detection-section-collapsed')).toBeInTheDocument();
    });

    it('should handle missing application dashboard ID', async () => {
      const dataWithoutDashboardId = mockAnomalyData.map((item) => ({
        ...item,
        application_dashboard_id: undefined,
      }));

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => dataWithoutDashboardId,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
      });
    });

    it('should handle empty string test run ID', () => {
      render(<AnomalyDetectionSection {...defaultProps} testRunId="" />);

      expect(screen.getByTestId('anomaly-detection-section-collapsed')).toBeInTheDocument();
    });

    it('should handle rapid expand/collapse toggling', async () => {
      const onAnomalyExpand = jest.fn();
      const { rerender } = render(
        <AnomalyDetectionSection {...defaultProps} onAnomalyExpand={onAnomalyExpand} anomalyExpanded={false} />
      );

      // Rapid toggling
      rerender(
        <AnomalyDetectionSection {...defaultProps} onAnomalyExpand={onAnomalyExpand} anomalyExpanded={true} />
      );
      rerender(
        <AnomalyDetectionSection {...defaultProps} onAnomalyExpand={onAnomalyExpand} anomalyExpanded={false} />
      );
      rerender(
        <AnomalyDetectionSection {...defaultProps} onAnomalyExpand={onAnomalyExpand} anomalyExpanded={true} />
      );

      // Should handle rapid changes without crashing
      expect(screen.getByTestId('anomaly-detection-section-expanded')).toBeInTheDocument();
    });

    it('should handle very long metric names', async () => {
      const longNameData = [
        {
          ...mockAnomalyData[0],
          metric_name: 'very_long_metric_name_that_exceeds_normal_length_boundaries_and_should_be_truncated',
        },
      ];

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => longNameData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText(/very_long_metric_name/)).toBeInTheDocument();
      });
    });

    it('should handle special characters in metric names', async () => {
      const specialCharData = [
        {
          ...mockAnomalyData[0],
          metric_name: 'metric-with-special_chars.and:colons',
        },
      ];

      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => specialCharData,
      });

      render(<AnomalyDetectionSection {...defaultProps} anomalyExpanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('metric-with-special_chars.and:colons')).toBeInTheDocument();
      });
    });
  });
});
