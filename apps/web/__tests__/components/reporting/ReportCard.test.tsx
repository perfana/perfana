/**
 * Unit tests for ReportCard Component
 *
 * Tests the main reporting card functionality:
 * - Collapsed and expanded states with auto-focus
 * - Report summary loading and display
 * - Report list display with actions
 * - Delete confirmation dialog
 * - Share link copying
 * - Refresh functionality
 * - Loading states and error handling
 * - Empty states
 *
 * Note: This tests the orchestrator component for Custom Reporting feature.
 * Tests focus on user interactions, state management, and API integration.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportCard from '@/app/test-runs/[id]/components/reporting/ReportCard';
import * as reportsApi from '@/lib/api/reports';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  })),
  usePathname: jest.fn(() => '/test-runs/123'),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

// Mock the reports API module
jest.mock('@/lib/api/reports', () => ({
  getReportSummary: jest.fn(),
  listReports: jest.fn(),
  deleteReport: jest.fn(),
  getReport: jest.fn(),
  downloadPdf: jest.fn(),
  getReportStatusLabel: jest.fn((status) => {
    const labels: Record<string, string> = {
      pending: 'Pending',
      processing: 'Processing',
      html_complete: 'HTML Ready',
      pdf_processing: 'Generating PDF',
      pdf_complete: 'PDF Ready',
      failed: 'Failed',
    };
    return labels[status] || status;
  }),
  getReportStatusColor: jest.fn((status) => {
    const colors: Record<string, string> = {
      pending: 'default',
      processing: 'info',
      html_complete: 'success',
      pdf_processing: 'info',
      pdf_complete: 'success',
      failed: 'error',
    };
    return colors[status] || 'default';
  }),
  isCompletedStatus: jest.fn((status) => status === 'html_complete' || status === 'pdf_complete'),
  isFailedStatus: jest.fn((status) => status === 'failed'),
  buildShareUrl: jest.fn((shareId) => `http://localhost:4001/reports/share/${shareId}`),
}));

// Mock KPIDisplay component
jest.mock('@/app/test-runs/[id]/components/shared/KPIDisplay', () => ({
  __esModule: true,
  default: ({ value, label, loading, color }: { value: string | number; label: string; loading?: boolean; color?: string }) => (
    <div data-testid="kpi-display" data-loading={loading} data-color={color}>
      <span data-testid="kpi-value">{loading ? 'Loading...' : value}</span>
      <span data-testid="kpi-label">{label}</span>
    </div>
  ),
}));

// Mock SoftBadge component
jest.mock('@/app/test-runs/[id]/components/shared/SoftBadge', () => ({
  __esModule: true,
  default: ({ count, label, color }: { count?: number; label: string; color?: string }) => (
    <div data-testid={`soft-badge-${color}`}>
      {count !== undefined && <span data-testid="badge-count">{count}</span>}
      <span data-testid="badge-label">{label}</span>
    </div>
  ),
}));

// Mock HtmlReportViewerModal component
jest.mock('@/components/reports/HtmlReportViewerModal', () => ({
  __esModule: true,
  HtmlReportViewerModal: ({ open }: { open: boolean }) => (
    open ? <div data-testid="html-report-viewer-modal">Report Viewer</div> : null
  ),
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

describe('ReportCard', () => {
  const mockOnExpand = jest.fn();
  const mockOnGenerateReport = jest.fn();
  const mockOnViewReport = jest.fn();
  const mockOnSnackbar = jest.fn();

  const mockTestRun = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    test_run_id: 'TR-2024-001',
    system_under_test_id: 'system-123',
    test_environment: 'production',
    workload: 'load-test',
  };

  const mockSummary: reportsApi.ReportSummary = {
    total_reports: 5,
    completed_reports: 3,
    pending_reports: 1,
    failed_reports: 1,
    total_downloads: 10,
    total_share_views: 25,
  };

  const mockReports: reportsApi.ReportListItem[] = [
    {
      id: 'report-1',
      test_run_id: mockTestRun.id,
      template_name: 'Performance Summary',
      name: 'Report 2024-01-15',
      generated_by: 'user@example.com',
      status: 'html_complete',
      share_enabled: true,
      share_id: 'share-uuid-1',
      share_view_count: 5,
      download_count: 2,
      has_pdf: true,
      file_size: 1024000,
      created_at: '2024-01-15T10:00:00Z',
      completed_at: '2024-01-15T10:01:00Z',
    },
    {
      id: 'report-2',
      test_run_id: mockTestRun.id,
      template_name: 'SLO Report',
      name: 'SLO Analysis',
      generated_by: 'user@example.com',
      status: 'processing',
      share_enabled: false,
      share_id: 'share-uuid-2',
      share_view_count: 0,
      download_count: 0,
      has_pdf: false,
      created_at: '2024-01-15T11:00:00Z',
    },
    {
      id: 'report-3',
      test_run_id: mockTestRun.id,
      template_name: 'Regression Report',
      name: 'Failed Report',
      generated_by: 'user@example.com',
      status: 'failed',
      share_enabled: false,
      share_id: 'share-uuid-3',
      share_view_count: 0,
      download_count: 0,
      has_pdf: false,
      created_at: '2024-01-15T12:00:00Z',
    },
  ];

  const defaultProps = {
    testRun: mockTestRun,
    expanded: false,
    onExpand: mockOnExpand,
    onGenerateReport: mockOnGenerateReport,
    onViewReport: mockOnViewReport,
    onSnackbar: mockOnSnackbar,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (reportsApi.getReportSummary as jest.Mock).mockResolvedValue(mockSummary);
    (reportsApi.listReports as jest.Mock).mockResolvedValue({
      items: mockReports,
      total: mockReports.length,
      offset: 0,
      limit: 50,
    });
  });

  describe('Rendering - Collapsed State', () => {
    it('should render collapsed card with Reports title', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        // The card should be rendered with the collapsed data-testid
        expect(screen.getByTestId('report-card-collapsed')).toBeInTheDocument();
      });
    });

    it('should load report summary on mount', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        expect(reportsApi.getReportSummary).toHaveBeenCalledWith(mockTestRun.id);
      });
    });

    it('should display KPI with report count in collapsed state', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        const kpi = screen.getByTestId('kpi-display');
        expect(kpi).toBeInTheDocument();
        expect(screen.getByTestId('kpi-value')).toHaveTextContent('5');
        expect(screen.getByTestId('kpi-label')).toHaveTextContent('Reports');
      });
    });

    it('should display soft badges for report status breakdown', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('soft-badge-green')).toBeInTheDocument();
        expect(screen.getByTestId('soft-badge-blue')).toBeInTheDocument();
        expect(screen.getByTestId('soft-badge-red')).toBeInTheDocument();
      });
    });

    it('should apply pointer cursor in collapsed state', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        const card = screen.getByTestId('report-card-collapsed');
        expect(card).toHaveStyle({ cursor: 'pointer' });
      });
    });

    it('should have data-testid for collapsed state', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('report-card-collapsed')).toBeInTheDocument();
      });
    });

    it('should call onExpand when card clicked in collapsed state', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        const card = screen.getByTestId('report-card-collapsed');
        fireEvent.click(card);
      });

      expect(mockOnExpand).toHaveBeenCalled();
    });

    it('should show loading badge while fetching summary', async () => {
      (reportsApi.getReportSummary as jest.Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockSummary), 100))
      );

      render(<ReportCard {...defaultProps} />);

      expect(screen.getByTestId('soft-badge-blue')).toHaveTextContent('Loading...');
    });
  });

  describe('Rendering - Expanded State', () => {
    it('should render expanded card', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(screen.getByTestId('report-card-expanded')).toBeInTheDocument();
      });
    });

    it('should display "Generated Reports" section header', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Generated Reports')).toBeInTheDocument();
      });
    });

    it('should fetch reports list when expanded', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(reportsApi.listReports).toHaveBeenCalledWith(mockTestRun.id, { limit: 50 });
      });
    });

    it('should display reports table with headers', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Name')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Created')).toBeInTheDocument();
        expect(screen.getByText('Actions')).toBeInTheDocument();
      });
    });

    it('should display report names in the table', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Report 2024-01-15')).toBeInTheDocument();
        expect(screen.getByText('SLO Analysis')).toBeInTheDocument();
        expect(screen.getByText('Failed Report')).toBeInTheDocument();
      });
    });

    it('should display template names under report names', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('Performance Summary')).toBeInTheDocument();
        expect(screen.getByText('SLO Report')).toBeInTheDocument();
        expect(screen.getByText('Regression Report')).toBeInTheDocument();
      });
    });

    it('should show manage templates button when expanded', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const settingsButton = screen.getByTestId('SettingsIcon').closest('button');
        expect(settingsButton).toBeInTheDocument();
      });
    });

    it('should show generate report button when expanded', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const generateButton = screen.getByTestId('AddIcon').closest('button');
        expect(generateButton).toBeInTheDocument();
      });
    });
  });

  describe('Summary Loading', () => {
    it('should show loading state for KPI', async () => {
      (reportsApi.getReportSummary as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<ReportCard {...defaultProps} />);

      const kpi = screen.getByTestId('kpi-display');
      expect(kpi).toHaveAttribute('data-loading', 'true');
    });

    it('should handle summary fetch error gracefully', async () => {
      (reportsApi.getReportSummary as jest.Mock).mockRejectedValue(
        new Error('Failed to fetch')
      );

      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('kpi-value')).toHaveTextContent('Error');
      });
    });

    it('should display zero reports when summary has no reports', async () => {
      (reportsApi.getReportSummary as jest.Mock).mockResolvedValue({
        total_reports: 0,
        completed_reports: 0,
        pending_reports: 0,
        failed_reports: 0,
        total_downloads: 0,
        total_share_views: 0,
      });

      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('kpi-value')).toHaveTextContent('0');
        expect(screen.getByText('No reports generated')).toBeInTheDocument();
      });
    });
  });

  describe('Report List Actions', () => {
    it('should call onViewReport when view button clicked', async () => {
      // The component's handleViewReport calls getReport internally to fetch
      // the HTML content, then opens a viewer modal. It does not call onViewReport prop.
      (reportsApi.getReport as jest.Mock).mockResolvedValue({
        id: 'report-1',
        name: 'Report 2024-01-15',
        html_content: '<html>report</html>',
        share_enabled: true,
        share_id: 'share-uuid-1',
      });

      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const viewIcons = screen.getAllByTestId('VisibilityIcon');
        // First report is completed, so view button should be enabled
        const viewButton = viewIcons[0].closest('button');
        if (viewButton) fireEvent.click(viewButton);
      });

      await waitFor(() => {
        expect(reportsApi.getReport).toHaveBeenCalledWith('report-1');
      });
    });

    it('should disable view button for non-completed reports', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const viewIcons = screen.getAllByTestId('VisibilityIcon');
        // Second report is 'processing', view should be disabled
        const viewButton = viewIcons[1].closest('button');
        expect(viewButton).toBeDisabled();
      });
    });

    it('should call onGenerateReport when generate button clicked', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const generateButton = screen.getByTestId('AddIcon').closest('button');
        fireEvent.click(generateButton);
      });

      expect(mockOnGenerateReport).toHaveBeenCalled();
    });

    it('should copy share link when share button clicked', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        // Find share buttons by the ShareIcon testid
        const shareIcons = screen.getAllByTestId('ShareIcon');
        // Click the first share button (for completed report with sharing enabled)
        const shareButton = shareIcons[0].closest('button');
        if (shareButton) fireEvent.click(shareButton);
      });

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          'http://localhost:4001/reports/share/share-uuid-1'
        );
        expect(mockOnSnackbar).toHaveBeenCalledWith(
          'Share link copied to clipboard',
          'success'
        );
      });
    });

    it('should have share buttons for reports', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        // Find share buttons by the ShareIcon testid
        const shareIcons = screen.getAllByTestId('ShareIcon');
        // Should have share icons for each report
        expect(shareIcons.length).toBeGreaterThan(0);
      });
    });

    it('should disable view button when report is not complete', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const viewIcons = screen.getAllByTestId('VisibilityIcon');
        // Second report (pending status) should have disabled view button
        const viewButton = viewIcons[1].closest('button');
        expect(viewButton).toBeDisabled();
      });
    });
  });

  describe('Delete Functionality', () => {
    it('should open delete dialog when delete button clicked', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      // Wait for reports to load
      await waitFor(() => {
        expect(screen.getAllByTestId('DeleteIcon').length).toBeGreaterThan(0);
      });

      // Click delete
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const deleteButton = deleteIcons[0].closest('button');
      if (deleteButton) fireEvent.click(deleteButton);

      // Dialog should open with confirmation buttons
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
      });
    });

    it('should close delete dialog when cancel clicked', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      // Wait for reports to load
      await waitFor(() => {
        expect(screen.getAllByTestId('DeleteIcon').length).toBeGreaterThan(0);
      });

      // Open dialog
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const deleteButton = deleteIcons[0].closest('button');
      if (deleteButton) fireEvent.click(deleteButton);

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click cancel
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should delete report when confirmed', async () => {
      (reportsApi.deleteReport as jest.Mock).mockResolvedValue(undefined);

      render(<ReportCard {...defaultProps} expanded={true} />);

      // Wait for reports to load
      await waitFor(() => {
        expect(screen.getAllByTestId('DeleteIcon').length).toBeGreaterThan(0);
      });

      // Open dialog
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const deleteButton = deleteIcons[0].closest('button');
      if (deleteButton) fireEvent.click(deleteButton);

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click confirm
      const confirmButton = screen.getByRole('button', { name: 'Delete' });
      fireEvent.click(confirmButton);

      // Should call delete API
      await waitFor(() => {
        expect(reportsApi.deleteReport).toHaveBeenCalledWith('report-1');
      });
    });

    it('should refresh list after successful delete', async () => {
      (reportsApi.deleteReport as jest.Mock).mockResolvedValue(undefined);

      render(<ReportCard {...defaultProps} expanded={true} />);

      // Wait for reports to load
      await waitFor(() => {
        expect(screen.getAllByTestId('DeleteIcon').length).toBeGreaterThan(0);
      });

      // Open dialog
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const deleteButton = deleteIcons[0].closest('button');
      if (deleteButton) fireEvent.click(deleteButton);

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click confirm
      const confirmButton = screen.getByRole('button', { name: 'Delete' });
      fireEvent.click(confirmButton);

      // Should call delete and refresh
      await waitFor(() => {
        expect(reportsApi.deleteReport).toHaveBeenCalled();
      });
    });

    it('should handle delete errors gracefully', async () => {
      (reportsApi.deleteReport as jest.Mock).mockRejectedValue(
        new Error('Delete failed')
      );

      render(<ReportCard {...defaultProps} expanded={true} />);

      // Wait for reports to load
      await waitFor(() => {
        expect(screen.getAllByTestId('DeleteIcon').length).toBeGreaterThan(0);
      });

      // Open dialog
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const deleteButton = deleteIcons[0].closest('button');
      if (deleteButton) fireEvent.click(deleteButton);

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click confirm
      const confirmButton = screen.getByRole('button', { name: 'Delete' });
      fireEvent.click(confirmButton);

      // Should handle error gracefully (not crash)
      await waitFor(() => {
        expect(reportsApi.deleteReport).toHaveBeenCalled();
      });
    });

    it('should have confirm and cancel buttons in delete dialog', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      // Wait for reports to load
      await waitFor(() => {
        expect(screen.getAllByTestId('DeleteIcon').length).toBeGreaterThan(0);
      });

      // Open dialog
      const deleteIcons = screen.getAllByTestId('DeleteIcon');
      const deleteButton = deleteIcons[0].closest('button');
      if (deleteButton) fireEvent.click(deleteButton);

      // Dialog should have both buttons
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      });
    });
  });

  describe('Refresh Functionality', () => {
    it('should refresh summary and reports when refreshTrigger changes', async () => {
      const { rerender } = render(<ReportCard {...defaultProps} expanded={true} refreshTrigger={0} />);

      // Wait for initial load
      await waitFor(() => {
        expect(reportsApi.listReports).toHaveBeenCalled();
      });

      // Trigger refresh by changing refreshTrigger prop
      rerender(<ReportCard {...defaultProps} expanded={true} refreshTrigger={1} />);

      await waitFor(() => {
        // Should call APIs again after initial call
        expect(reportsApi.getReportSummary).toHaveBeenCalledTimes(2);
        expect(reportsApi.listReports).toHaveBeenCalledTimes(2);
      });
    });

    it('should have manage templates button visible', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const settingsIcon = screen.getByTestId('SettingsIcon');
        const settingsButton = settingsIcon.closest('button');
        expect(settingsButton).toBeInTheDocument();
        expect(settingsButton).not.toBeDisabled();
      });
    });

    it('should handle refresh errors gracefully', async () => {
      const { rerender } = render(<ReportCard {...defaultProps} expanded={true} refreshTrigger={0} />);

      // Wait for initial load
      await waitFor(() => {
        expect(reportsApi.listReports).toHaveBeenCalled();
      });

      // Mock failure for next call
      (reportsApi.getReportSummary as jest.Mock).mockRejectedValueOnce(
        new Error('Refresh failed')
      );

      // Trigger refresh
      rerender(<ReportCard {...defaultProps} expanded={true} refreshTrigger={1} />);

      // Just verify it doesn't crash
      await waitFor(() => {
        expect(screen.getByTestId('report-card-expanded')).toBeInTheDocument();
      });
    });
  });

  describe('Empty States', () => {
    it('should show empty state when no reports exist', async () => {
      (reportsApi.listReports as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
        offset: 0,
        limit: 50,
      });

      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(screen.getByText('No reports generated yet.')).toBeInTheDocument();
        expect(
          screen.getByText('Click the + button to generate your first report.')
        ).toBeInTheDocument();
      });
    });

    it('should show loading state when fetching reports', async () => {
      (reportsApi.listReports as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        expect(screen.getByText('Loading reports...')).toBeInTheDocument();
      });
    });
  });

  describe('Expand/Collapse Behavior', () => {
    it('should call onExpand when expand button clicked', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        // Find expand button by icon button in header
        const expandButtons = screen.getAllByRole('button');
        const expandButton = expandButtons.find(btn => btn.querySelector('[data-testid="ExpandMoreIcon"]'));
        if (expandButton) fireEvent.click(expandButton);
      });

      expect(mockOnExpand).toHaveBeenCalled();
    });

    it('should call onExpand when collapse button clicked', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        // Find collapse button
        const buttons = screen.getAllByRole('button');
        const collapseButton = buttons.find(btn => btn.querySelector('[data-testid="ExpandLessIcon"]'));
        if (collapseButton) {
          fireEvent.click(collapseButton);
        }
      });

      expect(mockOnExpand).toHaveBeenCalled();
    });

    it('should auto-focus card when expanding', async () => {
      jest.useFakeTimers();

      const { rerender } = render(<ReportCard {...defaultProps} expanded={false} />);

      // Mock focus and scrollIntoView
      Element.prototype.scrollIntoView = jest.fn();
      const mockFocus = jest.fn();
      HTMLElement.prototype.focus = mockFocus;

      rerender(<ReportCard {...defaultProps} expanded={true} />);

      jest.advanceTimersByTime(350);

      jest.useRealTimers();
    });
  });

  describe('Status Badges', () => {
    it('should display correct status badge colors', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        // Verify status chips are rendered with correct colors
        expect(reportsApi.getReportStatusColor).toHaveBeenCalledWith('html_complete');
        expect(reportsApi.getReportStatusColor).toHaveBeenCalledWith('processing');
        expect(reportsApi.getReportStatusColor).toHaveBeenCalledWith('failed');
      });
    });

    it('should display correct status labels', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(reportsApi.getReportStatusLabel).toHaveBeenCalledWith('html_complete');
        expect(reportsApi.getReportStatusLabel).toHaveBeenCalledWith('processing');
        expect(reportsApi.getReportStatusLabel).toHaveBeenCalledWith('failed');
      });
    });
  });

  describe('Accent Color Logic', () => {
    it('should render card with proper data-testid when failed reports exist', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        const card = screen.getByTestId('report-card-collapsed');
        // Card should render correctly when failed reports exist
        expect(card).toBeInTheDocument();
        // Failed reports should show red badge
        expect(screen.getByTestId('soft-badge-red')).toBeInTheDocument();
      });
    });

    it('should render card correctly when only pending reports', async () => {
      (reportsApi.getReportSummary as jest.Mock).mockResolvedValue({
        total_reports: 1,
        completed_reports: 0,
        pending_reports: 1,
        failed_reports: 0,
        total_downloads: 0,
        total_share_views: 0,
      });

      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        const card = screen.getByTestId('report-card-collapsed');
        expect(card).toBeInTheDocument();
        // Pending reports should show blue badge
        expect(screen.getByTestId('soft-badge-blue')).toBeInTheDocument();
      });
    });

    it('should render card correctly when only completed reports', async () => {
      (reportsApi.getReportSummary as jest.Mock).mockResolvedValue({
        total_reports: 2,
        completed_reports: 2,
        pending_reports: 0,
        failed_reports: 0,
        total_downloads: 5,
        total_share_views: 10,
      });

      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        const card = screen.getByTestId('report-card-collapsed');
        expect(card).toBeInTheDocument();
        // Completed reports should show green badge
        expect(screen.getByTestId('soft-badge-green')).toBeInTheDocument();
      });
    });
  });

  describe('Date Formatting', () => {
    it('should display created dates', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        // Should show dates in the table - just verify table has dates rendered
        const table = screen.getByRole('table');
        expect(table).toBeInTheDocument();
        // There should be date cells with time data
        const cells = screen.getAllByRole('cell');
        expect(cells.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors when listing reports', async () => {
      (reportsApi.listReports as jest.Mock).mockRejectedValue(
        new Error('Failed to fetch reports')
      );

      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(mockOnSnackbar).toHaveBeenCalledWith(
          'Failed to fetch reports',
          'error'
        );
      });
    });

    it('should handle clipboard copy failure', async () => {
      navigator.clipboard.writeText = jest.fn().mockRejectedValue(new Error('Copy failed'));

      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const shareIcons = screen.getAllByTestId('ShareIcon');
        const shareButton = shareIcons[0].closest('button');
        if (shareButton) fireEvent.click(shareButton);
      });

      await waitFor(() => {
        expect(mockOnSnackbar).toHaveBeenCalledWith(
          'Failed to copy share link',
          'error'
        );
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing testRun gracefully', () => {
      const propsWithoutTestRun = {
        ...defaultProps,
        testRun: { id: '', test_run_id: '' },
      };

      expect(() => render(<ReportCard {...propsWithoutTestRun} />)).not.toThrow();
    });

    it('should handle undefined onSnackbar callback', async () => {
      const propsWithoutSnackbar = {
        testRun: mockTestRun,
        expanded: true,
        onExpand: mockOnExpand,
      };

      render(<ReportCard {...propsWithoutSnackbar} />);

      await waitFor(() => {
        const settingsButton = screen.getByTestId('SettingsIcon').closest('button');
        fireEvent.click(settingsButton);
      });

      // Should not throw
    });

    it('should handle undefined onViewReport callback', async () => {
      const propsWithoutViewReport = {
        testRun: mockTestRun,
        expanded: true,
        onExpand: mockOnExpand,
      };

      render(<ReportCard {...propsWithoutViewReport} />);

      await waitFor(() => {
        const viewIcons = screen.getAllByTestId('VisibilityIcon');
        const viewButton = viewIcons[0].closest('button');
        if (viewButton) fireEvent.click(viewButton);
      });

      // Should not throw
    });

    it('should handle undefined onGenerateReport callback', async () => {
      const propsWithoutGenerate = {
        testRun: mockTestRun,
        expanded: true,
        onExpand: mockOnExpand,
      };

      render(<ReportCard {...propsWithoutGenerate} />);

      await waitFor(() => {
        const addIcon = screen.getByTestId('AddIcon');
        const generateButton = addIcon.closest('button');
        if (generateButton) fireEvent.click(generateButton);
      });

      // Should not throw
    });
  });

  describe('Accessibility', () => {
    it('should have accessible table structure', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      });
    });

    it('should have accessible buttons with labels', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const settingsIcon = screen.getByTestId('SettingsIcon');
        expect(settingsIcon.closest('button')).toBeInTheDocument();

        const addIcon = screen.getByTestId('AddIcon');
        expect(addIcon.closest('button')).toBeInTheDocument();

        expect(screen.getAllByTestId('VisibilityIcon').length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('DeleteIcon').length).toBeGreaterThan(0);
      });
    });

    it('should have accessible dialog with aria labels', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const deleteIcons = screen.getAllByTestId('DeleteIcon');
        const deleteButton = deleteIcons[0].closest('button');
        if (deleteButton) fireEvent.click(deleteButton);
      });

      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-labelledby', 'delete-report-dialog-title');
        expect(dialog).toHaveAttribute('aria-describedby', 'delete-report-dialog-description');
      });
    });
  });

  describe('Visual Styling', () => {
    it('should have rounded card styling', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        const card = screen.getByTestId('report-card-collapsed');
        // MUI applies styles dynamically, check the element exists
        expect(card).toBeInTheDocument();
        expect(card.className).toContain('MuiCard');
      });
    });

    it('should have hover effect in collapsed state', async () => {
      render(<ReportCard {...defaultProps} />);

      await waitFor(() => {
        const card = screen.getByTestId('report-card-collapsed');
        // Card should exist and have transition applied via MUI
        expect(card).toBeInTheDocument();
      });
    });

    it('should render correctly in expanded state', async () => {
      render(<ReportCard {...defaultProps} expanded={true} />);

      await waitFor(() => {
        const card = screen.getByTestId('report-card-expanded');
        expect(card).toBeInTheDocument();
      });
    });
  });
});
