'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Alert,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Close,
  OpenInNew,
  ContentCopy,
  Check,
} from '@mui/icons-material';
import { ResolvedDeepLink } from '../types';

/**
 * Check whether a URL can safely be loaded in an iframe.
 * Same logic as DashboardDialog — HTTPS always, HTTP only for localhost/dev.
 */
function isEmbeddable(url: string): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    if (url.toLowerCase().startsWith('javascript:') || url.toLowerCase().startsWith('data:')) return false;
    if (protocol === 'https:') return true;
    const isDev = process.env.NODE_ENV !== 'production';
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return protocol === 'http:' && (isDev || isLocal);
  } catch {
    return false;
  }
}

interface DeepLinkDialogProps {
  link: ResolvedDeepLink | null;
  onClose: () => void;
}

export function DeepLinkDialog({ link, onClose }: DeepLinkDialogProps) {
  const [copied, setCopied] = useState(false);
  const [iframeStatus, setIframeStatus] = useState<'loading' | 'loaded' | 'blocked'>('loading');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const canEmbed = useMemo(() => (link ? isEmbeddable(link.url) : false), [link?.url]);

  // Reset iframe status when the link changes
  useEffect(() => {
    if (link && canEmbed) {
      setIframeStatus('loading');
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [link?.url, canEmbed]);

  // After iframe mounts, start a timeout to detect if it's blocked
  const handleIframeRef = useCallback((el: HTMLIFrameElement | null) => {
    (iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = el;
    if (!el) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // If the iframe hasn't fired onLoad within 5s, assume it's blocked
    timeoutRef.current = setTimeout(() => {
      if (iframeStatus === 'loading') {
        setIframeStatus('blocked');
      }
    }, 5000);
  }, [iframeStatus]);

  const handleIframeLoad = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Try to detect if the iframe actually loaded content or was blocked
    try {
      const iframe = iframeRef.current;
      if (iframe) {
        // If we can access contentWindow.length, the frame loaded something
        // This throws on cross-origin, which is fine — it means it loaded
        void iframe.contentWindow?.length;
      }
      setIframeStatus('loaded');
    } catch {
      // Cross-origin — iframe loaded successfully, we just can't inspect it
      setIframeStatus('loaded');
    }
  }, []);

  const handleIframeError = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIframeStatus('blocked');
  }, []);

  if (!link) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — silently ignore
    }
  };

  return (
    <Dialog
      open={!!link}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          width: '95vw',
          height: '90vh',
          maxWidth: 'none',
          maxHeight: 'none',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
            {link.name}
          </Typography>
          <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close">
            <Close />
          </IconButton>
        </Box>

        {/* URL shown as a compact monospace line below the title — readable but not dominant */}
        <Tooltip title="Click to copy URL" arrow placement="bottom-start">
          <Box
            onClick={handleCopy}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              mt: 0.5,
              cursor: 'pointer',
              '&:hover .url-text': { color: 'primary.main' },
            }}
          >
            <Typography
              className="url-text"
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                color: 'text.secondary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '80%',
                transition: 'color 0.2s',
              }}
            >
              {link.url}
            </Typography>
            {copied
              ? <Check sx={{ fontSize: 14, color: 'success.main' }} />
              : <ContentCopy sx={{ fontSize: 14, color: 'text.disabled' }} />
            }
          </Box>
        </Tooltip>
      </DialogTitle>

      <DialogContent
        sx={{
          p: 0,
          height: 'calc(90vh - 130px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {canEmbed && iframeStatus !== 'blocked' ? (
          <Box sx={{ position: 'relative', flex: 1, width: '100%', height: '100%' }}>
            {iframeStatus === 'loading' && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1.5,
                  zIndex: 1,
                  bgcolor: 'background.paper',
                }}
              >
                <CircularProgress size={32} />
                <Typography variant="body2" color="text.secondary">
                  Loading preview...
                </Typography>
              </Box>
            )}
            <iframe
              ref={handleIframeRef}
              src={link.url}
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              style={{
                border: 'none',
                width: '100%',
                height: '100%',
                flex: 1,
                opacity: iframeStatus === 'loaded' ? 1 : 0,
              }}
              title={`Deep link: ${link.name}`}
              allow="fullscreen"
              {...(process.env.NODE_ENV === 'production'
                ? { sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms' }
                : {})}
              referrerPolicy="no-referrer-when-downgrade"
            />
          </Box>
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              p: 4,
            }}
          >
            <Alert
              severity="info"
              sx={{ maxWidth: 520 }}
              action={
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<OpenInNew />}
                  onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                >
                  Open
                </Button>
              }
            >
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Cannot preview in modal
              </Typography>
              <Typography variant="body2">
                This link cannot be embedded — the target server may block framing
                or your browser restricts access to private networks. Use the button to open it directly.
              </Typography>
            </Alert>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button
          startIcon={<OpenInNew />}
          onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
        >
          Open in New Tab
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
