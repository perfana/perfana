/**
 * Type definitions for WebSocket real-time events
 * Aligned with backend Socket.IO implementation
 */

import { TestRun } from './test-runs';

/**
 * Connection established event payload
 */
export interface ConnectionEstablishedPayload {
  socketId: string;
  timestamp: Date;
  authenticated: boolean;
}

/**
 * Authentication error payload
 */
export interface AuthErrorPayload {
  message: string;
}

/**
 * Test runs initial data payload
 */
export interface TestRunsInitialPayload {
  data: TestRun[];
  room: string;
  timestamp: Date;
}

/**
 * Test run initial data payload
 */
export interface TestRunInitialPayload {
  data: TestRun;
  room: string;
  timestamp: Date;
}

/**
 * Test run created event payload (from TestRunsGateway)
 */
export interface TestRunCreatedPayload {
  eventType: 'test-run:created';
  timestamp: string;
  testRun: TestRun;
  userId?: string;
  organizationId?: string;
  teamId?: string;
}

/**
 * Test run updated event payload (from TestRunsGateway)
 */
export interface TestRunUpdatedPayload {
  eventType: 'test-run:updated';
  timestamp: string;
  testRun: TestRun;
  userId?: string;
  organizationId?: string;
  teamId?: string;
}

/**
 * Test run deleted event payload (from TestRunsGateway)
 */
export interface TestRunDeletedPayload {
  eventType: 'test-run:deleted';
  timestamp: string;
  testRunId: string;
  id: string;
  userId?: string;
  organizationId?: string;
  teamId?: string;
}

/**
 * Union type for all test run events
 */
export type TestRunEventPayload = TestRunCreatedPayload | TestRunUpdatedPayload | TestRunDeletedPayload;

/**
 * Subscription confirmed payload
 */
export interface SubscriptionConfirmedPayload {
  room: string;
  filters?: Record<string, unknown>;
  testRunId?: string;
  timestamp: Date;
}

/**
 * Subscription error payload
 */
export interface SubscriptionErrorPayload {
  message: string;
  error?: string;
}

/**
 * Pong response payload
 */
export interface PongPayload {
  timestamp: Date;
  socketId: string;
}

/**
 * Connection info payload
 */
export interface ConnectionInfoPayload {
  socketId: string;
  authenticated: boolean;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  } | null;
  rooms: string[];
  timestamp: Date;
}

/**
 * Filters for subscribing to test runs
 */
export interface TestRunFilters {
  testEnvironment?: string;
  workload?: string;
  systemUnderTestId?: string;
  completed?: boolean;
  [key: string]: unknown;
}

/**
 * WebSocket connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * WebSocket error details
 */
export interface WebSocketError {
  message: string;
  code?: string;
  timestamp: Date;
}
