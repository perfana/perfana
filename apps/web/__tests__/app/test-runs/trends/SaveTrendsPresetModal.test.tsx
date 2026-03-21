/**
 * Unit tests for SaveTrendsPresetModal Component
 *
 * Tests the save trends preset modal functionality:
 * - Form rendering and validation
 * - Auto-prefill name and description from filters
 * - Preset type selection (generic vs specific)
 * - Current filter state preview
 * - Save and cancel operations
 * - Loading states
 * - Error handling
 * - Support for Grafana and Dynatrace sources
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SaveTrendsPresetModal, { CurrentFilterState, PresetFormData } from '@/app/test-runs/[id]/components/trends/SaveTrendsPresetModal';
import { PresetType } from '@/lib/trends-presets';

describe('SaveTrendsPresetModal', () => {
  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();

  const defaultFilters: CurrentFilterState = {
    selectedDashboard: {
      id: 'dashboard-123',
      dashboard_label: 'Performance Dashboard'
    },
    selectedMetric: {
      id: 5,
      title: 'CPU Usage'
    },
    evaluateType: 'avg',
    source: 'grafana'
  };

  const defaultProps = {
    open: true,
    onClose: mockOnClose,
    onSave: mockOnSave,
    loading: false,
    currentTestRunId: 'test-run-123',
    currentFilters: defaultFilters
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the modal when open', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByText('Save Trends Filter Preset')).toBeInTheDocument();
    });

    it('should not render the modal when closed', () => {
      render(<SaveTrendsPresetModal {...defaultProps} open={false} />);

      expect(screen.queryByText('Save Trends Filter Preset')).not.toBeInTheDocument();
    });

    it('should render preset name field', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByLabelText(/Preset Name/i)).toBeInTheDocument();
    });

    it('should render description field', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    });

    it('should render preset type radio buttons', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByText('Generic')).toBeInTheDocument();
      expect(screen.getByText('Test Run Specific')).toBeInTheDocument();
    });

    it('should render save and cancel buttons', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Save Preset/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });
  });

  describe('Auto-Prefill Name and Description', () => {
    it('should prefill name from dashboard and metric', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toBe('Performance Dashboard | CPU Usage');
    });

    it('should prefill description from dashboard and metric', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const descInput = screen.getByLabelText(/Description/i) as HTMLTextAreaElement;
      expect(descInput.value).toBe('Performance Dashboard | CPU Usage');
    });

    it('should update prefill when modal reopens with new filters', () => {
      const { rerender } = render(<SaveTrendsPresetModal {...defaultProps} open={false} />);

      const newFilters = {
        ...defaultFilters,
        selectedDashboard: {
          id: 'new-dashboard',
          dashboard_label: 'New Dashboard'
        },
        selectedMetric: {
          id: 10,
          title: 'Memory Usage'
        }
      };

      rerender(<SaveTrendsPresetModal {...defaultProps} currentFilters={newFilters} open={true} />);

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toBe('New Dashboard | Memory Usage');
    });

    it('should not prefill when dashboard is missing', () => {
      const filtersWithoutDashboard = {
        ...defaultFilters,
        selectedDashboard: null
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={filtersWithoutDashboard}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toBe('');
    });

    it('should not prefill when metric is missing', () => {
      const filtersWithoutMetric = {
        ...defaultFilters,
        selectedMetric: null
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={filtersWithoutMetric}
        />
      );

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(nameInput.value).toBe('');
    });
  });

  describe('Current Filter Settings Preview', () => {
    it('should display source in preview', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByText('Source: Grafana')).toBeInTheDocument();
    });

    it('should display dashboard in preview', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByText(/Dashboard:.*Performance Dashboard/i)).toBeInTheDocument();
    });

    it('should display metric in preview', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByText(/Metric:.*CPU Usage/i)).toBeInTheDocument();
    });

    it('should display aggregation type in preview', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByText(/Aggregation:.*avg/i)).toBeInTheDocument();
    });

    it('should show "None" when dashboard is missing', () => {
      const filtersWithoutDashboard = {
        ...defaultFilters,
        selectedDashboard: null
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={filtersWithoutDashboard}
        />
      );

      expect(screen.getByText(/Dashboard:.*None/i)).toBeInTheDocument();
    });

    it('should show "None" when metric is missing', () => {
      const filtersWithoutMetric = {
        ...defaultFilters,
        selectedMetric: null
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={filtersWithoutMetric}
        />
      );

      expect(screen.getByText(/Metric:.*None/i)).toBeInTheDocument();
    });

    it('should display Dynatrace as source', () => {
      const dynatraceFilters = {
        ...defaultFilters,
        source: 'dynatrace' as const
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={dynatraceFilters}
        />
      );

      expect(screen.getByText('Source: Dynatrace')).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('should show error when name is empty', async () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: '' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Name is required/i)).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should show error when name is only whitespace', async () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: '   ' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Name is required/i)).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should clear error when user starts typing', async () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: '' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/Name is required/i)).toBeInTheDocument();
      });

      // Start typing to clear error
      fireEvent.change(nameInput, { target: { value: 'New Name' } });

      await waitFor(() => {
        expect(screen.queryByText(/Name is required/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Preset Type Selection', () => {
    it('should default to Generic preset type', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const genericRadio = screen.getByRole('radio', { name: /Generic/i }) as HTMLInputElement;
      expect(genericRadio.checked).toBe(true);
    });

    it('should allow switching to Specific preset type', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const specificRadio = screen.getByRole('radio', { name: /Test Run Specific/i }) as HTMLInputElement;
      fireEvent.click(specificRadio);

      expect(specificRadio.checked).toBe(true);
    });

    it('should show description for Generic preset type', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByText(/Can be applied to any test run with similar metrics/i)).toBeInTheDocument();
    });

    it('should show description for Specific preset type', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByText(/Optimized for this particular test run/i)).toBeInTheDocument();
    });
  });

  describe('Form Submission', () => {
    it('should call onSave with correct data for generic preset', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: 'My Trends Preset' } });

      const descInput = screen.getByLabelText(/Description/i);
      fireEvent.change(descInput, { target: { value: 'Test description' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'My Trends Preset',
            description: 'Test description',
            preset_type: PresetType.GENERIC,
            application_dashboard_id: 'dashboard-123',
            panel_id: 5,
            panel_title: 'CPU Usage',
            evaluate_type: 'avg',
            source: 'grafana',
            dashboard_label: 'Performance Dashboard',
            created_for_test_run_id: 'test-run-123',
            is_global: true
          })
        );
      });
    });

    it('should call onSave with specific preset type', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<SaveTrendsPresetModal {...defaultProps} />);

      const specificRadio = screen.getByRole('radio', { name: /Test Run Specific/i });
      fireEvent.click(specificRadio);

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            preset_type: PresetType.SPECIFIC
          })
        );
      });
    });

    it('should trim whitespace from name and description', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: '  Trimmed Name  ' } });

      const descInput = screen.getByLabelText(/Description/i);
      fireEvent.change(descInput, { target: { value: '  Trimmed Description  ' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Trimmed Name',
            description: 'Trimmed Description'
          })
        );
      });
    });

    it('should close modal after successful save', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<SaveTrendsPresetModal {...defaultProps} />);

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('should reset form after successful save', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const { rerender } = render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: 'Modified Name' } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });

      // Reopen modal
      rerender(<SaveTrendsPresetModal {...defaultProps} open={false} />);
      rerender(<SaveTrendsPresetModal {...defaultProps} open={true} />);

      const newNameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(newNameInput.value).toBe('Performance Dashboard | CPU Usage');
    });

    it('should not close modal on save failure', async () => {
      mockOnSave.mockRejectedValue(new Error('Save failed'));

      render(<SaveTrendsPresetModal {...defaultProps} />);

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
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should reset form when closed', async () => {
      const { rerender } = render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: 'Modified Name' } });

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButton);

      // Close modal
      rerender(<SaveTrendsPresetModal {...defaultProps} open={false} />);

      // Reopen modal
      rerender(<SaveTrendsPresetModal {...defaultProps} open={true} />);

      const newNameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      expect(newNameInput.value).toBe('Performance Dashboard | CPU Usage');
    });
  });

  describe('Loading State', () => {
    it('should disable save button when loading', () => {
      render(<SaveTrendsPresetModal {...defaultProps} loading={true} />);

      const saveButton = screen.getByRole('button', { name: /Saving.../i });
      expect(saveButton).toBeDisabled();
    });

    it('should show "Saving..." text when loading', () => {
      render(<SaveTrendsPresetModal {...defaultProps} loading={true} />);

      expect(screen.getByText(/Saving.../i)).toBeInTheDocument();
    });

    it('should show loading spinner when loading', () => {
      render(<SaveTrendsPresetModal {...defaultProps} loading={true} />);

      const saveButton = screen.getByRole('button', { name: /Saving.../i });
      const spinner = saveButton.querySelector('.MuiCircularProgress-root');
      expect(spinner).toBeInTheDocument();
    });

    it('should disable cancel button when loading', () => {
      render(<SaveTrendsPresetModal {...defaultProps} loading={true} />);

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      expect(cancelButton).toBeDisabled();
    });

    it('should disable input fields when loading', () => {
      render(<SaveTrendsPresetModal {...defaultProps} loading={true} />);

      const nameInput = screen.getByLabelText(/Preset Name/i) as HTMLInputElement;
      const descInput = screen.getByLabelText(/Description/i) as HTMLTextAreaElement;

      expect(nameInput.disabled).toBe(true);
      expect(descInput.disabled).toBe(true);
    });

    it('should disable preset type radios when loading', () => {
      render(<SaveTrendsPresetModal {...defaultProps} loading={true} />);

      const genericRadio = screen.getByRole('radio', { name: /Generic/i }) as HTMLInputElement;
      const specificRadio = screen.getByRole('radio', { name: /Test Run Specific/i }) as HTMLInputElement;

      expect(genericRadio.disabled).toBe(true);
      expect(specificRadio.disabled).toBe(true);
    });

    it('should not allow closing modal when loading', () => {
      render(<SaveTrendsPresetModal {...defaultProps} loading={true} />);

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Disabled Save Button', () => {
    it('should disable save button when no dashboard selected', () => {
      const filtersWithoutDashboard = {
        ...defaultFilters,
        selectedDashboard: null
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={filtersWithoutDashboard}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      expect(saveButton).toBeDisabled();
    });

    it('should disable save button when no metric selected', () => {
      const filtersWithoutMetric = {
        ...defaultFilters,
        selectedMetric: null
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={filtersWithoutMetric}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      expect(saveButton).toBeDisabled();
    });

    it('should enable save button when dashboard and metric are selected', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      expect(saveButton).not.toBeDisabled();
    });
  });

  describe('Dynatrace Support', () => {
    it('should use applicationDashboardId from metric for Dynatrace', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const dynatraceFilters: CurrentFilterState = {
        selectedDashboard: {
          id: 'dashboard-123',
          dashboard_label: 'Dynatrace Dashboard'
        },
        selectedMetric: {
          id: 10,
          title: 'Dynatrace Metric',
          applicationDashboardId: 'dynatrace-uuid-123'
        },
        evaluateType: 'avg',
        source: 'dynatrace'
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={dynatraceFilters}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            application_dashboard_id: 'dynatrace-uuid-123',
            source: 'dynatrace'
          })
        );
      });
    });

    it('should fall back to dashboard id when no applicationDashboardId', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const grafanaFilters: CurrentFilterState = {
        selectedDashboard: {
          id: 'dashboard-456',
          dashboard_label: 'Grafana Dashboard'
        },
        selectedMetric: {
          id: 5,
          title: 'Grafana Metric'
          // No applicationDashboardId
        },
        evaluateType: 'max',
        source: 'grafana'
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={grafanaFilters}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            application_dashboard_id: 'dashboard-456',
            source: 'grafana'
          })
        );
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty evaluate type', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const filtersWithoutEvaluate = {
        ...defaultFilters,
        evaluateType: ''
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={filtersWithoutEvaluate}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            evaluate_type: ''
          })
        );
      });
    });

    it('should handle missing source', async () => {
      mockOnSave.mockResolvedValue(undefined);

      const filtersWithoutSource = {
        ...defaultFilters,
        source: undefined
      };

      render(
        <SaveTrendsPresetModal
          {...defaultProps}
          currentFilters={filtersWithoutSource as CurrentFilterState}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            source: 'grafana' // Default to grafana
          })
        );
      });
    });

    it('should handle very long names', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<SaveTrendsPresetModal {...defaultProps} />);

      const longName = 'A'.repeat(200);
      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: longName } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: longName
          })
        );
      });
    });

    it('should handle special characters in name', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<SaveTrendsPresetModal {...defaultProps} />);

      const specialName = 'Test & Special <> Characters / | \\';
      const nameInput = screen.getByLabelText(/Preset Name/i);
      fireEvent.change(nameInput, { target: { value: specialName } });

      const saveButton = screen.getByRole('button', { name: /Save Preset/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: specialName
          })
        );
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper labels for all inputs', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByLabelText(/Preset Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    });

    it('should mark name field as required', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Preset Name/i);
      expect(nameInput).toBeRequired();
    });

    it('should have proper dialog structure', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have proper button roles', () => {
      render(<SaveTrendsPresetModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Save Preset/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });
  });
});
