'use client';

import { Box, Typography, Chip } from '@mui/material';
import { PyroscopeInstance } from '@/lib/pyroscope';

interface PyroscopeExpandedContentProps {
  instance: PyroscopeInstance;
}

export function PyroscopeExpandedContent({ instance }: PyroscopeExpandedContentProps) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        Instance Details
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Pyroscope URL
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
            {instance.pyroscopeUrl}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          {instance.pyroscopeStandAlone && (
            <Chip
              label="Standalone Pyroscope"
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
          {!instance.pyroscopeStandAlone && (
            <Chip
              label="Grafana Pyroscope App"
              size="small"
              variant="outlined"
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
