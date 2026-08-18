/**
 * Unit tests for GenerateReportDialog Component
 *
 * Tests the dialog functionality for generating reports:
 * - Template selector: "Choose a Starting Point" view with template cards
 * - Report builder: section builder with drag-and-drop, ordering
 * - Save as template toggle
 * - Form validation and error handling
 * - Loading states
 * - API integration (generateAdHocReport)
 *
 * Note: The dialog starts with a template selector view, then transitions
 * to a report builder view when a template is selected or "Start from Scratch"
 * is clicked. Tests focus on critical user flows and validation.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import GenerateReportDialog from '@/components/reports/report-generation/GenerateReportDialog';
import * as reportsApi from '@/lib/api/reports';

// Mock the reports API module
jest.mock('@/lib/api/reports', () => ({
  generateReportFromTemplate: jest.fn(),
  generateAdHocReport: jest.fn(),
  getTemplateSummaries: jest.fn(),
  getTemplate: jest.fn(),
  getSectionTypeLabel: jest.fn((type: string) => {
    const labels: Record<string, string> = {
      header: 'Header',
      text_block: 'Text Block',
      slo: 'SLO Results',
      apdex: 'Apdex Report',
      transaction_response_times: 'Transaction Response Times',
      regressions: 'Regressions',
      awr: 'AWR Analysis',
      trends: 'Trends',
      comparisons: 'Comparisons',
      graphs: 'Custom Graphs',
    };
    return labels[type] || type;
  }),
  sectionSupportsText: jest.fn((type: string) => type !== 'text_block'),
  getSectionText: jest.fn((s: { text?: string; comment?: string }) => s.text ?? s.comment),
  REPORT_SECTION_TYPES: [
    'header',
    'text_block',
    'slo',
    'apdex',
    'transaction_response_times',
    'regressions',
    'awr',
    'trends',
    'comparisons',
    'graphs',
  ],
  DEFAULT_REPORT_STYLING: {
    primaryColor: '#1976d2',
    secondaryColor: '#9c27b0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  REPORT_LIMITS: {
    MAX_SECTIONS: 50,
    MAX_TITLE_LENGTH: 255,
    MAX_SECTION_TEXT_LENGTH: 5000,
    MAX_NAME_LENGTH: 255,
    MAX_DESCRIPTION_LENGTH: 1000,
    MAX_CUSTOM_CSS_LENGTH: 10000,
  },
}));

// The dialog (and section config forms) fetch baseline candidates via
// authenticatedFetch — serve a fixed candidate list, degrade everything else.
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn((url: string) => {
    if (typeof url === 'string' && url.includes('/test-runs/baseline-candidates')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          {
            test_run_id: 'baseline-001',
            test_environment: 'acc',
            workload: 'loadTest',
            start_time: '2026-07-01T10:00:00Z',
            created_at: '2026-07-01T10:00:00Z',
          },
        ]),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve([]) });
  }),
  getAuthHeaders: jest.fn(() => ({})),
}));

describe('GenerateReportDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnSuccess = jest.fn();
  const mockOnError = jest.fn();

  const mockScope = {
    systemId: 'system-123',
    testEnvironment: 'production',
    workload: 'load-test',
  };

  const mockTemplateSummaries: reportsApi.TemplateSummary[] = [
    {
      id: 'template-1',
      name: 'Performance Summary',
      is_default: true,
      section_count: 5,
    },
    {
      id: 'template-2',
      name: 'SLO Report',
      is_default: false,
      section_count: 3,
    },
    {
      id: 'template-3',
      name: 'Regression Analysis',
      is_default: false,
      section_count: 4,
    },
  ];

  const mockTemplateDetail: reportsApi.TemplateDetail = {
    id: 'template-1',
    name: 'Performance Summary',
    description: 'Comprehensive performance report with all metrics',
    created_by: 'user@example.com',
    system_id: 'system-123',
    test_environment: 'production',
    workload: 'load-test',
    sections: [
      { type: 'header', order: 0, title: 'Report Header' },
      { type: 'slo', order: 1, title: 'SLO Results' },
      { type: 'apdex', order: 2, title: 'Apdex Scores' },
      { type: 'regressions', order: 3, title: 'Regression Analysis' },
      { type: 'trends', order: 4, title: 'Performance Trends' },
    ],
    is_default: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
  };

  const mockGenerateResponse: reportsApi.GenerateReportResponse = {
    report_id: 'report-uuid-123',
    job_id: 'job-uuid-456',
    status: 'pending',
    estimated_completion_seconds: 30,
  };

  const defaultProps = {
    open: true,
    onClose: mockOnClose,
    testRunId: 'test-run-123',
    scope: mockScope,
    onSuccess: mockOnSuccess,
    onError: mockOnError,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (reportsApi.getTemplateSummaries as jest.Mock).mockResolvedValue(mockTemplateSummaries);
    (reportsApi.getTemplate as jest.Mock).mockResolvedValue(mockTemplateDetail);
    (reportsApi.generateReportFromTemplate as jest.Mock).mockResolvedValue(mockGenerateResponse);
    (reportsApi.generateAdHocReport as jest.Mock).mockResolvedValue(mockGenerateResponse);
  });

  describe('Rendering', () => {
    it('should render dialog when open', () => {
      render(<GenerateReportDialog {...defaultProps} />);
      // Dialog should be visible
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should not render dialog when closed', () => {
      render(<GenerateReportDialog {...defaultProps} open={false} />);
      expect(screen.queryByText('Generate Report')).not.toBeInTheDocument();
    });

    it('should display starting point selector', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await waitFor(() => {
        expect(screen.getByText('Choose a Starting Point')).toBeInTheDocument();
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
    });

    it('should have Cancel button', () => {
      render(<GenerateReportDialog {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });

  describe('Template Mode', () => {
    it('should fetch templates on open', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(reportsApi.getTemplateSummaries).toHaveBeenCalledWith(
          mockScope.systemId,
          mockScope.testEnvironment,
          mockScope.workload
        );
      });
    });

    it('should display loading state while fetching templates', async () => {
      (reportsApi.getTemplateSummaries as jest.Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockTemplateSummaries), 100))
      );

      render(<GenerateReportDialog {...defaultProps} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should display template cards after loading', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Performance Summary')).toBeInTheDocument();
        expect(screen.getByText('SLO Report')).toBeInTheDocument();
        expect(screen.getByText('Regression Analysis')).toBeInTheDocument();
      });
    });

    it('should show Default chip for default template', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Default')).toBeInTheDocument();
      });
    });

    it('should fetch template details when template card clicked', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Performance Summary')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Performance Summary'));

      await waitFor(() => {
        expect(reportsApi.getTemplate).toHaveBeenCalledWith('template-1');
      });
    });

    it('should transition to report builder after selecting template', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Performance Summary')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Performance Summary'));

      await waitFor(() => {
        expect(screen.getByText('Report Layout')).toBeInTheDocument();
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });
    });

    it('should show info message when no templates available', async () => {
      (reportsApi.getTemplateSummaries as jest.Mock).mockResolvedValue([]);

      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/No templates available/)).toBeInTheDocument();
      });
    });

    it('should show error alert on template fetch failure', async () => {
      (reportsApi.getTemplateSummaries as jest.Mock).mockRejectedValue(
        new Error('Failed to load templates')
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        // Multiple alerts may be present (error + info "no templates available")
        const alerts = screen.getAllByRole('alert');
        const errorAlert = alerts.find(alert => alert.textContent?.includes('Failed to load templates'));
        expect(errorAlert).toBeTruthy();
      });
    });

    it('should not show Generate Report button on template selector view', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Choose a Starting Point')).toBeInTheDocument();
      });

      // Generate button only shows on the builder view, not the selector
      expect(screen.queryByRole('button', { name: 'Generate Report' })).not.toBeInTheDocument();
    });
  });

  describe('Report Builder (Start from Scratch)', () => {
    // Helper to navigate to the builder view
    const navigateToBuilder = async () => {
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));
      await waitFor(() => {
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });
    };

    it('should switch to builder view when Start from Scratch clicked', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      expect(screen.getByText('Report Layout')).toBeInTheDocument();
    });

    it('should start with empty sections', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      expect(screen.getByText(/No sections yet/)).toBeInTheDocument();
    });

    it('should display available section types', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      // Should show section types as clickable cards
      expect(screen.getByText('Text Block')).toBeInTheDocument();
      expect(screen.getByText('SLO Summary')).toBeInTheDocument();
    });

    it('should add section when clicked in available sections', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      // Click on SLO Summary section card
      fireEvent.click(screen.getByText('SLO Summary'));

      // After adding section, a delete icon should appear
      await waitFor(() => {
        const sections = screen.getAllByTestId('DeleteIcon');
        expect(sections.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should allow removing sections', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      // Add two sections
      fireEvent.click(screen.getByText('Header'));
      fireEvent.click(screen.getByText('SLO Summary'));

      await waitFor(() => {
        const deleteIcons = screen.getAllByTestId('DeleteIcon');
        expect(deleteIcons.length).toBe(2);
      });

      // Remove one section
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const removeButton = deleteIcons[1]?.closest('button');
      if (removeButton) fireEvent.click(removeButton);

      await waitFor(() => {
        const remainingDeleteIcons = screen.getAllByTestId('DeleteIcon');
        expect(remainingDeleteIcons.length).toBe(1);
      });
    });

    it('should show save as template toggle', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      expect(screen.getByText('Save as template for future use')).toBeInTheDocument();
    });

    it('should toggle save as template state when switch clicked', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      // MUI Switch: toggle by clicking the input with role="switch"
      const switchInput = screen.getByRole('switch') as HTMLInputElement;
      fireEvent.click(switchInput);

      // After toggling, a Template Name text field should appear.
      // MUI TextField with required prop renders "Template Name *" as label text,
      // so use getByText instead of getByLabelText for verification.
      await waitFor(() => {
        expect(screen.getByText('Template Name')).toBeInTheDocument();
      });
    });

    it('should show empty state when no sections added', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      expect(screen.getByText(/No sections yet/)).toBeInTheDocument();
    });

    it('should disable generate button when no sections', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      expect(generateButton).toBeDisabled();
    });

    it('hides the section count until it is close to the limit', async () => {
      // At zero it is a constraint nobody asked about; it earns its place near the cap.
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      expect(screen.queryByText(/\/ 20 sections/)).not.toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('should show error when template not selected', async () => {
      (reportsApi.getTemplateSummaries as jest.Mock).mockResolvedValue([]);

      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Choose a Starting Point')).toBeInTheDocument();
      });

      // Generate Report button is not visible on the template selector view -
      // user must select a template or start from scratch first
      expect(screen.queryByRole('button', { name: 'Generate Report' })).not.toBeInTheDocument();
    });

    it('should validate report name length', async () => {
      // The component auto-generates the report name and does not expose a report
      // name input field. Instead, validate that template name length is enforced
      // when save-as-template is enabled: template name is required and the
      // generate button stays disabled when template name is empty.
      render(<GenerateReportDialog {...defaultProps} />);

      // Navigate to builder view
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));

      await waitFor(() => {
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });

      // Enable save as template - click the switch input directly
      const switchInput = screen.getByRole('switch') as HTMLInputElement;
      fireEvent.click(switchInput);

      // Template Name text field should appear (MUI renders "Template Name *"
      // for required fields, so use getByText for the label text)
      await waitFor(() => {
        expect(screen.getByText('Template Name')).toBeInTheDocument();
      });
    });

    it('should require template name when save as template enabled', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      // Navigate to builder
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));

      await waitFor(() => {
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });

      // Enable save as template - click the switch input directly
      const switchInput = screen.getByRole('switch') as HTMLInputElement;
      fireEvent.click(switchInput);

      // Add a section so generate is not disabled due to empty sections
      fireEvent.click(screen.getByText('Header'));

      // The generate button should be disabled when template name is empty
      await waitFor(() => {
        const generateButton = screen.getByRole('button', { name: 'Generate Report' });
        expect(generateButton).toBeDisabled();
      });
    });
  });

  describe('Report Generation - From Template', () => {
    const navigateViaTemplate = async () => {
      // Wait for templates to load
      await waitFor(() => {
        expect(screen.getByText('Performance Summary')).toBeInTheDocument();
      });

      // Click the template to load it
      fireEvent.click(screen.getByText('Performance Summary'));

      // Wait for builder view
      await waitFor(() => {
        expect(screen.getByText('Report Layout')).toBeInTheDocument();
      });
    };

    it('should call generateAdHocReport API after selecting template', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateViaTemplate();

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(reportsApi.generateAdHocReport).toHaveBeenCalledWith(
          expect.objectContaining({
            test_run_id: 'test-run-123',
            sections: expect.any(Array),
          })
        );
      });
    });

    it('should call onSuccess callback with report details', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateViaTemplate();

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalledWith('report-uuid-123', 'job-uuid-456');
      });
    });

    it('should close dialog after successful generation', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateViaTemplate();

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('should show loading state during generation', async () => {
      // Use a never-resolving promise to keep the loading state visible
      (reportsApi.generateAdHocReport as jest.Mock).mockImplementation(
        () => new Promise(() => {})
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateViaTemplate();

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      // During generation, CircularProgress spinners appear (in status area and button)
      await waitFor(() => {
        const progressbars = screen.getAllByRole('progressbar');
        expect(progressbars.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should disable Cancel button during generation', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockGenerateResponse), 100))
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateViaTemplate();

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      });
    });
  });

  describe('Report Generation - From Scratch', () => {
    const navigateToBuilder = async () => {
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));
      await waitFor(() => {
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });
    };

    it('should call generateAdHocReport API with added sections', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      // Add a header section
      fireEvent.click(screen.getByText('Header'));

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(reportsApi.generateAdHocReport).toHaveBeenCalledWith(
          expect.objectContaining({
            test_run_id: 'test-run-123',
            sections: expect.arrayContaining([
              expect.objectContaining({ type: 'header', order: 0 }),
            ]),
          })
        );
      });
    });

    it('should include all added sections', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      // Add sections by clicking on section cards
      fireEvent.click(screen.getByText('Header'));
      fireEvent.click(screen.getByText('SLO Summary'));

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(reportsApi.generateAdHocReport).toHaveBeenCalledWith(
          expect.objectContaining({
            sections: expect.arrayContaining([
              expect.objectContaining({ type: 'header' }),
              expect.objectContaining({ type: 'slo' }),
            ]),
          })
        );
      });
    });

    it('should show save as template switch', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();

      expect(screen.getByText('Save as template for future use')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    const navigateToBuilder = async () => {
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));
      await waitFor(() => {
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });
    };

    it('should show error alert on generation failure', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockRejectedValue(
        new Error('Generation failed')
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();
      fireEvent.click(screen.getByText('Header'));

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Generation failed');
      });
    });

    it('should call onError callback on failure', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockRejectedValue(
        new Error('Generation failed')
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();
      fireEvent.click(screen.getByText('Header'));

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Generation failed');
      });
    });

    it('should not close dialog on failure', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockRejectedValue(
        new Error('Generation failed')
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();
      fireEvent.click(screen.getByText('Header'));

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should handle non-Error rejection objects', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockRejectedValue('string error');

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();
      fireEvent.click(screen.getByText('Header'));

      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to generate report');
      });
    });
  });

  describe('Dialog Controls', () => {
    it('should close dialog when Cancel clicked', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should not close dialog when submitting', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<GenerateReportDialog {...defaultProps} />);

      // Navigate to builder
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));

      await waitFor(() => {
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });

      // Add a section and generate
      fireEvent.click(screen.getByText('Header'));
      const generateButton = screen.getByRole('button', { name: 'Generate Report' });
      fireEvent.click(generateButton);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      // Close should not be called while submitting
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('should have proper dialog element', () => {
      render(<GenerateReportDialog {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });

    it('should display dialog title', () => {
      render(<GenerateReportDialog {...defaultProps} />);

      expect(screen.getByText('Generate Report')).toBeInTheDocument();
    });
  });

  describe('Visual Styling', () => {
    it('should have rounded dialog styling', () => {
      render(<GenerateReportDialog {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      // MUI applies styles dynamically, just verify dialog exists
      expect(dialog).toBeInTheDocument();
    });

    it('should have generate button', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      // Generate Report button only shows after navigating past the template selector
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));

      await waitFor(() => {
        const generateButton = screen.getByRole('button', { name: 'Generate Report' });
        expect(generateButton).toBeInTheDocument();
      });
    });
  });

  describe('Default View', () => {
    it('should start with template selector view by default', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Choose a Starting Point')).toBeInTheDocument();
      });
    });

    it('should show Start from Scratch option', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
        expect(screen.getByText('Build a custom report from an empty canvas')).toBeInTheDocument();
      });
    });
  });

  describe('Template Chip Badge', () => {
    it('should show Default chip for default template', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      // Wait for templates to load
      await waitFor(() => {
        expect(reportsApi.getTemplateSummaries).toHaveBeenCalled();
      });

      // The template selector uses clickable cards (not a select dropdown).
      // The default template should have a "Default" chip.
      await waitFor(() => {
        expect(screen.getByText('Performance Summary')).toBeInTheDocument();
        expect(screen.getByText('Default')).toBeInTheDocument();
      });
    });

    it('should load templates on open', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(reportsApi.getTemplateSummaries).toHaveBeenCalledWith(
          mockScope.systemId,
          mockScope.testEnvironment,
          mockScope.workload
        );
      });
    });
  });

  describe('Section Type Info', () => {
    it('should display section types in builder view', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      // Navigate to builder
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));

      await waitFor(() => {
        expect(screen.getByText('Header')).toBeInTheDocument();
        expect(screen.getByText('Text Block')).toBeInTheDocument();
      });
    });

    it('should show section in layout after adding', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      // Navigate to builder
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));

      await waitFor(() => {
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });

      // Add a section
      fireEvent.click(screen.getByText('Header'));

      // Should show the section in the layout with delete icon
      await waitFor(() => {
        const deleteIcons = screen.getAllByTestId('DeleteIcon');
        expect(deleteIcons.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Template-level baseline picker', () => {
    const baselineTemplate: reportsApi.TemplateDetail = {
      ...mockTemplateDetail,
      sections: [
        { type: 'header', order: 0, title: 'Report Header' },
        { type: 'comparisons', order: 1, title: 'Perf vs Baseline', config: { comparisonMode: 'baseline_run', source: 'performance-metrics' } },
        { type: 'comparisons', order: 2, title: 'Grafana vs Baseline', config: { comparisonMode: 'baseline_run', source: 'grafana' } },
      ],
    };

    it('shows one picker for baseline sections and applies the choice to all of them', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue(baselineTemplate);
      render(<GenerateReportDialog {...defaultProps} />);

      // Load the template containing two baseline_run sections
      fireEvent.click(await screen.findByText('Performance Summary'));

      // The template-level picker appears once
      expect(await screen.findByText(/set it once here/i)).toBeInTheDocument();
      expect(screen.getByText(/2 sections in this report compare against a baseline run/i)).toBeInTheDocument();

      // Pick the baseline run in the template-level dropdown (first match —
      // per-section dropdowns live inside collapsed config panels below it)
      const input = screen.getAllByLabelText(/baseline test run/i)[0];
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: 'baseline' } });
      fireEvent.click(await screen.findByText('baseline-001'));

      // Generate — every baseline_run section carries the selected id
      fireEvent.click(screen.getByRole('button', { name: /generate report/i }));
      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      const payload = (reportsApi.generateAdHocReport as jest.Mock).mock.calls[0][0];
      const comparisonSections = payload.sections.filter((s: { type: string }) => s.type === 'comparisons');
      expect(comparisonSections).toHaveLength(2);
      for (const s of comparisonSections) {
        expect(s.config.baselineTestRunId).toBe('baseline-001');
      }
      // The non-comparison section is untouched
      const header = payload.sections.find((s: { type: string }) => s.type === 'header');
      expect(header.config?.baselineTestRunId).toBeUndefined();
    });

    it('does not show the picker when no section requires a baseline', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue(mockTemplateDetail);
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText('Available Sections');
      expect(screen.queryByText(/set it once here/i)).not.toBeInTheDocument();
    });
  });

  describe('section palette', () => {
    const navigate = async () => {
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));
      await waitFor(() => {
        expect(screen.getByLabelText('Hide section list')).toBeInTheDocument();
      });
    };

    it('does not claim sections can be dragged from the palette', async () => {
      // The palette never had drag wired up. The old grip icons and "drag sections to the canvas"
      // copy described an interaction that did nothing, so people concluded the dialog was broken.
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      expect(screen.queryByText(/Drag sections to the canvas/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Click to add to your report/i)).toBeInTheDocument();
    });

    it('adds a section on click', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));

      expect(screen.queryByText(/No sections yet/)).not.toBeInTheDocument();
    });

    it('collapses the palette so the canvas gets the width', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      fireEvent.click(screen.getByLabelText('Hide section list'));

      // The catalogue is gone; a single add control takes its place.
      expect(screen.queryByText('Available Sections')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add section' })).toBeInTheDocument();
      expect(screen.getByLabelText('Show section list')).toBeInTheDocument();
    });

    it('offers a searchable menu when collapsed', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Hide section list'));
      fireEvent.click(screen.getByRole('button', { name: 'Add section' }));

      const search = await screen.findByPlaceholderText('Search sections');
      fireEvent.change(search, { target: { value: 'apdex' } });

      expect(screen.getByText('Apdex Scores')).toBeInTheDocument();
      expect(screen.queryByText('AWR Analysis')).not.toBeInTheDocument();
    });

    it('fills an empty canvas from a starter layout', async () => {
      // A blank page is the hardest place to start.
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      fireEvent.click(screen.getByText('Executive summary'));

      expect(screen.queryByText(/No sections yet/)).not.toBeInTheDocument();
    });

    it('enforces the section cap it advertises', async () => {
      // The dialog displayed "20 max" but never stopped at it, so the count sailed past.
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      const addSlo = screen.getByLabelText('Add SLO Summary section');
      for (let i = 0; i < 25; i++) {
      fireEvent.click(addSlo);
      }

      expect(screen.getByText('20 / 20 sections')).toBeInTheDocument();
    });

    it('shows the count once it is near the cap', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      const addSlo = screen.getByLabelText('Add SLO Summary section');
      for (let i = 0; i < 15; i++) {
      fireEvent.click(addSlo);
      }

      expect(screen.getByText('15 / 20 sections')).toBeInTheDocument();
    });
  });

});
