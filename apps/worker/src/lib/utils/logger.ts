import pino from 'pino';
import { getConfig } from '../../config/environment.js';

let logger: pino.Logger;

export function createLogger(): pino.Logger {
  if (logger) {
    return logger;
  }

  const config = getConfig();

  const loggerConfig: pino.LoggerOptions = {
    level: config.LOG_LEVEL,
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // Pretty print in development
  if (config.NODE_ENV === 'development') {
    logger = pino({
      ...loggerConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  } else {
    logger = pino(loggerConfig);
  }

  return logger;
}

export function getLogger(module?: string): pino.Logger {
  if (!logger) {
    logger = createLogger();
  }

  if (module) {
    return logger.child({ module });
  }

  return logger;
}

// Performance logging utilities
export function logPerformance(
  logger: pino.Logger,
  operation: string,
  startTime: number,
  details?: Record<string, unknown>
): void {
  const duration = Date.now() - startTime;

  logger.info({
    operation,
    duration: `${duration}ms`,
    performance: true,
    ...details,
  }, `${operation} completed in ${duration}ms`);
}

export function logError(
  logger: pino.Logger,
  error: Error,
  context?: Record<string, unknown>
): void {
  logger.error({
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
  }, error.message);
}

// Pipeline-specific logging helpers
export function logPipelineStart(
  logger: pino.Logger,
  pipeline: string,
  input: Record<string, unknown>
): void {
  logger.info({
    pipeline,
    phase: 'start',
    input,
  }, `🔷 Starting ${pipeline} pipeline`);
}

export function logPipelineSuccess(
  logger: pino.Logger,
  pipeline: string,
  result: Record<string, unknown>,
  duration?: number
): void {
  logger.info({
    pipeline,
    phase: 'success',
    result,
    ...(duration && { duration: `${duration}ms` }),
  }, `✅ ${pipeline} pipeline completed successfully`);
}

export function logPipelineError(
  logger: pino.Logger,
  pipeline: string,
  error: Error,
  context?: Record<string, unknown>
): void {
  logger.error({
    pipeline,
    phase: 'error',
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
  }, `❌ ${pipeline} pipeline failed: ${error.message}`);
}