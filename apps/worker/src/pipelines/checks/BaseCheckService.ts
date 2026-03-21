import { PoolClient as _PoolClient } from 'pg';
import type { Logger } from 'pino';

/**
 * Base class for all check pipeline services
 * Provides common functionality and logging
 */
export abstract class BaseCheckService {
  protected logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }
}

/**
 * Custom exception classes for check pipeline errors
 */
export class CheckPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckPipelineError';
  }
}

export class BenchmarkNotFoundError extends CheckPipelineError {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkNotFoundError';
  }
}

export class DataAggregationError extends CheckPipelineError {
  constructor(message: string) {
    super(message);
    this.name = 'DataAggregationError';
  }
}

export class RequirementCheckError extends CheckPipelineError {
  constructor(message: string) {
    super(message);
    this.name = 'RequirementCheckError';
  }
}