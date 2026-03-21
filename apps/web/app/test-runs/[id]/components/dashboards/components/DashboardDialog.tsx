'use client';

import { useMemo } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Chip,
  Alert,
} from '@mui/material';
import {
  Close,
  OpenInNew,
} from '@mui/icons-material';
import { Dashboard } from '../types';
import { filterSystemTags } from '@perfana/shared/utils';

/**
 * Validates a URL for safe iframe embedding.
 * Ensures URL is well-formed and uses secure protocol (HTTPS or localhost for development).
 */
function isValidIframeUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const parsedUrl = new URL(url);

    // Allow HTTPS always; allow HTTP in development/test or for localhost
    const isSecureProtocol = parsedUrl.protocol === 'https:';
    const isNonProduction = process.env.NODE_ENV !== 'production';
    const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
    const isHttpAllowed = (isNonProduction || isLocalhost) && parsedUrl.protocol === 'http:';

    if (!isSecureProtocol && !isHttpAllowed) {
      return false;
    }

    // Prevent javascript: or data: URLs that might bypass protocol checks
    if (url.toLowerCase().startsWith('javascript:') || url.toLowerCase().startsWith('data:')) {
      return false;
    }

    return true;
  } catch {
    // URL parsing failed - invalid URL
    return false;
  }
}

interface DashboardDialogProps {
  dashboard: Dashboard | null;
  dashboards: Dashboard[];
  onClose: () => void;
  buildGrafanaIframeUrl: (dashboard: Dashboard) => string;
}

export function DashboardDialog({
  dashboard,
  dashboards,
  onClose,
  buildGrafanaIframeUrl,
}: DashboardDialogProps) {
  // Compute URLs - handle null dashboard case for proper hook ordering
  const iframeUrl = dashboard ? buildGrafanaIframeUrl(dashboard) : '';
  const newTabUrl = iframeUrl.replace('&kiosk', '');

  // Validate the iframe URL for security - must be before any conditional returns
  const isUrlValid = useMemo(() => isValidIframeUrl(iframeUrl), [iframeUrl]);

  // Early return after all hooks
  if (!dashboard) return null;

  // Find the full dashboard data with tags
  const dashboardWithTags = dashboards.find(d => d.id === dashboard.id);
  const tags = dashboardWithTags?.tags ? filterSystemTags(dashboardWithTags.tags) : [];

  return (
    <Dialog
      open={!!dashboard}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          width: '95vw',
          height: '90vh',
          maxWidth: 'none',
          maxHeight: 'none',
        }
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="h6" component="div">
              {dashboard.dashboard_label}
            </Typography>
            {tags.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {tags.map((tag, index) => (
                  <Chip
                    key={index}
                    label={tag}
                    sx={{
                      height: '24px',
                      fontWeight: 600,
                      backdropFilter: 'blur(8px)',
                      transition: 'all 0.2s ease',
                      background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                      border: '1px solid rgba(25, 118, 210, 0.3)',
                      color: 'primary.dark',
                      '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
                        border: '1px solid rgba(25, 118, 210, 0.5)',
                      },
                      '& .MuiChip-label': {
                        px: 1,
                        py: 0,
                        fontSize: '0.7rem'
                      }
                    }}
                  />
                ))}
              </Box>
            )}
          </Box>
          <IconButton
            edge="end"
            color="inherit"
            onClick={onClose}
            aria-label="close"
          >
            <Close />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent
        sx={{
          p: 0,
          height: 'calc(90vh - 120px)', // Subtract header and footer height
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {isUrlValid ? (
          <iframe
            src={iframeUrl}
            style={{
              border: 'none',
              width: '100%',
              height: '100%',
              flex: 1
            }}
            title={`Grafana Dashboard: ${dashboard.dashboard_name}`}
            allow="fullscreen"
            {...(process.env.NODE_ENV === 'production'
              ? { sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms' }
              : {})}
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <Box sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Alert severity="error" sx={{ maxWidth: 500 }}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Invalid Dashboard URL
              </Typography>
              <Typography variant="body2">
                The dashboard URL could not be loaded because it does not meet security requirements.
                Please ensure the Grafana instance is configured with a valid HTTPS URL.
              </Typography>
            </Alert>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button
          startIcon={<OpenInNew />}
          onClick={() => {
            window.open(newTabUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          Open in New Tab
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
