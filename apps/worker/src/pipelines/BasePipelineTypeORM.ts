import type { Logger } from 'pino';
import { Pipeline, PipelineResult } from '../types/pipeline.js';
import { logPerformance, logError } from '../lib/utils/logger.js';
import { createPerformanceTimer, PerformanceTimer } from '../lib/utils/timing.js';
import { getDatabaseService } from '../common/database-accessor.js';
import { WorkerDatabaseService } from '../common/database.service.js';
import { EntityManager } from 'typeorm';

/**
 * Base Pipeline Class (TypeORM Version)
 *
 * Provides common functionality for all pipeline implementations using TypeORM:
 * - Database access via WorkerDatabaseService (TypeORM repositories)
 * - Transaction management through TypeORM EntityManager
 * - Performance logging
 * - Error handling
 * - Input validation
 *
 * MIGRATION GUIDE:
 * ===============
 * To migrate a pipeline from raw pg queries to TypeORM:
 *
 * 1. Replace BasePipeline with BasePipelineTypeORM:
 *    ```typescript
 *    // Old:
 *    import { BasePipeline } from './BasePipeline.js';
 *    export class MyPipeline extends BasePipeline { ... }
 *
 *    // New:
 *    import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
 *    export class MyPipeline extends BasePipelineTypeORM { ... }
 *    ```
 *
 * 2. Update constructor to not require Pool:
 *    ```typescript
 *    // Old:
 *    constructor(db: Pool, logger: Logger) {
 *      super(db, logger);
 *    }
 *
 *    // New:
 *    constructor(logger: Logger) {
 *      super(logger);
 *    }
 *    ```
 *
 * 3. Replace raw SQL queries with repository methods:
 *    ```typescript
 *    // Old:
 *    const result = await client.query(
 *      'SELECT * FROM test_runs WHERE test_run_id = $1',
 *      [testRunId]
 *    );
 *    const testRun = result.rows[0];
 *
 *    // New:
 *    const testRun = await this.db.getTestRunByTestRunId(testRunId);
 *    ```
 *
 * 4. Use TypeORM transactions instead of pg transactions:
 *    ```typescript
 *    // Old:
 *    await this.withTransaction(async (client) => {
 *      await client.query('UPDATE test_runs SET ...');
 *      await client.query('INSERT INTO ds_metrics ...');
 *    });
 *
 *    // New:
 *    await this.withTransaction(async (manager) => {
 *      await this.db.updateTestRun(id, { ... });
 *      await this.db.insertDsMetrics(metrics);
 *    });
 *    ```
 */
export abstract class BasePipelineTypeORM implements Pipeline {
  protected timer: PerformanceTimer;
  protected db: WorkerDatabaseService;

  constructor(protected logger: Logger) {
    // Get the database service from the NestJS DI container
    this.db = getDatabaseService();

    // Each pipeline gets its own performance timer
    this.timer = createPerformanceTimer(logger, this.constructor.name);
  }

  /**
   * Abstract method that must be implemented by each pipeline
   */
  abstract execute(input: unknown): Promise<PipelineResult>;

  /**
   * Optional input validation - override in specific pipelines
   */
  validateInput?(input: unknown): boolean;

  /**
   * Optional cleanup method - override if pipeline needs cleanup
   */
  cleanup?(): Promise<void>;

  /**
   * Ensure the database connection is alive before starting work.
   * Call this at the start of pipeline execution to detect dead connections early.
   */
  protected async ensureConnection(): Promise<void> {
    await this.db.ensureConnection();
  }

  /**
   * Execute a database operation within a transaction
   * Provides automatic rollback on error
   */
  protected async withTransaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return await this.db.transaction(operation);
  }

  /**
   * Execute raw SQL query (use sparingly - prefer repository methods)
   */
  protected async query<T = any>(sql: string, parameters?: any[]): Promise<T[]> {
    return await this.db.query<T>(sql, parameters);
  }

  /**
   * Log pipeline performance metrics
   */
  protected logPerformance(operation: string, startTime: number, details?: Record<string, unknown>): void {
    logPerformance(this.logger, operation, startTime, details);
  }

  /**
   * Log pipeline errors with context
   */
  protected logError(error: Error, context?: Record<string, unknown>): void {
    logError(this.logger, error, context);
  }

  /**
   * Create a successful pipeline result
   */
  protected createSuccessResult(data?: unknown, duration?: number): PipelineResult {
    const result: PipelineResult = { success: true };
    if (duration) {result.duration = duration;}
    if (data) {result.data = data;}
    return result;
  }

  /**
   * Create a failed pipeline result
   */
  protected createErrorResult(
    error: Error | string,
    code?: string,
    details?: unknown,
    duration?: number
  ): PipelineResult {
    const errorMessage = error instanceof Error ? error.message : error;

    const result: PipelineResult = {
      success: false,
      error: {
        message: errorMessage,
        code,
        details,
      },
    };
    if (duration) {result.duration = duration;}
    return result;
  }

  /**
   * Validate that a test run exists in the database
   */
  protected async validateTestRunExists(testRunId: string): Promise<boolean> {
    const testRun = await this.db.getTestRunByTestRunId(testRunId);
    return testRun !== null;
  }

  /**
   * Load test run data from database
   */
  protected async loadTestRun(testRunId: string) {
    const testRun = await this.db.getTestRunByTestRunId(testRunId);

    if (!testRun) {
      throw new Error(`Test run not found: ${testRunId}`);
    }

    return testRun;
  }

  /**
   * Get configuration settings from environment
   * Settings are loaded from environment variables via the config system
   */
  protected async getSettings(): Promise<Record<string, unknown>> {
    const { getConfig } = await import('../config/environment.js');
    const config = getConfig();

    return {
      GRAFANA_BATCH_SIZE: config.GRAFANA_BATCH_SIZE,
      GRAFANA_CONCURRENCY: config.GRAFANA_CONCURRENCY,
      METRICS_DUAL_WRITE: config.METRICS_DUAL_WRITE,
      POSTGRES_BATCH_SIZE: config.METRICS_BATCH_SIZE,
    };
  }

  /**
   * Create a new performance timer for sub-operations
   */
  protected createTimer(context: string): PerformanceTimer {
    return createPerformanceTimer(this.logger, `${this.constructor.name}:${context}`);
  }

  /**
   * Clean up stale data with invalid application_dashboard_id references
   * This should be called at the start of pipelines that write to data science tables
   *
   * @param tables - Array of table names to clean up
   * @returns Object with timing info and deleted row counts
   */
  protected async cleanupStaleApplicationDashboards(tables: string[]): Promise<{
    duration: number;
    totalDeleted: number;
    deletedByTable: Record<string, number>;
  }> {
    const startTime = Date.now();
    const deletedByTable: Record<string, number> = {};
    let totalDeleted = 0;

    for (const table of tables) {
      try {
        // Preserve records from both Grafana dashboards and Dynatrace queries
        const result = await this.db.query(`
          DELETE FROM ${table}
          WHERE application_dashboard_id NOT IN (
            SELECT id FROM application_dashboards
          )
          AND application_dashboard_id NOT IN (
            SELECT DISTINCT application_dashboard_id FROM dynatrace_queries
          )
        `);
        const deletedRows = result[1] || 0;
        deletedByTable[table] = deletedRows;
        totalDeleted += deletedRows;
      } catch (error) {
        this.logger.warn(`Failed to clean up stale data in ${table}:`, error);
        deletedByTable[table] = 0;
      }
    }

    const duration = Date.now() - startTime;

    if (totalDeleted > 0) {
      const breakdown = Object.entries(deletedByTable)
        .filter(([, count]) => count > 0)
        .map(([table, count]) => `${table}: ${count}`)
        .join(', ');
      this.logger.info(
        `🧹 Cleaned up ${totalDeleted} stale records with invalid application_dashboard_id (${breakdown})`
      );
    }

    return { duration, totalDeleted, deletedByTable };
  }

  /**
   * Log timing summary for this pipeline
   */
  protected logTimingSummary(additionalContext?: Record<string, any>): void {
    this.timer.logSummary(additionalContext);
  }
}
