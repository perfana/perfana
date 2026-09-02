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
 */
/**
 * Budget for a heavy background aggregation, mirrored in config/environment.ts
 * (AGGREGATION_STATEMENT_TIMEOUT_MS / AGGREGATION_WORK_MEM) so a bad value is
 * rejected at boot. Read from process.env rather than getConfig() because the
 * full schema requires secrets a unit test has no reason to provide — the same
 * reason TransactionStatsRollupPipeline reads ROLLUP_STATEMENT_TIMEOUT_MS directly.
 *
 * 540s, not 600s: the analytics pool sets a client-side query_timeout of 600000
 * (config/typeorm.config.ts). At equal deadlines node-postgres tears the connection
 * down instead of letting Postgres cancel the statement, so you lose the clean
 * rollback and get a torn socket instead of `canceling statement due to ...`.
 */
const AGGREGATION_STATEMENT_TIMEOUT_DEFAULT_MS = 540000;
const AGGREGATION_WORK_MEM_DEFAULT = '128MB';

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
   * Execute a heavy analytical operation within a transaction with a shorter statement timeout.
   * Use this for CTEs that scan large tables (Statistics, ControlGroups, ADAPT).
   *
   * The timeout is set via SET LOCAL so it only applies within this transaction —
   * the write path (INSERT INTO ds_metrics) keeps the default 10-minute timeout.
   *
   * Default: 120s. Override via ANALYTICS_STATEMENT_TIMEOUT_MS env var.
   * See: 2026-03-26 write starvation post-mortem
   */
  protected async withAnalyticsTransaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    const timeoutMs = parseInt(process.env.ANALYTICS_STATEMENT_TIMEOUT_MS || '120000', 10);

    return await this.db.transaction(async (manager: EntityManager) => {
      await manager.query(`SET LOCAL statement_timeout = '${timeoutMs}'`);
      return operation(manager);
    });
  }

  /**
   * Widen this transaction's budget for a heavy aggregation.
   *
   * Call it ONCE at the top of the withAnalyticsTransaction callback, never beside
   * the INSERT. `SET LOCAL` is transaction-scoped, so placing it next to the
   * aggregation leaves every earlier statement on the 120s cap — including
   * StatisticsPipeline's ramp_up refresh, which rewrites a compressed run and is
   * the statement most likely to exceed it.
   *
   * `set_config(name, value, true)` rather than an interpolated `SET LOCAL`: it
   * binds the value, so an operator-supplied env string never reaches the parser,
   * and a non-numeric timeout cannot abort the transaction as `'NaN'`.
   */
  protected async setAggregationBudget(manager: EntityManager): Promise<void> {
    const parsed = Number.parseInt(process.env.AGGREGATION_STATEMENT_TIMEOUT_MS ?? '', 10);
    const timeoutMs = Number.isFinite(parsed) ? parsed : AGGREGATION_STATEMENT_TIMEOUT_DEFAULT_MS;
    const workMem = process.env.AGGREGATION_WORK_MEM || AGGREGATION_WORK_MEM_DEFAULT;

    await manager.query('SELECT set_config($1, $2, true)', ['statement_timeout', String(timeoutMs)]);
    // Keeps ~20k percentile_agg sketches in a HashAggregate; spilling turns the
    // aggregation into a GroupAggregate that sorts every input row to disk.
    await manager.query('SELECT set_config($1, $2, true)', ['work_mem', workMem]);
  }

  /**
   * Execute raw SQL query (use sparingly - prefer repository methods)
   */
  protected async query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T[]> {
    return await this.db.query<T>(sql, parameters);
  }

  /**
   * Execute write operations within a transaction using the dedicated write pool.
   */
  protected async writeTransaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return await this.db.writeTransaction(operation);
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
}
