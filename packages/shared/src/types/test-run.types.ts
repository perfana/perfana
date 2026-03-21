/**
 * Type definitions for TestRun domain
 *
 * These types provide proper TypeScript typing for TestRun-related structures,
 * replacing the use of `any` types throughout the codebase.
 */

import type { JobType } from './job-progress.types.js';

/**
 * Active job information stored in test run status
 */
export interface ActiveJobInfo {
  /** BullMQ job ID */
  jobId: string;
  /** Type of job */
  jobType: JobType;
  /** Current stage name */
  stage: string;
  /** Human-readable stage name */
  stageName: string;
  /** Current stage index (1-based) */
  stageIndex: number;
  /** Total stages in pipeline */
  totalStages: number;
  /** Progress within current stage (0-100) */
  stageProgress: number;
  /** Overall progress (0-100) */
  overallProgress: number;
  /** ISO timestamp when job started */
  startedAt: string;
  /** ISO timestamp of last progress update */
  lastProgressAt: string;
}

/**
 * Status information for a test run
 * Tracks the evaluation state of ADAPT analysis and active job progress
 */
export interface TestRunStatus {
  /**
   * ADAPT evaluation status
   * - NO_BASELINES_FOUND: No baseline test runs available for comparison
   * - EVALUATING: Currently running ADAPT analysis
   * - COMPLETE: ADAPT analysis completed successfully
   * - FAILED: ADAPT analysis failed
   */
  evaluatingAdapt?: 'NO_BASELINES_FOUND' | 'EVALUATING' | 'COMPLETED' | 'FAILED';

  /**
   * Checks evaluation status
   * - IN_PROGRESS: Checks are being evaluated
   * - COMPLETED: Checks evaluation completed
   * - FAILED: Checks evaluation failed
   */
  evaluatingChecks?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

  /**
   * Active job information
   * Present when a job is currently running for this test run's scope
   * Null when no job is active
   */
  activeJob?: ActiveJobInfo | null;
}

/**
 * Consolidated result information for a test run
 * Aggregates results from requirements checks and ADAPT analysis
 */
export interface ConsolidatedResult {
  /**
   * Whether all requirements are met
   */
  meetsRequirement?: boolean;

  /**
   * Whether ADAPT analysis passed
   */
  adaptTestRunOK?: boolean;

  /**
   * Whether all individual requirements passed
   */
  requirementsOK?: boolean;

  /**
   * Overall result - true when BOTH meetsRequirement AND adaptTestRunOK are true
   */
  overall?: boolean;
}

/**
 * ADAPT configuration for a test run
 * Controls how performance differences are evaluated and accepted
 */
export interface AdaptConfig {
  /**
   * ADAPT evaluation mode
   * - DEFAULT: Standard ADAPT analysis
   */
  mode?: 'DEFAULT' | string;

  /**
   * Status of difference acceptance
   * - TBD: Not yet decided
   * - ACCEPTED: Performance differences accepted
   * - DENIED: Performance differences rejected
   */
  differencesAccepted?: 'TBD' | 'ACCEPTED' | 'DENIED';
}

/**
 * Test run variable
 * Individual variable with placeholder and value
 */
export interface TestRunVariable {
  /**
   * Variable placeholder/key
   */
  placeholder: string;

  /**
   * Variable value
   */
  value: string;
}

/**
 * Test run variables
 * Array of test configuration variables
 */
export type TestRunVariables = TestRunVariable[];

/**
 * Deep link information (data structure)
 * Provides quick access links to related resources (Grafana, CI/CD, etc.)
 * Note: This is different from the DeepLink entity (database representation)
 */
export interface TestRunDeepLink {
  /**
   * Display name for the link
   */
  name: string;

  /**
   * Target URL
   */
  url: string;

  /**
   * Optional tags for categorization
   */
  tags?: string[];
}

/**
 * Collection of deep links for a test run
 */
export type DeepLinksCollection = TestRunDeepLink[] | Record<string, TestRunDeepLink>;
