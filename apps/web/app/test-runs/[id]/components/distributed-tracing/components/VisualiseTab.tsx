'use client';

import {
  Box,
  Button,
  CircularProgress,
  Typography,
  Alert,
} from '@mui/material';
import { OpenInNew } from '@mui/icons-material';
import { VisualiseTabProps } from '../types';

/**
 * Capitalize the first letter of a string
 */
function capitalize(str: string | undefined): string {
  if (!str) return 'Tracing';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function VisualiseTab({
  tracingUrl,
  loading,
  iframeLoading,
  iframeAllowed,
  tracingUi,
  onOpenExternal,
  onIframeLoad,
  onIframeError,
}: VisualiseTabProps) {
  const tracingUiLabel = capitalize(tracingUi);

  return (
    <>
      {/* Open in New Tab button */}
      <Box sx={{ mb: 3 }}>
        <Button
          variant="outlined"
          startIcon={<OpenInNew />}
          onClick={onOpenExternal}
          disabled={!tracingUrl || loading}
          fullWidth
        >
          Open in {tracingUiLabel}
        </Button>
      </Box>

      {/* Iframe (if allowed) */}
      {iframeAllowed ? (
        loading || iframeLoading ? (
          <Box textAlign="center" py={8}>
            <CircularProgress size={48} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Loading traces...
            </Typography>
          </Box>
        ) : tracingUrl ? (
          <Box
            sx={{
              width: '100%',
              height: '800px',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <iframe
              key={tracingUrl}
              src={tracingUrl}
              title="Distributed Tracing View"
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={onIframeLoad}
              onError={onIframeError}
            />
          </Box>
        ) : null
      ) : (
        <Alert severity="info" sx={{ mt: 2 }}>
          {`Iframe embedding is disabled for this tracing service. Click "Open in ${tracingUiLabel}" to view traces in a new tab.`}
        </Alert>
      )}
    </>
  );
}
