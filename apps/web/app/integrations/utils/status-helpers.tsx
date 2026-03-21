'use client';

import { CheckCircle, Warning } from '@mui/icons-material';
import { ConnectionStatus, IntegrationType } from '../types';

/**
 * Returns the status icon component for a connection status
 */
export const getStatusIcon = (status: ConnectionStatus): React.ReactNode => {
  switch (status) {
    case 'connected':
      return <CheckCircle sx={{ color: 'success.main', fontSize: 20 }} />;
    case 'disconnected':
      return <Warning sx={{ color: 'text.secondary', fontSize: 20 }} />;
  }
};

/**
 * Returns the display label for a connection status
 */
export const getStatusLabel = (status: ConnectionStatus): string => {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Not Connected';
  }
};

/**
 * Returns the display label for an integration type
 */
export const getIntegrationTypeLabel = (type: IntegrationType): string => {
  switch (type) {
    case 'grafana':
      return 'Grafana';
    case 'dynatrace':
      return 'Dynatrace';
    case 'pyroscope':
      return 'Pyroscope';
    case 'tracing':
      return 'Tracing';
  }
};
