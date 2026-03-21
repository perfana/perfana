'use client';

import { Box, Typography, Chip } from '@mui/material';
import { Storage } from '@mui/icons-material';
import { GrafanaInstance } from '@/lib/grafana-instances';
import GrafanaDashboardsTable from '@/components/integrations/GrafanaDashboardsTable';

interface GrafanaExpandedContentProps {
  instance: GrafanaInstance;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export function GrafanaExpandedContent({
  instance,
  onError,
  onSuccess,
}: GrafanaExpandedContentProps) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        Instance Details
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Client URL
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
            {instance.clientUrl}
          </Typography>
        </Box>
        {instance.serverUrl && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Server URL
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
              {instance.serverUrl}
            </Typography>
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          <Chip
            label={`Org ${instance.orgId}`}
            size="small"
            variant="outlined"
          />
          {instance.snapshotInstance && (
            <Chip
              icon={<Storage />}
              label="Snapshot Instance"
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
          {instance.apiKey && (
            <Chip
              label="API Key Configured"
              size="small"
              color="success"
              variant="outlined"
            />
          )}
        </Box>
      </Box>

      <GrafanaDashboardsTable
        grafanaInstance={instance}
        onError={onError}
        onSuccess={onSuccess}
      />
    </Box>
  );
}
