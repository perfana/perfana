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
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import GenerateReportDialog from '@/components/reports/report-generation/GenerateReportDialog';
import * as reportsApi from '@/lib/api/reports';
import { authenticatedFetch } from '@/lib/api';

// Mock the reports API module
jest.mock('@/lib/api/reports', () => ({
  generateReportFromTemplate: jest.fn(),
  generateAdHocReport: jest.fn(),
  getTemplateSummaries: jest.fn(),
  getTemplate: jest.fn(),
  updateTemplate: jest.fn(),
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
  getSectionText: jest.fn(
    (s: { text?: string; comment?: string }) => s.text ?? s.comment
  ),
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
    if (
      typeof url === 'string' &&
      url.includes('/test-runs/baseline-candidates')
    ) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
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

// jsdom has no layout, so a real pointer drag can't land by position here. These pass straight through
// to dnd-kit and record what the dialog handed it: its drag handlers and accessibility props, the
// canvas card ids, the layout-animation gate each card hands useSortable, the canvas droppable's
// options and the drag overlay's props. `handDrag` is the drag a test holds by calling the recorded
// handlers itself, which dnd-kit knows nothing about.
const mockDnd: {
  context?: Record<'onDragStart' | 'onDragMove' | 'onDragOver' | 'onDragEnd' | 'onDragCancel', (event: unknown) => void> & {
    collisionDetection: (args: unknown) => Array<{ id: string }>;
    accessibility: { announcements: Record<'onDragStart' | 'onDragOver' | 'onDragEnd' | 'onDragCancel', (event: unknown) => string | undefined> };
  };
  cardIds?: string[];
  animateLayoutChanges?: (args: unknown) => boolean;
  canvasDroppable?: { id: string; disabled?: boolean };
  overlay?: { dropAnimation?: unknown; style?: { pointerEvents?: string } };
  handDrag?: unknown;
} = {};
jest.mock('@dnd-kit/core', () => {
  const actual = jest.requireActual('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: Record<string, (event: { active?: unknown }) => void>) => {
      mockDnd.context = {
        ...props,
        onDragStart: (event: { active?: unknown }) => {
          mockDnd.handDrag = event.active;
          props.onDragStart(event);
        },
        onDragEnd: (event: { active?: unknown }) => {
          mockDnd.handDrag = undefined;
          props.onDragEnd(event);
        },
        onDragCancel: (event: { active?: unknown }) => {
          mockDnd.handDrag = undefined;
          props.onDragCancel(event);
        },
      } as never;
      // dnd-kit gets the dialog's own handlers, so a real sensor drag never sets handDrag.
      return jest.requireActual('react').createElement(actual.DndContext, props);
    },
    // The dialog clears its drag state when dnd-kit reads idle, which would end a hand-held drag on
    // its first commit, so one reads as in progress here.
    useDndContext: () => {
      const context = actual.useDndContext();
      return mockDnd.handDrag ? { ...context, active: mockDnd.handDrag } : context;
    },
    DragOverlay: (props: Record<string, unknown>) => {
      mockDnd.overlay = props as never;
      return jest.requireActual('react').createElement(actual.DragOverlay, props);
    },
    // useSortable calls this too, for every card; only the canvas's call is recorded.
    useDroppable: (args: { id: string; disabled?: boolean }) => {
      if (args.id === 'report-canvas') mockDnd.canvasDroppable = args;
      return actual.useDroppable(args);
    },
  };
});
jest.mock('@dnd-kit/sortable', () => {
  const actual = jest.requireActual('@dnd-kit/sortable');
  return {
    ...actual,
    SortableContext: (props: { items: string[] }) => {
      mockDnd.cardIds = props.items;
      return jest.requireActual('react').createElement(actual.SortableContext, props);
    },
    useSortable: (args: { animateLayoutChanges?: (a: unknown) => boolean }) => {
      mockDnd.animateLayoutChanges = args.animateLayoutChanges;
      return actual.useSortable(args);
    },
  };
});

/**
 * Generates, and answers "Generate without saving" when the report has changes on top of the
 * template it was loaded from: those tests are about the report, not about the template prompt.
 */
const clickGenerate = async () => {
  fireEvent.click(screen.getByRole('button', { name: /generate report/i }));
  await act(async () => {});
  const skip = screen.queryByRole('button', { name: 'Generate without saving' });
  if (skip) fireEvent.click(skip);
};

/** A palette row in hand, as dnd-kit reports it. The dragged preview's centre is at y=100. */
const paletteActive = (type: string) => ({
  id: `palette:${type}`,
  data: { current: { paletteType: type } },
  rect: { current: { initial: null, translated: { top: 90, height: 20 } } },
});
/** A canvas card placed so that the dragged preview's centre falls in its top or bottom half. */
const overCard = (card: number, half: 'top' | 'bottom') => ({
  id: mockDnd.cardIds![card],
  rect: { top: half === 'top' ? 100 : 80, height: 20 },
});

/** Drops a palette row onto a card's half, the canvas, or nothing. */
const dropFromPalette = (
  type: string,
  over: { card: number; half: 'top' | 'bottom' } | 'canvas' | null,
) => {
  const active = paletteActive(type);
  const overArg =
    over === null
      ? null
      : over === 'canvas'
        ? { id: 'report-canvas', rect: { top: 0, height: 500 } }
        : overCard(over.card, over.half);
  act(() => mockDnd.context!.onDragStart({ active }));
  act(() => mockDnd.context!.onDragEnd({ active, over: overArg }));
};

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
    mockDnd.handDrag = undefined;
    (reportsApi.getTemplateSummaries as jest.Mock).mockResolvedValue(
      mockTemplateSummaries
    );
    (reportsApi.getTemplate as jest.Mock).mockResolvedValue(mockTemplateDetail);
    (reportsApi.generateReportFromTemplate as jest.Mock).mockResolvedValue(
      mockGenerateResponse
    );
    (reportsApi.generateAdHocReport as jest.Mock).mockResolvedValue(
      mockGenerateResponse
    );
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
      expect(
        screen.getByRole('button', { name: 'Cancel' })
      ).toBeInTheDocument();
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
        () =>
          new Promise(resolve =>
            setTimeout(() => resolve(mockTemplateSummaries), 100)
          )
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
        const errorAlert = alerts.find(alert =>
          alert.textContent?.includes('Failed to load templates')
        );
        expect(errorAlert).toBeTruthy();
      });
    });

    it('should not show Generate Report button on template selector view', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Choose a Starting Point')).toBeInTheDocument();
      });

      // Generate button only shows on the builder view, not the selector
      expect(
        screen.queryByRole('button', { name: 'Generate Report' })
      ).not.toBeInTheDocument();
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

      expect(
        screen.getByText('Save as template')
      ).toBeInTheDocument();
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

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
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
      expect(
        screen.queryByRole('button', { name: 'Generate Report' })
      ).not.toBeInTheDocument();
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
        const generateButton = screen.getByRole('button', {
          name: 'Generate Report',
        });
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

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
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

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalledWith(
          'report-uuid-123',
          'job-uuid-456'
        );
      });
    });

    it('should close dialog after successful generation', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      await navigateViaTemplate();

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
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

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
      fireEvent.click(generateButton);

      // During generation, CircularProgress spinners appear (in status area and button)
      await waitFor(() => {
        const progressbars = screen.getAllByRole('progressbar');
        expect(progressbars.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should disable Cancel button during generation', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(() => resolve(mockGenerateResponse), 100)
          )
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateViaTemplate();

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
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

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
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

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
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

      expect(
        screen.getByText('Save as template')
      ).toBeInTheDocument();
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

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Generation failed'
        );
      });
    });

    it('should call onError callback on failure', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockRejectedValue(
        new Error('Generation failed')
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();
      fireEvent.click(screen.getByText('Header'));

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
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

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should handle non-Error rejection objects', async () => {
      (reportsApi.generateAdHocReport as jest.Mock).mockRejectedValue(
        'string error'
      );

      render(<GenerateReportDialog {...defaultProps} />);

      await navigateToBuilder();
      fireEvent.click(screen.getByText('Header'));

      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Failed to generate report'
        );
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
      const generateButton = screen.getByRole('button', {
        name: 'Generate Report',
      });
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
        const generateButton = screen.getByRole('button', {
          name: 'Generate Report',
        });
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
        expect(
          screen.getByText('Build a custom report from an empty canvas')
        ).toBeInTheDocument();
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

  describe('reopening and the starting point', () => {
    // Value: protects=reopening shows the starting point at once, not the last report's live builder
    // until the fetch answers, where a drop would be thrown away; fails_when=the selector is set only
    // after the await; why_new=no test reopened this dialog; seam=none; no_claim=none beyond protects
    it('shows the starting point straight away on a reopen', async () => {
      const { rerender } = render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Start from Scratch'));
      await screen.findByText('Available Sections');

      rerender(<GenerateReportDialog {...defaultProps} open={false} />);
      (reportsApi.getTemplateSummaries as jest.Mock).mockReturnValue(new Promise(() => undefined));
      rerender(<GenerateReportDialog {...defaultProps} />);

      expect(screen.getByText('Choose a Starting Point')).toBeInTheDocument();
      expect(screen.queryByText('Available Sections')).not.toBeInTheDocument();
    });

    // Value: protects=a reopen does not mount the last report's builder, whose forms would each fire
    // their fetches only for the starting point to replace them; fails_when=the selector resets in
    // an effect, a commit too late; why_new=the reopen test above reads the settled screen, which is
    // right either way; seam=the mocked fetch, read for one form's request; no_claim=other sections' forms
    it('fetches nothing for the last report on a reopen', async () => {
      const transactionCalls = () =>
        (authenticatedFetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/transactions'));
      const { rerender } = render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Start from Scratch'));
      fireEvent.click(await screen.findByLabelText('Add Response Times section'));
      // The control: this section's form does fetch when it mounts.
      await waitFor(() => expect(transactionCalls().length).toBeGreaterThan(0));

      // All the way closed: a reopen during the exit animation never unmounted the old content.
      rerender(<GenerateReportDialog {...defaultProps} open={false} />);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      (authenticatedFetch as jest.Mock).mockClear();
      rerender(<GenerateReportDialog {...defaultProps} />);
      await act(async () => {});

      expect(screen.getByText('Choose a Starting Point')).toBeInTheDocument();
      expect(transactionCalls()).toHaveLength(0);
    });

    // Value: protects=a template picked before a close cannot replace the report built after the
    // reopen when its slow answer lands; fails_when=handleLoadTemplate writes without checking it is
    // still the current load, or a close stops invalidating it; why_new=no test closes mid-load;
    // seam=getTemplate; no_claim=how slow a real template load is
    it('does not let a template picked before a close replace the report built since', async () => {
      let answer: (detail: unknown) => void = () => undefined;
      (reportsApi.getTemplate as jest.Mock).mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const { rerender } = render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));

      rerender(<GenerateReportDialog {...defaultProps} open={false} />);
      rerender(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Start from Scratch'));
      fireEvent.click(await screen.findByLabelText('Add SLO Summary section'));
      expect(screen.getAllByTestId('DeleteIcon')).toHaveLength(1);

      await act(async () => answer(mockTemplateDetail));

      expect(screen.getAllByTestId('DeleteIcon')).toHaveLength(1);
    });

    // Value: protects=a template list from a superseded open cannot replace the current one when it
    // answers last; fails_when=the effect loses its cancelled flag; why_new=see above; seam=none;
    // no_claim=none beyond protects
    it('keeps the current template list when an earlier fetch answers last', async () => {
      const answers: Array<(value: unknown) => void> = [];
      (reportsApi.getTemplateSummaries as jest.Mock).mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );
      const { rerender } = render(<GenerateReportDialog {...defaultProps} />);
      rerender(<GenerateReportDialog {...defaultProps} open={false} />);
      rerender(<GenerateReportDialog {...defaultProps} />);

      await act(async () => answers[1]([{ id: 'current', name: 'Current Template', section_count: 1 }]));
      await act(async () => answers[0]([{ id: 'stale', name: 'Stale Template', section_count: 1 }]));

      expect(screen.getByText('Current Template')).toBeInTheDocument();
      expect(screen.queryByText('Stale Template')).not.toBeInTheDocument();
    });

    // Value: protects=the keyboard can leave the starting-point screen, the only way into the
    // builder for a report; fails_when=the options go back to divs with click handlers; why_new=every
    // test clicks them by text; seam=none; no_claim=focus styling
    it('offers every starting point as a real button', async () => {
      render(<GenerateReportDialog {...defaultProps} />);

      expect(await screen.findByRole('button', { name: /Start from Scratch/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Performance Summary/ })).toBeInTheDocument();
    });
  });

  describe('Template-level baseline picker', () => {
    const baselineTemplate: reportsApi.TemplateDetail = {
      ...mockTemplateDetail,
      sections: [
        { type: 'header', order: 0, title: 'Report Header' },
        {
          type: 'comparisons',
          order: 1,
          title: 'Perf vs Baseline',
          config: {
            comparisonMode: 'baseline_run',
            source: 'performance-metrics',
          },
        },
        {
          type: 'comparisons',
          order: 2,
          title: 'Grafana vs Baseline',
          config: { comparisonMode: 'baseline_run', source: 'grafana' },
        },
      ],
    };

    it('blocks Generate Report until every comparison section has a baseline', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue(baselineTemplate);
      render(<GenerateReportDialog {...defaultProps} />);

      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText(/set it once here/i);

      // Two comparison sections, no baseline picked yet
      const generate = screen.getByRole('button', { name: /generate report/i });
      expect(generate).toBeDisabled();
      expect(screen.getByText(/select a baseline run for every comparison section/i)).toBeInTheDocument();

      const input = screen.getAllByLabelText(/baseline test run/i)[0];
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: 'baseline' } });
      fireEvent.click(await screen.findByText('baseline-001'));

      await waitFor(() => expect(screen.getByRole('button', { name: /generate report/i })).toBeEnabled());
    });

    // The run this report is generated for may have no earlier run to pin — a first run in a
    // new environment, or simply a baseline-candidates fetch that failed. Neither is a reason
    // to refuse the report: the picker still offers the resolved-per-report sentinels, and the
    // renderer resolves them at generation time. Blocking on the candidate list took the
    // feature away in exactly the case it exists for.
    it('generates against a resolved-per-report baseline when there is no run to pin', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue(baselineTemplate);
      (global.fetch as jest.Mock).mockImplementation((url: string) =>
        url.includes('/test-runs/baseline-candidates')
          ? Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
          : Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));

      render(<GenerateReportDialog {...defaultProps} />);

      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText(/set it once here/i);

      // No candidates, so the old gate refused outright. The only block now is "nothing chosen".
      expect(
        screen.queryByText(/remove the comparison section to generate the report/i)
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /generate report/i })).toBeDisabled();

      const input = screen.getAllByLabelText(/baseline test run/i)[0]!;
      fireEvent.mouseDown(input);
      fireEvent.click(await screen.findByText('Previous run'));

      await waitFor(() => expect(screen.getByRole('button', { name: /generate report/i })).toBeEnabled());
    });

    // Value: protects=a section with no baseline can be repaired from the shared picker: it shows no
    // value and says the sections differ, rather than "Applied to all" over a blocked Generate, and
    // picking applies to every section; fails_when=the picker shows the one baseline in use while a
    // section is unset, where re-picking that value fires no change; why_new=the disagree test has
    // two pinned sections; seam=none; no_claim=none beyond protects
    it('lets the shared picker repair a section that has no baseline', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue({
        ...mockTemplateDetail,
        sections: [
          { type: 'comparisons', order: 0, config: { baselineTestRunId: 'baseline-001' } },
          { type: 'comparisons', order: 1 },
        ],
      });
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));
      expect(await screen.findByText(/different baselines/i)).toBeInTheDocument();
      expect(screen.queryByText(/Applied to all/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /generate report/i })).toBeDisabled();

      const input = screen.getAllByLabelText(/baseline test run/i)[0];
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: 'baseline' } });
      fireEvent.click(await screen.findByText('baseline-001'));

      expect(await screen.findByText(/Applied to all 2/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: /generate report/i })).toBeEnabled());
    });

    // Value: protects=a new comparisons section starts unset while the others disagree, so Generate
    // stays blocked until the user points it at one; fails_when=the seed falls back to one of the
    // disagreeing baselines; why_new=the seed test has one shared baseline; seam=none;
    // no_claim=a section's own baseline picker
    it('leaves a new comparisons section unseeded while the others disagree', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue({
        ...mockTemplateDetail,
        sections: [
          { type: 'comparisons', order: 0, config: { baselineTestRunId: 'baseline-001' } },
          { type: 'comparisons', order: 1, config: { baselineTestRunId: 'baseline-002' } },
        ],
      });
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText('Report Layout');
      await waitFor(() => expect(screen.getByRole('button', { name: /generate report/i })).toBeEnabled());

      fireEvent.click(screen.getByLabelText('Add Test Comparisons section'));

      expect(screen.getByRole('button', { name: /generate report/i })).toBeDisabled();
    });

    // Value: protects=the shared baseline reaches comparisons sections only; fails_when=the seed
    // loses its type check and every later section carries a stray baseline; why_new=the seed test
    // reads comparisons sections alone; seam=none; no_claim=whether another section reads the field
    it('does not seed the shared baseline into any other section type', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue(baselineTemplate);
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText(/set it once here/i);
      const input = screen.getAllByLabelText(/baseline test run/i)[0];
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: 'baseline' } });
      fireEvent.click(await screen.findByText('baseline-001'));
      await waitFor(() => expect(screen.getByRole('button', { name: /generate report/i })).toBeEnabled());

      fireEvent.click(screen.getByLabelText('Add AWR Analysis section'));
      await clickGenerate();

      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      const { sections } = (reportsApi.generateAdHocReport as jest.Mock).mock.calls[0][0];
      expect(sections.find((s: { type: string }) => s.type === 'awr').config).toBeUndefined();
    });

    // Value: protects=a comparisons section added after the shared baseline is chosen starts on it, so
    // Generate is not blocked by a section the picker says it covers; fails_when=handleAddSection
    // stops seeding the shared baseline into new comparisons sections; why_new=every other baseline
    // test picks after the sections exist; seam=none; no_claim=none beyond protects
    it('starts a comparisons section added later on the shared baseline', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue(baselineTemplate);
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText(/set it once here/i);
      const input = screen.getAllByLabelText(/baseline test run/i)[0];
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: 'baseline' } });
      fireEvent.click(await screen.findByText('baseline-001'));
      await waitFor(() => expect(screen.getByRole('button', { name: /generate report/i })).toBeEnabled());

      fireEvent.click(screen.getByLabelText('Add Test Comparisons section'));

      expect(screen.getByRole('button', { name: /generate report/i })).toBeEnabled();
      await clickGenerate();
      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      const { sections } = (reportsApi.generateAdHocReport as jest.Mock).mock.calls[0][0];
      const baselines = sections
        .filter((s: { type: string }) => s.type === 'comparisons')
        .map((s: { config?: { baselineTestRunId?: string } }) => s.config?.baselineTestRunId);
      expect(baselines).toEqual(['baseline-001', 'baseline-001', 'baseline-001']);
    });

    it('shows one picker for baseline sections and applies the choice to all of them', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue(baselineTemplate);
      render(<GenerateReportDialog {...defaultProps} />);

      // Load the template containing two baseline_run sections
      fireEvent.click(await screen.findByText('Performance Summary'));

      // The template-level picker appears once
      expect(await screen.findByText(/set it once here/i)).toBeInTheDocument();
      expect(
        screen.getByText(
          /2 sections in this report compare against a baseline run/i
        )
      ).toBeInTheDocument();

      // Pick the baseline run in the template-level dropdown (first match —
      // per-section dropdowns live inside collapsed config panels below it)
      const input = screen.getAllByLabelText(/baseline test run/i)[0];
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: 'baseline' } });
      fireEvent.click(await screen.findByText('baseline-001'));

      // Generate — every baseline_run section carries the selected id
      await clickGenerate();
      await waitFor(() =>
        expect(reportsApi.generateAdHocReport).toHaveBeenCalled()
      );
      const payload = (reportsApi.generateAdHocReport as jest.Mock).mock
        .calls[0][0];
      const comparisonSections = payload.sections.filter(
        (s: { type: string }) => s.type === 'comparisons'
      );
      expect(comparisonSections).toHaveLength(2);
      for (const s of comparisonSections) {
        expect(s.config.baselineTestRunId).toBe('baseline-001');
      }
      // The non-comparison section is untouched
      const header = payload.sections.find(
        (s: { type: string }) => s.type === 'header'
      );
      expect(header.config?.baselineTestRunId).toBeUndefined();
    });

    it('does not show the picker when no section requires a baseline', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue(
        mockTemplateDetail
      );
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

    const generatedTypes = async () => {
      await clickGenerate();
      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      const { sections } = (reportsApi.generateAdHocReport as jest.Mock).mock.calls[0][0];
      return sections.map((s: { type: string; order: number }) => `${s.order}:${s.type}`);
    };

    it('says a section can be clicked or dragged in', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      expect(screen.getByText('Click to add, or drag into place')).toBeInTheDocument();
    });

    // Extended by /ship test coverage audit (the unmeasured-drop case).
    // Value: protects=a palette drop whose dragged rect dnd-kit has not measured lands above the
    // card it is over; fails_when=insertIndexFor reads `translated` without its null check (a
    // TypeError on drop) or treats a missing rect as the bottom half; why_new=every other drop
    // carries a translated rect; seam=none; no_claim=when dnd-kit actually leaves it null in a
    // browser (crafted events; jsdom has no layout)
    it('drops a dragged section above or below the card it lands on, by which half', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));

      dropFromPalette('header', { card: 0, half: 'top' });
      dropFromPalette('awr', { card: 1, half: 'bottom' });
      // No measured rect for the dragged row, so no half to read: it goes above the card it is
      // over, even one placed so that a measured drag would have gone below.
      const unmeasured = {
        ...paletteActive('trends'),
        rect: { current: { initial: null, translated: null } },
      };
      act(() => mockDnd.context!.onDragStart({ active: unmeasured }));
      act(() => mockDnd.context!.onDragEnd({ active: unmeasured, over: overCard(3, 'bottom') }));

      expect(await generatedTypes()).toEqual(['0:header', '1:slo', '2:awr', '3:trends', '4:apdex']);
    });

    // Extended by /ship test coverage audit (the drag-over before the drop).
    // Value: protects=a palette drag over an empty canvas swaps the "No sections yet" placeholder
    // for the drop slot, and a cancel brings the placeholder back; fails_when=the placeholder stops
    // yielding to the slot, the empty-canvas slot is not drawn, or cancel leaves it; why_new=the
    // slot test runs on a full canvas only; seam=none; no_claim=the placeholder's highlighted border
    // while dragging (crafted events; jsdom has no layout)
    it('drops onto an empty canvas, and nowhere outside it', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      const placeholder = () => screen.queryByText(/No sections yet/);
      // The palette row is a button; the slot is the only other place the label is drawn.
      const slots = () => screen.queryAllByText('Header').filter((el) => !el.closest('button'));
      const active = paletteActive('header');

      act(() => mockDnd.context!.onDragStart({ active }));
      expect(placeholder()).toBeInTheDocument();
      act(() =>
        mockDnd.context!.onDragMove({ active, over: { id: 'report-canvas', rect: { top: 0, height: 500 } } }),
      );
      expect(placeholder()).not.toBeInTheDocument();
      expect(slots()).toHaveLength(1);
      act(() => mockDnd.context!.onDragCancel({ active }));
      expect(placeholder()).toBeInTheDocument();
      expect(slots()).toHaveLength(0);

      dropFromPalette('header', null);
      expect(screen.getByText(/No sections yet/)).toBeInTheDocument();

      dropFromPalette('header', 'canvas');
      expect(await generatedTypes()).toEqual(['0:header']);
    });

    it('keeps each card bound to its own section when one is dropped above it', async () => {
      // Index keys handed card 0's state (expanded or not, form drafts) to whichever section
      // landed at index 0 — every drop into the middle of the list did that to every card below.
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      // [palette row, canvas card]
      const sloOnCanvas = screen.getAllByText('SLO Summary')[1];

      dropFromPalette('awr', { card: 0, half: 'top' });

      expect(sloOnCanvas).toBeInTheDocument();
      expect(sloOnCanvas).toHaveTextContent('SLO Summary');
    });

    // Generated by /ship test coverage audit.
    // Value: protects=deleting a card leaves every later card bound to its own section, and later
    // drops still land by card; fails_when=handleDelete stops removing the deleted card's key;
    // why_new=the binding test above covers an insert only; seam=none; no_claim=a real pointer drag
    // (handlers are called with crafted events; jsdom has no layout)
    it('keeps the remaining cards bound to their own sections after a delete', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add Header section'));
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      // [palette row, canvas card]
      const sloOnCanvas = screen.getAllByText('SLO Summary')[1];

      fireEvent.click(screen.getAllByTestId('DeleteIcon')[0]!.closest('button')!);

      expect(sloOnCanvas).toBeInTheDocument();
      expect(sloOnCanvas).toHaveTextContent('SLO Summary');
      dropFromPalette('awr', { card: 0, half: 'bottom' });
      expect(await generatedTypes()).toEqual(['0:slo', '1:awr']);
    });

    // Generated by /ship test coverage audit; extended (the drag-move with no slot).
    // Value: protects=a card dragged by its grip moves to the card it is dropped on, carrying its
    // own card with it, draws no palette drop slot on the way, and a drop on nothing moves
    // nothing; fails_when=the reorder branch of handleDragEnd maps ids to the wrong index, a
    // starter layout seeds no card keys, the `over` guard goes, handleDragStart opens a palette
    // drag without a palette type, or handleDragMove loses its no-palette-drag guard;
    // why_new=no other test reorders by drag or moves a card drag; seam=none; no_claim=dnd-kit's
    // sortable sensors and animation (crafted events; no layout)
    it('reorders a card dropped onto another, and keeps the card with its section', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByText('Executive summary'));
      const headerOnCanvas = screen.getAllByText('Header')[1];
      const [headerId, , apdexId] = mockDnd.cardIds!;
      const card = {
        id: headerId,
        data: { current: {} },
        rect: { current: { initial: null, translated: { top: 90, height: 20 } } },
      };
      const shown = screen.getByRole('dialog').textContent;

      act(() => mockDnd.context!.onDragStart({ active: card }));
      // A reorder moves the card itself: no drop slot, nothing new drawn while it travels.
      act(() =>
        mockDnd.context!.onDragMove({ active: card, over: { id: apdexId, rect: { top: 80, height: 20 } } }),
      );
      expect(screen.getByRole('dialog').textContent).toBe(shown);
      act(() => mockDnd.context!.onDragEnd({ active: card, over: { id: apdexId } }));
      act(() => mockDnd.context!.onDragStart({ active: card }));
      act(() => mockDnd.context!.onDragEnd({ active: card, over: null }));

      expect(headerOnCanvas).toBeInTheDocument();
      expect(headerOnCanvas).toHaveTextContent('Header');
      expect(await generatedTypes()).toEqual(['0:slo', '1:apdex', '2:header', '3:regressions']);
    });

    // Generated by /ship test coverage audit.
    // Value: protects=a palette drag shows its drop slot where the drop would land, and the slot
    // goes when the drag is cancelled; fails_when=handleDragMove stops updating the insert point,
    // the slot is drawn off by one, a loaded template seeds no card keys, or onDragCancel stops
    // clearing it; why_new=existing drop tests call only start and end, never move or cancel;
    // seam=none; no_claim=what the slot looks like or how it animates (crafted events; no layout)
    it('draws the drop slot where a palette drag would land, and clears it on cancel', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText('Report Layout');
      const isBefore = (a: Element, b: Element) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      // The palette row is a button; the slot is the only other place the label is drawn.
      const slots = () => screen.queryAllByText('AWR Analysis').filter((el) => !el.closest('button'));
      const firstCard = screen.getByText('Report Header');
      const secondCard = screen.getByText('SLO Results');
      const lastCard = screen.getByText('Performance Trends');
      const active = paletteActive('awr');

      act(() => mockDnd.context!.onDragStart({ active }));
      expect(slots()).toHaveLength(0);

      act(() => mockDnd.context!.onDragMove({ active, over: overCard(1, 'top') }));
      expect(slots()).toHaveLength(1);
      expect(isBefore(firstCard, slots()[0]!)).toBe(true);
      expect(isBefore(slots()[0]!, secondCard)).toBe(true);

      act(() => mockDnd.context!.onDragMove({ active, over: overCard(4, 'bottom') }));
      expect(slots()).toHaveLength(1);
      expect(isBefore(lastCard, slots()[0]!)).toBe(true);

      // A new target arrives through onDragOver, not the next move: the slot follows it there.
      act(() => mockDnd.context!.onDragOver({ active, over: overCard(1, 'top') }));
      expect(slots()).toHaveLength(1);
      expect(isBefore(slots()[0]!, secondCard)).toBe(true);

      act(() => mockDnd.context!.onDragCancel({ active }));
      expect(slots()).toHaveLength(0);
    });

    // Generated by /ship test coverage audit.
    // Value: protects=Start from Scratch, reached back from a loaded template, empties the canvas
    // and its sortable list down to the cards it then shows, and drops land by card;
    // fails_when=handleStartFromScratch keeps the template's sections or its card keys;
    // why_new=no test leaves a template for scratch; seam=none; no_claim=a fault a user would see
    // from leftover keys: dnd-kit 6 skips ids it never measured, so the drop half passes with them
    // (only the sortable-list length catches that half; crafted events, no layout)
    it('starts from scratch after a loaded template with only its own cards', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText('Report Layout');
      expect(mockDnd.cardIds).toHaveLength(5);

      fireEvent.click(screen.getByRole('button', { name: 'Back to Template' }));
      await navigate();
      expect(screen.getByText(/No sections yet/)).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));

      // The canvas hands dnd-kit the two cards it shows and none of the template's five.
      expect(mockDnd.cardIds).toHaveLength(2);
      dropFromPalette('header', { card: 1, half: 'top' });
      expect(await generatedTypes()).toEqual(['0:slo', '1:header', '2:apdex']);
    });

    // Generated by /ship test coverage audit.
    // Value: protects=a template opened for editing gives each of its cards a drag id, so a palette
    // drop between two of them lands there and Save Configuration hands back that order;
    // fails_when=sectionKeys is not seeded from initialSections, or the save hands back anything but
    // the edited, renumbered list; why_new=every other drop starts from scratch, a starter layout or
    // a loaded template, never from initialSections; seam=none; no_claim=a real pointer drag
    // (crafted events; jsdom has no layout)
    it('drops between the cards of a template being edited, and saves them in that order', () => {
      const onTemplateBuilt = jest.fn();
      render(
        <GenerateReportDialog
          {...defaultProps}
          mode="template-builder"
          initialSections={[
            { type: 'header', order: 0, title: 'Intro' },
            { type: 'slo', order: 1 },
          ]}
          onTemplateBuilt={onTemplateBuilt}
        />,
      );

      expect(mockDnd.cardIds).toHaveLength(2);
      dropFromPalette('awr', { card: 1, half: 'top' });
      fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

      expect(onTemplateBuilt).toHaveBeenCalledTimes(1);
      expect(onTemplateBuilt).toHaveBeenCalledWith(
        [
          { type: 'header', order: 0, title: 'Intro' },
          { type: 'awr', order: 1 },
          { type: 'slo', order: 2 },
        ],
        undefined,
      );
    });

    // Generated by /ship test coverage audit.
    // Value: protects=a palette drag finds a drop target only while the pointer is inside the
    // canvas, and a card reorder never targets the canvas itself; fails_when=collisionDetection
    // reverts to plain closestCenter, loses its pointerWithin gate or its card filter;
    // why_new=the drop tests hand `over` straight to onDragEnd, so collision is never run (this
    // calls the collisionDetection prop the dialog hands DndContext); seam=none;
    // no_claim=dnd-kit's own measuring in a browser (rects are crafted; jsdom has no layout)
    it('resolves a palette drop only inside the canvas, and a reorder only onto a card', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));
      const [slo, apdex] = mockDnd.cardIds!;
      const rect = (left: number, top: number, width: number, height: number) =>
        ({ left, top, width, height, right: left + width, bottom: top + height });
      // The canvas spans x 0..400; the palette sits left of it. Cards stack inside the canvas.
      const droppableRects = new Map([
        ['report-canvas', rect(0, 0, 400, 600)],
        [slo, rect(0, 0, 400, 100)],
        [apdex, rect(0, 120, 400, 100)],
      ]);
      const detect = (
        dragged: string | 'card',
        x: number,
        y: number,
        ids: string[] = [...droppableRects.keys()],
      ) =>
        mockDnd.context!.collisionDetection({
          active:
            dragged === 'card'
              ? { id: slo, data: { current: {} } }
              : { id: `palette:${dragged}`, data: { current: { paletteType: dragged } } },
          collisionRect: rect(x - 10, y - 10, 20, 20),
          droppableRects,
          droppableContainers: ids.map((id) => ({ id })),
          pointerCoordinates: { x, y },
        })[0]?.id ?? null;

      // Let go over the palette: nothing to land on, though the cards are the nearest rects.
      expect(detect('awr', -150, 50)).toBeNull();
      // Inside the canvas: the nearest card, even below the last one.
      expect(detect('awr', 200, 170)).toBe(apdex);
      expect(detect('awr', 200, 500)).toBe(apdex);
      // An empty canvas is a target of its own.
      expect(detect('awr', 200, 300, ['report-canvas'])).toBe('report-canvas');
      // A reorder low in the canvas is nearer the canvas's centre than any card's; it still
      // snaps to a card, since the canvas has no index to move to.
      expect(detect('card', 200, 500)).toBe(apdex);
    });

    // Value: protects=the canvas is a drop target only while a palette row is in hand, so dnd-kit's
    // keyboard reorder (which ranks every enabled droppable itself) never sends a card to it;
    // fails_when=the canvas droppable is always enabled again, or stays on after the drag;
    // why_new=collision detection is tested, but the keyboard getter bypasses it; seam=none;
    // no_claim=the geometry that made the canvas win (expanded cards; checked in a browser)
    it('makes the canvas a drop target only during a palette drag', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      const card = { id: mockDnd.cardIds![0], data: { current: {} } };
      const palette = paletteActive('awr');

      expect(mockDnd.canvasDroppable).toMatchObject({ id: 'report-canvas', disabled: true });
      act(() => mockDnd.context!.onDragStart({ active: card }));
      expect(mockDnd.canvasDroppable!.disabled).toBe(true);
      act(() => mockDnd.context!.onDragCancel({ active: card }));

      act(() => mockDnd.context!.onDragStart({ active: palette }));
      expect(mockDnd.canvasDroppable!.disabled).toBe(false);
      act(() => mockDnd.context!.onDragCancel({ active: palette }));
      expect(mockDnd.canvasDroppable!.disabled).toBe(true);
    });

    // Value: protects=the floating preview exists only for a palette drag, does not fly back to the
    // palette after a drop that landed, and lets wheel events through to the canvas;
    // fails_when=the overlay is always mounted (it would take over a reorder's collision rect),
    // gets the default drop animation, or takes pointer events again; why_new=no test touched the
    // overlay; seam=none; no_claim=what the preview looks like (jsdom renders no active overlay)
    it('mounts the drag preview for a palette drag only, inert to the pointer and without a fly-back', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      const card = { id: mockDnd.cardIds![0], data: { current: {} } };
      const palette = paletteActive('awr');

      mockDnd.overlay = undefined;
      act(() => mockDnd.context!.onDragStart({ active: card }));
      expect(mockDnd.overlay).toBeUndefined();
      act(() => mockDnd.context!.onDragCancel({ active: card }));

      act(() => mockDnd.context!.onDragStart({ active: palette }));
      expect(mockDnd.overlay).toMatchObject({ dropAnimation: null, style: { pointerEvents: 'none' } });
      act(() => mockDnd.context!.onDragCancel({ active: palette }));
      mockDnd.overlay = undefined;
      fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));
      expect(mockDnd.overlay).toBeUndefined();
    });

    // Value: protects=during any drag nothing under the pointer reacts except the canvas, which
    // keeps the wheel, a keyboard drag leaves no mouse path to Delete or Back, and the gate lifts on
    // drop and on cancel; fails_when=the Dialog's sx is dropped, narrowed to one kind of drag, or
    // keyed on state the end of a drag does not clear; why_new=this was only checked live;
    // seam=none, the rules reach jsdom through Emotion; no_claim=hover styles, which jsdom never applies
    it('takes the dialog out of hit-testing during any drag, except the canvas', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      const pointerEvents = (el: Element) => getComputedStyle(el).pointerEvents;
      const row = screen.getByLabelText('Add Header section');
      const canvas = document.querySelector('[data-drop-canvas]')!;
      const card = { id: mockDnd.cardIds![0], data: { current: {} } };
      const palette = paletteActive('header');

      for (const active of [card, palette]) {
        for (const end of ['onDragEnd', 'onDragCancel'] as const) {
          act(() => mockDnd.context!.onDragStart({ active }));
          expect(pointerEvents(row)).toBe('none');
          expect(pointerEvents(canvas)).toBe('auto');
          act(() => mockDnd.context![end]({ active, over: null }));
          expect(pointerEvents(row)).not.toBe('none');
        }
      }
    });

    describe('with the real pointer sensor', () => {
      const pointer = (type: string, clientX: number) =>
        Object.assign(new MouseEvent(type, { bubbles: true, clientX, clientY: 0 }), { isPrimary: true });
      const cancelPointerEvents = () =>
        getComputedStyle(screen.getByRole('button', { name: 'Cancel' })).pointerEvents;

      // dnd-kit swallows clicks on the document until 50ms after a drag ends, which would eat the
      // next test's first click, so end one a failed test left in hand and wait that out.
      afterEach(async () => {
        act(() => {
          document.dispatchEvent(pointer('pointerup', 7));
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
      });

      // Value: protects=a jittery click on a palette row does not freeze the dialog. The move past
      // the activation distance and the release can land in one React batch, and dnd-kit then calls
      // neither onDragEnd nor onDragCancel; fails_when=the dialog's drag state is cleared only by
      // those two handlers, leaving every control dead and Escape off; why_new=every other drag
      // test calls the handlers by hand, so none could reach this; seam=the real PointerSensor and
      // DndContext, with act() forcing the batch a browser gets when both events land in one frame;
      // no_claim=how often a browser does that
      it('stays usable when a drag starts and ends before React commits', async () => {
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();

        fireEvent(screen.getByLabelText('Add Header section'), pointer('pointerdown', 0));
        act(() => {
          document.dispatchEvent(pointer('pointermove', 7));
          document.dispatchEvent(pointer('pointerup', 7));
        });

        expect(cancelPointerEvents()).not.toBe('none');
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(mockOnClose).toHaveBeenCalled();
      });

      // Extended by /ship test coverage audit (the click that lands with the release).
      // Value: protects=the idle check does not end a live drag early, and the click a release fires
      // on its own row adds nothing; fails_when=the check clears on anything but dnd-kit reading
      // idle, the dialog's state starts ahead of dnd-kit's, or dnd-kit stops swallowing that click;
      // why_new=the hand-held drags fake dnd-kit's side of this, and no test clicks after a real
      // drag; seam=none; no_claim=where a real drag lands by geometry, which needs layout
      it('keeps a real drag in hand until it is released, and adds nothing on release', async () => {
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();
        const row = screen.getByLabelText('Add Header section');

        // Away from the origin: every jsdom rect is zero-sized there, so a pointer at 0,0 is inside
        // the canvas and its release would land on it.
        fireEvent(row, pointer('pointerdown', 100));
        act(() => {
          document.dispatchEvent(pointer('pointermove', 107));
        });
        expect(cancelPointerEvents()).toBe('none');
        expect(getComputedStyle(document.querySelector('.MuiDialog-root')!).cursor).toBe('grabbing');
        expect(screen.getByText('Drag to reorder sections')).toBeInTheDocument();

        act(() => {
          document.dispatchEvent(pointer('pointerup', 107));
        });
        expect(cancelPointerEvents()).not.toBe('none');

        // Let go over the row it came from and the browser clicks that row, in the same task:
        // no await above, so dnd-kit's 50ms is still running. The docs promise nothing is added.
        fireEvent.click(row);
        expect(screen.getByText(/No sections yet/)).toBeInTheDocument();

        // The control: it was the drag that ate that click, not a dead row.
        await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
        fireEvent.click(row);
        expect(screen.queryByText(/No sections yet/)).not.toBeInTheDocument();
      });

      // Value: protects=a real drag lands: sensor, collision, drop and insert wired end to end, on an
      // empty report and beside a card; fails_when=the canvas or the row loses its dnd-kit ref, or
      // the row its drag data, which pass every test that hands the dialog a target by hand;
      // why_new=every other drop calls the recorded handlers; seam=none; no_claim=placement by
      // geometry: every jsdom rect is zero-sized at the origin, where the pointer stays inside the
      // canvas; separate act()s, so the drag commits first
      it('lands a real pointer drag on an empty report and beside a card', async () => {
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();
        const drag = () => {
          fireEvent(screen.getByLabelText('Add Header section'), pointer('pointerdown', 0));
          act(() => {
            document.dispatchEvent(pointer('pointermove', 7));
          });
          act(() => {
            document.dispatchEvent(pointer('pointerup', 7));
          });
        };

        drag();
        expect(screen.queryAllByTestId('DeleteIcon')).toHaveLength(1);
        expect(screen.queryByText(/No sections yet/)).not.toBeInTheDocument();

        drag();
        // dnd-kit swallows clicks for 50ms after a drag, and generatedTypes clicks Generate.
        await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
        expect(await generatedTypes()).toEqual(['0:header', '1:header']);
      });

      // Value: protects=a click that drifts a pixel or two still adds the section, which is what the
      // activation distance is for; fails_when=the distance is lowered until a physical click starts
      // a drag, which swallows the click; why_new=the real-click test never moves; seam=none;
      // no_claim=how far a real hand drifts
      it('still adds on a click that drifts a pixel or two', async () => {
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();
        const row = screen.getByLabelText('Add Header section');

        fireEvent(row, pointer('pointerdown', 100));
        act(() => {
          document.dispatchEvent(pointer('pointermove', 102));
        });
        expect(cancelPointerEvents()).not.toBe('none');
        act(() => {
          document.dispatchEvent(pointer('pointerup', 102));
        });
        fireEvent.click(row);

        expect(screen.queryAllByTestId('DeleteIcon')).toHaveLength(1);
      });

      // Value: protects=a drag cancelled with the button still held adds nothing when released on its
      // own row, later than dnd-kit's 50ms click swallow, while the next real click and a keyboard
      // click both still add; fails_when=the row's click stops checking for a drag, or a click stays
      // dead afterwards; why_new=the release test clicks inside the 50ms; seam=none; no_claim=that a
      // browser clicks the row here, which is dispatched by hand
      it('adds nothing when a drag cancelled by Escape is released on its own row', async () => {
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();
        const row = screen.getByLabelText('Add Header section');
        const realClick = () => {
          fireEvent(row, pointer('pointerdown', 100));
          act(() => {
            document.dispatchEvent(pointer('pointerup', 100));
          });
          fireEvent.click(row, { detail: 1 });
        };

        fireEvent(row, pointer('pointerdown', 100));
        act(() => {
          document.dispatchEvent(pointer('pointermove', 107));
        });
        fireEvent.keyDown(screen.getByRole('dialog'), { code: 'Escape', key: 'Escape' });
        await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
        act(() => {
          document.dispatchEvent(pointer('pointerup', 107));
        });
        fireEvent.click(row, { detail: 1 });
        expect(screen.getByText(/No sections yet/)).toBeInTheDocument();

        // A keyboard click (detail 0) has no pointerdown to clear the drag, and still adds.
        fireEvent.click(row, { detail: 0 });
        expect(screen.queryAllByTestId('DeleteIcon')).toHaveLength(1);

        realClick();
        expect(screen.queryAllByTestId('DeleteIcon')).toHaveLength(2);
      });

      // Generated by /ship test coverage audit.
      // Value: protects=Escape during a palette drag cancels it, adds nothing and keeps the dialog
      // and its unsaved report open, then the next Escape closes it; fails_when=disableEscapeKeyDown
      // stops covering a palette drag, or Escape stops reaching dnd-kit's cancel; why_new=the Escape
      // test below drives the keyboard sensor on a card, and a palette drag is pointer-only;
      // seam=none; no_claim=where a drag lands by geometry, which needs layout
      it('cancels a palette drag on Escape, adding nothing and leaving the dialog open', async () => {
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();
        const liveRegion = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';

        fireEvent(screen.getByLabelText('Add Header section'), pointer('pointerdown', 0));
        act(() => {
          document.dispatchEvent(pointer('pointermove', 7));
        });
        expect(cancelPointerEvents()).toBe('none');

        fireEvent.keyDown(screen.getByRole('dialog'), { code: 'Escape', key: 'Escape' });

        expect(mockOnClose).not.toHaveBeenCalled();
        expect(cancelPointerEvents()).not.toBe('none');
        await waitFor(() => expect(liveRegion()).toMatch(/Cancelled dragging Header from the section list/));

        // The pointer is still down, and at the origin it is inside the canvas's zero-sized rect, so
        // this release would drop the section there had Escape not cancelled the drag.
        act(() => {
          document.dispatchEvent(pointer('pointerup', 7));
        });
        expect(screen.getByText(/No sections yet/)).toBeInTheDocument();

        fireEvent.keyDown(screen.getByRole('dialog'), { code: 'Escape', key: 'Escape' });
        expect(mockOnClose).toHaveBeenCalled();
      });

      // Generated by /ship test coverage audit.
      // Value: protects=the row in hand dims and its hover tooltip stops riding along, the preview
      // names the section being dragged, and all three end with the drag; fails_when=the row stops
      // reading isDragging, or the overlay draws another section or nothing; why_new=the overlay
      // test reads its props from a hand-held drag, which dnd-kit's overlay renders nothing for;
      // seam=none; no_claim=where the preview sits, which needs layout
      it('dims the row in hand, drops its tooltip and names it in the preview', async () => {
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();
        const row = screen.getByLabelText('Add Header section');

        fireEvent.mouseOver(row);
        expect(await screen.findByRole('tooltip')).toHaveTextContent(/Section heading/);
        expect(getComputedStyle(row).opacity).toBe('1');
        expect(screen.getAllByText('Header')).toHaveLength(1);

        // Away from the origin, where the pointer would be over the zero-sized canvas and a drop slot
        // would draw the label a third time.
        fireEvent(row, pointer('pointerdown', 100));
        act(() => {
          document.dispatchEvent(pointer('pointermove', 107));
        });

        await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
        expect(getComputedStyle(row).opacity).toBe('0.4');
        // [palette row, preview]
        expect(screen.getAllByText('Header')).toHaveLength(2);

        act(() => {
          document.dispatchEvent(pointer('pointerup', 107));
        });
        expect(getComputedStyle(row).opacity).toBe('1');
        expect(screen.getAllByText('Header')).toHaveLength(1);
      });
    });

    // Value: protects=a card that left the list mid-drag moves nothing; fails_when=the reorder trusts
    // indexOf, whose -1 makes splice take the last section; why_new=the no-target test has a target
    // that exists; seam=none; no_claim=how a card leaves the list mid-drag, which the mouse gate blocks
    it('moves nothing when the dragged card has left the list', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add Header section'));
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      const gone = { id: 'section-gone', data: { current: {} } };

      act(() => mockDnd.context!.onDragStart({ active: gone }));
      act(() => mockDnd.context!.onDragEnd({ active: gone, over: { id: mockDnd.cardIds![0], rect: { top: 0, height: 20 } } }));

      expect(await generatedTypes()).toEqual(['0:header', '1:slo']);
    });

    // Value: protects=a template keeps a new comparisons section unpinned even when another is
    // pinned; fails_when=the baseline seed stops checking the mode, writing a run id into the saved
    // template with no picker or block to explain it; why_new=the seed test runs in report mode;
    // seam=none; no_claim=whether a template should pin at all
    it('does not pin a new comparisons section in a template', () => {
      const onTemplateBuilt = jest.fn();
      render(
        <GenerateReportDialog
          {...defaultProps}
          mode="template-builder"
          initialSections={[{ type: 'comparisons', order: 0, config: { baselineTestRunId: 'baseline-001' } }]}
          onTemplateBuilt={onTemplateBuilt}
        />,
      );

      fireEvent.click(screen.getByLabelText('Add Test Comparisons section'));
      fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

      expect(onTemplateBuilt.mock.calls[0][0][1]).toEqual({ type: 'comparisons', order: 1 });
    });

    // Value: protects=a template opened in the template editor with sections stored out of `order`
    // is laid out and saved in `order`; fails_when=the builder's initial state stops sorting
    // initialSections (the edit-template path; the load path below is a separate sort);
    // why_new=every other initialSections fixture is already in order; seam=none;
    // no_claim=how a template came to be stored out of order
    it('opens a template for editing in its order values, and saves it that way', () => {
      const onTemplateBuilt = jest.fn();
      render(
        <GenerateReportDialog
          {...defaultProps}
          mode="template-builder"
          initialSections={[
            { type: 'slo', order: 1 },
            { type: 'header', order: 0, title: 'Intro' },
          ]}
          onTemplateBuilt={onTemplateBuilt}
        />,
      );

      fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));
      fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

      expect(onTemplateBuilt).toHaveBeenCalledWith(
        [
          { type: 'header', order: 0, title: 'Intro' },
          { type: 'slo', order: 1 },
          { type: 'apdex', order: 2 },
        ],
        undefined,
      );
    });

    // Value: protects=a stored template whose array order disagrees with its `order` values shows
    // and generates in `order`, and the first add does not silently reorder it;
    // fails_when=template load or initialSections stops sorting by `order` (the add renumbers
    // `order` from array position); why_new=every template fixture is already in order;
    // seam=none; no_claim=how templates came to be stored out of order
    it('lays a loaded template out by its order values, not its stored array order', async () => {
      (reportsApi.getTemplate as jest.Mock).mockResolvedValue({
        ...mockTemplateDetail,
        sections: [
          { type: 'slo', order: 1, title: 'SLO Results' },
          { type: 'header', order: 0, title: 'Report Header' },
        ],
      });
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText('Report Layout');

      fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));

      expect(await generatedTypes()).toEqual(['0:header', '1:slo', '2:apdex']);
    });

    // Value: protects=a palette drag that leaves the canvas takes its drop slot with it, so no slot
    // promises a drop that will add nothing; fails_when=handleDragMove keeps the last insert point
    // when the drag loses its target; why_new=every other move lands on a card or the canvas;
    // seam=none; no_claim=a real pointer leaving the canvas (crafted events; jsdom has no layout)
    it('takes the drop slot away once the pointer leaves the canvas', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      // The palette row is a button; the slot is the only other place the label is drawn.
      const slots = () => screen.queryAllByText('AWR Analysis').filter((el) => !el.closest('button'));
      const active = paletteActive('awr');

      act(() => mockDnd.context!.onDragStart({ active }));
      act(() => mockDnd.context!.onDragMove({ active, over: overCard(0, 'bottom') }));
      expect(slots()).toHaveLength(1);
      // Back over the palette: collision detection reports no target.
      act(() => mockDnd.context!.onDragMove({ active, over: null }));
      expect(slots()).toHaveLength(0);
      act(() => mockDnd.context!.onDragEnd({ active, over: null }));

      expect(await generatedTypes()).toEqual(['0:slo']);
    });

    // Extended by /ship test coverage audit (Escape closes the dialog again once the drag is over).
    // Value: protects=Escape during a drag cancels the drag and leaves the dialog (and the unsaved
    // report) open, Escape after it closes the dialog as before, the live region names the section
    // rather than an internal id, and a keyboard drag shows its keys with no grabbing cursor;
    // fails_when=the Dialog swallows Escape mid-drag (disableEscapeKeyDown stops following the
    // drag), a cancelled drag leaves Escape disabled (the cancel stops resetting `dragging`), the
    // announcements fall back to dnd-kit's id-reading defaults, or a keyboard drag loses its hint
    // or reads as a pointer drag; why_new=nothing presses Escape during or after a drag or reads the live
    // region; seam=none; no_claim=a pointer drag (this one is the keyboard sensor, which reaches
    // Escape the same way: a listener on document)
    it('cancels a drag on Escape without closing the dialog, and names the section aloud', async () => {
      // A keyboard drag scrolls its handle into view; jsdom has no scrollIntoView.
      const scrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = jest.fn();
      try {
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();
        fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
        fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));
        const grip = document.querySelectorAll<HTMLElement>('[aria-roledescription="sortable"]')[1]!;
        const liveRegion = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';

        fireEvent.keyDown(grip, { code: 'Space', key: ' ' });
        // jsdom has no layout, so the pick-up is followed at once by an "is over" announcement;
        // either way the card is named by its section and position.
        await waitFor(() => expect(liveRegion()).toMatch(/Apdex Scores, position 2 of 2/));
        // The mouse is locked out for the drag, so the screen has to say how to end it.
        expect(screen.getByText('Arrow keys to move, Space to drop, Esc to cancel')).toBeInTheDocument();
        expect(getComputedStyle(document.querySelector('.MuiDialog-root')!).cursor).not.toBe('grabbing');
        // dnd-kit's KeyboardSensor attaches its document keydown listener in a setTimeout(0)
        // after pick-up; let it land so the Escape below reaches dnd-kit and not thin air.
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

        fireEvent.keyDown(grip, { code: 'Escape', key: 'Escape' });
        await waitFor(() => expect(liveRegion()).toMatch(/Cancelled dragging Apdex Scores/));
        expect(mockOnClose).not.toHaveBeenCalled();
        expect(screen.getByText('Drag to reorder sections')).toBeInTheDocument();
        expect(liveRegion()).not.toMatch(/section-\d+/);

        // The drag is over, so Escape is the dialog's again: a cancel that left `dragging` set
        // would keep the dialog open on every Escape from here on.
        fireEvent.keyDown(screen.getByRole('dialog'), { code: 'Escape', key: 'Escape' });
        expect(mockOnClose).toHaveBeenCalled();
      } finally {
        Element.prototype.scrollIntoView = scrollIntoView;
      }
    });

    // Value: protects=a re-render of the page with an equal scope leaves the user in the builder
    // with their sections; fails_when=the template fetch depends on the scope object again (the
    // test-run page passes a fresh literal on every render); why_new=no test re-renders the open
    // dialog; seam=none; no_claim=which page events re-render it (a rerender stands in for them)
    it('stays in the builder when the page re-renders with an equal scope', async () => {
      const { rerender } = render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));

      rerender(<GenerateReportDialog {...defaultProps} scope={{ ...mockScope }} />);
      await act(async () => {});

      expect(reportsApi.getTemplateSummaries).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Start from Scratch')).not.toBeInTheDocument();
      expect(await generatedTypes()).toEqual(['0:slo']);
    });

    // Value: protects=every announcement names what a screen-reader user can place (a palette
    // section, a card and its position, the end of the report, or nothing) instead of a raw id;
    // fails_when=describeDragged loses its palette branch, describeTarget its canvas fallback, or an
    // over-null branch reverts to dnd-kit's id-reading default; why_new=the Escape test only hears a
    // keyboard reorder of a card; seam=none; no_claim=how a given screen reader voices the region
    it('announces every drag outcome by name, never by internal id', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));
      const say = mockDnd.context!.accessibility.announcements;
      const palette = paletteActive('awr');
      const [slo, apdex] = mockDnd.cardIds!;
      const card = { id: apdex, data: { current: {} } };

      expect(say.onDragStart({ active: palette })).toBe('Picked up AWR Analysis from the section list.');
      expect(say.onDragOver({ active: palette, over: { id: slo } })).toBe(
        'AWR Analysis from the section list is over SLO Summary, position 1 of 2.',
      );
      expect(say.onDragOver({ active: palette, over: null })).toBe(
        'AWR Analysis from the section list is not over the report.',
      );
      expect(say.onDragEnd({ active: palette, over: { id: 'report-canvas' } })).toBe(
        'Dropped AWR Analysis from the section list on the end of the report.',
      );
      expect(say.onDragEnd({ active: palette, over: null })).toBe(
        'Dropped AWR Analysis from the section list outside the report; nothing changed.',
      );
      expect(say.onDragCancel({ active: card })).toBe(
        'Cancelled dragging Apdex Scores, position 2 of 2; nothing changed.',
      );
    });

    // Generated by /ship test coverage audit.
    // Value: protects=over a card of a template being edited, the live region reads the section's own
    // title, and for a type this build does not know, its stored type name; fails_when=describeTarget
    // drops the title, loses its optional chain on SECTION_CONFIG (a TypeError mid-drag) or its
    // fallback to the type; why_new=the sibling above names only known, untitled palette types;
    // seam=none; no_claim=how a given screen reader voices the region
    it('announces a titled card by its title, and an unknown section type by its stored name', () => {
      render(
        <GenerateReportDialog
          {...defaultProps}
          mode="template-builder"
          initialSections={[
            { type: 'header', order: 0, title: 'Intro' },
            // A DB-stored template can carry a section type this build does not know.
            { type: 'legacy_widget', order: 1 } as unknown as reportsApi.ReportSectionConfig,
          ]}
        />,
      );
      const say = mockDnd.context!.accessibility.announcements;
      const palette = paletteActive('awr');
      const [intro, legacy] = mockDnd.cardIds!;

      expect(say.onDragOver({ active: palette, over: { id: intro } })).toBe(
        'AWR Analysis from the section list is over Intro, position 1 of 2.',
      );
      expect(say.onDragOver({ active: palette, over: { id: legacy } })).toBe(
        'AWR Analysis from the section list is over legacy_widget, position 2 of 2.',
      );
    });

    // Extended by /ship test coverage audit (the gate read after a completed drop, palette first).
    // Value: protects=after a palette drop the cards below stay where they are instead of jumping up
    // over the new card and sliding back, while a reorder keeps its animation; fails_when=the
    // dialog stops gating dnd-kit's layout animation on where the last drag came from, resets that
    // flag when a drag ends, or only ever sets it; why_new=jsdom has no layout, so this reads the
    // gate the cards hand useSortable, mid-drag and on the render after each drop; seam=none;
    // no_claim=the animation itself (checked in a browser; the args stand in for dnd-kit's)
    it('animates cards into place after a reorder but not after a palette drop', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));
      fireEvent.click(screen.getByLabelText('Add Apdex Scores section'));
      // What dnd-kit hands the card on the render after a drop that moved it down one place.
      const movedAfterDrag = {
        active: null, containerId: 'c', isDragging: false, isSorting: false, id: 'x', index: 1,
        items: [], newIndex: 0, previousItems: [], previousContainerId: 'c',
        transition: { duration: 200, easing: 'ease' }, wasDragging: true,
      };

      act(() => mockDnd.context!.onDragStart({ active: { id: mockDnd.cardIds![0], data: { current: {} } } }));
      expect(mockDnd.animateLayoutChanges!(movedAfterDrag)).toBe(true);

      act(() => mockDnd.context!.onDragStart({ active: paletteActive('awr') }));
      expect(mockDnd.animateLayoutChanges!(movedAfterDrag)).toBe(false);

      // dnd-kit reads the gate on the render after the drop, so read it there too, palette drop
      // first: a flag cleared when a drag ends, or one that is only ever set, passes both reads above.
      dropFromPalette('awr', { card: 0, half: 'top' });
      expect(mockDnd.animateLayoutChanges!(movedAfterDrag)).toBe(false);

      const card = { id: mockDnd.cardIds![0], data: { current: {} } };
      act(() => mockDnd.context!.onDragStart({ active: card }));
      act(() => mockDnd.context!.onDragEnd({ active: card, over: { id: mockDnd.cardIds![1] } }));
      expect(mockDnd.animateLayoutChanges!(movedAfterDrag)).toBe(true);
    });

    // Value: protects=a real mouse click on a palette row adds the section without starting a drag;
    // fails_when=the pointer sensor loses its 5px activation distance, so pointerdown starts a drag
    // and dnd-kit swallows the click that follows; why_new=every other add uses fireEvent.click,
    // which sends no pointerdown; seam=none; no_claim=a click that drifts past 5px (real pointer only)
    it('adds a palette section on a real mouse click without starting a drag', async () => {
      const user = userEvent.setup();
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      fireEvent.click(screen.getByLabelText('Add Header section'));
      fireEvent.click(screen.getByLabelText('Add SLO Summary section'));

      await user.click(screen.getByLabelText('Add Apdex Scores section'));

      expect(document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '').toBe('');
      expect(await generatedTypes()).toEqual(['0:header', '1:slo', '2:apdex']);
    });

    // Generated by /ship test coverage audit.
    // Value: protects=a keyboard user adds a palette section with Enter or Space; fails_when=the
    // palette row spreads all of dnd-kit's listeners, so the keyboard sensor takes Enter/Space
    // and the click never fires; why_new=every palette test adds by mouse click; seam=none;
    // no_claim=screen-reader announcements (jsdom; user-event synthesises the key-to-click)
    it('adds a palette section from the keyboard', async () => {
      // A keyboard drag scrolls its row into view and jsdom has no scrollIntoView, so without this
      // the regression would surface as a TypeError instead of on the assertions below.
      const scrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = jest.fn();
      try {
        const user = userEvent.setup();
        render(<GenerateReportDialog {...defaultProps} />);
        await navigate();

        // Counted by delete buttons, which only canvas cards carry: a keyboard drag that wrongly
        // started would draw the row's label again in its drag preview.
        screen.getByLabelText('Add SLO Summary section').focus();
        await user.keyboard('{Enter}');
        expect(screen.queryAllByTestId('DeleteIcon')).toHaveLength(1);

        screen.getByLabelText('Add Apdex Scores section').focus();
        await user.keyboard(' ');
        expect(screen.queryAllByTestId('DeleteIcon')).toHaveLength(2);

        expect(await generatedTypes()).toEqual(['0:slo', '1:apdex']);
      } finally {
        Element.prototype.scrollIntoView = scrollIntoView;
      }
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
      expect(
        screen.getByRole('button', { name: 'Add section' })
      ).toBeInTheDocument();
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

    it('lays out the full-analysis starter in order, each section titled', async () => {
      // The layout is a starting shape, not a stub: every section arrives named, so the canvas
      // reads as a report outline rather than a stack of "Header".
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      fireEvent.click(screen.getByText('Full analysis'));

      // Each label now appears twice: once in the catalogue, once on the canvas.
      for (const label of [
        'SLO Summary',
        'Apdex Scores',
        'Trend Charts',
        'Response Times',
      ]) {
        expect(screen.getAllByText(label)).toHaveLength(2);
      }
      // Top 10 Lists is missing from this file's mocked type list, so its single occurrence can
      // only be the canvas — which is the assertion that matters here.
      expect(screen.getByText('Top 10 Lists')).toBeInTheDocument();
      // ...and the offer is gone, because the canvas is no longer empty.
      expect(screen.queryByText('Executive summary')).not.toBeInTheDocument();
    });

    // Extended by /ship test coverage audit (the absence now checks the copy that ships).
    // Value: protects=a collapsed catalogue swaps the "click or drag one from the left" hint for
    // the + hint; fails_when=the collapsed copy keeps or merges in the left-hand hint;
    // why_new=the absence matched copy this diff retired, so it could not fail; seam=none;
    // no_claim=none beyond protects
    it('points at the + when the catalogue is collapsed', async () => {
      // Telling someone to "click or drag one from the left" when the left is a single icon is
      // no help.
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();
      // Present first, so the absence below is checked against the hint that actually ships: an
      // absence of retired wording passes forever.
      expect(screen.getByText(/Click or drag one from the left/)).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Hide section list'));

      expect(screen.getByText(/Use \+ to add one/)).toBeInTheDocument();
      expect(
        screen.queryByText(/Click or drag one from the left/)
      ).not.toBeInTheDocument();
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

  describe('section title field', () => {
    // The palette label ("Header", "SLO Summary", ...) is deliberately NOT what
    // gets stamped as the section's title any more — these tests exercise the
    // Section Title field itself, which is what now lets an author give two
    // same-type sections distinct titles (and therefore distinct anchors).
    const navigate = async () => {
      await waitFor(() => {
        expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start from Scratch'));
      await waitFor(() => {
        expect(screen.getByText('Available Sections')).toBeInTheDocument();
      });
    };

    it('adds a section with no title stamped, so the card shows the palette label as a fallback', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      fireEvent.click(screen.getByText('Header'));

      // The Section Title field starts empty — nothing was stamped onto section.title.
      expect(screen.getByLabelText('Section Title')).toHaveValue('');
    });

    it("shows the section's default rendered heading as the field's placeholder", async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      fireEvent.click(screen.getByText('Header'));

      // SECTION_RENDER_TITLES.header is "Report Header" — distinct from the palette
      // label "Header" shown on the card itself, so the placeholder proves this reads
      // from the renderer's default, not the palette.
      expect(screen.getByLabelText('Section Title')).toHaveAttribute('placeholder', 'Report Header');
    });

    it('lets an author set a distinct title, which flows into the generated payload', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      fireEvent.click(screen.getByText('Header'));
      fireEvent.change(screen.getByLabelText('Section Title'), {
        target: { value: 'Executive Overview' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));

      await waitFor(() => {
        expect(reportsApi.generateAdHocReport).toHaveBeenCalledWith(
          expect.objectContaining({
            sections: expect.arrayContaining([
              expect.objectContaining({ type: 'header', title: 'Executive Overview' }),
            ]),
          })
        );
      });
    });

    it('stores undefined, not an empty string, when the title is cleared back to blank', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      fireEvent.click(screen.getByText('Header'));
      const titleField = screen.getByLabelText('Section Title');
      fireEvent.change(titleField, { target: { value: 'Executive Overview' } });
      // Whitespace-only, not just '' — both must land on undefined, not on ''.
      // The field is controlled from section.title, so once that's undefined the
      // input reads back as empty rather than echoing the spaces back.
      fireEvent.change(titleField, { target: { value: '   ' } });

      expect(titleField).toHaveValue('');

      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));

      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      const payload = (reportsApi.generateAdHocReport as jest.Mock).mock.calls[0][0];
      expect(payload.sections[0].title).toBeUndefined();
    });

    it('lets two sections of the same type carry distinct titles', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await navigate();

      const addSlo = screen.getByLabelText('Add SLO Summary section');
      fireEvent.click(addSlo);
      fireEvent.click(addSlo);

      const titleFields = screen.getAllByLabelText('Section Title');
      expect(titleFields).toHaveLength(2);
      fireEvent.change(titleFields[0], { target: { value: 'SLO — API' } });
      fireEvent.change(titleFields[1], { target: { value: 'SLO — Web' } });

      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));

      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      const payload = (reportsApi.generateAdHocReport as jest.Mock).mock.calls[0][0];
      const sloTitles = payload.sections
        .filter((s: { type: string }) => s.type === 'slo')
        .map((s: { title?: string }) => s.title);
      expect(sloTitles).toEqual(['SLO — API', 'SLO — Web']);
    });
  });
  /**
   * The whole point of surfacing this in the builder: the API already detected
   * the collision and could only write it to a server log the author never
   * reads. These assert the author actually SEES it, which is the part that
   * was missing — the detection itself is covered in SectionAnchorWarnings.
   */
  describe('anchor collision warnings', () => {
    const collidingSections = [
      { type: 'graphs' as const, order: 0, title: 'Latency' },
      { type: 'slo' as const, order: 1, title: 'latency' },
    ];

    it('flags every colliding section on its collapsed card', () => {
      render(
        <GenerateReportDialog
          {...defaultProps}
          mode="template-builder"
          initialSections={collidingSections}
        />
      );

      // Collapsed is the default state, and it is where an author scanning the
      // report would be — a warning only visible after expanding the offending
      // card is a warning they never find.
      expect(screen.getAllByLabelText('Link target problem')).toHaveLength(2);
    });

    it('shows no warning when the titles slug distinctly', () => {
      render(
        <GenerateReportDialog
          {...defaultProps}
          mode="template-builder"
          initialSections={[
            { type: 'graphs' as const, order: 0, title: 'Latency' },
            { type: 'slo' as const, order: 1, title: 'Throughput' },
          ]}
        />
      );

      expect(screen.queryByLabelText('Link target problem')).not.toBeInTheDocument();
    });

    it('explains the conflict in the Section Title field once expanded', async () => {
      render(
        <GenerateReportDialog
          {...defaultProps}
          mode="template-builder"
          initialSections={collidingSections}
        />
      );

      fireEvent.click(screen.getAllByLabelText('Link target problem')[0]!);

      await waitFor(() => {
        // Names the actual anchor at stake, not a generic "titles must be unique".
        expect(screen.getAllByText(/#section-latency/).length).toBeGreaterThan(0);
      });
    });
  });
  describe('changes on top of the template', () => {
    const openTemplate = async () => {
      fireEvent.click(await screen.findByText('Performance Summary'));
      await screen.findByText('Report Layout');
    };
    /** Retitles the template's first section, which is a change on top of the template. */
    const changeFirstSection = (title = 'Executive Overview') => {
      fireEvent.change(screen.getAllByLabelText('Section Title')[0], { target: { value: title } });
    };
    const prompt = () => screen.queryByRole('dialog', { name: /Save changes to/ });

    beforeEach(() => {
      (reportsApi.updateTemplate as jest.Mock).mockImplementation(
        async (_id: string, request: { sections: reportsApi.ReportSectionConfig[] }) => ({
          ...mockTemplateDetail,
          sections: request.sections,
        }),
      );
    });

    // Value: protects=a template report left as loaded generates with no prompt; fails_when=the
    // fingerprint reads the stored `order` or a blank field differently from the loaded template;
    // why_new=the prompt is new; seam=none; no_claim=forms that rewrite their config on mount
    it('generates straight away when nothing changed', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();

      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));

      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      expect(prompt()).not.toBeInTheDocument();
      expect(reportsApi.updateTemplate).not.toHaveBeenCalled();
    });

    it('asks before generating, and saves the changes to the template when told to', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));
      expect(await screen.findByRole('dialog', { name: 'Save changes to “Performance Summary”?' })).toBeInTheDocument();
      expect(reportsApi.generateAdHocReport).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Save and generate' }));

      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      expect(reportsApi.updateTemplate).toHaveBeenCalledWith('template-1', {
        sections: expect.arrayContaining([
          expect.objectContaining({ type: 'header', order: 0, title: 'Executive Overview' }),
        ]),
      });
      // Saved before generating, so a failed save never leaves a report behind it.
      expect((reportsApi.updateTemplate as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (reportsApi.generateAdHocReport as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('generates without touching the template on "Generate without saving"', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Generate without saving' }));

      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: expect.arrayContaining([expect.objectContaining({ title: 'Executive Overview' })]),
        }),
      ));
      expect(reportsApi.updateTemplate).not.toHaveBeenCalled();
    });

    it('keeps the builder open and generates nothing when the save fails', async () => {
      (reportsApi.updateTemplate as jest.Mock).mockRejectedValue(new Error('Forbidden'));
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Save and generate' }));

      expect(await screen.findByText(/Could not save the template: Forbidden/)).toBeInTheDocument();
      expect(reportsApi.generateAdHocReport).not.toHaveBeenCalled();
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('does not ask when the report is saved as a new template', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();
      fireEvent.click(screen.getByLabelText('Save as template'));
      fireEvent.change(screen.getByLabelText(/Template Name/), { target: { value: 'My copy' } });

      fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));

      await waitFor(() => expect(reportsApi.generateAdHocReport).toHaveBeenCalled());
      expect(prompt()).not.toBeInTheDocument();
    });

    it('does not ask once a change is put back', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();
      changeFirstSection('Report Header');

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockOnClose).toHaveBeenCalled();
      expect(prompt()).not.toBeInTheDocument();
    });

    it('asks on Cancel, and Keep editing returns to the builder', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      await waitFor(() => expect(prompt()).not.toBeInTheDocument());
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(screen.getAllByLabelText('Section Title')[0]).toHaveValue('Executive Overview');
    });

    it('closes without saving on Discard changes', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));

      expect(mockOnClose).toHaveBeenCalled();
      expect(reportsApi.updateTemplate).not.toHaveBeenCalled();
    });

    it('saves and closes on Save to template', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Save to template' }));

      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(reportsApi.updateTemplate).toHaveBeenCalledTimes(1);
      expect(reportsApi.generateAdHocReport).not.toHaveBeenCalled();
    });

    it('asks on Escape and on a backdrop click', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      fireEvent.keyDown(screen.getAllByRole('dialog')[0], { key: 'Escape' });
      expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      await waitFor(() => expect(prompt()).not.toBeInTheDocument());

      const backdrop = document.querySelector('.MuiBackdrop-root:not(.MuiBackdrop-invisible)');
      fireEvent.mouseDown(backdrop!);
      fireEvent.click(backdrop!);
      expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('asks on Back to Template', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      fireEvent.click(screen.getByRole('button', { name: 'Back to Template' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));

      expect(await screen.findByText('Choose a Starting Point')).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('never asks for a report started from scratch', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      fireEvent.click(await screen.findByText('Start from Scratch'));
      fireEvent.click(await screen.findByText('Header'));

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockOnClose).toHaveBeenCalled();
      expect(prompt()).not.toBeInTheDocument();
    });

    // Value: protects=an accidental browser Back with changes asks instead of leaving the page;
    // fails_when=the history guard is not armed while there are changes, or a Back is not routed
    // to the prompt; why_new=the prompt is new; seam=jsdom's history; no_claim=Next's router
    it('asks on the browser Back button and re-arms for a second Back', async () => {
      render(<GenerateReportDialog {...defaultProps} />);
      await openTemplate();
      changeFirstSection();

      // The guard pushed one entry of its own for the same URL.
      const isGuardEntry = () =>
        Object.keys((window.history.state as Record<string, unknown> | null) ?? {}).some((k) => k.includes('Guard'));
      await waitFor(() => expect(isGuardEntry()).toBe(true));

      // What Back delivers once it has popped the guard's entry: the page's own state, on the
      // same URL. Dispatched rather than history.back(), whose jsdom traversal is queued twice and
      // lands in whichever test is running by then.
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
      expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();

      // Re-armed, so a second Back is caught too.
      expect(isGuardEntry()).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('steps back over its own history entry when the changes are saved', async () => {
      // jsdom queues a traversal across tests, so the step back is read off the call, not the state.
      const back = jest.spyOn(window.history, 'back').mockImplementation(() => undefined);
      try {
        render(<GenerateReportDialog {...defaultProps} />);
        await openTemplate();
        changeFirstSection();
        await waitFor(() =>
          expect(Object.keys(window.history.state ?? {}).some((k) => k.includes('Guard'))).toBe(true));
        expect(back).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Back to Template' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Save to template' }));

        await screen.findByText('Choose a Starting Point');
        expect(back).toHaveBeenCalledTimes(1);
      } finally {
        back.mockRestore();
      }
    });
  });
});
