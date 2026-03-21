'use client';

import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
} from '@mui/material';
import {
  MonitorHeart,
  OpenInNew,
  Visibility,
} from '@mui/icons-material';
import { Dashboard } from '../types';
import { filterSystemTags } from '@perfana/shared/utils';

interface DashboardCardProps {
  dashboard: Dashboard;
  onView: (dashboard: Dashboard) => void;
  onOpenInGrafana: (dashboard: Dashboard) => void;
}

export function DashboardCard({
  dashboard,
  onView,
  onOpenInGrafana,
}: DashboardCardProps) {
  // Filter out system variables to display
  const displayVariables = dashboard.variables?.filter((variable) =>
    variable.name &&
    variable.name !== 'system_under_test' &&
    variable.name !== 'test_environment'
  ) || [];

  return (
    <Card
      variant="outlined"
      sx={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          boxShadow: 2,
          borderColor: 'primary.main'
        }
      }}
    >
      <CardContent sx={{ flexGrow: 1 }}>
        <Box display="flex" alignItems="flex-start" mb={1}>
          <MonitorHeart color="primary" sx={{ mr: 1 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
            {dashboard.dashboard_label}
          </Typography>
        </Box>

        {dashboard.tags && dashboard.tags.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
            {filterSystemTags(dashboard.tags).map((tag, index) => (
              <Chip
                key={index}
                label={tag}
                sx={{
                  height: '24px',
                  fontWeight: 600,
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease',
                  background: (theme) =>
                    theme.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, rgba(100, 181, 246, 0.15) 0%, rgba(66, 165, 245, 0.20) 100%)'
                      : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                  border: (theme) =>
                    theme.palette.mode === 'dark'
                      ? '1px solid rgba(100, 181, 246, 0.4)'
                      : '1px solid rgba(25, 118, 210, 0.3)',
                  color: (theme) =>
                    theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark,
                  '&:hover': {
                    transform: 'translateY(-1px)',
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
                    border: (theme) =>
                      theme.palette.mode === 'dark'
                        ? '1px solid rgba(100, 181, 246, 0.6)'
                        : '1px solid rgba(25, 118, 210, 0.5)',
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

        {displayVariables.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ fontWeight: 600 }}>
              Variables:
            </Typography>
            {displayVariables.map((variable, index) => (
              <Typography
                key={variable.name || index}
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ ml: 1 }}
              >
                {variable.name}: {Array.isArray(variable.values) ? variable.values.join(', ') : variable.values || 'N/A'}
              </Typography>
            ))}
          </Box>
        )}
      </CardContent>

      <Box sx={{ p: 2, pt: 0 }}>
        <Button
          variant="contained"
          size="small"
          fullWidth
          startIcon={<Visibility />}
          onClick={() => onView(dashboard)}
          sx={{ mb: 1 }}
        >
          View
        </Button>
        <Button
          variant="outlined"
          size="small"
          fullWidth
          startIcon={<OpenInNew />}
          onClick={() => onOpenInGrafana(dashboard)}
        >
          View in Grafana
        </Button>
      </Box>
    </Card>
  );
}
