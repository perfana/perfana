'use client';

/**
 * HTML Report Viewer Modal
 *
 * A modal component that displays HTML reports in a sandboxed iframe for XSS protection.
 *
 * Features:
 * - Sandboxed iframe for security (no script execution, no form submission)
 * - Fullscreen mode toggle
 * - Loading and error states
 * - Download as PDF option
 * - Responsive design
 * - Proper accessibility with ARIA attributes
 *
 * @example
 * ```tsx
 * <HtmlReportViewerModal
 *   open={showViewer}
 *   onClose={() => setShowViewer(false)}
 *   reportId="abc-123"
 *   reportName="Performance Report - Jan 2024"
 * />
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Slide,
  useMediaQuery,
  useTheme,
  Snackbar,
} from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import {
  Close as CloseIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  Refresh as RefreshIcon,
  OpenInNew as OpenInNewIcon,
  PictureAsPdf as PdfIcon,
  Share as ShareIcon,
} from '@mui/icons-material';
import { forwardRef, type ReactElement, type Ref } from 'react';
import { getReport, getPublicReport, buildShareUrl, generatePdf, downloadPdf } from '@/lib/api/reports';

// ==================== Types ====================

/**
 * Props for the HtmlReportViewerModal component
 */
export interface HtmlReportViewerModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when the modal should close */
  onClose: () => void;
  /** The report ID to fetch and display (for authenticated access) */
  reportId?: string;
  /** The share ID to fetch and display (for public access) */
  shareId?: string;
  /** The report name for display in the title */
  reportName?: string;
  /** Pre-loaded HTML content (optional - if provided, skips fetch) */
  htmlContent?: string;
  /** Whether to start in fullscreen mode */
  defaultFullscreen?: boolean;
  /** Whether to show the toolbar actions */
  showToolbar?: boolean;
  /** Callback when the report is loaded successfully */
  onLoad?: () => void;
  /** Callback when loading the report fails */
  onError?: (error: string) => void;
}

// ==================== Transition Component ====================

/**
 * Slide transition for the dialog
 */
const SlideTransition = forwardRef(function Transition(
  props: TransitionProps & { children: ReactElement },
  ref: Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

// ==================== Sandbox Configuration ====================

/**
 * Iframe sandbox permissions - restrictive for security
 * - allow-same-origin: Required for srcdoc to work properly
 * - allow-popups: Allows links to open in new windows/tabs
 *
 * NOT included for security:
 * - allow-scripts: Prevents any JavaScript execution
 * - allow-forms: Prevents form submissions
 * - allow-modals: Prevents alert/confirm/prompt
 * - allow-top-navigation: Prevents navigation of parent window
 */
const IFRAME_SANDBOX = 'allow-same-origin allow-popups';

// ==================== Main Component ====================

/**
 * HtmlReportViewerModal - Modal component for viewing HTML reports safely
 */
export function HtmlReportViewerModal({
  open,
  onClose,
  reportId,
  shareId,
  reportName = 'Report',
  htmlContent: initialHtmlContent,
  defaultFullscreen = false,
  showToolbar = true,
  onLoad,
  onError,
}: HtmlReportViewerModalProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // State
  const [loading, setLoading] = useState(!initialHtmlContent);
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(initialHtmlContent || null);
  const [isFullscreen, setIsFullscreen] = useState(defaultFullscreen || isMobile);
  const [displayName, setDisplayName] = useState(reportName);

  // Update displayName when reportName prop changes
  useEffect(() => {
    setDisplayName(reportName);
  }, [reportName]);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error' | 'info'>('info');

  // Ref for the iframe
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Snackbar helper
  const showSnackbar = useCallback((message: string, severity: 'success' | 'error' | 'info' = 'info') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  }, []);

  // Fetch report content
  const fetchReportContent = useCallback(async () => {
    // Skip if we have initial content
    if (initialHtmlContent) {
      setHtmlContent(initialHtmlContent);
      setLoading(false);
      return;
    }

    // Skip if we don't have a report ID or share ID
    if (!reportId && !shareId) {
      setError('No report ID or share ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let content: string;

      if (shareId) {
        // Public access via share ID
        const response = await getPublicReport(shareId);
        content = response.html_content;
        setDisplayName(response.name || reportName);
      } else if (reportId) {
        // Authenticated access via report ID - fetch full report for name
        const fullReport = await getReport(reportId);
        content = fullReport.html_content || '';
        setDisplayName(fullReport.name || reportName);
      } else {
        throw new Error('No report source provided');
      }

      setHtmlContent(content);
      onLoad?.();
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load report';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [reportId, shareId, initialHtmlContent, reportName, onLoad, onError]);

  // Fetch content when modal opens
  useEffect(() => {
    if (open) {
      fetchReportContent();
    }
  }, [open, fetchReportContent]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      // Don't reset htmlContent if it was provided as prop
      if (!initialHtmlContent) {
        setHtmlContent(null);
      }
      setError(null);
      // Reset displayName to default prop value
      setDisplayName(reportName);
    }
  }, [open, initialHtmlContent, reportName]);

  // Handle fullscreen toggle
  const handleFullscreenToggle = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    fetchReportContent();
  }, [fetchReportContent]);

  // Handle open in new tab
  const handleOpenInNewTab = useCallback(() => {
    if (shareId) {
      // Use frontend HTML view page for public access
      const baseUrl = typeof window !== 'undefined'
        ? window.location.origin
        : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4001';
      const htmlViewUrl = `${baseUrl}/reports/share/${shareId}`;
      window.open(htmlViewUrl, '_blank');
    } else if (htmlContent) {
      // Create a blob URL for authenticated content
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Revoke after a delay to allow the window to load
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }, [shareId, htmlContent]);

  // Handle PDF generation and download
  const handleGeneratePdf = useCallback(async () => {
    if (!reportId) {
      showSnackbar('Cannot generate PDF: Report ID not available', 'error');
      return;
    }

    setGeneratingPdf(true);
    try {
      // Step 1: Queue PDF generation job
      showSnackbar('Queueing PDF generation...', 'info');
      const generateResponse = await generatePdf(reportId);

      if (generateResponse.status === 'pdf_complete') {
        // PDF already generated, download immediately
        showSnackbar('PDF ready, downloading...', 'info');
      } else {
        // Step 2: Poll for completion (check every 2 seconds, max 60 seconds)
        showSnackbar('Generating PDF... This may take a moment.', 'info');

        let attempts = 0;
        const maxAttempts = 30; // 30 * 2s = 60s timeout
        let pdfReady = false;

        while (attempts < maxAttempts && !pdfReady) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

          try {
            const report = await getReport(reportId);

            if (report.status === 'pdf_complete') {
              pdfReady = true;
              showSnackbar('PDF ready, downloading...', 'success');
            } else if (report.status === 'failed') {
              throw new Error(report.error_message || 'PDF generation failed');
            } else if (report.status === 'pdf_processing') {
              // Still processing, continue polling
              attempts++;
            } else {
              throw new Error(`Unexpected status: ${report.status}`);
            }
          } catch (pollError) {
            // If polling fails, break the loop and try downloading anyway
            console.error('Error polling report status:', pollError);
            break;
          }
        }

        if (!pdfReady && attempts >= maxAttempts) {
          throw new Error('PDF generation timed out. Please try again later.');
        }
      }

      // Step 3: Download the PDF
      const blob = await downloadPdf(reportId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // Sanitize filename similar to backend
      const sanitizedName = displayName
        .replace(/[^a-z0-9\s-]/gi, '_')
        .replace(/\s+/g, '_')
        .toLowerCase();

      link.download = `${sanitizedName}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);

      showSnackbar('PDF downloaded successfully', 'success');
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to generate PDF';
      showSnackbar(errorMessage, 'error');
    } finally {
      setGeneratingPdf(false);
    }
  }, [reportId, displayName, showSnackbar]);

  // Handle copy share URL
  const handleCopyShareUrl = useCallback(async () => {
    if (!shareId) {
      showSnackbar('Share URL not available for this report', 'error');
      return;
    }

    try {
      const shareUrl = buildShareUrl(shareId);
      await navigator.clipboard.writeText(shareUrl);
      showSnackbar('Share URL copied to clipboard', 'success');
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to copy share URL';
      showSnackbar(errorMessage, 'error');
    }
  }, [shareId, showSnackbar]);

  // Render loading state
  const renderLoading = () => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 300,
      }}
    >
      <CircularProgress size={40} />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Loading report...
      </Typography>
    </Box>
  );

  // Render error state
  const renderError = () => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 300,
        p: 3,
      }}
    >
      <Alert
        severity="error"
        sx={{ mb: 2, maxWidth: 400 }}
        action={
          <Button color="inherit" size="small" onClick={handleRefresh}>
            Retry
          </Button>
        }
      >
        {error}
      </Alert>
    </Box>
  );

  // Render iframe content
  const renderContent = () => {
    if (!htmlContent) return null;

    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          position: 'relative',
          bgcolor: 'background.paper',
        }}
      >
        <iframe
          ref={iframeRef}
          srcDoc={htmlContent}
          sandbox={IFRAME_SANDBOX}
          title={`Report: ${displayName}`}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
          }}
          aria-label={`HTML report viewer for ${displayName}`}
        />
      </Box>
    );
  };

  // Render toolbar actions
  const renderToolbarActions = () => {
    if (!showToolbar) return null;

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {/* Refresh */}
        <Tooltip title="Refresh">
          <IconButton
            size="small"
            onClick={handleRefresh}
            disabled={loading}
            aria-label="Refresh report"
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Generate and Download PDF */}
        <Tooltip title="Generate and Download PDF">
          <IconButton
            size="small"
            onClick={handleGeneratePdf}
            disabled={loading || !!error || !reportId || generatingPdf}
            aria-label="Generate and download PDF"
          >
            {generatingPdf ? (
              <CircularProgress size={16} />
            ) : (
              <PdfIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>

        {/* Copy Share URL */}
        <Tooltip title="Copy Share URL">
          <IconButton
            size="small"
            onClick={handleCopyShareUrl}
            disabled={loading || !!error || !shareId}
            aria-label="Copy share URL to clipboard"
          >
            <ShareIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Open in new tab */}
        <Tooltip title="Open in new tab">
          <IconButton
            size="small"
            onClick={handleOpenInNewTab}
            disabled={loading || !!error || (!htmlContent && !shareId)}
            aria-label="Open in new tab"
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Fullscreen toggle */}
        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          <IconButton
            size="small"
            onClick={handleFullscreenToggle}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <FullscreenExitIcon fontSize="small" />
            ) : (
              <FullscreenIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>

        {/* Close */}
        <Tooltip title="Close">
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="Close report viewer"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isFullscreen}
      maxWidth="lg"
      fullWidth
      TransitionComponent={SlideTransition}
      aria-labelledby="html-report-viewer-title"
      aria-describedby="html-report-viewer-content"
      PaperProps={{
        sx: {
          height: isFullscreen ? '100%' : '80vh',
          maxHeight: isFullscreen ? '100%' : '90vh',
        },
      }}
    >
      {/* Dialog Title with Actions */}
      <DialogTitle
        id="html-report-viewer-title"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 1.5,
          px: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
          <Typography
            variant="h6"
            component="span"
            noWrap
            sx={{ fontSize: '1rem', fontWeight: 500 }}
          >
            {displayName}
          </Typography>
          {loading && <CircularProgress size={16} sx={{ ml: 1 }} />}
        </Box>
        {renderToolbarActions()}
      </DialogTitle>

      {/* Dialog Content */}
      <DialogContent
        id="html-report-viewer-content"
        sx={{
          p: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {loading && renderLoading()}
        {error && renderError()}
        {!loading && !error && renderContent()}
      </DialogContent>

      {/* Dialog Actions - Only show when not fullscreen */}
      {!isFullscreen && (
        <DialogActions
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            px: 2,
            py: 1,
          }}
        >
          <Button onClick={onClose} color="inherit">
            Close
          </Button>
        </DialogActions>
      )}

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        ContentProps={{
          sx: {
            backgroundColor:
              snackbarSeverity === 'success'
                ? 'success.main'
                : snackbarSeverity === 'error'
                ? 'error.main'
                : 'info.main',
          },
        }}
      />
    </Dialog>
  );
}

export default HtmlReportViewerModal;
