/**
 * Unit tests for SavePresetModal Component
 *
 * Tests the save preset modal functionality:
 * - Form rendering and validation
 * - Auto-generation of preset name and description
 * - Preset type selection (generic vs specific)
 * - Configuration preview chips
 * - Save and cancel operations
 * - Error handling
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SavePresetModal, { CurrentFilterState, PresetFormData } from '@/app/test-runs/[id]/components/compare/SavePresetModal';

describe('SavePresetModal', () => {
  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();

  const defaultFilters: CurrentFilterState = {
    selectedTestRun: null,
    selectedDashboard: {
      id: 'dashboard-123',
      dashboard_label: 'Performance Dashboard'
    },
    selectedMetric: {
      id: 5,
      title: 'CPU Usage'
    },
    seriesSearchText: '',
    showPercentiles: false,
    source: 'grafana',
    addedSeries: [
      {
        id: 'series-1',
        dashboardId: 'dashboard-123',
        dashboardLabel: 'Performance Dashboard',
        panelId: 5,
        panelTitle: 'CPU Usage',
        metricName: 'cpu_usage_percent',
        source: 'grafana'
      }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the modal when open', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      expect(screen.getByText('Save Filter Preset')).toBeInTheDocument();
    });

    it('should not render the modal when closed', () => {
      render(
        <SavePresetModal
          open={false}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      expect(screen.queryByText('Save Filter Preset')).not.toBeInTheDocument();
    });

    it('should render preset name and description fields', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      expect(screen.getByLabelText(/Preset Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    });

    it('should render preset type radio buttons', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      expect(screen.getByText(/Generic Preset/i)).toBeInTheDocument();
      expect(screen.getByText(/Save for This Test Run Only/i)).toBeInTheDocument();
    });

    it('should show warning when no series added', () => {
      const filtersWithoutSeries: CurrentFilterState = {
        ...defaultFilters,
        addedSeries: []
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithoutSeries}
        />
      );

      expect(screen.getByText(/Please add at least one series to the comparison before saving a preset/i)).toBeInTheDocument();
    });
  });

  describe('Auto-Generation of Preset Name', () => {
    it('should generate name from series count', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toBe('1 Series');
    });

    it('should include series search text in name when present', () => {
      const filtersWithSearch = {
        ...defaultFilters,
        seriesSearchText: 'cpu.*usage'
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithSearch}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toContain('"cpu.*usage"');
    });

    it('should include "Percentiles" in name when enabled', () => {
      const filtersWithPercentiles = {
        ...defaultFilters,
        showPercentiles: true
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithPercentiles}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toContain('Percentiles');
    });

    it('should use "Filtered" for long search text', () => {
      const filtersWithLongSearch = {
        ...defaultFilters,
        seriesSearchText: 'this is a very long search text that exceeds twenty characters'
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithLongSearch}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toContain('Filtered');
      expect(nameInput.value).not.toContain('this is a very long');
    });

    it('should generate "Generic Preset" when no details available', () => {
      const minimalFilters: CurrentFilterState = {
        selectedTestRun: null,
        selectedDashboard: { id: '1', dashboard_label: 'Test' },
        selectedMetric: null,
        seriesSearchText: '',
        showPercentiles: false,
        addedSeries: []
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={minimalFilters}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toBe('Generic Preset');
    });

    it('should generate "Specific Preset" when test run selected', () => {
      const filtersWithTestRun: CurrentFilterState = {
        selectedTestRun: { test_run_id: 'test-123' },
        selectedDashboard: { id: '1', dashboard_label: 'Test' },
        selectedMetric: null,
        seriesSearchText: '',
        showPercentiles: false,
        addedSeries: []
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithTestRun}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toBe('Specific Preset');
    });
  });

  describe('Auto-Generation of Description', () => {
    it('should generate description from series and dashboard', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      const descInput = screen.getByLabelText(/Description/i) as HTMLTextAreaElement;
      expect(descInput.value).toContain('1 series to compare');
      expect(descInput.value).toContain('Dashboard: Performance Dashboard');
    });

    it('should include filter in description', () => {
      const filtersWithSearch = {
        ...defaultFilters,
        seriesSearchText: 'memory.*'
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithSearch}
        />
      );

      const descInput = screen.getByLabelText(/Description/i) as HTMLTextAreaElement;
      expect(descInput.value).toContain('Filter: "memory.*"');
    });

    it('should include baseline test run in description', () => {
      const filtersWithBaseline = {
        ...defaultFilters,
        selectedTestRun: { test_run_id: 'baseline-run-456' }
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithBaseline}
        />
      );

      const descInput = screen.getByLabelText(/Description/i) as HTMLTextAreaElement;
      expect(descInput.value).toContain('Baseline: baseline-run-456');
    });
  });

  describe('Configuration Preview', () => {
    it('should display series chips', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      // Look for series chips in the Configuration to Save section
      expect(screen.getByText(/Series to Compare/)).toBeInTheDocument();
    });

    it('should display series count', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      // Should show series count
      expect(screen.getByText(/Series to Compare \(1\)/)).toBeInTheDocument();
    });

    it('should display filter chip when search text present', () => {
      const filtersWithSearch = {
        ...defaultFilters,
        seriesSearchText: 'cpu.*'
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithSearch}
        />
      );

      // Look for chips in the Configuration to Save section
      const chips = screen.getAllByText(/Filter: "cpu\.\*"/i);
      // Should be in both description and chip
      expect(chips.length).toBeGreaterThan(0);
    });

    it('should display percentiles chip when enabled', () => {
      const filtersWithPercentiles = {
        ...defaultFilters,
        showPercentiles: true
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithPercentiles}
        />
      );

      expect(screen.getByText(/Show Percentiles/i)).toBeInTheDocument();
    });

    it('should display baseline chip for specific presets', async () => {
      const filtersWithBaseline = {
        ...defaultFilters,
        selectedTestRun: { test_run_id: 'test-run-123' }
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithBaseline}
        />
      );

      // Wait for baseline chip to appear (should be visible initially for specific preset)
      await waitFor(() => {
        const baselineElements = screen.getAllByText(/Baseline: test-run-123/i);
        expect(baselineElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Form Validation', () => {
    it('should show error when name is empty', async () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: '' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Preset name is required/i)).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should show error when specific preset has no baseline', async () => {
      const filtersWithoutBaseline = {
        ...defaultFilters,
        selectedTestRun: null
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithoutBaseline}
        />
      );

      // Select specific preset type
      const specificRadio = screen.getByLabelText(/Save for This Test Run Only/i);
      fireEvent.click(specificRadio);

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/require a baseline test run/i)).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should clear error when user starts typing', async () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: '' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Preset name is required/i)).toBeInTheDocument();
      });

      // Start typing to clear error
      fireEvent.change(nameInput, { target: { value: 'New Name' } });

      await waitFor(() => {
        expect(screen.queryByText(/Preset name is required/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('should call onSave with correct data for generic preset', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: 'My Generic Preset' } });

      const descInput = screen.getByLabelText(/Description/i);
      fireEvent.change(descInput, { target: { value: 'Test description' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'My Generic Preset',
            description: 'Test description',
            preset_type: 'generic',
            series_search_text: '',
            show_percentiles: false,
            application_dashboard_id: 'dashboard-123',
            panel_id: 5,
            panel_title: 'CPU Usage',
            is_global: true,
            series_config: expect.arrayContaining([
              expect.objectContaining({
                dashboardId: 'dashboard-123',
                panelTitle: 'CPU Usage',
                metricName: 'cpu_usage_percent'
              })
            ])
          })
        );
      });
    });

    it('should call onSave with baseline for specific preset', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const filtersWithBaseline = {
        ...defaultFilters,
        selectedTestRun: { test_run_id: 'baseline-123' }
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={filtersWithBaseline}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: 'Specific Preset' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Specific Preset',
            preset_type: 'specific',
            baseline_test_run_id: 'baseline-123'
          })
        );
      });
    });

    it('should close modal after successful save', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('should not close modal on save failure', async () => {
      mockOnSave.mockRejectedValue(new Error('Save failed'));

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled();
      });

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Cancel Operation', () => {
    it('should call onClose when cancel button clicked', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should reset form when closed', async () => {
      const { rerender } = render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      // Wait for auto-generation to complete
      await waitFor(() => {
        const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
        expect(nameInput.value).toBe('1 Series');
      });

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'Modified Name' } });

      expect(nameInput.value).toBe('Modified Name');

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButton);

      // Close modal first
      rerender(
        <SavePresetModal
          open={false}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      // Then reopen modal
      rerender(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
        />
      );

      // Should have regenerated name when reopened
      await waitFor(() => {
        const newNameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
        expect(newNameInput.value).toBe('1 Series');
      });
    });
  });

  describe('Loading State', () => {
    it('should disable save button when loading', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
          loading={true}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Saving.../i });
      expect(saveButton).toBeDisabled();
    });

    it('should show "Saving..." text when loading', () => {
      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
          loading={true}
        />
      );

      expect(screen.getByText(/Saving.../i)).toBeInTheDocument();
    });

    it('should disable save button when no series added', () => {
      const invalidFilters: CurrentFilterState = {
        ...defaultFilters,
        addedSeries: []
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={invalidFilters}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      expect(saveButton).toBeDisabled();
    });
  });

  describe('Dynatrace Support', () => {
    it('should use applicationDashboardId from metric for Dynatrace', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const dynatraceFilters: CurrentFilterState = {
        ...defaultFilters,
        source: 'dynatrace',
        addedSeries: [{
          id: 'dt-series-1',
          dashboardId: 'dashboard-123',
          dashboardLabel: 'Dynatrace Dashboard',
          panelId: 10,
          panelTitle: 'Dynatrace Metric',
          metricName: 'dt_cpu',
          source: 'dynatrace'
        }],
        selectedDashboard: {
          id: 'dashboard-123',
          dashboard_label: 'Dynatrace Dashboard'
        },
        selectedMetric: {
          id: 10,
          title: 'Dynatrace Metric',
          applicationDashboardId: 'dynatrace-uuid-123'
        }
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={dynatraceFilters}
        />
      );

      // Wait for form to initialize
      await waitFor(() => {
        const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
        expect(nameInput.value).toBe('1 Series');
      });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            application_dashboard_id: 'dashboard-123'
          })
        );
      });
    });

    it('should fall back to dashboard id when no applicationDashboardId', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const grafanaFilters: CurrentFilterState = {
        ...defaultFilters,
        source: 'grafana',
        selectedMetric: {
          id: 5,
          title: 'Grafana Metric'
          // No applicationDashboardId
        },
        addedSeries: [{
          id: 'grafana-series-1',
          dashboardId: 'dashboard-123',
          dashboardLabel: 'Performance Dashboard',
          panelId: 5,
          panelTitle: 'Grafana Metric',
          metricName: 'grafana_cpu',
          source: 'grafana'
        }]
      };

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={grafanaFilters}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            application_dashboard_id: 'dashboard-123'
          })
        );
      });
    });
  });

  describe('Created For Test Run ID', () => {
    it('should include created_for_test_run_id when currentTestRunId provided', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const currentTestRunId = 'PaymentService-prod-loadTest-20240115';

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
          currentTestRunId={currentTestRunId}
        />
      );

      // Wait for form to initialize
      await waitFor(() => {
        const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
        expect(nameInput.value).toBe('1 Series');
      });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            created_for_test_run_id: currentTestRunId
          })
        );
      });
    });

    it('should not include created_for_test_run_id when currentTestRunId is not provided', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(
        <SavePresetModal
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          currentFilters={defaultFilters}
          // currentTestRunId not provided
        />
      );

      // Wait for form to initialize
      await waitFor(() => {
        const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
        expect(nameInput.value).toBe('1 Series');
      });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            created_for_test_run_id: undefined
          })
        );
      });
    });
  });
});
