/**
 * Command for deleting a test run
 *
 * This command encapsulates all data needed to delete a test run.
 * The handler is responsible for executing the deletion logic.
 */

import { ICommand, MutationCommandType, MutationOptions } from './types';

/**
 * Data payload for deleting a test run
 */
export interface DeleteTestRunData {
  /** UUID of the test run to delete */
  id: string;
}

/**
 * Command for deleting a test run
 *
 * Commands are immutable data objects that describe what action to perform.
 * The actual business logic is executed by the corresponding handler.
 */
export class DeleteTestRunCommand implements ICommand {
  readonly type = MutationCommandType.DELETE_TEST_RUN;

  constructor(
    /** Data for deleting the test run */
    public readonly data: DeleteTestRunData,
    /** Optional mutation options */
    public readonly options?: MutationOptions,
  ) {}

  /**
   * Factory method to create command from id parameter
   */
  static fromId(id: string, options?: MutationOptions): DeleteTestRunCommand {
    return new DeleteTestRunCommand(
      { id },
      options,
    );
  }
}
