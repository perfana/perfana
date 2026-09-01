'use client';

import { Box, Paper, Typography, Chip, Button } from '@mui/material';
import {
  Computer,
  Storage,
  CloudQueue,
  NetworkCheck,
  Schedule,
  OpenInNew
} from '@mui/icons-material';
import { HostPropertiesResponse, DynatraceConfig } from '@/lib/dynatrace';
import { formatBytes } from '@/lib/format-units';
import { createPlatformUrl, deepLinkBaseUrl } from './utils/dynatrace-formatters';

interface HostPropertiesSectionProps {
  properties: HostPropertiesResponse;
  hostId: string;
  config: DynatraceConfig;
  startTime?: string;
  endTime?: string;
}

export default function HostPropertiesSection({
  properties,
  hostId,
  config,
  startTime,
  endTime
}: HostPropertiesSectionProps) {
  const { properties: props, lastSeenTimestamp } = properties;


  const formatTimestamp = (timestamp?: number): string => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  // Create Dynatrace time filter from test run start/end times
  const createTimeFilter = () => {
    if (!startTime || !endTime) {
      return 'gtf=-2h';
    }
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    return `gtf=c_${start}_${end}`;
  };

  const handleOpenInDynatrace = () => {
    // Only SaaS has a platform (apps) host; a managed cluster serves the route
    // itself. buildDeepLinkUrl branches the same way.
    const baseUrl = deepLinkBaseUrl(config);
    const linkBase = config.dynatraceType === 'saas' ? createPlatformUrl(baseUrl) : baseUrl;
    const timeFilter = createTimeFilter();
    const url = `${linkBase}/ui/apps/dynatrace.classic.hosts/ui/entity/${hostId}?${timeFilter}&gf=all`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Paper
      elevation={1}
      sx={{
        p: 4,
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
            Host Properties
          </Typography>
          <Typography variant="body2" color="text.secondary">
            System information and configuration details
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<OpenInNew />}
          onClick={handleOpenInDynatrace}
          sx={{
            borderColor: 'rgba(76, 175, 80, 0.5)',
            color: 'rgba(76, 175, 80, 0.8)',
            '&:hover': {
              borderColor: 'rgba(76, 175, 80, 0.8)',
              backgroundColor: 'rgba(76, 175, 80, 0.08)',
            },
          }}
        >
          Open in Dynatrace
        </Button>
      </Box>

      {/* Property Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
          gap: 3,
        }}
      >
        {/* OS Information */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Computer sx={{ fontSize: '1.2rem', mr: 1, color: 'rgba(76, 175, 80, 0.8)' }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Operating System
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {props.osType || 'N/A'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {props.osArchitecture || 'N/A'} • {props.bitness || 'N/A'}
          </Typography>
        </Box>

        {/* CPU Cores */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Computer sx={{ fontSize: '1.2rem', mr: 1, color: 'rgba(76, 175, 80, 0.8)' }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              CPU Cores
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {props.cpuCores || 'N/A'}
          </Typography>
        </Box>

        {/* Memory */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Storage sx={{ fontSize: '1.2rem', mr: 1, color: 'rgba(76, 175, 80, 0.8)' }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Memory Total
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {formatBytes(props.memoryTotal)}
          </Typography>
        </Box>

        {/* Monitoring Mode */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <NetworkCheck sx={{ fontSize: '1.2rem', mr: 1, color: 'rgba(76, 175, 80, 0.8)' }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Monitoring Mode
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {props.monitoringMode || 'N/A'}
          </Typography>
        </Box>

        {/* Cloud Type */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <CloudQueue sx={{ fontSize: '1.2rem', mr: 1, color: 'rgba(76, 175, 80, 0.8)' }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Cloud Type
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {props.cloudType || 'N/A'}
          </Typography>
        </Box>

        {/* Last Seen */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Schedule sx={{ fontSize: '1.2rem', mr: 1, color: 'rgba(76, 175, 80, 0.8)' }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Last Seen
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {formatTimestamp(lastSeenTimestamp)}
          </Typography>
        </Box>
      </Box>

      {/* IP Addresses */}
      {props.ipAddresses && props.ipAddresses.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            IP Addresses
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {props.ipAddresses.map((ip, index) => (
              <Chip
                key={index}
                label={ip}
                size="small"
                sx={{
                  backgroundColor: 'rgba(76, 175, 80, 0.1)',
                  color: 'rgba(76, 175, 80, 0.8)',
                  fontFamily: 'monospace',
                }}
              />
            ))}
          </Box>
        </Box>
      )}
    </Paper>
  );
}
