/**
 * Job validation utilities using Zod schemas
 * Provides centralized validation for all job types
 */

import { z } from 'zod';
import {
  AnalyzeTestJobSchema,
  BatchProcessingJobSchema as _BatchProcessingJobSchema,
  ReevaluateJobSchema,
  MetricsCollectionJobSchema,
  StatisticsJobSchema,
  ControlGroupsJobSchema,
  AdaptJobSchema,
  ChecksJobSchema,
  BatchAnalysisJobSchema,
  BatchFlowJobSchema,
  ReevaluationBatchJobSchema,
  JOB_NAMES,
  type JobName
} from '../../types/jobs.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('job-validator');

// Map job names to their corresponding schemas
const JOB_SCHEMAS = {
  [JOB_NAMES.ANALYZE_TEST]: AnalyzeTestJobSchema,
  [JOB_NAMES.METRICS_COLLECTION]: MetricsCollectionJobSchema,
  [JOB_NAMES.STATISTICS_PIPELINE]: StatisticsJobSchema,
  [JOB_NAMES.CONTROL_GROUPS_PIPELINE]: ControlGroupsJobSchema,
  [JOB_NAMES.ADAPT_PIPELINE]: AdaptJobSchema,
  [JOB_NAMES.CHECKS_EVALUATION]: ChecksJobSchema,
  [JOB_NAMES.PANELS_PROCESSING]: z.object({
    testRunId: z.string(),
    panelDocuments: z.array(z.unknown()).optional()
  }),
  [JOB_NAMES.DYNATRACE_COLLECTION]: z.object({
    testRunId: z.string()
  }),
  [JOB_NAMES.REEVALUATE_CHECKS]: ReevaluateJobSchema,
  [JOB_NAMES.BATCH_ANALYSIS]: BatchAnalysisJobSchema,
  [JOB_NAMES.BATCH_FLOW]: BatchFlowJobSchema,
  [JOB_NAMES.REEVALUATION_BATCH]: ReevaluationBatchJobSchema
} as const;

export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: string[];
}

/**
 * Validate job data against the appropriate schema
 */
export function validateJobData<T>(
  jobName: string,
  data: unknown
): ValidationResult<T> {
  try {
    // Check if job name exists
    if (!Object.values(JOB_NAMES).includes(jobName as JobName)) {
      logger.warn(`Unknown job name: ${jobName}`);
      return {
        success: false,
        errors: [`Unknown job name: ${jobName}`]
      };
    }

    // Get the appropriate schema
    const schema = JOB_SCHEMAS[jobName as keyof typeof JOB_SCHEMAS];
    if (!schema) {
      logger.warn(`No validation schema found for job: ${jobName}`);
      return {
        success: false,
        errors: [`No validation schema found for job: ${jobName}`]
      };
    }

    // Validate the data
    const result = schema.safeParse(data);

    if (result.success) {
      logger.debug(`Job data validation successful: ${jobName}`);
      return {
        success: true,
        data: result.data as T
      };
    } else {
      const errors = result.error.errors.map(err =>
        `${err.path.join('.')}: ${err.message}`
      );

      logger.warn(`Job data validation failed: ${jobName}`, {
        errors,
        data: typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : data
      });

      return {
        success: false,
        errors
      };
    }
  } catch (error) {
    logger.error(`Validation error for job ${jobName}:`, error);
    return {
      success: false,
      errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

/**
 * Validate and sanitize job data, throwing on validation failure
 */
export function validateAndSanitizeJobData<T>(
  jobName: string,
  data: unknown
): T {
  const result = validateJobData<T>(jobName, data);

  if (!result.success) {
    const errorMessage = `Job validation failed for ${jobName}: ${result.errors?.join(', ')}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  return result.data!;
}

/**
 * Validate batch size constraints
 */
export function validateBatchSize(
  jobName: string,
  testRunIds: string[],
  batchSize?: number
): ValidationResult<{ batchSize: number; maxBatches: number }> {
  const testRunCount = testRunIds.length;

  // Default batch sizes based on job type
  const defaultBatchSizes = {
    [JOB_NAMES.BATCH_ANALYSIS]: 10,
    [JOB_NAMES.BATCH_FLOW]: 10,
    [JOB_NAMES.REEVALUATION_BATCH]: 15
  };

  const maxBatchSizes = {
    [JOB_NAMES.BATCH_ANALYSIS]: 50,
    [JOB_NAMES.BATCH_FLOW]: 50,
    [JOB_NAMES.REEVALUATION_BATCH]: 25
  };

  const effectiveBatchSize = batchSize || defaultBatchSizes[jobName as keyof typeof defaultBatchSizes] || 10;
  const maxBatchSize = maxBatchSizes[jobName as keyof typeof maxBatchSizes] || 50;

  // Validate batch size
  if (effectiveBatchSize < 1) {
    return {
      success: false,
      errors: ['Batch size must be at least 1']
    };
  }

  if (effectiveBatchSize > maxBatchSize) {
    return {
      success: false,
      errors: [`Batch size cannot exceed ${maxBatchSize} for job type ${jobName}`]
    };
  }

  // Calculate number of batches
  const maxBatches = Math.ceil(testRunCount / effectiveBatchSize);

  if (maxBatches > 100) {
    return {
      success: false,
      errors: [`Too many batches (${maxBatches}). Consider increasing batch size or reducing test run count.`]
    };
  }

  logger.debug(`Batch validation successful for ${jobName}`, {
    testRunCount,
    batchSize: effectiveBatchSize,
    maxBatches
  });

  return {
    success: true,
    data: {
      batchSize: effectiveBatchSize,
      maxBatches
    }
  };
}

/**
 * Validate resource requirements
 */
export function validateResourceRequirements(
  jobName: string,
  resourceRequirements?: {
    memory_mb: number;
    cpu_cores: number;
    io_intensive: boolean;
  }
): ValidationResult<boolean> {
  if (!resourceRequirements) {
    return { success: true };
  }

  const errors: string[] = [];

  // Memory validation
  if (resourceRequirements.memory_mb < 64) {
    errors.push('Memory requirement must be at least 64MB');
  }

  if (resourceRequirements.memory_mb > 8192) {
    errors.push('Memory requirement cannot exceed 8GB');
  }

  // CPU validation
  if (resourceRequirements.cpu_cores < 1) {
    errors.push('CPU cores requirement must be at least 1');
  }

  if (resourceRequirements.cpu_cores > 16) {
    errors.push('CPU cores requirement cannot exceed 16');
  }

  if (errors.length > 0) {
    logger.warn(`Resource requirements validation failed for ${jobName}`, {
      resourceRequirements,
      errors
    });

    return {
      success: false,
      errors
    };
  }

  return { success: true };
}

/**
 * Validate job dependencies
 */
export function validateJobDependencies(
  jobName: string,
  dependencies?: string[]
): ValidationResult<boolean> {
  if (!dependencies || dependencies.length === 0) {
    return { success: true };
  }

  const errors: string[] = [];

  // Check for circular dependencies (simple check)
  if (dependencies.includes(jobName)) {
    errors.push(`Job cannot depend on itself: ${jobName}`);
  }

  // Check dependency count
  if (dependencies.length > 10) {
    errors.push('Job cannot have more than 10 dependencies');
  }

  // Check dependency name format (basic validation)
  for (const dep of dependencies) {
    if (typeof dep !== 'string' || dep.trim().length === 0) {
      errors.push(`Invalid dependency name: ${dep}`);
    }
  }

  if (errors.length > 0) {
    logger.warn(`Job dependencies validation failed for ${jobName}`, {
      dependencies,
      errors
    });

    return {
      success: false,
      errors
    };
  }

  return { success: true };
}

/**
 * Get all available job names
 */
export function getAvailableJobNames(): string[] {
  return Object.values(JOB_NAMES);
}

/**
 * Check if a job name is valid
 */
export function isValidJobName(jobName: string): boolean {
  return Object.values(JOB_NAMES).includes(jobName as JobName);
}

/**
 * Get schema for a specific job name
 */
export function getJobSchema(jobName: string): z.ZodSchema | null {
  if (!isValidJobName(jobName)) {
    return null;
  }

  return JOB_SCHEMAS[jobName as keyof typeof JOB_SCHEMAS] || null;
}