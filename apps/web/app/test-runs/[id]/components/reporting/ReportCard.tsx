'use client';

/**
 * Report Card Component
 *
 * Main orchestrator component for Custom Reporting feature.
 * Displays a collapsible card with report summary, list, and actions.
 *
 * Features:
 * - Collapsed view: Shows report count, status summary
 * - Expanded view: Report list, generate button, actions
 * - Auto-focus on expand (per CLAUDE.md UI standards)
 * - Support for multiple reports per test run
 *
 * @example
 * ```tsx
 * <ReportCard
 *   testRun={testRun}
 *   expanded={expanded}
 *   onExpand={() => setExpanded(!expanded)}
 * />
 * ```
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Card,
  CardContent,
  Collapse,
  Divider,
  CircularProgress,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Tooltip,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Add as AddIcon,
  Assessment as AssessmentIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Share as ShareIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import {
  getReportSummary,
  listReports,
  deleteReport,
  getReport,
  downloadPdf,
  getReportStatusLabel,
  getReportStatusColor,
  isCompletedStatus,
  isFailedStatus,
  buildShareUrl,
  type ReportSummary,
  type ReportListItem,
  type ReportStatus,
} from '@/lib/api/reports';
import KPIDisplay from '../shared/KPIDisplay';
import SoftBadge from '../shared/SoftBadge';
import { HtmlReportViewerModal } from '@/components/reports/HtmlReportViewerModal';

// ==================== Types ====================

/**
 * Snackbar severity for MUI Snackbar notifications
 */
type SnackbarSeverity = 'success' | 'error' | 'warning' | 'info';

/**
 * Test run information needed by Report components
 */
export interface ReportTestRunInfo {
  /** Test run UUID */
  id: string;
  /** Test run ID string (e.g., "my-test-run") */
  test_run_id: string;
  /** System under test ID */
  system_under_test_id?: string;
  /** Test environment */
  test_environment?: string;
  /** Workload name */
  workload?: string;
}

/**
 * Props for the main Report Card component
 */
export interface ReportCardProps {
  /** Test run information */
  testRun: ReportTestRunInfo;
  /** Whether the card is expanded */
  expanded: boolean;
  /** Callback when expand/collapse is toggled */
  onExpand: () => void;
  /** Callback when Generate Report button is clicked */
  onGenerateReport?: () => void;
  /** Callback when View Report is clicked */
  onViewReport?: (reportId: string) => void;
  /** Callback for snackbar notifications */
  onSnackbar?: (message: string, severity: SnackbarSeverity) => void;
  /** Custom class name */
  className?: string;
  /** Trigger to refresh reports list (increment to trigger refresh) */
  refreshTrigger?: number;
}

// ==================== Main Component ====================

/**
 * ReportCard - Main orchestrator component for Custom Reporting
 */
export function ReportCard({
  testRun,
  expanded,
  onExpand,
  onGenerateReport,
  onViewReport,
  onSnackbar,
  className,
  refreshTrigger = 0,
}: ReportCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // State for report data
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // State for report viewer modal
  const [viewerModalOpen, setViewerModalOpen] = useState(false);
  const [viewerReportId, setViewerReportId] = useState<string | undefined>(undefined);
  const [viewerReportName, setViewerReportName] = useState<string>('');
  const [viewerShareId, setViewerShareId] = useState<string | undefined>(undefined);
  const [viewerHtmlContent, setViewerHtmlContent] = useState<string | undefined>(undefined);

  // Snackbar callback - defined early to avoid initialization errors
  const handleSnackbar = useCallback(
    (message: string, severity?: SnackbarSeverity) => {
      if (onSnackbar) {
        onSnackbar(message, severity || 'info');
      }
    },
    [onSnackbar]
  );

  // Fetch summary on mount
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);
        const summaryData = await getReportSummary(testRun.id);
        setSummary(summaryData);
      } catch (err) {
        const errorMessage = err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch report summary';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [testRun.id]);

  // Fetch reports list when expanded
  useEffect(() => {
    if (!expanded) return;

    const fetchReports = async () => {
      try {
        const response = await listReports(testRun.id, { limit: 50 });
        setReports(response.items);
      } catch (err) {
        const errorMessage = err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch reports';
        handleSnackbar(errorMessage, 'error');
      }
    };

    fetchReports();
  }, [expanded, testRun.id]);

  // Refresh reports when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger === 0) return; // Skip initial render

    const refresh = async () => {
      try {
        // Refresh summary
        const summaryData = await getReportSummary(testRun.id);
        setSummary(summaryData);

        // Refresh reports list if expanded
        if (expanded) {
          const response = await listReports(testRun.id, { limit: 50 });
          setReports(response.items);
        }
      } catch (err) {
        const errorMessage = err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to refresh reports';
        handleSnackbar(errorMessage, 'error');
      }
    };

    refresh();
  }, [refreshTrigger, testRun.id, expanded, handleSnackbar]);

  // Handle expand with auto-focus
  const handleExpand = useCallback(() => {
    const wasCollapsed = !expanded;
    onExpand();

    // Auto-focus the card after expansion (only when expanding)
    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector(
          '[data-testid="report-card-expanded"]'
        );
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  }, [expanded, onExpand]);

  // Handle delete button click
  const handleDeleteClick = useCallback((report: ReportListItem) => {
    setReportToDelete({
      id: report.id,
      name: report.name,
    });
    setDeleteDialogOpen(true);
  }, []);

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(async () => {
    if (!reportToDelete) return;

    setIsDeleting(true);
    try {
      await deleteReport(reportToDelete.id);

      // Immediately remove from local state for instant UI update
      setReports(prevReports => prevReports.filter(r => r.id !== reportToDelete.id));

      // Refresh summary in the background
      const summaryData = await getReportSummary(testRun.id);
      setSummary(summaryData);

      handleSnackbar('Report deleted successfully', 'success');
    } catch (err) {
      const errorMessage = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to delete report';
      handleSnackbar(errorMessage, 'error');

      // Refetch reports on error to ensure consistency
      try {
        const response = await listReports(testRun.id, { limit: 50 });
        setReports(response.items);
      } catch (refetchErr) {
        console.error('Failed to refetch reports after delete error:', refetchErr);
      }
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setReportToDelete(null);
    }
  }, [reportToDelete, testRun.id, handleSnackbar]);

  // Handle delete cancel
  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false);
    setReportToDelete(null);
  }, []);

  // Handle manage templates - navigate to system config reporting templates tab
  const handleManageTemplates = useCallback(() => {
    if (!testRun.system_under_test_id) {
      handleSnackbar('System under test not available', 'error');
      return;
    }

    const params = new URLSearchParams();
    params.set('tab', '7'); // Reporting Templates tab
    if (testRun.test_environment) {
      params.set('environment', testRun.test_environment);
    }
    if (testRun.workload) {
      params.set('workload', testRun.workload);
    }

    router.push(`/systems/${testRun.system_under_test_id}/config?${params.toString()}`);
  }, [testRun.system_under_test_id, testRun.test_environment, testRun.workload, router, handleSnackbar]);

  // Handle view report
  const handleViewReport = useCallback(async (reportId: string) => {
    try {
      const report = await getReport(reportId);

      if (!report.html_content) {
        handleSnackbar('Report HTML not available', 'warning');
        return;
      }

      // Set modal state and open
      setViewerReportId(report.id);
      setViewerReportName(report.name);
      setViewerShareId(report.share_enabled ? report.share_id : undefined);
      setViewerHtmlContent(report.html_content);
      setViewerModalOpen(true);
    } catch (err) {
      const errorMessage = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to open report';
      handleSnackbar(errorMessage, 'error');
    }
  }, [handleSnackbar]);

  // Handle close viewer modal
  const handleCloseViewerModal = useCallback(() => {
    setViewerModalOpen(false);
    // Clear state after animation completes
    setTimeout(() => {
      setViewerReportId(undefined);
      setViewerReportName('');
      setViewerShareId(undefined);
      setViewerHtmlContent(undefined);
    }, 300);
  }, []);

  // Handle copy share link
  const handleCopyShareLink = useCallback(async (report: ReportListItem) => {
    if (!report.share_enabled) {
      handleSnackbar('Sharing is disabled for this report', 'warning');
      return;
    }

    const shareUrl = buildShareUrl(report.share_id);
    try {
      await navigator.clipboard.writeText(shareUrl);
      handleSnackbar('Share link copied to clipboard', 'success');
    } catch (err) {
      handleSnackbar('Failed to copy share link', 'error');
    }
  }, [handleSnackbar]);

  // Handle download PDF
  const handleDownloadPdf = useCallback(async (report: ReportListItem) => {
    if (!report.has_pdf) {
      handleSnackbar('PDF not available for this report', 'warning');
      return;
    }

    try {
      const blob = await downloadPdf(report.id);

      // Create a download link and trigger download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the blob URL
      setTimeout(() => URL.revokeObjectURL(url), 100);

      handleSnackbar('PDF download started', 'success');
    } catch (err) {
      const errorMessage = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to download PDF';
      handleSnackbar(errorMessage, 'error');
    }
  }, [handleSnackbar]);

  // Get accent color based on status
  const getAccentColor = (): string => {
    if (!loading && summary) {
      if (summary.failed_reports > 0) {
        return '#d32f2f'; // Red for failed
      }
      if (summary.pending_reports > 0) {
        return '#1976d2'; // Blue for in-progress
      }
      if (summary.completed_reports > 0) {
        return '#4caf50'; // Green for completed
      }
    }
    return '#1976d2'; // Default blue
  };

  // Format date for display
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get status badge color for SoftBadge
  const getStatusBadgeColor = (status: ReportStatus): 'blue' | 'green' | 'red' | 'orange' | 'neutral' => {
    switch (status) {
      case 'pending':
      case 'processing':
      case 'pdf_processing':
        return 'blue';
      case 'html_complete':
      case 'pdf_complete':
        return 'green';
      case 'failed':
        return 'red';
      default:
        return 'neutral';
    }
  };

  // Render collapsed view content
  const renderCollapsedContent = () => (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={loading ? '—' : error ? 'Error' : summary?.total_reports ?? 0}
          label="Reports"
          loading={loading}
          color={!summary?.total_reports ? 'neutral' : 'primary'}
        />
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'center',
        }}
      >
        {loading && <SoftBadge label="Loading..." color="blue" />}

        {!loading && !error && summary && summary.total_reports > 0 && (
          <>
            {summary.completed_reports > 0 && (
              <SoftBadge count={summary.completed_reports} label="ready" color="green" />
            )}
            {summary.pending_reports > 0 && (
              <SoftBadge count={summary.pending_reports} label="generating" color="blue" />
            )}
            {summary.failed_reports > 0 && (
              <SoftBadge count={summary.failed_reports} label="failed" color="red" />
            )}
            {summary.total_downloads > 0 && (
              <SoftBadge count={summary.total_downloads} label="downloads" color="neutral" />
            )}
          </>
        )}

        {!loading && !error && (!summary || summary.total_reports === 0) && (
          <SoftBadge label="No reports generated" color="neutral" />
        )}
      </Box>
    </Box>
  );

  // Render expanded view content
  const renderExpandedContent = () => (
    <Box>
      {/* Actions Row */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          Generated Reports
        </Typography>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          {/* Manage Templates Button */}
          <Tooltip title="Manage Reporting Templates">
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                handleManageTemplates();
              }}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>

          {/* Generate Report Button */}
          <Tooltip title="Generate New Report">
            <IconButton
              color="primary"
              onClick={onGenerateReport}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Reports Table */}
      {reports.length > 0 && (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reports.map((report) => (
                <TableRow key={report.id} hover>
                  <TableCell>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                      {report.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {report.template_name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={getReportStatusLabel(report.status)}
                      color={getReportStatusColor(report.status)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {formatDate(report.created_at)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                      {/* View */}
                      <Tooltip title="View Report">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleViewReport(report.id)}
                            disabled={!isCompletedStatus(report.status)}
                          >
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>

                      {/* Share */}
                      <Tooltip title={report.share_enabled ? 'Copy Share Link' : 'Sharing Disabled'}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleCopyShareLink(report)}
                            disabled={!report.share_enabled || !isCompletedStatus(report.status)}
                          >
                            <ShareIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>

                      {/* Delete */}
                      <Tooltip title="Delete Report">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteClick(report)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Loading State */}
      {loading && (
        <Box textAlign="center" py={4}>
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Loading reports...
          </Typography>
        </Box>
      )}

      {/* Error State */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Empty State */}
      {!loading && !error && reports.length === 0 && (
        <Box textAlign="center" py={4}>
          <AssessmentIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography variant="body2" color="text.secondary">
            No reports generated yet.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click the + button to generate your first report.
          </Typography>
        </Box>
      )}
    </Box>
  );

  return (
    <Box className={className}>
      <Card
        ref={cardRef}
        tabIndex={-1}
        data-testid={
          expanded ? 'report-card-expanded' : 'report-card-collapsed'
        }
        elevation={0}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: expanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: expanded ? 'none' : `3px solid ${getAccentColor()}`,
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: expanded ? 'visible' : 'hidden',
          '&:hover': expanded
            ? {}
            : {
                transform: 'translateY(-4px)',
                boxShadow: (theme) => theme.palette.mode === 'dark'
                  ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
                  : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
              },
        }}
        onClick={expanded ? undefined : handleExpand}
      >
        <CardContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            p: 3.5,
            pt: 4,
            '&:last-child': { pb: 3.5 },
          }}
        >
          {/* Header */}
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            mb={2}
            sx={{
              position: expanded ? 'sticky' : 'relative',
              ...(expanded ? { top: 0, zIndex: 10, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' } : {}),
            }}
          >
            <Typography
              variant="subtitle1"
              component="h2"
              sx={{
                fontWeight: 600,
                color: 'text.secondary',
                fontSize: '0.875rem',
                letterSpacing: '0.01em',
                textTransform: 'uppercase',
                textAlign: 'center',
              }}
            >
              Reports
            </Typography>

            {/* Expand/Collapse Button */}
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                handleExpand();
              }}
              size="small"
              sx={{
                position: 'absolute',
                right: 0,
                width: 32,
                height: 32,
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: `${getAccentColor()}15`,
                  color: getAccentColor(),
                },
                transition: 'all 0.2s ease',
              }}
            >
              {expanded ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          </Box>

          {/* Collapsed Content */}
          {!expanded && renderCollapsedContent()}

          {/* Expanded Content */}
          <Collapse in={expanded}>
            <Divider sx={{ my: 2 }} />
            {renderExpandedContent()}
          </Collapse>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-report-dialog-title"
        aria-describedby="delete-report-dialog-description"
      >
        <DialogTitle id="delete-report-dialog-title">Delete Report</DialogTitle>
        <DialogContent>
          <Typography id="delete-report-dialog-description">
            Are you sure you want to delete the report <strong>{reportToDelete?.name}</strong>?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={isDeleting}
            autoFocus
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Report Viewer Modal */}
      <HtmlReportViewerModal
        open={viewerModalOpen}
        onClose={handleCloseViewerModal}
        reportId={viewerReportId}
        shareId={viewerShareId}
        reportName={viewerReportName}
        htmlContent={viewerHtmlContent}
        onLoad={() => console.log('Report loaded')}
        onError={(error) => handleSnackbar(error, 'error')}
      />
    </Box>
  );
}

export default ReportCard;
