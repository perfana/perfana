'use client';

/**
 * Public Share Page for Reports
 *
 * This page displays shared reports without requiring authentication.
 * It fetches the report content using the public share API endpoint.
 *
 * Features:
 * - No authentication required
 * - Sandboxed iframe for XSS protection
 * - Loading and error states
 * - Print and fullscreen capabilities
 * - Responsive design
 *
 * @route /reports/share/[shareId]
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  Box,
  Container,
  Typography,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  Tooltip,
  Paper,
  AppBar,
  Toolbar,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  Print as PrintIcon,
  Refresh as RefreshIcon,
  Home as HomeIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import Link from 'next/link';
import { getPublicReport, type PublicShareResponse } from '@/lib/api/reports';

// ==================== Constants ====================

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

// ==================== Error Types ====================

type ErrorType = 'not_found' | 'expired' | 'network' | 'unknown';

interface ErrorState {
  type: ErrorType;
  message: string;
}

// ==================== Main Component ====================

export default function PublicSharePage() {
  const params = useParams();
  const shareId = params.shareId as string;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorState | null>(null);
  const [reportData, setReportData] = useState<PublicShareResponse | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(isMobile);

  // Ref for the iframe
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Fetch the report
  const fetchReport = useCallback(async () => {
    if (!shareId) {
      setError({ type: 'not_found', message: 'No share ID provided' });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getPublicReport(shareId);
      setReportData(data);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'An unexpected error occurred';

      // Determine error type based on message
      let errorType: ErrorType = 'unknown';
      if (errorMessage.includes('not found') || errorMessage.includes('disabled')) {
        errorType = 'not_found';
      } else if (errorMessage.includes('expired')) {
        errorType = 'expired';
      } else if (errorMessage.includes('Failed to fetch') || errorMessage.includes('network')) {
        errorType = 'network';
      }

      setError({ type: errorType, message: errorMessage });
    } finally {
      setLoading(false);
    }
  }, [shareId]);

  // Fetch on mount and when shareId changes
  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Handle fullscreen toggle
  const handleFullscreenToggle = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Handle print
  const handlePrint = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return;

    try {
      iframeRef.current.contentWindow.print();
    } catch (_err) {
      // Fallback: Open in new window and print
      if (reportData?.html_content) {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(reportData.html_content);
          printWindow.document.close();
          printWindow.print();
        }
      }
    }
  }, [reportData?.html_content]);

  // Format date for display
  const formatDate = useCallback((dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  }, []);

  // Render loading state
  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'background.default',
          gap: 2,
        }}
      >
        <CircularProgress size={48} />
        <Typography variant="body1" color="text.secondary">
          Loading report...
        </Typography>
      </Box>
    );
  }

  // Render error state
  if (error) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'background.default',
          px: 2,
        }}
      >
        <Container maxWidth="sm">
          <Paper
            elevation={0}
            sx={{
              p: 4,
              textAlign: 'center',
              borderRadius: 2,
              backgroundColor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <ErrorIcon
              sx={{
                fontSize: 64,
                color: error.type === 'expired' ? 'warning.main' : 'error.main',
                mb: 2,
              }}
            />

            <Typography variant="h5" gutterBottom fontWeight={600}>
              {error.type === 'not_found' && 'Report Not Found'}
              {error.type === 'expired' && 'Share Link Expired'}
              {error.type === 'network' && 'Connection Error'}
              {error.type === 'unknown' && 'Error Loading Report'}
            </Typography>

            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}
            >
              {error.type === 'not_found' &&
                'This report does not exist or sharing has been disabled by the owner.'}
              {error.type === 'expired' &&
                'The share link for this report has expired. Please request a new link from the report owner.'}
              {error.type === 'network' &&
                'Unable to connect to the server. Please check your internet connection and try again.'}
              {error.type === 'unknown' && error.message}
            </Typography>

            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
              {error.type === 'network' && (
                <Button variant="contained" onClick={fetchReport} startIcon={<RefreshIcon />}>
                  Try Again
                </Button>
              )}
              <Button
                component={Link}
                href="/"
                variant={error.type === 'network' ? 'outlined' : 'contained'}
                startIcon={<HomeIcon />}
              >
                Go to Home
              </Button>
            </Box>
          </Paper>
        </Container>
      </Box>
    );
  }

  // Render report content
  if (!reportData) {
    return null;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: 'background.default',
      }}
    >
      {/* Header Bar */}
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          backgroundColor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {/* Logo / Brand */}
          <Box
            component={Link}
            href="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              textDecoration: 'none',
              color: 'primary.main',
              fontWeight: 700,
              fontSize: '1.125rem',
              letterSpacing: '-0.02em',
              '&:hover': {
                opacity: 0.8,
              },
            }}
          >
            Perfana
          </Box>

          {/* Report Info */}
          <Box sx={{ flex: 1, mx: 2, overflow: 'hidden' }}>
            <Typography
              variant="subtitle1"
              noWrap
              sx={{ color: 'text.primary', fontWeight: 500 }}
            >
              {reportData.name}
            </Typography>
            {!isMobile && reportData.test_run_name && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {reportData.test_run_name} • Generated {formatDate(reportData.generated_at)}
              </Typography>
            )}
          </Box>

          {/* Actions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={fetchReport} aria-label="Refresh report">
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="Print">
              <IconButton size="small" onClick={handlePrint} aria-label="Print report">
                <PrintIcon fontSize="small" />
              </IconButton>
            </Tooltip>

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
          </Box>
        </Toolbar>
      </AppBar>

      {/* Report Content */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            flex: 1,
            bgcolor: 'background.paper',
            position: 'relative',
          }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={reportData.html_content}
            sandbox={IFRAME_SANDBOX}
            title={`Report: ${reportData.name}`}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            aria-label={`Shared report: ${reportData.name}`}
          />
        </Box>
      </Box>

      {/* Footer - Only show in non-fullscreen mode */}
      {!isFullscreen && (
        <Box
          component="footer"
          sx={{
            py: 1.5,
            px: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            backgroundColor: 'background.paper',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Generated {formatDate(reportData.generated_at)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Powered by{' '}
            <Box
              component={Link}
              href="/"
              sx={{
                color: 'primary.main',
                textDecoration: 'none',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              Perfana
            </Box>
          </Typography>
        </Box>
      )}
    </Box>
  );
}
