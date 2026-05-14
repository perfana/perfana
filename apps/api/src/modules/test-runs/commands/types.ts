/**
 * Base types for Command Pattern implementation
 *
 * The Command Pattern separates mutation operations into:
 * - Commands: Simple data holders (DTOs) representing the intent
 * - Handlers: Business logic that executes the command
 *
 * This improves testability, maintainability, and follows SRP.
 */

import { TestRun } from '../services/test-runs-mutation.service';

/**
 * Base interface for all commands
 * Commands are immutable data objects that describe what action to perform
 */
export interface ICommand {
  readonly type: string;
}

/**
 * Context passed to command handlers
 * Contains information about who is executing the command
 */
export interface CommandContext {
  /** User ID of the requester (if authenticated via JWT) */
  userId?: string;
  /** Organization ID of the requester */
  organizationId?: string;
  /** Team ID of the requester */
  teamId?: string;
  /** Timestamp when the command was issued */
  timestamp: Date;
}

/**
 * Result wrapper for command execution
 */
export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Base interface for command handlers
 * Each handler is responsible for executing a specific command type
 */
export interface ICommandHandler<TCommand extends ICommand, TResult = void> {
  execute(command: TCommand, context?: CommandContext): Promise<TResult>;
}

/**
 * Types of mutation operations for test runs
 */
export enum MutationCommandType {
  CREATE_TEST_RUN = 'CREATE_TEST_RUN',
  UPDATE_TEST_RUN = 'UPDATE_TEST_RUN',
  DELETE_TEST_RUN = 'DELETE_TEST_RUN',
}

/**
 * Standard result for test run mutations
 */
export interface TestRunMutationResult extends CommandResult<TestRun> {
  /** The affected test run ID */
  testRunId?: string;
  /** Whether the test run was newly created */
  isNew?: boolean;
}

/**
 * Options for controlling mutation behavior
 */
export interface MutationOptions {
  /** Skip WebSocket event emission */
  skipEvents?: boolean;
  /** Skip triggering downstream analysis jobs */
  skipAnalysis?: boolean;
  /** Run within an existing transaction */
  transaction?: boolean;
}
