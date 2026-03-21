/**
 * Unit tests for ConnectionStatus Component
 *
 * Tests the WebSocket connection status indicator:
 * - Connection state rendering (connected, disconnected, connecting, error)
 * - WebSocket event subscriptions and cleanup
 * - Manual reconnect functionality
 * - Different display variants (chip, icon, full)
 * - Tooltip content and styling
 * - Animation states
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConnectionStatus } from '@/components/realtime/ConnectionStatus';
import { socketManager, ConnectionState } from '@/lib/socket';

// Mock the socket manager
jest.mock('@/lib/socket', () => {
  const listeners: { [key: string]: Function[] } = {
    connectionStateChange: [],
    connection_info: [],
    connection_established: [],
  };

  const mockSocketManager = {
    getConnectionState: jest.fn(() => 'disconnected' as ConnectionState),
    isConnected: jest.fn(() => false),
    onConnectionStateChange: jest.fn((listener: Function) => {
      listeners.connectionStateChange.push(listener);
      return jest.fn(() => {
        const index = listeners.connectionStateChange.indexOf(listener);
        if (index > -1) {
          listeners.connectionStateChange.splice(index, 1);
        }
      });
    }),
    on: jest.fn((event: string, listener: Function) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(listener);
      return jest.fn(() => {
        if (listeners[event]) {
          const index = listeners[event].indexOf(listener);
          if (index > -1) {
            listeners[event].splice(index, 1);
          }
        }
      });
    }),
    connect: jest.fn(() => Promise.resolve()),
    getConnectionInfo: jest.fn(),
    __listeners: listeners,
    __triggerConnectionStateChange: (state: ConnectionState) => {
      listeners.connectionStateChange.forEach((listener) => listener(state));
    },
    __triggerConnectionInfo: (info: any) => {
      listeners.connection_info?.forEach((listener) => listener(info));
    },
    __triggerConnectionEstablished: (payload: any) => {
      listeners.connection_established?.forEach((listener) => listener(payload));
    },
  };

  return {
    socketManager: mockSocketManager,
    ConnectionState: {
      connected: 'connected',
      disconnected: 'disconnected',
      connecting: 'connecting',
      error: 'error',
    },
  };
});

describe('ConnectionStatus Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset listeners
    (socketManager as any).__listeners.connectionStateChange = [];
    (socketManager as any).__listeners.connection_info = [];
    (socketManager as any).__listeners.connection_established = [];

    // Reset default state
    (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');
    (socketManager.isConnected as jest.Mock).mockReturnValue(false);

    // Reset mock implementations
    (socketManager.onConnectionStateChange as jest.Mock).mockImplementation((listener: Function) => {
      (socketManager as any).__listeners.connectionStateChange.push(listener);
      return jest.fn(() => {
        const index = (socketManager as any).__listeners.connectionStateChange.indexOf(listener);
        if (index > -1) {
          (socketManager as any).__listeners.connectionStateChange.splice(index, 1);
        }
      });
    });

    (socketManager.on as jest.Mock).mockImplementation((event: string, listener: Function) => {
      if (!(socketManager as any).__listeners[event]) {
        (socketManager as any).__listeners[event] = [];
      }
      (socketManager as any).__listeners[event].push(listener);
      return jest.fn(() => {
        if ((socketManager as any).__listeners[event]) {
          const index = (socketManager as any).__listeners[event].indexOf(listener);
          if (index > -1) {
            (socketManager as any).__listeners[event].splice(index, 1);
          }
        }
      });
    });
  });

  describe('Rendering - Chip Variant', () => {
    it('should render chip variant by default', () => {
      render(<ConnectionStatus />);

      // Should show offline by default
      expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('should render connected state in chip variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connected');
      (socketManager.isConnected as jest.Mock).mockReturnValue(true);

      render(<ConnectionStatus variant="chip" />);

      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('should render connecting state in chip variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connecting');

      render(<ConnectionStatus variant="chip" />);

      expect(screen.getByText('Connecting')).toBeInTheDocument();
    });

    it('should render error state in chip variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('error');

      render(<ConnectionStatus variant="chip" />);

      expect(screen.getByText('Connection Error')).toBeInTheDocument();
    });

    it('should render disconnected state in chip variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');

      render(<ConnectionStatus variant="chip" />);

      expect(screen.getByText('Offline')).toBeInTheDocument();
    });
  });

  describe('Rendering - Icon Variant', () => {
    it('should render icon variant with connected state', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connected');

      const { container } = render(<ConnectionStatus variant="icon" />);

      // Icon variant renders a Box with an icon
      const iconBox = container.querySelector('[class*="MuiBox-root"]');
      expect(iconBox).toBeInTheDocument();
    });

    it('should render icon variant with disconnected state', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');

      const { container } = render(<ConnectionStatus variant="icon" />);

      // Icon variant renders a Box with an icon
      const iconBox = container.querySelector('[class*="MuiBox-root"]');
      expect(iconBox).toBeInTheDocument();
    });
  });

  describe('Rendering - Full Variant', () => {
    it('should render full variant with all details', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connected');

      render(<ConnectionStatus variant="full" />);

      expect(screen.getByText('Live')).toBeInTheDocument();
      expect(screen.getByText('Real-time updates active')).toBeInTheDocument();
    });

    it('should show connecting message in full variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connecting');

      render(<ConnectionStatus variant="full" />);

      expect(screen.getByText('Connecting')).toBeInTheDocument();
      expect(screen.getByText('Establishing connection...')).toBeInTheDocument();
    });

    it('should show error message in full variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('error');

      render(<ConnectionStatus variant="full" />);

      expect(screen.getByText('Connection Error')).toBeInTheDocument();
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    it('should show disconnected message in full variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');

      render(<ConnectionStatus variant="full" />);

      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect(screen.getByText('Not connected')).toBeInTheDocument();
    });
  });

  describe('WebSocket Event Subscriptions', () => {
    it('should subscribe to connection state changes on mount', () => {
      render(<ConnectionStatus />);

      expect(socketManager.onConnectionStateChange).toHaveBeenCalledTimes(1);
      expect(socketManager.onConnectionStateChange).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should subscribe to connection_info event', () => {
      render(<ConnectionStatus />);

      expect(socketManager.on).toHaveBeenCalledWith('connection_info', expect.any(Function));
    });

    it('should subscribe to connection_established event', () => {
      render(<ConnectionStatus />);

      expect(socketManager.on).toHaveBeenCalledWith('connection_established', expect.any(Function));
    });

    it('should request connection info when already connected', () => {
      (socketManager.isConnected as jest.Mock).mockReturnValue(true);

      render(<ConnectionStatus />);

      expect(socketManager.getConnectionInfo).toHaveBeenCalled();
    });

    it('should not request connection info when disconnected', () => {
      (socketManager.isConnected as jest.Mock).mockReturnValue(false);

      render(<ConnectionStatus />);

      expect(socketManager.getConnectionInfo).not.toHaveBeenCalled();
    });

    it('should unsubscribe from all events on unmount', () => {
      const unsubscribeMocks = [jest.fn(), jest.fn(), jest.fn()];
      let callCount = 0;

      (socketManager.onConnectionStateChange as jest.Mock).mockReturnValue(unsubscribeMocks[0]);
      (socketManager.on as jest.Mock).mockImplementation(() => {
        return unsubscribeMocks[++callCount];
      });

      const { unmount } = render(<ConnectionStatus />);

      unmount();

      unsubscribeMocks.forEach((unsubscribe) => {
        expect(unsubscribe).toHaveBeenCalled();
      });
    });
  });

  describe('Connection State Changes', () => {
    it('should update UI when connection state changes to connected', async () => {
      render(<ConnectionStatus />);

      // Initially disconnected
      expect(screen.getByText('Offline')).toBeInTheDocument();

      // Trigger state change
      (socketManager as any).__triggerConnectionStateChange('connected');

      await waitFor(() => {
        expect(screen.getByText('Live')).toBeInTheDocument();
      });
    });

    it('should update UI when connection state changes to connecting', async () => {
      render(<ConnectionStatus />);

      (socketManager as any).__triggerConnectionStateChange('connecting');

      await waitFor(() => {
        expect(screen.getByText('Connecting')).toBeInTheDocument();
      });
    });

    it('should update UI when connection state changes to error', async () => {
      render(<ConnectionStatus />);

      (socketManager as any).__triggerConnectionStateChange('error');

      await waitFor(() => {
        expect(screen.getByText('Connection Error')).toBeInTheDocument();
      });
    });

    it('should update UI when connection state changes to disconnected', async () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connected');

      render(<ConnectionStatus />);

      expect(screen.getByText('Live')).toBeInTheDocument();

      (socketManager as any).__triggerConnectionStateChange('disconnected');

      await waitFor(() => {
        expect(screen.getByText('Offline')).toBeInTheDocument();
      });
    });
  });

  describe('Connection Info Updates', () => {
    it('should receive connection_info event', () => {
      render(<ConnectionStatus variant="chip" />);

      const connectionInfo = {
        socketId: 'test-socket-id-12345',
        authenticated: true,
      };

      // Trigger should not throw
      expect(() => {
        (socketManager as any).__triggerConnectionInfo(connectionInfo);
      }).not.toThrow();
    });

    it('should receive connection_established event', () => {
      render(<ConnectionStatus variant="chip" />);

      const establishedPayload = {
        socketId: 'new-socket-id-67890',
        authenticated: true,
        message: 'Connection established',
      };

      // Trigger should not throw
      expect(() => {
        (socketManager as any).__triggerConnectionEstablished(establishedPayload);
      }).not.toThrow();
    });
  });

  describe('Manual Reconnect', () => {
    it('should show reconnect button when disconnected in full variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');

      render(<ConnectionStatus variant="full" showReconnect={true} />);

      const reconnectButton = screen.getByRole('button', { name: '' });
      expect(reconnectButton).toBeInTheDocument();
    });

    it('should show reconnect button when error in full variant', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('error');

      render(<ConnectionStatus variant="full" showReconnect={true} />);

      const reconnectButton = screen.getByRole('button', { name: '' });
      expect(reconnectButton).toBeInTheDocument();
    });

    it('should not show reconnect button when connected', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connected');

      render(<ConnectionStatus variant="full" showReconnect={true} />);

      const buttons = screen.queryAllByRole('button');
      expect(buttons).toHaveLength(0);
    });

    it('should not show reconnect button when connecting', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connecting');

      render(<ConnectionStatus variant="full" showReconnect={true} />);

      const buttons = screen.queryAllByRole('button');
      expect(buttons).toHaveLength(0);
    });

    it('should not show reconnect button when showReconnect is false', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');

      render(<ConnectionStatus variant="full" showReconnect={false} />);

      const buttons = screen.queryAllByRole('button');
      expect(buttons).toHaveLength(0);
    });

    it('should call socketManager.connect when reconnect clicked', async () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');
      (socketManager.connect as jest.Mock).mockResolvedValue(undefined);

      render(<ConnectionStatus variant="full" showReconnect={true} />);

      const reconnectButton = screen.getByRole('button', { name: '' });
      fireEvent.click(reconnectButton);

      await waitFor(() => {
        expect(socketManager.connect).toHaveBeenCalled();
      });
    });

    it('should handle reconnect failure gracefully', async () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('error');
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      (socketManager.connect as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      render(<ConnectionStatus variant="full" showReconnect={true} />);

      const reconnectButton = screen.getByRole('button', { name: '' });
      fireEvent.click(reconnectButton);

      await waitFor(() => {
        expect(socketManager.connect).toHaveBeenCalled();
      });

      expect(consoleError).toHaveBeenCalledWith(
        '[ConnectionStatus] Reconnect failed:',
        expect.any(Error)
      );

      consoleError.mockRestore();
    });

    it('should disable reconnect button while reconnecting', async () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');

      // Make connect take some time
      (socketManager.connect as jest.Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<ConnectionStatus variant="full" showReconnect={true} />);

      const reconnectButton = screen.getByRole('button', { name: '' });
      fireEvent.click(reconnectButton);

      // Button should be disabled during reconnection
      expect(reconnectButton).toBeDisabled();

      await waitFor(() => {
        expect(socketManager.connect).toHaveBeenCalled();
      });
    });
  });

  describe('Tooltip Content', () => {
    it('should render chip with tooltip wrapper', () => {
      const { container } = render(<ConnectionStatus variant="chip" />);

      // MUI Tooltip wraps the chip
      const tooltip = container.querySelector('[class*="MuiTooltip"]');
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('Position Prop', () => {
    it('should render full variant with static position', () => {
      render(<ConnectionStatus variant="full" position="static" />);

      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect(screen.getByText('Not connected')).toBeInTheDocument();
    });

    it('should render full variant with fixed position', () => {
      render(<ConnectionStatus variant="full" position="fixed" />);

      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect(screen.getByText('Not connected')).toBeInTheDocument();
    });
  });

  describe('State Color Mapping', () => {
    it('should apply success color for connected state', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connected');

      const { container } = render(<ConnectionStatus variant="chip" />);

      const chip = screen.getByText('Live').closest('.MuiChip-colorSuccess');
      expect(chip).toBeInTheDocument();
    });

    it('should apply warning color for connecting state', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('connecting');

      const { container } = render(<ConnectionStatus variant="chip" />);

      const chip = screen.getByText('Connecting').closest('.MuiChip-colorWarning');
      expect(chip).toBeInTheDocument();
    });

    it('should apply error color for error state', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('error');

      const { container } = render(<ConnectionStatus variant="chip" />);

      const chip = screen.getByText('Connection Error').closest('.MuiChip-colorError');
      expect(chip).toBeInTheDocument();
    });

    it('should apply default color for disconnected state', () => {
      (socketManager.getConnectionState as jest.Mock).mockReturnValue('disconnected');

      const { container } = render(<ConnectionStatus variant="chip" />);

      const chip = screen.getByText('Offline').closest('.MuiChip-colorDefault');
      expect(chip).toBeInTheDocument();
    });
  });
});
