import { TestRun } from '../test-runs.service';

/**
 * Enum for test run event types
 * These events are emitted via WebSocket to connected clients
 */
export enum TestRunEventType {
  CREATED = 'test-run:created',
  UPDATED = 'test-run:updated',
  DELETED = 'test-run:deleted',
  STATUS_CHANGED = 'test-run:status-changed',
}

/**
 * Base event payload structure
 */
export interface TestRunEventPayload {
  eventType: TestRunEventType;
  timestamp: string;
  testRun: TestRun;
  userId?: string;
  organizationId?: string;
  teamId?: string;
}

/**
 * Created event payload
 */
export interface TestRunCreatedEvent extends TestRunEventPayload {
  eventType: TestRunEventType.CREATED;
}

/**
 * Updated event payload
 */
export interface TestRunUpdatedEvent extends TestRunEventPayload {
  eventType: TestRunEventType.UPDATED;
  changes?: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
}

/**
 * Deleted event payload
 */
export interface TestRunDeletedEvent {
  eventType: TestRunEventType.DELETED;
  timestamp: string;
  testRunId: string;
  id: string;
  userId?: string;
  organizationId?: string;
  teamId?: string;
}

/**
 * Status changed event payload
 */
export interface TestRunStatusChangedEvent extends TestRunEventPayload {
  eventType: TestRunEventType.STATUS_CHANGED;
  oldStatus?: string;
  newStatus: string;
}

/**
 * Union type for all event payloads
 */
export type TestRunEvent =
  | TestRunCreatedEvent
  | TestRunUpdatedEvent
  | TestRunDeletedEvent
  | TestRunStatusChangedEvent;

/**
 * Room naming conventions for Socket.IO
 * Users are automatically joined to their appropriate rooms on connection
 */
export class TestRunRooms {
  /**
   * User-specific room - receives events for test runs created/updated by this user
   */
  static user(userId: string): string {
    return `user:${userId}`;
  }

  /**
   * Organization-specific room - receives events for all test runs in this organization
   */
  static organization(organizationId: string): string {
    return `org:${organizationId}`;
  }

  /**
   * Team-specific room - receives events for test runs visible to this team
   */
  static team(teamId: string): string {
    return `team:${teamId}`;
  }

  /**
   * Test run-specific room - receives events for a specific test run
   * Clients can subscribe to this room to get detailed updates for a specific test run
   */
  static testRun(testRunId: string): string {
    return `test-run:${testRunId}`;
  }

  /**
   * Global room - receives all test run events
   * Used for admin dashboards or monitoring
   */
  static global(): string {
    return 'global';
  }
}
