import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, EntityManager, ObjectLiteral } from 'typeorm';
import {
  TestRun,
  ApplicationDashboard,
  GrafanaInstance,
  Benchmark,
  DsMetrics,
  DsPanels,
  DsMetricStatistics,
  DsMetricCollectionStatus,
  DsAdaptResults,
  DsAdaptConclusion,
  DsControlGroups,
  DsControlGroupStatistics,
  DynatraceConfig,
  DynatraceQuery,
  DynatraceEntityMapping,
  SystemUnderTest,
} from '@perfana/shared/entities';

/** Max retries for transient connection errors */
const MAX_RETRIES = 3;
/** Base delay between retries in ms (doubles each attempt) */
const BASE_RETRY_DELAY_MS = 500;

/** Transient error codes/messages that are safe to retry */
const TRANSIENT_ERRORS = [
  'Connection terminated',
  'Connection terminated unexpectedly',
  'Driver not Connected',
  'connection is insecure',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'connection lost',
  'socket hang up',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
];

function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') { return false; }
  const err = error as Record<string, unknown>;
  const msg = 'message' in err ? String(err.message) : '';
  const code = 'code' in err ? String(err.code) : '';
  return TRANSIENT_ERRORS.some(t => msg.includes(t) || code === t);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Database Service for Worker Application
 *
 * Provides TypeORM repository access to all entities needed by worker pipelines.
 * This replaces the raw pg Pool queries with proper ORM operations.
 *
 * Includes retry logic with exponential backoff for transient connection errors
 * (e.g. "Connection terminated", "Driver not Connected").
 *
 * Pattern: Follows the exact same approach as perfana-api's NativeDatabaseService
 */
@Injectable()
export class WorkerDatabaseService implements OnModuleInit {
  private readonly logger = new Logger(WorkerDatabaseService.name);

  constructor(
    @InjectDataSource() public readonly dataSource: DataSource,
    @InjectDataSource('write') public readonly writeDataSource: DataSource,
    @InjectRepository(TestRun) public readonly testRunRepo: Repository<TestRun>,
    @InjectRepository(ApplicationDashboard) public readonly applicationDashboardRepo: Repository<ApplicationDashboard>,
    @InjectRepository(GrafanaInstance) public readonly grafanaInstanceRepo: Repository<GrafanaInstance>,
    @InjectRepository(Benchmark) public readonly benchmarkRepo: Repository<Benchmark>,
    @InjectRepository(DsMetrics) public readonly dsMetricsRepo: Repository<DsMetrics>,
    @InjectRepository(DsPanels) public readonly dsPanelsRepo: Repository<DsPanels>,
    @InjectRepository(DsMetricStatistics) public readonly dsMetricStatisticsRepo: Repository<DsMetricStatistics>,
    @InjectRepository(DsMetricCollectionStatus) public readonly dsMetricCollectionStatusRepo: Repository<DsMetricCollectionStatus>,
    @InjectRepository(DsAdaptResults) public readonly dsAdaptResultsRepo: Repository<DsAdaptResults>,
    @InjectRepository(DsAdaptConclusion) public readonly dsAdaptConclusionRepo: Repository<DsAdaptConclusion>,
    @InjectRepository(DsControlGroups) public readonly dsControlGroupsRepo: Repository<DsControlGroups>,
    @InjectRepository(DsControlGroupStatistics) public readonly dsControlGroupStatisticsRepo: Repository<DsControlGroupStatistics>,
    @InjectRepository(DynatraceConfig) public readonly dynatraceConfigRepo: Repository<DynatraceConfig>,
    @InjectRepository(DynatraceQuery) public readonly dynatraceQueryRepo: Repository<DynatraceQuery>,
    @InjectRepository(DynatraceEntityMapping) public readonly dynatraceEntityMappingRepo: Repository<DynatraceEntityMapping>,
    @InjectRepository(SystemUnderTest) public readonly systemUnderTestRepo: Repository<SystemUnderTest>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureConnection();
    this.logger.log('Database connection verified on module init');
  }

  /**
   * Ensure the DataSource is connected, reconnecting if necessary.
   * Called before job execution to avoid operating on a dead connection.
   * Checks both the main (analytics) and write connection pools.
   */
  async ensureConnection(): Promise<void> {
    await this.ensureDataSourceConnection(this.dataSource, 'main');
    await this.ensureDataSourceConnection(this.writeDataSource, 'write');
  }

  private async ensureDataSourceConnection(ds: DataSource, name: string): Promise<void> {
    if (!ds.isInitialized) {
      this.logger.warn(`${name} DataSource not initialized, attempting to initialize...`);
      await ds.initialize();
      this.logger.log(`${name} DataSource re-initialized successfully`);
      return;
    }

    try {
      await ds.query('SELECT 1');
    } catch {
      this.logger.warn(`${name} database connection check failed, attempting to reconnect...`);
      try {
        await ds.destroy();
      } catch { /* ignore destroy errors */ }
      await ds.initialize();
      this.logger.log(`${name} database reconnected successfully`);
    }
  }

  /**
   * Execute raw SQL query with retry logic for transient connection errors.
   * Use sparingly - prefer TypeORM query builder when possible.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(sql: string, parameters?: unknown[]): Promise<T[]> {
    return this.withRetry('query', async () => {
      const result = await this.dataSource.query(sql, parameters);
      this.logger.debug(`Executed raw query with ${Array.isArray(result) ? result.length : 0} results`);
      return result;
    });
  }

  /**
   * Execute operations within a transaction with retry logic.
   * Only retries on transient connection errors (the whole transaction is re-attempted).
   * Provides automatic rollback on error.
   */
  async transaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.withRetry('transaction', async () => {
      return await this.dataSource.transaction(operation);
    });
  }

  /**
   * Get the underlying DataSource for advanced operations
   */
  getDataSource(): DataSource {
    return this.dataSource;
  }

  /**
   * Execute a raw SQL query using the dedicated write connection pool.
   * Use this for INSERT/UPDATE operations that must not be starved by analytics.
   *
   * See: 2026-03-26 write starvation post-mortem
   */
  async writeQuery<T = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<T[]> {
    return this.withRetry('writeQuery', async () => {
      const result = await this.writeDataSource.query(sql, parameters);
      return result;
    });
  }

  /**
   * Execute write operations within a transaction using the dedicated write pool.
   * Guarantees write-path connections are never starved by analytical queries.
   */
  async writeTransaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.withRetry('writeTransaction', async () => {
      return await this.writeDataSource.transaction(operation);
    });
  }

  /**
   * Retry wrapper with exponential backoff for transient connection errors.
   * Non-transient errors (constraint violations, syntax errors, etc.) are thrown immediately.
   */
  private async withRetry<T>(context: string, operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const errMsg = error instanceof Error ? error.message : String(error);

        if (!isTransientError(error) || attempt === MAX_RETRIES) {
          if (attempt > 1) {
            this.logger.error(`${context} failed after ${attempt} attempts: ${errMsg}`);
          } else {
            this.logger.error(`${context} failed: ${errMsg}`, error);
          }
          throw error;
        }

        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `${context} failed with transient error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms: ${errMsg}`
        );

        await sleep(delay);

        // Reconnect before retrying
        try {
          await this.ensureConnection();
        } catch (reconnectError) {
          this.logger.error('Failed to reconnect before retry:', reconnectError);
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if TimescaleDB extension is available
   */
  async isTimescaleEnabled(): Promise<boolean> {
    try {
      const result = await this.dataSource.query(
        "SELECT * FROM pg_extension WHERE extname = 'timescaledb' LIMIT 1"
      );
      return result.length > 0;
    } catch (error) {
      this.logger.warn('Failed to check TimescaleDB availability:', error);
      return false;
    }
  }

  /**
   * Health check - verify database connectivity
   */
  async healthCheck(): Promise<{ status: string; timestamp: Date; timescaleEnabled: boolean }> {
    try {
      await this.dataSource.query('SELECT 1');
      const timescaleEnabled = await this.isTimescaleEnabled();

      return {
        status: 'healthy',
        timestamp: new Date(),
        timescaleEnabled,
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`, error);
      throw error;
    }
  }

  // ============================================================================
  // Test Run Operations
  // ============================================================================

  async getTestRunById(id: string): Promise<TestRun | null> {
    return await this.testRunRepo.findOne({ where: { id } });
  }

  async getTestRunByTestRunId(testRunId: string): Promise<TestRun | null> {
    return await this.testRunRepo.findOne({ where: { testRunId } });
  }

  async updateTestRun(id: string, data: Partial<TestRun>): Promise<void> {
    await this.testRunRepo.update(id, data);
    this.logger.debug(`Updated test run: ${id}`);
  }

  async updateTestRunByTestRunId(testRunId: string, data: Partial<TestRun>): Promise<void> {
    await this.testRunRepo.update({ testRunId }, data);
    this.logger.debug(`Updated test run by testRunId: ${testRunId}`);
  }

  async getSystemUnderTestName(systemUnderTestId: string): Promise<string | null> {
    const system = await this.systemUnderTestRepo.findOne({
      where: { id: systemUnderTestId },
      select: ['name'],
    });
    return system?.name || null;
  }

  // ============================================================================
  // Application Dashboard Operations
  // ============================================================================

  async getApplicationDashboards(filters: {
    systemUnderTestId?: string;
    testEnvironment?: string;
    organizationId?: string;
  }): Promise<ApplicationDashboard[]> {
    const queryBuilder = this.applicationDashboardRepo.createQueryBuilder('ad');

    if (filters.systemUnderTestId) {
      queryBuilder.andWhere('ad.systemUnderTestId = :systemUnderTestId', {
        systemUnderTestId: filters.systemUnderTestId,
      });
    }

    if (filters.testEnvironment) {
      queryBuilder.andWhere('ad.testEnvironment = :testEnvironment', {
        testEnvironment: filters.testEnvironment,
      });
    }

    // RBAC: Filter by organization (backward compatible with NULL)
    if (filters.organizationId) {
      queryBuilder.andWhere(
        '(ad.organization_id = :organizationId OR ad.organization_id IS NULL)',
        { organizationId: filters.organizationId }
      );
    }

    return await queryBuilder.getMany();
  }

  // ============================================================================
  // Grafana Instance Operations
  // ============================================================================

  async getGrafanaInstanceById(id: string): Promise<GrafanaInstance | null> {
    return await this.grafanaInstanceRepo.findOne({ where: { id } });
  }

  // ============================================================================
  // Benchmark Operations
  // ============================================================================

  async getBenchmarksByDashboard(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    dashboardUid: string,
    organizationId?: string
  ): Promise<Benchmark[]> {
    // RBAC: Filter by organization (backward compatible with NULL)
    if (organizationId) {
      const queryBuilder = this.benchmarkRepo.createQueryBuilder('b');
      queryBuilder.where({
        system_under_test_id: systemUnderTestId,
        test_environment: testEnvironment,
        workload,
        dashboard_uid: dashboardUid,
      });
      queryBuilder.andWhere(
        '(b.organization_id = :organizationId OR b.organization_id IS NULL)',
        { organizationId }
      );
      return await queryBuilder.getMany();
    }

    return await this.benchmarkRepo.find({
      where: {
        system_under_test_id: systemUnderTestId,
        test_environment: testEnvironment,
        workload,
        dashboard_uid: dashboardUid,
      },
    });
  }

  async getBenchmarksByPanel(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    dashboardUid: string,
    panelTitle: string,
    organizationId?: string
  ): Promise<Benchmark[]> {
    // RBAC: Filter by organization (backward compatible with NULL)
    if (organizationId) {
      const queryBuilder = this.benchmarkRepo.createQueryBuilder('b');
      queryBuilder.where({
        system_under_test_id: systemUnderTestId,
        test_environment: testEnvironment,
        workload,
        dashboard_uid: dashboardUid,
        panel_title: panelTitle,
      });
      queryBuilder.andWhere(
        '(b.organization_id = :organizationId OR b.organization_id IS NULL)',
        { organizationId }
      );
      return await queryBuilder.getMany();
    }

    return await this.benchmarkRepo.find({
      where: {
        system_under_test_id: systemUnderTestId,
        test_environment: testEnvironment,
        workload,
        dashboard_uid: dashboardUid,
        panel_title: panelTitle,
      },
    });
  }

  // ============================================================================
  // Metrics Operations
  // ============================================================================

  async deleteDsMetricsByTestRun(testRunId: string): Promise<void> {
    await this.dsMetricsRepo.delete({ test_run_id: testRunId });
    this.logger.debug(`Deleted ds_metrics for test run: ${testRunId}`);
  }

  /**
   * Generic helper method to insert entities in chunks for better performance
   * @param repo - TypeORM repository to use for insertion
   * @param items - Array of items to insert
   * @param entityName - Name of entity for logging purposes
   * @param chunkSize - Number of items per chunk (default: 100)
   */
  private async batchInsert<T extends ObjectLiteral>(
    repo: Repository<T>,
    items: Partial<T>[],
    entityName: string,
    chunkSize: number = 100
  ): Promise<void> {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await repo.insert(chunk as Partial<T>[]);
    }
    this.logger.debug(`Inserted ${items.length} ${entityName} records`);
  }

  async insertDsMetrics(metrics: Partial<DsMetrics>[]): Promise<void> {
    await this.batchInsert(this.dsMetricsRepo, metrics, 'ds_metrics');
  }

  // ============================================================================
  // Panels Operations
  // ============================================================================

  async deleteDsPanelsByTestRun(testRunId: string): Promise<void> {
    await this.dsPanelsRepo.delete({ test_run_id: testRunId });
    this.logger.debug(`Deleted ds_panels for test run: ${testRunId}`);
  }

  async insertDsPanels(panels: Partial<DsPanels>[]): Promise<void> {
    await this.batchInsert(this.dsPanelsRepo, panels, 'ds_panels');
  }

  async getDsPanelsByTestRun(testRunId: string): Promise<DsPanels[]> {
    return await this.dsPanelsRepo.find({
      where: { test_run_id: testRunId },
    });
  }

  // ============================================================================
  // Statistics Operations
  // ============================================================================

  async deleteDsMetricStatisticsByTestRun(testRunId: string): Promise<void> {
    await this.dsMetricStatisticsRepo.delete({ test_run_id: testRunId });
    this.logger.debug(`Deleted ds_metric_statistics for test run: ${testRunId}`);
  }

  async insertDsMetricStatistics(statistics: Partial<DsMetricStatistics>[]): Promise<void> {
    await this.batchInsert(this.dsMetricStatisticsRepo, statistics, 'ds_metric_statistics');
  }

  // ============================================================================
  // Control Groups Operations
  // ============================================================================

  async deleteDsControlGroupsByTestRun(testRunId: string): Promise<void> {
    // Note: ds_control_groups has test_runs array field, not test_run_id
    // Using raw SQL for array operations
    await this.dataSource.query(
      `DELETE FROM ds_control_groups WHERE $1 = ANY(test_runs)`,
      [testRunId]
    );
    this.logger.debug(`Deleted ds_control_groups for test run: ${testRunId}`);
  }

  async insertDsControlGroups(groups: Partial<DsControlGroups>[]): Promise<void> {
    await this.batchInsert(this.dsControlGroupsRepo, groups, 'ds_control_groups');
  }

  // ============================================================================
  // ADAPT Operations
  // ============================================================================

  async deleteDsAdaptResultsByTestRun(testRunId: string): Promise<void> {
    await this.dsAdaptResultsRepo.delete({ test_run_id: testRunId });
    this.logger.debug(`Deleted ds_adapt_results for test run: ${testRunId}`);
  }

  async insertDsAdaptResults(results: Partial<DsAdaptResults>[]): Promise<void> {
    await this.batchInsert(this.dsAdaptResultsRepo, results, 'ds_adapt_results');
  }

  async deleteDsAdaptConclusionByTestRun(testRunId: string): Promise<void> {
    await this.dsAdaptConclusionRepo.delete({ test_run_id: testRunId });
    this.logger.debug(`Deleted ds_adapt_conclusion for test run: ${testRunId}`);
  }

  async insertDsAdaptConclusion(conclusion: Partial<DsAdaptConclusion>): Promise<void> {
    // TypeORM's _QueryDeepPartialEntity is incompatible with Record<string,unknown> JSONB columns at the type level
    await this.dsAdaptConclusionRepo.insert(conclusion as unknown as Parameters<typeof this.dsAdaptConclusionRepo.insert>[0]);
    this.logger.debug(`Inserted ds_adapt_conclusion for test run: ${conclusion.test_run_id}`);
  }

  // ============================================================================
  // Metric Collection Status Operations
  // ============================================================================

  /**
   * Get collection status for a specific source
   * @param testRunId - The test run ID
   * @param sourceType - Type of source ('grafana', 'dynatrace', 'performance_test')
   * @param sourceId - Source identifier. '' (or null) for sources without a natural id, e.g. performance_test.
   * @returns Collection status or null if not found
   */
  async getCollectionStatus(
    testRunId: string,
    sourceType: string,
    sourceId: string | null
  ): Promise<DsMetricCollectionStatus | null> {
    return await this.dsMetricCollectionStatusRepo.findOne({
      where: {
        test_run_id: testRunId,
        source_type: sourceType,
        source_id: sourceId ?? '',
      },
    });
  }

  /**
   * Get all collection statuses for a test run
   * @param testRunId - The test run ID
   * @returns Array of all collection statuses for the test run
   */
  async getAllCollectionStatuses(testRunId: string): Promise<DsMetricCollectionStatus[]> {
    return await this.dsMetricCollectionStatusRepo.find({
      where: { test_run_id: testRunId },
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Get incomplete collection statuses for a test run
   * @param testRunId - The test run ID
   * @returns Array of statuses where is_complete = false
   */
  async getIncompleteCollectionStatuses(testRunId: string): Promise<DsMetricCollectionStatus[]> {
    return await this.dsMetricCollectionStatusRepo.find({
      where: {
        test_run_id: testRunId,
        is_complete: false,
      },
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Create or update a collection status
   * Uses upsert (insert or update) based on unique constraint (test_run_id, source_type, source_id)
   * @param status - Partial status object with at least test_run_id, source_type
   * @returns The created or updated status
   */
  async upsertCollectionStatus(status: Partial<DsMetricCollectionStatus>): Promise<DsMetricCollectionStatus> {
    const sourceId = status.source_id ?? '';

    // Ensure row exists atomically using the canonical unique key.
    await this.dataSource.query(
      `INSERT INTO ds_metric_collection_status
         (test_run_id, source_type, source_id, collected_ranges, failed_ranges, is_complete, total_data_points, organization_id, team_id, created_at, updated_at)
       VALUES ($1::text, $2, $3, '[]'::jsonb, '[]'::jsonb, false, 0, (SELECT organization_id FROM test_runs WHERE test_run_id = $1::text), (SELECT team_id FROM test_runs WHERE test_run_id = $1::text), NOW(), NOW())
       ON CONFLICT (test_run_id, source_type, source_id) DO NOTHING`,
      [status.test_run_id, status.source_type, sourceId]
    );

    // Now find the existing row and update it with the provided fields
    const existing = await this.getCollectionStatus(
      status.test_run_id!,
      status.source_type!,
      sourceId
    );

    if (!existing) {
      throw new Error(
        `Failed to get collection status after upsert for test_run=${status.test_run_id}, source=${status.source_type}/${sourceId || 'empty'}`
      );
    }

    // Apply updates from the partial status
    const { test_run_id: _trid, source_type: _st, source_id: _sid, id: _id, ...updateFields } = status;
    if (Object.keys(updateFields).length > 0) {
      await this.dsMetricCollectionStatusRepo.update(existing.id, updateFields);
    }

    this.logger.debug(
      `Upserted collection status for test_run=${status.test_run_id}, source=${status.source_type}/${sourceId || 'empty'}`
    );
    return (await this.dsMetricCollectionStatusRepo.findOne({ where: { id: existing.id } }))!;
  }

  /**
   * Get the last collected time for a source (max 'to' from collected_ranges)
   * Returns null if no ranges have been collected yet
   * @param testRunId - The test run ID
   * @param sourceType - Type of source
   * @param sourceId - Source identifier (or null)
   * @returns The last collected 'to' time, or null if none
   */
  async getLastCollectedTime(
    testRunId: string,
    sourceType: string,
    sourceId: string | null
  ): Promise<Date | null> {
    const status = await this.getCollectionStatus(testRunId, sourceType, sourceId);

    if (!status || !status.collected_ranges || status.collected_ranges.length === 0) {
      return null;
    }

    // Find the maximum 'to' time from all collected ranges
    let maxToTime: Date | null = null;
    for (const range of status.collected_ranges) {
      const toTime = new Date(range.to);
      if (!maxToTime || toTime > maxToTime) {
        maxToTime = toTime;
      }
    }

    return maxToTime;
  }

  /**
   * Append a new time range to collected_ranges (creates record if not exists)
   * @param testRunId - The test run ID
   * @param sourceType - Type of source
   * @param sourceId - Source identifier (or null)
   * @param newRange - The time range to append
   */
  async updateCollectedRanges(
    testRunId: string,
    sourceType: string,
    sourceId: string | null,
    newRange: { from: Date; to: Date }
  ): Promise<void> {
    const normalizedSourceId = sourceId ?? '';
    const rangeJson = JSON.stringify({ from: newRange.from.toISOString(), to: newRange.to.toISOString() });

    // Atomic upsert: append to collected_ranges and drop any failed_range
    // whose [from, to] window is fully covered by ANY entry in the now-current
    // collected_ranges (existing || new). Prior versions only dropped exact
    // from/to matches, so retries with wider windows left stale entries in
    // failed_ranges forever — which the sanity check kept counting as
    // "failed collection ranges". See issue #136, Defect B.
    await this.dataSource.query(
      `INSERT INTO ds_metric_collection_status
         (test_run_id, source_type, source_id, collected_ranges, failed_ranges, is_complete, total_data_points, last_collected_at, organization_id, team_id, created_at, updated_at)
       VALUES ($1::text, $2, $3, $4::jsonb, '[]'::jsonb, false, 0, NOW(), (SELECT organization_id FROM test_runs WHERE test_run_id = $1::text), (SELECT team_id FROM test_runs WHERE test_run_id = $1::text), NOW(), NOW())
       ON CONFLICT (test_run_id, source_type, source_id)
       DO UPDATE SET
         collected_ranges = ds_metric_collection_status.collected_ranges || $4::jsonb,
         failed_ranges = COALESCE(
           (SELECT jsonb_agg(fr)
            FROM jsonb_array_elements(ds_metric_collection_status.failed_ranges) fr
            WHERE NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(ds_metric_collection_status.collected_ranges || $4::jsonb) cr
              WHERE (cr->>'from')::timestamptz <= (fr->>'from')::timestamptz
                AND (cr->>'to')::timestamptz   >= (fr->>'to')::timestamptz
            )),
           '[]'::jsonb
         ),
         last_collected_at = NOW(),
         organization_id = COALESCE(ds_metric_collection_status.organization_id, EXCLUDED.organization_id),
         team_id = COALESCE(ds_metric_collection_status.team_id, EXCLUDED.team_id),
         updated_at = NOW()`,
      [testRunId, sourceType, normalizedSourceId, `[${rangeJson}]`]
    );

    this.logger.debug(
      `Updated collected_ranges for test_run=${testRunId}, source=${sourceType}/${normalizedSourceId || 'empty'}, range=${newRange.from.toISOString()}-${newRange.to.toISOString()}`
    );
  }

  /**
   * Record a failed time range with error details (creates record if not exists)
   * If the range already exists in failed_ranges, increment attempts and update error
   * @param testRunId - The test run ID
   * @param sourceType - Type of source
   * @param sourceId - Source identifier (or null)
   * @param range - The time range that failed
   * @param error - Error message
   */
  async recordFailedRange(
    testRunId: string,
    sourceType: string,
    sourceId: string | null,
    range: { from: Date; to: Date },
    error: string
  ): Promise<void> {
    const normalizedSourceId = sourceId ?? '';

    // Ensure the row exists atomically (no duplicate creation race)
    await this.dataSource.query(
      `INSERT INTO ds_metric_collection_status
         (test_run_id, source_type, source_id, collected_ranges, failed_ranges, is_complete, total_data_points, organization_id, team_id, created_at, updated_at)
       VALUES ($1::text, $2, $3, '[]'::jsonb, '[]'::jsonb, false, 0, (SELECT organization_id FROM test_runs WHERE test_run_id = $1::text), (SELECT team_id FROM test_runs WHERE test_run_id = $1::text), NOW(), NOW())
       ON CONFLICT (test_run_id, source_type, source_id) DO NOTHING`,
      [testRunId, sourceType, normalizedSourceId]
    );

    // Now read the guaranteed-existing row
    const status = await this.getCollectionStatus(testRunId, sourceType, normalizedSourceId);
    if (!status) {
      throw new Error(
        `Failed to get collection status after upsert for test_run=${testRunId}, source=${sourceType}/${normalizedSourceId || 'empty'}`
      );
    }

    const failedRanges = status.failed_ranges || [];

    // Check if this range already exists (same from/to timestamps)
    const existingIndex = failedRanges.findIndex(
      (fr) =>
        new Date(fr.from).getTime() === new Date(range.from).getTime() &&
        new Date(fr.to).getTime() === new Date(range.to).getTime()
    );

    if (existingIndex >= 0) {
      // Update existing failed range
      failedRanges[existingIndex] = {
        ...range,
        attempts: failedRanges[existingIndex].attempts + 1,
        lastError: error,
      };
    } else {
      // Add new failed range
      failedRanges.push({
        ...range,
        attempts: 1,
        lastError: error,
      });
    }

    await this.dsMetricCollectionStatusRepo.update(status.id, {
      failed_ranges: failedRanges,
    });

    this.logger.debug(
      `Recorded failed range for test_run=${testRunId}, source=${sourceType}/${sourceId ?? 'null'}, attempts=${existingIndex >= 0 ? failedRanges[existingIndex].attempts : 1}`
    );
  }

  /**
   * Mark collection as complete for a specific source
   * @param testRunId - The test run ID
   * @param sourceType - Type of source
   * @param sourceId - Source identifier (or null)
   */
  async markCollectionComplete(
    testRunId: string,
    sourceType: string,
    sourceId: string | null
  ): Promise<void> {
    const status = await this.getCollectionStatus(testRunId, sourceType, sourceId);

    if (!status) {
      throw new Error(
        `Collection status not found for test_run=${testRunId}, source=${sourceType}/${sourceId ?? 'null'}`
      );
    }

    const updateData: Partial<DsMetricCollectionStatus> = {
      is_complete: true,
      failed_ranges: [],
      last_collected_at: new Date(),
    };

    // If collected_ranges is empty (e.g. after force-refetch reset), populate it
    // with the full test run time range so coverage calculation works correctly.
    if (!status.collected_ranges || status.collected_ranges.length === 0) {
      const testRun = await this.getTestRunByTestRunId(testRunId);
      if (testRun?.startTime && testRun?.endTime) {
        updateData.collected_ranges = [
          { from: testRun.startTime, to: testRun.endTime },
        ];
      }
    }

    await this.dsMetricCollectionStatusRepo.update(status.id, updateData);

    this.logger.debug(`Marked collection complete for test_run=${testRunId}, source=${sourceType}/${sourceId ?? 'null'}`);
  }

  /**
   * Reset collection status for a source, clearing collected/failed ranges and marking incomplete.
   * Used by force re-fetch to re-collect all data from scratch.
   */
  async resetCollectionStatus(
    testRunId: string,
    sourceType: string,
    sourceId: string | null
  ): Promise<void> {
    const status = await this.getCollectionStatus(testRunId, sourceType, sourceId);

    if (!status) {
      this.logger.warn(
        `No collection status to reset for test_run=${testRunId}, source=${sourceType}/${sourceId ?? 'null'}`
      );
      return;
    }

    await this.dsMetricCollectionStatusRepo.update(status.id, {
      collected_ranges: [],
      failed_ranges: [],
      is_complete: false,
    });

    this.logger.debug(`Reset collection status for test_run=${testRunId}, source=${sourceType}/${sourceId ?? 'null'}`);
  }

  /**
   * Remove a collection status record (e.g. orphaned source no longer configured)
   */
  async removeCollectionStatus(
    testRunId: string,
    sourceType: string,
    sourceId: string | null
  ): Promise<void> {
    await this.dsMetricCollectionStatusRepo.delete({
      test_run_id: testRunId,
      source_type: sourceType,
      source_id: sourceId ?? '',
    });
    this.logger.debug(`Removed collection status for test_run=${testRunId}, source=${sourceType}/${sourceId ?? 'null'}`);
  }

  /**
   * Decompress any compressed chunks of `hypertable` overlapping [from, to].
   *
   * Force-refetch (orchestrate-reevaluate-batch) DELETE/UPSERTs ds_metrics for an
   * existing run. If the run's chunk is already compressed and the DML filters on
   * a non-segmentby column (metrics_source_id), TimescaleDB decompresses the run's
   * segments inline and large runs blow past
   * timescaledb.max_tuples_decompressed_per_dml_transaction (default 100k),
   * aborting the whole refetch. Decompressing the chunk(s) up front avoids that;
   * the compression policy recompresses them on its next run.
   *
   * No-op (and cheap) when compression is disabled or nothing is compressed.
   */
  async decompressChunksForRange(hypertable: string, from: Date, to: Date): Promise<void> {
    try {
      const rows: Array<{ chunk: string | null }> = await this.dataSource.query(
        `SELECT decompress_chunk(format('%I.%I', chunk_schema, chunk_name)::regclass, if_compressed => true) AS chunk
         FROM timescaledb_information.chunks
         WHERE hypertable_name = $1
           AND is_compressed
           AND range_start < $3::timestamptz
           AND range_end   > $2::timestamptz`,
        [hypertable, from, to]
      );
      const n = Array.isArray(rows) ? rows.filter((r) => r.chunk).length : 0;
      if (n > 0) {
        this.logger.log(
          `Decompressed ${n} ${hypertable} chunk(s) for refetch over [${from.toISOString()} - ${to.toISOString()}]`
        );
      }
    } catch (err) {
      // Compression not enabled, timescaledb missing, or table not a hypertable → nothing to do.
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'unknown error';
      this.logger.debug(`decompressChunksForRange(${hypertable}) skipped: ${msg}`);
    }
  }

  // ============================================================================
  // Dynatrace Operations
  // ============================================================================

  async getDynatraceConfigBySystemUnderTest(
    systemUnderTestId: string,
    testEnvironment: string,
    organizationId?: string
  ): Promise<DynatraceConfig | null> {
    // DynatraceConfig is linked via DynatraceEntityMapping
    // RBAC: Filter by organization (backward compatible with NULL)
    if (organizationId) {
      const queryBuilder = this.dynatraceEntityMappingRepo.createQueryBuilder('mapping');
      queryBuilder.leftJoinAndSelect('mapping.dynatraceConfig', 'config');
      queryBuilder.where({
        systemUnderTestId,
        testEnvironment,
      });
      queryBuilder.andWhere(
        '(mapping.organization_id = :organizationId OR mapping.organization_id IS NULL)',
        { organizationId }
      );
      const mapping = await queryBuilder.getOne();
      return mapping?.dynatraceConfig || null;
    }

    const mapping = await this.dynatraceEntityMappingRepo.findOne({
      where: {
        systemUnderTestId,
        testEnvironment,
      },
      relations: ['dynatraceConfig'],
    });
    return mapping?.dynatraceConfig || null;
  }

  async getDynatraceQueriesByConfig(
    dynatraceConfigId: string,
    organizationId?: string
  ): Promise<DynatraceQuery[]> {
    // RBAC: Filter by organization (backward compatible with NULL)
    if (organizationId) {
      const queryBuilder = this.dynatraceQueryRepo.createQueryBuilder('q');
      queryBuilder.where({ dynatraceConfigId });
      queryBuilder.andWhere(
        '(q.organization_id = :organizationId OR q.organization_id IS NULL)',
        { organizationId }
      );
      queryBuilder.orderBy('q.createdAt', 'ASC');
      return await queryBuilder.getMany();
    }

    return await this.dynatraceQueryRepo.find({
      where: { dynatraceConfigId },
      order: { createdAt: 'ASC' },
    });
  }
}
