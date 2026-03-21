'use client';

import { Box, Typography, Chip } from '@mui/material';
import { DynatraceConfig } from '@/lib/dynatrace';

interface DynatraceExpandedContentProps {
  config: DynatraceConfig;
}

export function DynatraceExpandedContent({ config }: DynatraceExpandedContentProps) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        Configuration Details
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Host URL
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
            {config.host}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          <Chip
            label={config.dynatraceType.toUpperCase()}
            size="small"
            variant="outlined"
          />
          {config.perfanaTestRunIdAttribute && (
            <Chip
              label="Test Run ID Configured"
              size="small"
              color="success"
              variant="outlined"
            />
          )}
          {config.perfanaRequestNameAttribute && (
            <Chip
              label="Request Name Configured"
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
