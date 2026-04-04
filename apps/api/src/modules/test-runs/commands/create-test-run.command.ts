/**
 * Command for creating a new test run
 *
 * This command encapsulates all data needed to create a test run.
 * The handler is responsible for executing the creation logic.
 */

import { ICommand, MutationCommandType, MutationOptions } from './types';
import { TestRunVariables } from '../../../types';

/**
 * Data payload for creating a test run
 */
export interface CreateTestRunData {
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
  /** Ramp-up duration in seconds */
  rampUp?: number;
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
  /** Test start time */
  startTime?: Date;
  /** Test end time */
  endTime?: Date;
  /** Organization ID (from API key or user context) */
  organizationId?: string;
  /** Team ID */
  teamId?: string;
  /** User ID who created the test run (e.g., 'api-key:xxx' or Keycloak sub) */
  createdBy?: string;
  /** User ID who last updated the test run */
  updatedBy?: string;
  /** ADAPT mode: DEFAULT (regression) or SCALING (sizing test) */
  adaptMode?: string;
  /** Baseline test run ID for SCALING mode comparison */
  baselineTestRunId?: string;
  /** Scaling session UUID */
  scalingSessionId?: string;
}

/**
 * Command for creating a new test run
 *
 * Commands are immutable data objects that describe what action to perform.
 * The actual business logic is executed by the corresponding handler.
 */
export class CreateTestRunCommand implements ICommand {
  readonly type = MutationCommandType.CREATE_TEST_RUN;

  constructor(
    /** Data for creating the test run */
    public readonly data: CreateTestRunData,
    /** Optional mutation options */
    public readonly options?: MutationOptions,
  ) {}

  /**
   * Factory method to create command from UpdateRunningTestDto-like input
   */
  static fromUpdateDto(params: {
    testRunId: string;
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    applicationRelease?: string;
    duration: number;
    plannedDuration: number;
    rampUp?: number;
    completed: boolean;
    ciBuildResultsUrl?: string;
    annotations?: string[];
    tags?: string[];
    abort?: boolean;
    variables?: TestRunVariables;
    startTime?: Date;
    endTime?: Date;
    organizationId?: string;
    teamId?: string;
    createdBy?: string;
    updatedBy?: string;
    adaptMode?: string;
    baselineTestRunId?: string;
    scalingSessionId?: string;
  }, options?: MutationOptions): CreateTestRunCommand {
    return new CreateTestRunCommand(
      {
        testRunId: params.testRunId,
        systemUnderTestId: params.systemUnderTestId,
        testEnvironment: params.testEnvironment,
        workload: params.workload,
        applicationRelease: params.applicationRelease,
        duration: params.duration,
        plannedDuration: params.plannedDuration,
        rampUp: params.rampUp,
        completed: params.completed,
        ciBuildResultsUrl: params.ciBuildResultsUrl,
        annotations: params.annotations,
        tags: params.tags,
        abort: params.abort,
        variables: params.variables,
        startTime: params.startTime,
        endTime: params.endTime,
        organizationId: params.organizationId,
        teamId: params.teamId,
        createdBy: params.createdBy,
        updatedBy: params.updatedBy,
        adaptMode: params.adaptMode,
        baselineTestRunId: params.baselineTestRunId,
        scalingSessionId: params.scalingSessionId,
      },
      options,
    );
  }
}
