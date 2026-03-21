'use client';

import { Box, CircularProgress, Typography } from '@mui/material';

interface PyroscopeFlameGraphProps {
  url: string | null;
  loading: boolean;
  iframeLoading: boolean;
  title: string;
  loadingText: string;
  emptyText: string;
  onLoad: () => void;
  onError: () => void;
}

export function PyroscopeFlameGraph({
  url,
  loading,
  iframeLoading,
  title,
  loadingText,
  emptyText,
  onLoad,
  onError,
}: PyroscopeFlameGraphProps) {
  if (loading || iframeLoading) {
    return (
      <Box textAlign="center" py={8}>
        <CircularProgress size={48} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {loadingText}
        </Typography>
      </Box>
    );
  }

  if (url) {
    return (
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
          key={url}
          src={url}
          title={title}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          {...(process.env.NODE_ENV === 'production'
            ? { sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms' }
            : {})}
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={onLoad}
          onError={onError}
        />
      </Box>
    );
  }

  return (
    <Box textAlign="center" py={8}>
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    </Box>
  );
}
