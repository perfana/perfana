'use client';

import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  IconButton,
  Avatar,
  Switch,
  FormControlLabel,
  Divider,
} from '@mui/material';
import {
  Settings,
  KeyboardArrowDown,
  KeyboardArrowUp,
  Delete,
} from '@mui/icons-material';
import { IntegrationCard as IntegrationCardType } from '../types';
import { GrafanaInstance } from '@/lib/grafana-instances';
import { DynatraceConfig } from '@/lib/dynatrace';
import { PyroscopeInstance } from '@/lib/pyroscope';
import { TracingInstance } from '@/lib/distributed-tracing';
import { getStatusIcon, getStatusLabel, getIntegrationTypeLabel } from '../utils';
import {
  GrafanaExpandedContent,
  DynatraceExpandedContent,
  PyroscopeExpandedContent,
  TracingExpandedContent,
} from './expanded-content';

interface IntegrationCardProps {
  card: IntegrationCardType;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSettings: () => void;
  onDelete: () => void;
  onConnect: () => void;
  onSnackbar: (message: string, severity: 'success' | 'error') => void;
}

export function IntegrationCardComponent({
  card,
  isExpanded,
  onToggleExpand,
  onSettings,
  onDelete,
  onConnect,
  onSnackbar,
}: IntegrationCardProps) {
  const isGrafanaInstance = card.integrationType === 'grafana' && card.instanceData;
  const isDynatraceInstance = card.integrationType === 'dynatrace' && card.instanceData;
  const isPyroscopeInstance = card.integrationType === 'pyroscope' && card.instanceData;
  const isTracingInstance = card.integrationType === 'tracing' && card.instanceData;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleExpand();
    }
  };

  return (
    <Card
      data-card-id={card.id}
      role="button"
      tabIndex={0}
      aria-label={`${card.name} - ${getStatusLabel(card.status)}`}
      aria-expanded={isExpanded}
      sx={{
        minHeight: isExpanded ? 'auto' : 200,
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        borderTop: 3,
        borderTopColor: card.status === 'connected' ? 'success.main' : 'divider',
        transition: 'all 0.3s ease',
        '&:hover': {
          boxShadow: 6,
          transform: 'translateY(-2px)',
        },
        '&:focus': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: '2px',
        },
        cursor: 'pointer',
      }}
      onClick={onToggleExpand}
      onKeyDown={handleKeyDown}
    >
      <CardContent sx={{ flex: 1, pb: isExpanded ? 2 : 1 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
          <Avatar
            sx={{
              bgcolor: `${card.color}20`,
              color: card.color,
              mr: 2,
              width: 32,
              height: 32,
            }}
          >
            {card.icon}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 600 }}>
                {card.name}
              </Typography>
              <Chip
                label={getIntegrationTypeLabel(card.integrationType)}
                size="small"
                sx={{
                  height: '18px',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  bgcolor: `${card.color}15`,
                  color: card.color,
                  border: `1px solid ${card.color}40`,
                }}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {getStatusIcon(card.status)}
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                {getStatusLabel(card.status)}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {card.status === 'connected' && card.instanceData && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onSettings();
                }}
                aria-label={`Configure ${card.name}`}
                sx={{
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                <Settings fontSize="small" />
              </IconButton>
            )}
            <IconButton
              size="small"
              onClick={(e) => e.stopPropagation()}
              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
            >
              {isExpanded ? <KeyboardArrowUp fontSize="small" /> : <KeyboardArrowDown fontSize="small" />}
            </IconButton>
          </Box>
        </Box>

        {/* Content */}
        {!isExpanded ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontSize: '0.875rem' }}>
              {card.tldr}
            </Typography>
            <Typography variant="caption" color="primary.main" sx={{
              fontStyle: 'italic',
              fontSize: '0.75rem',
              display: 'block',
              mt: 1,
            }}>
              Click to see details
            </Typography>
          </Box>
        ) : (
          <Box>
            {/* Grafana expanded content */}
            {isGrafanaInstance && (
              <GrafanaExpandedContent
                instance={card.instanceData as GrafanaInstance}
                onError={(message) => onSnackbar(message, 'error')}
                onSuccess={(message) => onSnackbar(message, 'success')}
              />
            )}

            {/* Dynatrace expanded content */}
            {isDynatraceInstance && (
              <DynatraceExpandedContent config={card.instanceData as DynatraceConfig} />
            )}

            {/* Pyroscope expanded content */}
            {isPyroscopeInstance && (
              <PyroscopeExpandedContent instance={card.instanceData as PyroscopeInstance} />
            )}

            {/* Tracing expanded content */}
            {isTracingInstance && (
              <TracingExpandedContent instance={card.instanceData as TracingInstance} />
            )}

            {/* Placeholder content */}
            {!card.instanceData && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {card.integrationType === 'pyroscope' &&
                    'Continuous profiling platform for CPU and memory profiling with flame graph visualization.'
                  }
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </CardContent>

      {/* Actions */}
      {isExpanded && (
        <>
          <Divider />
          <CardActions sx={{ px: 2, py: 1.5 }} onClick={(e) => e.stopPropagation()}>
            {card.status === 'connected' && card.instanceData ? (
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                gap: 1,
              }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Settings />}
                  onClick={onSettings}
                >
                  Configure
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<Delete />}
                  onClick={onDelete}
                >
                  Delete
                </Button>
              </Box>
            ) : card.status === 'connected' ? (
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
              }}>
                <FormControlLabel
                  control={<Switch defaultChecked size="small" />}
                  label="Enabled"
                  sx={{ m: 0 }}
                />
                <Button size="small" variant="outlined">
                  Configure
                </Button>
              </Box>
            ) : (
              <Button
                size="small"
                variant="contained"
                fullWidth
                startIcon={<Settings />}
                onClick={onConnect}
              >
                Connect
              </Button>
            )}
          </CardActions>
        </>
      )}
    </Card>
  );
}
