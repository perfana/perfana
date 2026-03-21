'use client';

import { Box, Typography, Chip } from '@mui/material';
import { TracingInstance } from '@/lib/distributed-tracing';

interface TracingExpandedContentProps {
  instance: TracingInstance;
}

/**
 * Returns the display label for a tracing UI type
 */
const getTracingUiLabel = (tracingUi: string): string => {
  switch (tracingUi) {
    case 'tempo':
      return 'Grafana Tempo';
    case 'jaeger':
      return 'Jaeger';
    case 'elastic':
      return 'Elastic APM';
    default:
      return tracingUi;
  }
};

export function TracingExpandedContent({ instance }: TracingExpandedContentProps) {
  const uiLabel = getTracingUiLabel(instance.tracing_ui);

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        Instance Details
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Tracing URL
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
            {instance.tracing_url}
          </Typography>
        </Box>
        {instance.tracing_ui === 'tempo' && instance.tracing_api_url && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Backend API URL
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
              {instance.tracing_api_url}
            </Typography>
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          <Chip
            label={uiLabel}
            size="small"
            color="primary"
            variant="outlined"
          />
          {instance.tracing_iframe_allowed && (
            <Chip
              label="Iframe Enabled"
              size="small"
              color="success"
              variant="outlined"
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
