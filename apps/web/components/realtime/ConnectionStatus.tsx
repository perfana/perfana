/**
 * WebSocket Connection Status Indicator
 *
 * Displays the real-time connection status with:
 * - Color-coded status indicator
 * - Hover tooltip with connection details
 * - Animated transitions
 * - Manual reconnect button
 */

'use client';

import { useEffect, useState } from 'react';
import {
  Box,
  Chip,
  Tooltip,
  Typography,
  IconButton,
  Paper,
  Fade,
} from '@mui/material';
import {
  WifiOff,
  Wifi,
  SyncProblem,
  Refresh,
} from '@mui/icons-material';
import { socketManager, ConnectionState } from '@/lib/socket';

/**
 * Connection status props
 */
interface ConnectionStatusProps {
  /**
   * Display variant: 'chip' | 'icon' | 'full'
   */
  variant?: 'chip' | 'icon' | 'full';

  /**
   * Position for floating indicator
   */
  position?: 'fixed' | 'static';

  /**
   * Show reconnect button
   */
  showReconnect?: boolean;
}

/**
 * Get status color based on connection state
 */
function getStatusColor(state: ConnectionState): 'success' | 'warning' | 'error' | 'default' {
  switch (state) {
    case 'connected':
      return 'success';
    case 'connecting':
      return 'warning';
    case 'error':
      return 'error';
    case 'disconnected':
    default:
      return 'default';
  }
}

/**
 * Get status icon based on connection state
 */
function getStatusIcon(state: ConnectionState): React.ReactElement {
  switch (state) {
    case 'connected':
      return <Wifi fontSize="small" />;
    case 'connecting':
      return <Refresh fontSize="small" sx={{ animation: 'spin 1s linear infinite' }} />;
    case 'error':
      return <SyncProblem fontSize="small" />;
    case 'disconnected':
    default:
      return <WifiOff fontSize="small" />;
  }
}

/**
 * Get status label based on connection state
 */
function getStatusLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Live';
    case 'connecting':
      return 'Connecting';
    case 'error':
      return 'Connection Error';
    case 'disconnected':
    default:
      return 'Offline';
  }
}

/**
 * Connection status indicator component
 */
export function ConnectionStatus({
  variant = 'chip',
  position = 'static',
  showReconnect = true,
}: ConnectionStatusProps): React.ReactElement {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [socketId, setSocketId] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    // Subscribe to connection state changes
    const unsubscribe = socketManager.onConnectionStateChange((state) => {
      setConnectionState(state);
    });

    // Get initial connection state
    setConnectionState(socketManager.getConnectionState());

    // Request connection info if connected
    if (socketManager.isConnected()) {
      socketManager.getConnectionInfo();
    }

    // Listen for connection info
    const unsubscribeInfo = socketManager.on('connection_info', (info: { socketId: string; authenticated: boolean }) => {
      setSocketId(info.socketId);
      setAuthenticated(info.authenticated);
    });

    // Listen for connection established
    const unsubscribeEstablished = socketManager.on('connection_established', (payload: { socketId: string; authenticated: boolean }) => {
      setSocketId(payload.socketId);
      setAuthenticated(payload.authenticated);
    });

    return () => {
      unsubscribe();
      unsubscribeInfo();
      unsubscribeEstablished();
    };
  }, []);

  /**
   * Handle manual reconnect
   */
  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await socketManager.connect();
    } catch (error) {
      console.error('[ConnectionStatus] Reconnect failed:', error);
    } finally {
      setReconnecting(false);
    }
  };

  /**
   * Render tooltip content
   */
  const tooltipContent = (
    <Box sx={{ p: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
        Real-Time Connection
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
          Status: <strong>{getStatusLabel(connectionState)}</strong>
        </Typography>
        {socketId && (
          <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
            Socket ID: <strong>{socketId.substring(0, 8)}...</strong>
          </Typography>
        )}
        <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
          Auth: <strong>{authenticated ? 'Yes' : 'No'}</strong>
        </Typography>
      </Box>
    </Box>
  );

  // Chip variant
  if (variant === 'chip') {
    return (
      <Tooltip
        title={tooltipContent}
        arrow
        placement="bottom"
        sx={{
          '& .MuiTooltip-tooltip': {
            backgroundColor: 'rgba(33, 33, 33, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
            maxWidth: 280,
          },
          '& .MuiTooltip-arrow': {
            color: 'rgba(33, 33, 33, 0.95)',
          },
        }}
      >
        <Chip
          icon={getStatusIcon(connectionState)}
          label={getStatusLabel(connectionState)}
          color={getStatusColor(connectionState)}
          size="small"
          sx={{
            fontWeight: 600,
            cursor: 'help',
            transition: 'all 0.2s ease',
            animation: connectionState === 'connecting' ? 'pulse 2s ease-in-out infinite' : 'none',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.7 },
            },
            '@keyframes spin': {
              '0%': { transform: 'rotate(0deg)' },
              '100%': { transform: 'rotate(360deg)' },
            },
          }}
        />
      </Tooltip>
    );
  }

  // Icon variant
  if (variant === 'icon') {
    return (
      <Tooltip
        title={tooltipContent}
        arrow
        placement="bottom"
        sx={{
          '& .MuiTooltip-tooltip': {
            backgroundColor: 'rgba(33, 33, 33, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
            maxWidth: 280,
          },
          '& .MuiTooltip-arrow': {
            color: 'rgba(33, 33, 33, 0.95)',
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            bgcolor:
              connectionState === 'connected'
                ? 'success.main'
                : connectionState === 'connecting'
                ? 'warning.main'
                : connectionState === 'error'
                ? 'error.main'
                : 'action.disabled',
            color: 'white',
            cursor: 'help',
            transition: 'all 0.2s ease',
            animation: connectionState === 'connecting' ? 'pulse 2s ease-in-out infinite' : 'none',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.7 },
            },
            '@keyframes spin': {
              '0%': { transform: 'rotate(0deg)' },
              '100%': { transform: 'rotate(360deg)' },
            },
          }}
        >
          {getStatusIcon(connectionState)}
        </Box>
      </Tooltip>
    );
  }

  // Full variant
  return (
    <Fade in timeout={300}>
      <Paper
        elevation={4}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          ...(position === 'fixed' && {
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1000,
          }),
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: '50%',
            bgcolor:
              connectionState === 'connected'
                ? 'success.main'
                : connectionState === 'connecting'
                ? 'warning.main'
                : connectionState === 'error'
                ? 'error.main'
                : 'action.disabled',
            color: 'white',
            transition: 'all 0.2s ease',
            animation: connectionState === 'connecting' ? 'pulse 2s ease-in-out infinite' : 'none',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.7 },
            },
            '@keyframes spin': {
              '0%': { transform: 'rotate(0deg)' },
              '100%': { transform: 'rotate(360deg)' },
            },
          }}
        >
          {getStatusIcon(connectionState)}
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            {getStatusLabel(connectionState)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
            {connectionState === 'connected'
              ? 'Real-time updates active'
              : connectionState === 'connecting'
              ? 'Establishing connection...'
              : connectionState === 'error'
              ? 'Connection failed'
              : 'Not connected'}
          </Typography>
        </Box>

        {showReconnect && connectionState !== 'connected' && connectionState !== 'connecting' && (
          <IconButton
            size="small"
            onClick={handleReconnect}
            disabled={reconnecting}
            sx={{
              animation: reconnecting ? 'spin 1s linear infinite' : 'none',
              '@keyframes spin': {
                '0%': { transform: 'rotate(0deg)' },
                '100%': { transform: 'rotate(360deg)' },
              },
            }}
          >
            <Refresh fontSize="small" />
          </IconButton>
        )}
      </Paper>
    </Fade>
  );
}

export default ConnectionStatus;
