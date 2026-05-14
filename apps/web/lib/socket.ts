/**
 * WebSocket Connection Manager for Real-Time Updates
 *
 * Manages Socket.IO client connection to backend WebSocket server with:
 * - Keycloak JWT authentication
 * - Automatic reconnection with exponential backoff
 * - Connection state management
 * - Error handling and recovery
 */

import { io, Socket } from 'socket.io-client';
import keycloakAuth from './keycloak-auth';
import { env } from './env';
import {
  ConnectionState,
  WebSocketError,
  ConnectionEstablishedPayload,
  AuthErrorPayload,
  TestRunsInitialPayload,
  TestRunInitialPayload,
  TestRunEventPayload,
  TestRunDeletedPayload,
  SubscriptionConfirmedPayload,
  SubscriptionErrorPayload,
  PongPayload,
  ConnectionInfoPayload,
  TestRunFilters,
} from '@/types/realtime';

/**
 * Event listeners map type
 */
type EventListeners = {
  connectionStateChange: ((state: ConnectionState) => void)[];
  error: ((error: WebSocketError) => void)[];
  [key: string]: ((...args: unknown[]) => void)[];
};

/**
 * WebSocket connection manager singleton class
 */
class SocketManager {
  private socket: Socket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private listeners: EventListeners = {
    connectionStateChange: [],
    error: [],
  };
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private reconnectTimer: NodeJS.Timeout | null = null;

  /**
   * Get the WebSocket URL from API URL
   * Converts HTTP URL to WS URL automatically
   */
  private getWebSocketUrl(): string {
    const apiUrl = env.API_URL || 'http://localhost:3001/api';

    // Remove /api suffix if present
    const baseUrl = apiUrl.replace(/\/api\/?$/, '');

    // Convert http:// to ws:// and https:// to wss://
    const wsUrl = baseUrl.replace(/^http/, 'ws');

    return wsUrl;
  }

  /**
   * Connect to WebSocket server with authentication
   */
  async connect(): Promise<void> {
    // Skip WebSocket connection if Keycloak is disabled
    if (!env.USE_KEYCLOAK_AUTH) {
      // console.log('[Socket] Keycloak authentication is disabled, skipping WebSocket connection');
      this.setConnectionState('disconnected');
      return;
    }

    if (this.socket?.connected) {
      // console.log('[Socket] Already connected');
      return;
    }

    if (this.connectionState === 'connecting') {
      // console.log('[Socket] Connection already in progress');
      return;
    }

    try {
      this.setConnectionState('connecting');

      // Get fresh token
      const token = keycloakAuth.getToken();

      if (!token) {
        throw new Error('No authentication token available');
      }

      const wsUrl = this.getWebSocketUrl();
      // console.log('[Socket] Connecting to:', wsUrl + '/test-runs');

      // Create socket connection
      this.socket = io(wsUrl + '/test-runs', {
        auth: {
          token,
        },
        transports: ['websocket', 'polling'], // Try websocket first, fallback to polling
        reconnection: false, // Handle reconnection manually
        timeout: 10000,
      });

      this.setupSocketListeners();

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        // Listen for Socket.IO native 'connect' event first
        this.socket!.once('connect', () => {
          // console.log('[Socket] Transport connected, waiting for auth...');
        });

        // Then listen for backend's custom 'connected' event (after auth)
        this.socket!.once('connected', (_payload) => {
          // console.log('[Socket] Authenticated and ready:', payload);
          clearTimeout(timeout);
          resolve();
        });

        this.socket!.once('connect_error', (error) => {
          // console.error('[Socket] Connect error:', error);
          clearTimeout(timeout);
          reject(error);
        });

        this.socket!.once('auth_error', (payload: AuthErrorPayload) => {
          // console.error('[Socket] Auth error:', payload);
          clearTimeout(timeout);
          reject(new Error(payload.message));
        });

        // Also handle disconnect during connection attempt
        this.socket!.once('disconnect', (reason) => {
          // console.log('[Socket] Disconnected during connection attempt:', reason);
          clearTimeout(timeout);
          reject(new Error(`Disconnected: ${reason}`));
        });
      });

      this.setConnectionState('connected');
      this.reconnectAttempts = 0;
      // console.log('[Socket] Connected successfully');
    } catch (error) {
      // console.error('[Socket] Connection failed:', error);
      this.setConnectionState('error');
      this.emitError({
        message: error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Connection failed',
        timestamp: new Date(),
      });

      // Schedule reconnection
      this.scheduleReconnect();

      throw error;
    }
  }

  /**
   * Setup socket event listeners
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    // Connection events (backend emits 'connected')
    this.socket.on('connected', (_payload: ConnectionEstablishedPayload) => {
      // console.log('[Socket] Connection established:', payload);
    });

    this.socket.on('connect_error', (_error) => {
      // console.error('[Socket] Connection error:', error);
      this.setConnectionState('error');
      this.scheduleReconnect();
    });

    this.socket.on('disconnect', (reason) => {
      // console.log('[Socket] Disconnected:', reason);
      this.setConnectionState('disconnected');

      // Reconnect unless it was a manual disconnect
      if (reason !== 'io client disconnect') {
        this.scheduleReconnect();
      }
    });

    this.socket.on('auth_error', (payload: AuthErrorPayload) => {
      // console.error('[Socket] Authentication error:', payload);
      this.emitError({
        message: payload.message,
        code: 'AUTH_ERROR',
        timestamp: new Date(),
      });

      // Redirect to login
      keycloakAuth.login();
    });

    // Error handling
    this.socket.on('error', (error) => {
      // console.error('[Socket] Socket error:', error);
      this.emitError({
        message: error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Socket error',
        timestamp: new Date(),
      });
    });

    this.socket.on('subscription_error', (payload: SubscriptionErrorPayload) => {
      // console.error('[Socket] Subscription error:', payload);
      this.emitError({
        message: payload.message,
        code: 'SUBSCRIPTION_ERROR',
        timestamp: new Date(),
      });
    });

    // Debug: Log all incoming events
    // this.socket.onAny((eventName, ...args) => {
    //   console.log(`[Socket] Received any event: ${eventName}`, args);
    // });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // console.log('[Socket] Max reconnection attempts reached');
      this.emitError({
        message: 'Failed to reconnect after maximum attempts',
        code: 'MAX_RECONNECT_ATTEMPTS',
        timestamp: new Date(),
      });
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    // console.log(`[Socket] Scheduling reconnection attempt ${this.reconnectAttempts + 1} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch((_error) => {
        // console.error('[Socket] Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.setConnectionState('disconnected');
    // console.log('[Socket] Disconnected');
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if socket is connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.socket?.connected === true;
  }

  /**
   * Set connection state and notify listeners
   */
  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;

    this.connectionState = state;
    this.listeners.connectionStateChange.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        // console.error('[Socket] Error in connection state listener:', error);
      }
    });
  }

  /**
   * Emit error to listeners
   */
  private emitError(error: WebSocketError): void {
    this.listeners.error.forEach(listener => {
      try {
        listener(error);
      } catch (err) {
        // console.error('[Socket] Error in error listener:', err);
      }
    });
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionStateChange(listener: (state: ConnectionState) => void): () => void {
    this.listeners.connectionStateChange.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.connectionStateChange.indexOf(listener);
      if (index > -1) {
        this.listeners.connectionStateChange.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to errors
   */
  onError(listener: (error: WebSocketError) => void): () => void {
    this.listeners.error.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.error.indexOf(listener);
      if (index > -1) {
        this.listeners.error.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to a specific event
   */
  on<T = unknown>(event: string, listener: (data: T) => void): () => void {
    if (!this.socket) {
      // console.warn(`[Socket] Cannot subscribe to ${event}: not connected`);
      return () => {};
    }

    // console.log(`[Socket] Subscribing to event: ${event}`);

    // Wrap listener to add logging
    const wrappedListener = (data: T) => {
      // console.log(`[Socket] Received event: ${event}`, data);
      listener(data);
    };

    this.socket.on(event, wrappedListener);

    // Return unsubscribe function
    return () => {
      if (this.socket) {
        // console.log(`[Socket] Unsubscribing from event: ${event}`);
        this.socket.off(event, wrappedListener);
      }
    };
  }

  /**
   * Emit an event to the server
   */
  emit(event: string, data?: unknown): void {
    if (!this.socket || !this.isConnected()) {
      // console.warn(`[Socket] Cannot emit ${event}: not connected`);
      return;
    }

    this.socket.emit(event, data);
  }

  /**
   * Subscribe to test runs list with optional filters
   */
  subscribeTestRuns(filters?: TestRunFilters): void {
    // console.log('[Socket] Subscribing to test runs with filters:', filters);
    this.emit('subscribe_test_runs', { filters });
  }

  /**
   * Unsubscribe from test runs list
   */
  unsubscribeTestRuns(filters?: TestRunFilters): void {
    this.emit('unsubscribe_test_runs', { filters });
  }

  /**
   * Subscribe to specific test run updates
   */
  subscribeTestRun(testRunId: string): void {
    this.emit('subscribe_test_run', { testRunId });
  }

  /**
   * Unsubscribe from specific test run updates
   */
  unsubscribeTestRun(testRunId: string): void {
    this.emit('unsubscribe_test_run', { testRunId });
  }

  /**
   * Send ping to server
   */
  ping(): void {
    this.emit('ping');
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): void {
    this.emit('get_connection_info');
  }
}

// Export singleton instance
export const socketManager = new SocketManager();

// Export types
export type {
  ConnectionState,
  WebSocketError,
  ConnectionEstablishedPayload,
  AuthErrorPayload,
  TestRunsInitialPayload,
  TestRunInitialPayload,
  TestRunEventPayload,
  TestRunDeletedPayload,
  SubscriptionConfirmedPayload,
  SubscriptionErrorPayload,
  PongPayload,
  ConnectionInfoPayload,
  TestRunFilters,
};
