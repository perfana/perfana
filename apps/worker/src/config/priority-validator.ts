/**
 * Priority System Validation Utilities
 * Ensures priority configurations are consistent and optimal
 */

import { JOB_QUEUE_MAPPING } from './queues.js';
import { ENHANCED_JOB_CONFIGS, JOB_NAMES } from '../types/jobs.js';
import { validateJobQueuePriority, getJobPriority as _getJobPriority, getQueuePriority as _getQueuePriority } from './priorities.js';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('priority-validator');

export interface PriorityValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
  summary: {
    totalJobs: number;
    validMappings: number;
    invalidMappings: number;
    priorityDistribution: Record<number, number>;
  };
}

/**
 * Validate the entire priority system configuration
 */
export function validatePrioritySystem(): PriorityValidationResult {
  const result: PriorityValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    recommendations: [],
    summary: {
      totalJobs: 0,
      validMappings: 0,
      invalidMappings: 0,
      priorityDistribution: {}
    }
  };

  // Validate all job-queue mappings
  Object.entries(JOB_QUEUE_MAPPING).forEach(([jobName, queueName]) => {
    result.summary.totalJobs++;

    const validation = validateJobQueuePriority(jobName, queueName);

    if (!validation.isValid) {
      result.isValid = false;
      result.errors.push(validation.recommendation!);
      result.summary.invalidMappings++;
    } else {
      result.summary.validMappings++;
    }

    // Track priority distribution
    const jobPriority = validation.jobPriority;
    result.summary.priorityDistribution[jobPriority] =
      (result.summary.priorityDistribution[jobPriority] || 0) + 1;
  });

  // Validate job configurations exist
  Object.values(JOB_NAMES).forEach(jobName => {
    if (!ENHANCED_JOB_CONFIGS[jobName]) {
      result.warnings.push(`Missing job configuration for: ${jobName}`);
    }
  });

  // Check for priority balance
  const criticalJobs = result.summary.priorityDistribution[1] || 0;
  const totalJobs = result.summary.totalJobs;

  if (criticalJobs > totalJobs * 0.3) {
    result.warnings.push(
      `High percentage of critical jobs (${criticalJobs}/${totalJobs}). Consider rebalancing priorities.`
    );
  }

  // Recommendations
  if (result.summary.invalidMappings === 0) {
    result.recommendations.push('✅ All job-queue priority mappings are valid');
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    result.recommendations.push('✅ Priority system is optimally configured');
  }

  return result;
}

/**
 * Log priority validation results
 */
export function logPriorityValidation(result: PriorityValidationResult): void {
  logger.info('🔍 Priority System Validation Results:', {
    isValid: result.isValid,
    summary: result.summary
  });

  if (result.errors.length > 0) {
    logger.error('❌ Priority Configuration Errors:');
    result.errors.forEach(error => logger.error(`  - ${error}`));
  }

  if (result.warnings.length > 0) {
    logger.warn('⚠️ Priority Configuration Warnings:');
    result.warnings.forEach(warning => logger.warn(`  - ${warning}`));
  }

  if (result.recommendations.length > 0) {
    logger.info('💡 Priority Configuration Recommendations:');
    result.recommendations.forEach(rec => logger.info(`  - ${rec}`));
  }
}

/**
 * Runtime priority validation - call during worker startup
 */
export function validatePrioritySystemAtStartup(): boolean {
  logger.info('🚀 Validating priority system configuration...');

  const validation = validatePrioritySystem();
  logPriorityValidation(validation);

  if (!validation.isValid) {
    logger.error('❌ Priority system validation failed! Worker startup aborted.');
    return false;
  }

  logger.info('✅ Priority system validation passed');
  return true;
}

/**
 * Get priority configuration summary for monitoring
 */
export function getPriorityConfigSummary(): Record<string, any> {
  const validation = validatePrioritySystem();

  return {
    timestamp: new Date().toISOString(),
    isValid: validation.isValid,
    totalJobs: validation.summary.totalJobs,
    validMappings: validation.summary.validMappings,
    invalidMappings: validation.summary.invalidMappings,
    priorityDistribution: validation.summary.priorityDistribution,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length
  };
}