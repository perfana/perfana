import type { Logger } from 'pino';

/**
 * Timing utilities for comprehensive performance logging
 * Helps identify slow operations across all pipeline stages
 */

export interface TimingEntry {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export class PerformanceTimer {
  private timings: Map<string, TimingEntry> = new Map();
  private operationStack: string[] = [];
  private readonly logger: Logger;
  private readonly context: string;

  constructor(logger: Logger, context: string) {
    this.logger = logger;
    this.context = context;
  }

  /**
   * Start timing an operation
   */
  start(operation: string, metadata?: Record<string, any>): void {
    const fullOperation = this.getFullOperationName(operation);

    this.timings.set(fullOperation, {
      operation: fullOperation,
      startTime: Date.now(),
      metadata
    });

    this.operationStack.push(operation);

    this.logger.debug(`⏱️ [${this.context}] Started: ${fullOperation}`, metadata);
  }

  /**
   * End timing an operation and log the duration
   */
  end(operation: string, metadata?: Record<string, any>): number {
    const fullOperation = this.getFullOperationName(operation);
    const timing = this.timings.get(fullOperation);

    if (!timing) {
      this.logger.warn(`⚠️ [${this.context}] Attempted to end operation that wasn't started: ${fullOperation}`);
      return 0;
    }

    const endTime = Date.now();
    const duration = endTime - timing.startTime;

    timing.endTime = endTime;
    timing.duration = duration;
    if (metadata) {
      timing.metadata = { ...timing.metadata, ...metadata };
    }

    // Pop from stack
    const lastOp = this.operationStack.pop();
    if (lastOp !== operation) {
      this.logger.warn(`⚠️ [${this.context}] Operation stack mismatch. Expected: ${operation}, Got: ${lastOp}`);
    }

    // Log with appropriate severity based on duration
    const logLevel = this.getLogLevel(duration);
    const emoji = this.getEmoji(duration);

    this.logger[logLevel](
      `${emoji} [${this.context}] ${fullOperation}: ${duration}ms`,
      { duration, ...timing.metadata, ...metadata }
    );

    return duration;
  }

  /**
   * Measure an async operation
   */
  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    this.start(operation, metadata);
    try {
      const result = await fn();
      this.end(operation, metadata);
      return result;
    } catch (error) {
      this.end(operation, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Measure a synchronous operation
   */
  measureSync<T>(
    operation: string,
    fn: () => T,
    metadata?: Record<string, any>
  ): T {
    this.start(operation, metadata);
    try {
      const result = fn();
      this.end(operation, metadata);
      return result;
    } catch (error) {
      this.end(operation, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Get all timing entries
   */
  getTimings(): TimingEntry[] {
    return Array.from(this.timings.values());
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalOperations: number;
    totalDuration: number;
    slowestOperation: TimingEntry | null;
    fastestOperation: TimingEntry | null;
    averageDuration: number;
  } {
    const timings = this.getTimings().filter(t => t.duration !== undefined);

    if (timings.length === 0) {
      return {
        totalOperations: 0,
        totalDuration: 0,
        slowestOperation: null,
        fastestOperation: null,
        averageDuration: 0
      };
    }

    const totalDuration = timings.reduce((sum, t) => sum + (t.duration || 0), 0);
    const sortedByDuration = [...timings].sort((a, b) => (b.duration || 0) - (a.duration || 0));

    return {
      totalOperations: timings.length,
      totalDuration,
      slowestOperation: sortedByDuration[0],
      fastestOperation: sortedByDuration[sortedByDuration.length - 1],
      averageDuration: totalDuration / timings.length
    };
  }

  /**
   * Log a comprehensive timing summary
   */
  logSummary(additionalContext?: Record<string, any>): void {
    const summary = this.getSummary();
    const timings = this.getTimings().filter(t => t.duration !== undefined);

    if (timings.length === 0) {
      this.logger.info(`📊 [${this.context}] No timing data available`);
      return;
    }

    // Sort by duration (slowest first)
    const sortedTimings = [...timings].sort((a, b) => (b.duration || 0) - (a.duration || 0));

    this.logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 PERFORMANCE SUMMARY: ${this.context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Overall Statistics:
   • Total Operations: ${summary.totalOperations}
   • Total Duration: ${summary.totalDuration}ms
   • Average Duration: ${Math.round(summary.averageDuration)}ms

🐌 Top 5 Slowest Operations:
${sortedTimings.slice(0, 5).map((t, i) =>
  `   ${i + 1}. ${t.operation}: ${t.duration}ms ${this.getEmoji(t.duration || 0)}`
).join('\n')}

⚡ Top 5 Fastest Operations:
${sortedTimings.slice(-5).reverse().map((t, i) =>
  `   ${i + 1}. ${t.operation}: ${t.duration}ms`
).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`, additionalContext);
  }

  /**
   * Clear all timing data
   */
  reset(): void {
    this.timings.clear();
    this.operationStack = [];
  }

  /**
   * Get full operation name with nesting
   */
  private getFullOperationName(operation: string): string {
    if (this.operationStack.length === 0) {
      return operation;
    }
    return `${this.operationStack.join(' > ')} > ${operation}`;
  }

  /**
   * Get log level based on duration
   */
  private getLogLevel(duration: number): 'debug' | 'info' | 'warn' {
    if (duration < 100) {return 'debug';}
    if (duration < 1000) {return 'info';}
    return 'warn';
  }

  /**
   * Get emoji based on duration
   */
  private getEmoji(duration: number): string {
    if (duration < 100) {return '⚡';}
    if (duration < 500) {return '✅';}
    if (duration < 1000) {return '⏱️';}
    if (duration < 5000) {return '🐢';}
    return '🐌';
  }
}

/**
 * Create a performance timer
 */
export function createPerformanceTimer(logger: Logger, context: string): PerformanceTimer {
  return new PerformanceTimer(logger, context);
}