/**
 * Command for updating an existing test run
 *
 * This command encapsulates all data needed to update a test run.
 * The handler is responsible for executing the update logic.
 */

import { ICommand, MutationCommandType, MutationOptions } from './types';
import { TestRunVariables } from '../../../types';

/**
 * Data payload for updating a test run
 */
export interface UpdateTestRunData {
  /** Unique test run identifier (e.g., 'PaymentService-prod-loadTest-00001') */
  testRunId: string;
  /** UUID of the system under test */
  systemUnderTestId: string;
  /** Test environment name */
  testEnvironment: string;
  /** Workload name */
  workload: string;
  /** Application version/release */
  applicationRelease?: string;
  /** Calculated test duration in seconds */
  duration: number;
  /** Planned test duration in seconds */
  plannedDuration: number;
  /** Analysis start offset in seconds (initial period excluded from analysis) */
  analysisStartOffset?: number;
  /** Analysis end offset in seconds (tail period excluded from analysis) */
  analysisEndOffset?: number;
  /** Whether the test is completed */
  completed: boolean;
  /** CI build results URL */
  ciBuildResultsUrl?: string;
  /** Test annotations */
  annotations?: string[];
  /** Test tags */
  tags?: string[];
  /** Whether the test was aborted */
  abort?: boolean;
  /** Test variables */
  variables?: TestRunVariables;
  /** Test end time */
  endTime?: Date;
  /** User ID who last updated the test run */
  updatedBy?: string;
}

/**
 * Command for updating an existing test run
 *
 * Commands are immutable data objects that describe what action to perform.
 * The actual business logic is executed by the corresponding handler.
 */
export class UpdateTestRunCommand implements ICommand {
  readonly type = MutationCommandType.UPDATE_TEST_RUN;

  constructor(
    /** Data for updating the test run */
    public readonly data: UpdateTestRunData,
    /** Optional mutation options */
    public readonly options?: MutationOptions,
  ) {}

  /**
   * Factory method to create command from update parameters
   */
  static fromParams(params: {
    testRunId: string;
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    applicationRelease?: string;
    duration: number;
    plannedDuration: number;
    analysisStartOffset?: number;
    analysisEndOffset?: number;
    completed: boolean;
    ciBuildResultsUrl?: string;
    annotations?: string[];
    tags?: string[];
    abort?: boolean;
    variables?: TestRunVariables;
    endTime?: Date;
    updatedBy?: string;
  }, options?: MutationOptions): UpdateTestRunCommand {
    return new UpdateTestRunCommand(
      {
        testRunId: params.testRunId,
        systemUnderTestId: params.systemUnderTestId,
        testEnvironment: params.testEnvironment,
        workload: params.workload,
        applicationRelease: params.applicationRelease,
        duration: params.duration,
        plannedDuration: params.plannedDuration,
        analysisStartOffset: params.analysisStartOffset,
        analysisEndOffset: params.analysisEndOffset,
        completed: params.completed,
        ciBuildResultsUrl: params.ciBuildResultsUrl,
        annotations: params.annotations,
        tags: params.tags,
        abort: params.abort,
        variables: params.variables,
        endTime: params.endTime,
        updatedBy: params.updatedBy,
      },
      options,
    );
  }
}
