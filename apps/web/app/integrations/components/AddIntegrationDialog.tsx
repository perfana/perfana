'use client';

import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Timeline,
  LocalFireDepartment,
  Speed,
} from '@mui/icons-material';
import { IntegrationType, IntegrationTypeDefinition } from '../types';

/**
 * Integration type definitions for Add Integration dialog
 */
export const INTEGRATION_TYPES: IntegrationTypeDefinition[] = [
  {
    id: 'grafana',
    name: 'Grafana',
    description: 'Powerful visualization and monitoring platform for creating interactive dashboards and alerting on your metrics.',
    category: 'Visualization',
    icon: <Timeline />,
    color: '#F46800',
    features: ['Dashboard Visualization', 'Alerting', 'Snapshots', 'Multiple Data Sources'],
  },
  {
    id: 'dynatrace',
    name: 'Dynatrace',
    description: 'All-in-one APM and observability platform providing deep insights into application performance, infrastructure monitoring, and real user experience.',
    category: 'APM',
    icon: <Speed />,
    color: '#1496FF',
    features: ['APM', 'Real User Monitoring', 'Infrastructure Monitoring', 'Distributed Tracing', 'AI-Powered Analysis'],
  },
  {
    id: 'pyroscope',
    name: 'Pyroscope',
    description: 'Continuous profiling platform that helps you understand CPU, memory, and other resource usage patterns in your applications.',
    category: 'Profiling',
    icon: <LocalFireDepartment />,
    color: '#FF6B35',
    features: ['CPU Profiling', 'Memory Profiling', 'Goroutine Profiling', 'Flame Graphs'],
  },
  {
    id: 'tracing',
    name: 'Distributed Tracing',
    description: 'Connect distributed tracing platforms (Tempo, Jaeger, Elastic APM) to analyze request flows and identify bottlenecks across microservices.',
    category: 'Distributed Tracing',
    icon: <Timeline />,
    color: '#9C27B0',
    features: ['Request Flow Analysis', 'Service Dependencies', 'Latency Breakdown', 'Error Tracking'],
  },
];

interface AddIntegrationDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (integrationType: IntegrationType) => void;
}

export function AddIntegrationDialog({
  open,
  onClose,
  onSelect,
}: AddIntegrationDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Add Integration</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Select an integration to configure and connect to your Perfana instance.
        </Typography>
        <Grid container spacing={2}>
          {INTEGRATION_TYPES.map((integration) => (
            <Grid size={{ xs: 12, sm: 6 }} key={integration.id}>
              <Card
                sx={{
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    boxShadow: 4,
                    transform: 'translateY(-2px)',
                  },
                }}
                onClick={() => {
                  onClose();
                  onSelect(integration.id);
                }}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
                    <Avatar
                      sx={{
                        bgcolor: `${integration.color}20`,
                        color: integration.color,
                        mr: 2,
                        width: 48,
                        height: 48,
                      }}
                    >
                      {integration.icon}
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600, mb: 0.5 }}>
                        {integration.name}
                      </Typography>
                    </Box>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                    {integration.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
