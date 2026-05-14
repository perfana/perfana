'use client';

/**
 * Report List Component
 *
 * Displays a list of reports with actions for a test run.
 * Features:
 * - Table view with report details (name, template, status, created date)
 * - Action buttons: View, Share, PDF Download, Delete
 * - Loading, error, and empty states
 * - Delete confirmation dialog
 * - Copy share link functionality
 *
 * @example
 * ```tsx
 * <ReportList
 *   reports={reports}
 *   loading={false}
 *   onView={(id) => router.push(`/reports/${id}`)}
 *   onDelete={handleDelete}
 *   onRefresh={fetchReports}
 * />
 * ```
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  Alert,
  LinearProgress,
} from '@mui/material';
import {
  Visibility as ViewIcon,
  Share as ShareIcon,
  PictureAsPdf as PdfIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Assessment as AssessmentIcon,
  Download as _DownloadIcon,
} from '@mui/icons-material';
import {
  type ReportListItem,
  type ReportStatus,
  getReportStatusLabel,
  getReportStatusColor,
  isCompletedStatus,
  isProcessingStatus,
  buildShareUrl,
  downloadPdf,
} from '@/lib/api/reports';

// ==================== Types ====================

/**
 * Snackbar severity for MUI Snackbar notifications
 */
type SnackbarSeverity = 'success' | 'error' | 'warning' | 'info';

/**
 * Props for the ReportList component
 */
export interface ReportListProps {
  /** List of reports to display */
  reports: ReportListItem[];
  /** Whether the list is loading */
  loading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Whether to show the refresh button */
  showRefresh?: boolean;
  /** Callback when refresh is clicked */
  onRefresh?: () => Promise<void>;
  /** Callback when view report is clicked */
  onView?: (reportId: string) => void;
  /** Callback when delete is completed */
  onDelete?: (reportId: string) => Promise<void>;
  /** Callback for snackbar notifications */
  onSnackbar?: (message: string, severity: SnackbarSeverity) => void;
  /** Custom empty state message */
  emptyMessage?: string;
  /** Custom empty state description */
  emptyDescription?: string;
  /** Whether to show the table header */
  showHeader?: boolean;
  /** Whether to use compact mode */
  compact?: boolean;
}

// ==================== Helper Functions ====================

/**
 * Format date for display
 */
const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Format file size for display
 */
const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ==================== Main Component ====================

/**
 * ReportList - Displays a list of reports with actions
 */
export function ReportList({
  reports,
  loading = false,
  error = null,
  showRefresh = true,
  onRefresh,
  onView,
  onDelete,
  onSnackbar,
  emptyMessage = 'No reports generated yet.',
  emptyDescription = 'Click the + button to generate your first report.',
  showHeader = true,
  compact = false,
}: ReportListProps) {
  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // PDF download state
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Handle snackbar callback
  const handleSnackbar = useCallback(
    (message: string, severity: SnackbarSeverity) => {
      if (onSnackbar) {
        onSnackbar(message, severity);
      }
    },
    [onSnackbar]
  );

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
    if (!reportToDelete || !onDelete) return;

    setIsDeleting(true);
    try {
      await onDelete(reportToDelete.id);
      handleSnackbar('Report deleted successfully', 'success');
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete report';
      handleSnackbar(errorMessage, 'error');
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setReportToDelete(null);
    }
  }, [reportToDelete, onDelete, handleSnackbar]);

  // Handle delete cancel
  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false);
    setReportToDelete(null);
  }, []);

  // Handle refresh click
  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
      handleSnackbar('Reports refreshed', 'success');
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to refresh reports';
      handleSnackbar(errorMessage, 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh, handleSnackbar]);

  // Handle copy share link
  const handleCopyShareLink = useCallback(
    async (report: ReportListItem) => {
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
    },
    [handleSnackbar]
  );

  // Handle PDF download
  const handleDownloadPdf = useCallback(
    async (report: ReportListItem) => {
      if (!report.has_pdf) {
        handleSnackbar('PDF not available for this report', 'warning');
        return;
      }

      setDownloadingPdf(report.id);
      try {
        const blob = await downloadPdf(report.id);

        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${report.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        handleSnackbar('PDF downloaded successfully', 'success');
      } catch (err) {
        const errorMessage =
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to download PDF';
        handleSnackbar(errorMessage, 'error');
      } finally {
        setDownloadingPdf(null);
      }
    },
    [handleSnackbar]
  );

  // Render processing indicator
  const renderProcessingIndicator = (report: ReportListItem) => {
    if (!isProcessingStatus(report.status)) return null;

    return (
      <Box sx={{ width: '100%', mt: 0.5 }}>
        <LinearProgress
          variant="indeterminate"
          sx={{
            height: 2,
            borderRadius: 1,
            backgroundColor: 'rgba(25, 118, 210, 0.1)',
            '& .MuiLinearProgress-bar': {
              backgroundColor: 'primary.main',
            },
          }}
        />
      </Box>
    );
  };

  // Render action buttons for a report
  const renderActions = (report: ReportListItem) => {
    const isComplete = isCompletedStatus(report.status);
    const isProcessing = isProcessingStatus(report.status);
    const buttonSize = compact ? 'small' : 'small';

    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
        {/* View */}
        <Tooltip title={isComplete ? 'View Report' : 'Report not ready'}>
          <span>
            <IconButton
              size={buttonSize}
              onClick={() => onView?.(report.id)}
              disabled={!isComplete || !onView}
            >
              <ViewIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        {/* Share */}
        <Tooltip
          title={
            !isComplete
              ? 'Report not ready'
              : report.share_enabled
              ? 'Copy Share Link'
              : 'Sharing Disabled'
          }
        >
          <span>
            <IconButton
              size={buttonSize}
              onClick={() => handleCopyShareLink(report)}
              disabled={!report.share_enabled || !isComplete}
            >
              <ShareIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        {/* PDF Download */}
        <Tooltip
          title={
            !isComplete
              ? 'Report not ready'
              : report.has_pdf
              ? 'Download PDF'
              : 'PDF not available'
          }
        >
          <span>
            <IconButton
              size={buttonSize}
              onClick={() => handleDownloadPdf(report)}
              disabled={!report.has_pdf || downloadingPdf === report.id}
            >
              {downloadingPdf === report.id ? (
                <CircularProgress size={16} />
              ) : (
                <PdfIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>

        {/* Delete */}
        <Tooltip title="Delete Report">
          <IconButton
            size={buttonSize}
            color="error"
            onClick={() => handleDeleteClick(report)}
            disabled={isProcessing}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    );
  };

  // Render header row with optional refresh button
  const renderHeaderRow = () => {
    if (!showHeader) return null;

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          Generated Reports ({reports.length})
        </Typography>
        {showRefresh && onRefresh && (
          <Tooltip title="Refresh">
            <IconButton
              size="small"
              onClick={handleRefresh}
              disabled={isRefreshing || loading}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              {isRefreshing ? (
                <CircularProgress size={16} />
              ) : (
                <RefreshIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  };

  // Render loading state
  if (loading && reports.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <CircularProgress size={32} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Loading reports...
        </Typography>
      </Box>
    );
  }

  // Render error state
  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  // Render empty state
  if (reports.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <AssessmentIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {emptyDescription}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {renderHeaderRow()}

      {/* Reports Table */}
      <TableContainer>
        <Table size={compact ? 'small' : 'medium'}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              {!compact && <TableCell>Size</TableCell>}
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reports.map((report) => (
              <TableRow
                key={report.id}
                hover
                sx={{
                  '&:last-child td, &:last-child th': { border: 0 },
                }}
              >
                <TableCell>
                  <Box>
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ maxWidth: compact ? 150 : 200, fontWeight: 500 }}
                    >
                      {report.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {report.template_name}
                    </Typography>
                    {renderProcessingIndicator(report)}
                  </Box>
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
                {!compact && (
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {formatFileSize(report.file_size)}
                    </Typography>
                  </TableCell>
                )}
                <TableCell align="right">{renderActions(report)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Loading overlay when refreshing */}
      {(loading || isRefreshing) && reports.length > 0 && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <CircularProgress size={24} />
        </Box>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-report-list-dialog-title"
        aria-describedby="delete-report-list-dialog-description"
      >
        <DialogTitle id="delete-report-list-dialog-title">Delete Report</DialogTitle>
        <DialogContent>
          <Typography id="delete-report-list-dialog-description">
            Are you sure you want to delete the report{' '}
            <strong>{reportToDelete?.name}</strong>? This action cannot be undone.
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
    </Box>
  );
}

export default ReportList;
