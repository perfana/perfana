/**
 * Unit tests for MetricConfigForm Component
 *
 * Tests the metric configuration form functionality:
 * - Rendering with existing configuration
 * - Scope selection (metric vs panel)
 * - Ignore metric toggle
 * - Metric classification selection
 * - Higher is better toggle
 * - Threshold configuration (aggregation, percentage, IQR, absolute)
 * - Form validation and saving
 * - Error handling
 * - Default values and initialization
 * - Cancel functionality
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MetricConfigForm, { MetricConfigData } from '@/app/test-runs/[id]/components/configuration-comparison/MetricConfigForm';

describe('MetricConfigForm', () => {
  const mockOnSave = jest.fn();
  const mockOnCancel = jest.fn();

  const mockConfigData: MetricConfigData = {
    rowKey: 'metric-123',
    systemUnderTestId: 'sys-123',
    testEnvironment: 'production',
    workload: 'load-test',
    applicationDashboardId: 'dashboard-1',
    panelId: 'panel-1',
    panelTitle: 'Response Time Panel',
    metricName: 'http_request_duration_ms',
    dashboardLabel: 'Performance Dashboard',
    currentConfig: {
      ignore: false,
      metricClassification: {
        classification: 'RED_duration',
        higherIsBetter: false,
      },
      thresholds: {
        aggregation: 'mean',
        percentageThreshold: 15,
        iqrThreshold: 2,
        absoluteThreshold: null,
      },
      configSource: 'metric',
    },
  };

  const mockConfigDataWithoutMetricName: MetricConfigData = {
    ...mockConfigData,
    metricName: null,
    currentConfig: {
      ...mockConfigData.currentConfig!,
      configSource: 'panel',
    },
  };

  const defaultProps = {
    configData: mockConfigData,
    onSave: mockOnSave,
    onCancel: mockOnCancel,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering - Basic Layout', () => {
    it('should render the form with all sections', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByText('Configuration Scope')).toBeInTheDocument();
      expect(screen.getByText('Metric Control')).toBeInTheDocument();
      expect(screen.getByText('Metric Classification')).toBeInTheDocument();
      expect(screen.getByText('Anomaly Detection Thresholds')).toBeInTheDocument();
    });

    it('should render Save and Cancel buttons', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByText('Save Configuration')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should show "No data available" when configData is null', () => {
      render(<MetricConfigForm configData={null as any} onSave={mockOnSave} onCancel={mockOnCancel} />);

      expect(screen.getByText('No data available')).toBeInTheDocument();
    });
  });

  describe('Configuration Scope Selection', () => {
    it('should show metric scope option when metricName is available', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByText('Single Metric')).toBeInTheDocument();
      expect(screen.getByText(/Apply to: http_request_duration_ms/)).toBeInTheDocument();
    });

    it('should show panel scope option', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByText('Entire Panel')).toBeInTheDocument();
      expect(screen.getByText(/Apply to all metrics in: Response Time Panel/)).toBeInTheDocument();
    });

    it('should disable metric scope when metricName is not available', () => {
      render(<MetricConfigForm {...defaultProps} configData={mockConfigDataWithoutMetricName} />);

      const metricRadio = screen.getByRole('radio', { name: /Single Metric/ });
      expect(metricRadio).toBeDisabled();
    });

    it('should default to metric scope when metricName is available', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const metricRadio = screen.getByRole('radio', { name: /Single Metric/ }) as HTMLInputElement;
      expect(metricRadio.checked).toBe(true);
    });

    it('should default to panel scope when metricName is not available', () => {
      render(<MetricConfigForm {...defaultProps} configData={mockConfigDataWithoutMetricName} />);

      const panelRadio = screen.getByRole('radio', { name: /Entire Panel/ }) as HTMLInputElement;
      expect(panelRadio.checked).toBe(true);
    });

    it('should change scope when radio button is clicked', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const panelRadio = screen.getByRole('radio', { name: /Entire Panel/ });
      fireEvent.click(panelRadio);

      expect((panelRadio as HTMLInputElement).checked).toBe(true);
    });

    it('should use configSource to determine initial scope', () => {
      const configWithPanelSource = {
        ...mockConfigData,
        currentConfig: {
          ...mockConfigData.currentConfig!,
          configSource: 'panel' as const,
        },
      };

      render(<MetricConfigForm {...defaultProps} configData={configWithPanelSource} />);

      const panelRadio = screen.getByRole('radio', { name: /Entire Panel/ }) as HTMLInputElement;
      expect(panelRadio.checked).toBe(true);
    });
  });

  describe('Ignore Metric Toggle', () => {
    it('should show ignore metric switch', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByText('Ignore Metric')).toBeInTheDocument();
      expect(
        screen.getByText('When enabled, this metric will be excluded from anomaly detection analysis')
      ).toBeInTheDocument();
    });

    it('should initialize ignore toggle from config', () => {
      const configWithIgnore = {
        ...mockConfigData,
        currentConfig: {
          ...mockConfigData.currentConfig!,
          ignore: true,
        },
      };

      render(<MetricConfigForm {...defaultProps} configData={configWithIgnore} />);

      // Find the Ignore Metric switch specifically by navigating from its label
      const ignoreLabel = screen.getByText('Ignore Metric');
      const ignoreSwitch = ignoreLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(ignoreSwitch?.checked).toBe(true);
    });

    it('should toggle ignore state when switch is clicked', () => {
      render(<MetricConfigForm {...defaultProps} />);

      // Find the Ignore Metric switch specifically
      const ignoreLabel = screen.getByText('Ignore Metric');
      const ignoreSwitch = ignoreLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;

      if (ignoreSwitch) {
        expect(ignoreSwitch.checked).toBe(false);
        fireEvent.click(ignoreSwitch);
        expect(ignoreSwitch.checked).toBe(true);
      }
    });
  });

  describe('Metric Classification', () => {
    it('should show classification dropdown', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const classificationLabels = screen.getAllByText('Classification Category');
      expect(classificationLabels.length).toBeGreaterThan(0);
      // Find the select by looking for the first label and checking there's a combobox nearby
      const classificationLabel = classificationLabels[0];
      expect(classificationLabel.parentElement?.querySelector('[role="combobox"]')).toBeInTheDocument();
    });

    it('should initialize classification from config', () => {
      const { container } = render(<MetricConfigForm {...defaultProps} />);

      // Find the Classification Category select by navigating from the label
      const labels = screen.getAllByText('Classification Category');
      const formControl = labels[0].closest('.MuiFormControl-root');
      const selectInput = formControl?.querySelector('input[value="RED_duration"]');
      expect(selectInput).toBeInTheDocument();
    });

    it('should show all classification options', async () => {
      render(<MetricConfigForm {...defaultProps} />);

      // Find the classification select by navigating from the label
      const labels = screen.getAllByText('Classification Category');
      const label = labels[0];
      const selectButton = label.closest('.MuiFormControl-root')?.querySelector('[role="combobox"]');

      if (selectButton) {
        fireEvent.mouseDown(selectButton);
      }

      await waitFor(() => {
        const listbox = document.querySelector('[role="listbox"]');
        expect(listbox).toBeInTheDocument();
      });

      // Check for options within the listbox
      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox?.textContent).toContain('Unclassified');
      expect(listbox?.textContent).toContain('RED Duration');
      expect(listbox?.textContent).toContain('RED Rate');
      expect(listbox?.textContent).toContain('RED Errors');
      expect(listbox?.textContent).toContain('USE Saturation');
      expect(listbox?.textContent).toContain('USE Utilization');
      expect(listbox?.textContent).toContain('USE Errors');
      expect(listbox?.textContent).toContain('Business Metric');
      expect(listbox?.textContent).toContain('Infrastructure Metric');
      expect(listbox?.textContent).toContain('Application Metric');
      expect(listbox?.textContent).toContain('Custom');
    });

    it('should update classification when option is selected', async () => {
      const { container } = render(<MetricConfigForm {...defaultProps} />);

      // Find the classification select
      const labels = screen.getAllByText('Classification Category');
      const label = labels[0];
      const selectButton = label.closest('.MuiFormControl-root')?.querySelector('[role="combobox"]');

      if (selectButton) {
        fireEvent.mouseDown(selectButton);
      }

      await waitFor(() => {
        const listbox = document.querySelector('[role="listbox"]');
        expect(listbox).toBeInTheDocument();
      });

      // Find and click the Business Metric option within the listbox
      const listbox = document.querySelector('[role="listbox"]');
      const businessMetricOption = Array.from(listbox?.querySelectorAll('[role="option"]') || [])
        .find(el => el.textContent === 'Business Metric');

      if (businessMetricOption) {
        fireEvent.click(businessMetricOption);
      }

      await waitFor(() => {
        const input = container.querySelector('input[value="business_metric"]');
        expect(input).toBeInTheDocument();
      });
    });
  });

  describe('Higher is Better Toggle', () => {
    it('should show higher is better switch', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByText('Higher is Better')).toBeInTheDocument();
    });

    it('should initialize higher is better from config', () => {
      const { container } = render(<MetricConfigForm {...defaultProps} />);

      // Find the switch input by navigating from the label
      const label = screen.getByText('Higher is Better');
      const switchInput = label.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(switchInput).toBeInTheDocument();
      expect(switchInput.checked).toBe(false);
    });

    it('should toggle higher is better when switch is clicked', () => {
      const { container } = render(<MetricConfigForm {...defaultProps} />);

      // Find the switch input
      const label = screen.getByText('Higher is Better');
      const switchInput = label.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;

      fireEvent.click(switchInput);

      expect(switchInput.checked).toBe(true);
    });
  });

  describe('Aggregation Method', () => {
    it('should show aggregation dropdown', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const labels = screen.getAllByText('Aggregation Method');
      expect(labels.length).toBeGreaterThan(0);
      const label = labels[0];
      expect(label.parentElement?.querySelector('[role="combobox"]')).toBeInTheDocument();
    });

    it('should initialize aggregation from config', () => {
      const { container } = render(<MetricConfigForm {...defaultProps} />);

      // Find the aggregation select input
      const labels = screen.getAllByText('Aggregation Method');
      const label = labels[0];
      const formControl = label.closest('.MuiFormControl-root');
      const selectInput = formControl?.querySelector('input[value="mean"]');
      expect(selectInput).toBeInTheDocument();
    });

    it('should show all aggregation options', async () => {
      render(<MetricConfigForm {...defaultProps} />);

      // Find the aggregation select
      const labels = screen.getAllByText('Aggregation Method');
      const label = labels[0];
      const selectButton = label.closest('.MuiFormControl-root')?.querySelector('[role="combobox"]');

      if (selectButton) {
        fireEvent.mouseDown(selectButton);
      }

      await waitFor(() => {
        const listbox = document.querySelector('[role="listbox"]');
        expect(listbox).toBeInTheDocument();
      });

      // Check for options within the listbox
      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox?.textContent).toContain('Mean');
      expect(listbox?.textContent).toContain('Median');
      expect(listbox?.textContent).toContain('Minimum');
      expect(listbox?.textContent).toContain('Maximum');
      expect(listbox?.textContent).toContain('Last Value');
      expect(listbox?.textContent).toContain('10th Percentile');
      expect(listbox?.textContent).toContain('25th Percentile');
      expect(listbox?.textContent).toContain('75th Percentile');
      expect(listbox?.textContent).toContain('90th Percentile');
      expect(listbox?.textContent).toContain('95th Percentile');
      expect(listbox?.textContent).toContain('99th Percentile');
    });

    it('should update aggregation when option is selected', async () => {
      const { container } = render(<MetricConfigForm {...defaultProps} />);

      // Find the aggregation select
      const labels = screen.getAllByText('Aggregation Method');
      const label = labels[0];
      const selectButton = label.closest('.MuiFormControl-root')?.querySelector('[role="combobox"]');

      if (selectButton) {
        fireEvent.mouseDown(selectButton);
      }

      await waitFor(() => {
        const listbox = document.querySelector('[role="listbox"]');
        expect(listbox).toBeInTheDocument();
      });

      // Find and click the Median option within the listbox
      const listbox = document.querySelector('[role="listbox"]');
      const medianOption = Array.from(listbox?.querySelectorAll('[role="option"]') || [])
        .find(el => el.textContent === 'Median');

      if (medianOption) {
        fireEvent.click(medianOption);
      }

      await waitFor(() => {
        const input = container.querySelector('input[value="median"]');
        expect(input).toBeInTheDocument();
      });
    });
  });

  describe('Threshold Configuration', () => {
    it('should show percentage threshold input', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByLabelText('Percentage Threshold (%)')).toBeInTheDocument();
    });

    it('should show IQR threshold input', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByLabelText('IQR Threshold')).toBeInTheDocument();
    });

    it('should show absolute threshold input', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByLabelText('Absolute Threshold')).toBeInTheDocument();
    });

    it('should initialize percentage threshold from config', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const percentageInput = screen.getByLabelText('Percentage Threshold (%)') as HTMLInputElement;
      expect(percentageInput.value).toBe('15');
    });

    it('should initialize IQR threshold from config', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const iqrInput = screen.getByLabelText('IQR Threshold') as HTMLInputElement;
      expect(iqrInput.value).toBe('2');
    });

    it('should initialize absolute threshold from config', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const absoluteInput = screen.getByLabelText('Absolute Threshold') as HTMLInputElement;
      expect(absoluteInput.value).toBe('');
    });

    it('should update percentage threshold when value is changed', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const percentageInput = screen.getByLabelText('Percentage Threshold (%)');
      fireEvent.change(percentageInput, { target: { value: '20' } });

      expect((percentageInput as HTMLInputElement).value).toBe('20');
    });

    it('should update IQR threshold when value is changed', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const iqrInput = screen.getByLabelText('IQR Threshold');
      fireEvent.change(iqrInput, { target: { value: '3' } });

      expect((iqrInput as HTMLInputElement).value).toBe('3');
    });

    it('should update absolute threshold when value is changed', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const absoluteInput = screen.getByLabelText('Absolute Threshold');
      fireEvent.change(absoluteInput, { target: { value: '100' } });

      expect((absoluteInput as HTMLInputElement).value).toBe('100');
    });

    it('should show helper text for each threshold input', () => {
      render(<MetricConfigForm {...defaultProps} />);

      expect(screen.getByText('Percentage change threshold')).toBeInTheDocument();
      expect(screen.getByText('Interquartile range multiplier')).toBeInTheDocument();
      expect(screen.getByText('Absolute value threshold')).toBeInTheDocument();
    });
  });

  describe('Form Saving', () => {
    it('should call onSave with correct data when save button is clicked', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<MetricConfigForm {...defaultProps} />);

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          'metric-123',
          {
            ignore: false,
            metricClassification: {
              classification: 'RED_duration',
              higherIsBetter: false,
            },
            thresholds: {
              aggregation: 'mean',
              percentageThreshold: 15,
              iqrThreshold: 2,
              absoluteThreshold: null,
            },
          },
          'metric'
        );
      });
    });

    it('should save with panel scope when selected', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<MetricConfigForm {...defaultProps} />);

      const panelRadio = screen.getByRole('radio', { name: /Entire Panel/ });
      fireEvent.click(panelRadio);

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 'panel');
      });
    });

    it('should parse numeric threshold values correctly', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<MetricConfigForm {...defaultProps} />);

      const percentageInput = screen.getByLabelText('Percentage Threshold (%)');
      fireEvent.change(percentageInput, { target: { value: '25.5' } });

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            thresholds: expect.objectContaining({
              percentageThreshold: 25.5,
            }),
          }),
          expect.any(String)
        );
      });
    });

    it('should handle null threshold values when empty', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<MetricConfigForm {...defaultProps} />);

      const percentageInput = screen.getByLabelText('Percentage Threshold (%)');
      fireEvent.change(percentageInput, { target: { value: '' } });

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            thresholds: expect.objectContaining({
              percentageThreshold: null,
            }),
          }),
          expect.any(String)
        );
      });
    });

    it('should show loading state while saving', async () => {
      mockOnSave.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1000)));

      render(<MetricConfigForm {...defaultProps} />);

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeInTheDocument();
      });
    });

    it('should disable buttons while saving', async () => {
      mockOnSave.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1000)));

      render(<MetricConfigForm {...defaultProps} />);

      const saveButton = screen.getByText('Save Configuration');
      const cancelButton = screen.getByText('Cancel');

      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(saveButton).toBeDisabled();
        expect(cancelButton).toBeDisabled();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when save fails', async () => {
      mockOnSave.mockRejectedValue(new Error('Save failed'));

      render(<MetricConfigForm {...defaultProps} />);

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });
    });

    it('should handle non-Error objects in catch block', async () => {
      mockOnSave.mockRejectedValue('String error');

      render(<MetricConfigForm {...defaultProps} />);

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Failed to save configuration')).toBeInTheDocument();
      });
    });

    it('should clear error message on successful save', async () => {
      mockOnSave.mockRejectedValueOnce(new Error('First save failed')).mockResolvedValueOnce(undefined);

      render(<MetricConfigForm {...defaultProps} />);

      const saveButton = screen.getByText('Save Configuration');

      // First save fails
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('First save failed')).toBeInTheDocument();
      });

      // Second save succeeds
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.queryByText('First save failed')).not.toBeInTheDocument();
      });
    });
  });

  describe('Cancel Functionality', () => {
    it('should call onCancel when cancel button is clicked', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('should not save when cancel is clicked', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });

  describe('Default Values', () => {
    it('should use default values when no config is provided', () => {
      const configWithoutCurrentConfig: MetricConfigData = {
        ...mockConfigData,
        currentConfig: undefined,
      };

      const { container } = render(<MetricConfigForm {...defaultProps} configData={configWithoutCurrentConfig} />);

      // Find the Classification Category select by navigating from label
      const classificationLabels = screen.getAllByText('Classification Category');
      const classificationFormControl = classificationLabels[0].closest('.MuiFormControl-root');
      const classificationInput = classificationFormControl?.querySelector('input[value]') as HTMLInputElement;
      expect(classificationInput?.value).toBe('unclassified');

      // Find the Aggregation Method select
      const aggregationLabels = screen.getAllByText('Aggregation Method');
      const aggregationFormControl = aggregationLabels[0].closest('.MuiFormControl-root');
      const aggregationInput = aggregationFormControl?.querySelector('input[value]') as HTMLInputElement;
      expect(aggregationInput?.value).toBe('mean');
    });

    it('should initialize ignore to false by default', () => {
      const configWithoutCurrentConfig: MetricConfigData = {
        ...mockConfigData,
        currentConfig: undefined,
      };

      render(<MetricConfigForm {...defaultProps} configData={configWithoutCurrentConfig} />);

      // Find the Ignore Metric switch by navigating from label
      const ignoreLabel = screen.getByText('Ignore Metric');
      const ignoreSwitch = ignoreLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(ignoreSwitch?.checked).toBe(false);
    });

    it('should initialize higherIsBetter to false by default', () => {
      const configWithoutCurrentConfig: MetricConfigData = {
        ...mockConfigData,
        currentConfig: undefined,
      };

      render(<MetricConfigForm {...defaultProps} configData={configWithoutCurrentConfig} />);

      // Find the Higher is Better switch by navigating from label
      const higherIsBetterLabel = screen.getByText('Higher is Better');
      const higherIsBetterSwitch = higherIsBetterLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(higherIsBetterSwitch?.checked).toBe(false);
    });
  });

  describe('Form State Reinitialization', () => {
    it('should reinitialize form when configData changes', () => {
      const { rerender } = render(<MetricConfigForm {...defaultProps} />);

      const newConfigData: MetricConfigData = {
        ...mockConfigData,
        rowKey: 'metric-456',
        currentConfig: {
          ignore: true,
          metricClassification: {
            classification: 'USE_utilization',
            higherIsBetter: true,
          },
          thresholds: {
            aggregation: 'median',
            percentageThreshold: 20,
            iqrThreshold: 3,
            absoluteThreshold: 50,
          },
          configSource: 'panel',
        },
      };

      rerender(<MetricConfigForm {...defaultProps} configData={newConfigData} />);

      // Find the Ignore Metric switch
      const ignoreLabel = screen.getByText('Ignore Metric');
      const ignoreSwitch = ignoreLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(ignoreSwitch?.checked).toBe(true);

      // Find the Classification Category select
      const classificationLabels = screen.getAllByText('Classification Category');
      const classificationFormControl = classificationLabels[0].closest('.MuiFormControl-root');
      const classificationInput = classificationFormControl?.querySelector('input[value]') as HTMLInputElement;
      expect(classificationInput?.value).toBe('USE_utilization');

      // Find the Aggregation Method select
      const aggregationLabels = screen.getAllByText('Aggregation Method');
      const aggregationFormControl = aggregationLabels[0].closest('.MuiFormControl-root');
      const aggregationInput = aggregationFormControl?.querySelector('input[value]') as HTMLInputElement;
      expect(aggregationInput?.value).toBe('median');
    });
  });

  describe('Form Validation', () => {
    it('should allow saving with all threshold fields empty', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<MetricConfigForm {...defaultProps} />);

      const percentageInput = screen.getByLabelText('Percentage Threshold (%)');
      const iqrInput = screen.getByLabelText('IQR Threshold');
      const absoluteInput = screen.getByLabelText('Absolute Threshold');

      fireEvent.change(percentageInput, { target: { value: '' } });
      fireEvent.change(iqrInput, { target: { value: '' } });
      fireEvent.change(absoluteInput, { target: { value: '' } });

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            thresholds: {
              aggregation: 'mean',
              percentageThreshold: null,
              iqrThreshold: null,
              absoluteThreshold: null,
            },
          }),
          expect.any(String)
        );
      });
    });
  });

  describe('UI States', () => {
    it('should show N/A for metric name when not available', () => {
      render(<MetricConfigForm {...defaultProps} configData={mockConfigDataWithoutMetricName} />);

      expect(screen.getByText(/Apply to: N\/A/)).toBeInTheDocument();
    });

    it('should enable both save and cancel buttons by default', () => {
      render(<MetricConfigForm {...defaultProps} />);

      const saveButton = screen.getByText('Save Configuration');
      const cancelButton = screen.getByText('Cancel');

      expect(saveButton).not.toBeDisabled();
      expect(cancelButton).not.toBeDisabled();
    });
  });

  describe('Complex State Changes', () => {
    it('should preserve all form state when switching between scopes', () => {
      render(<MetricConfigForm {...defaultProps} />);

      // Find and change the Ignore Metric switch
      const ignoreLabel = screen.getByText('Ignore Metric');
      const ignoreSwitch = ignoreLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(ignoreSwitch);

      // Change percentage threshold
      const percentageInput = screen.getByLabelText('Percentage Threshold (%)');
      fireEvent.change(percentageInput, { target: { value: '30' } });

      // Switch to panel scope
      const panelRadio = screen.getByRole('radio', { name: /Entire Panel/ });
      fireEvent.click(panelRadio);

      // Switch back to metric scope
      const metricRadio = screen.getByRole('radio', { name: /Single Metric/ });
      fireEvent.click(metricRadio);

      // Values should be preserved
      expect(ignoreSwitch.checked).toBe(true);
      expect((percentageInput as HTMLInputElement).value).toBe('30');
    });

    it('should save all modified fields correctly', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<MetricConfigForm {...defaultProps} />);

      // Find and modify Ignore Metric switch
      const ignoreLabel = screen.getByText('Ignore Metric');
      const ignoreSwitch = ignoreLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(ignoreSwitch);

      // Modify classification - find the combobox and open it
      const classificationLabels = screen.getAllByText('Classification Category');
      const classificationFormControl = classificationLabels[0].closest('.MuiFormControl-root');
      const classificationCombobox = classificationFormControl?.querySelector('[role="combobox"]');
      if (classificationCombobox) {
        fireEvent.mouseDown(classificationCombobox);
      }
      await waitFor(() => {
        expect(screen.getByText('Business Metric')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Business Metric'));

      // Find and modify Higher is Better switch
      const higherIsBetterLabel = screen.getByText('Higher is Better');
      const higherIsBetterSwitch = higherIsBetterLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(higherIsBetterSwitch);

      // Modify aggregation - find the combobox and open it
      const aggregationLabels = screen.getAllByText('Aggregation Method');
      const aggregationFormControl = aggregationLabels[0].closest('.MuiFormControl-root');
      const aggregationCombobox = aggregationFormControl?.querySelector('[role="combobox"]');
      if (aggregationCombobox) {
        fireEvent.mouseDown(aggregationCombobox);
      }
      await waitFor(() => {
        expect(screen.getByText('Median')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Median'));

      // Modify threshold inputs
      const percentageInput = screen.getByLabelText('Percentage Threshold (%)');
      fireEvent.change(percentageInput, { target: { value: '25' } });

      const iqrInput = screen.getByLabelText('IQR Threshold');
      fireEvent.change(iqrInput, { target: { value: '2.5' } });

      const absoluteInput = screen.getByLabelText('Absolute Threshold');
      fireEvent.change(absoluteInput, { target: { value: '100' } });

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          'metric-123',
          {
            ignore: true,
            metricClassification: {
              classification: 'business_metric',
              higherIsBetter: true,
            },
            thresholds: {
              aggregation: 'median',
              percentageThreshold: 25,
              iqrThreshold: 2.5,
              absoluteThreshold: 100,
            },
          },
          'metric'
        );
      });
    });
  });
});
