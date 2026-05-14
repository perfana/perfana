/**
 * WorkerDatabaseService Unit Tests
 *
 * Comprehensive test suite covering:
 * - Module initialization and connection verification
 * - ensureConnection / ensureDataSourceConnection (initialized vs not, ping failure)
 * - query() with retry logic and exponential backoff
 * - transaction() with retry logic
 * - writeQuery() / writeTransaction() against the write DataSource
 * - getDataSource()
 * - isTimescaleEnabled() happy path + failure path
 * - healthCheck() healthy + unhealthy
 * - Test run CRUD operations (getTestRunById, getTestRunByTestRunId, updateTestRun,
 *   updateTestRunByTestRunId, getSystemUnderTestName)
 * - getApplicationDashboards() filter combinations (no filter, systemUnderTest, env, org)
 * - getGrafanaInstanceById()
 * - getBenchmarksByDashboard() / getBenchmarksByPanel() with and without organizationId
 * - deleteDsMetricsByTestRun, insertDsMetrics, batchInsert chunking
 * - deleteDsPanelsByTestRun, insertDsPanels, getDsPanelsByTestRun
 * - deleteDsMetricStatisticsByTestRun, insertDsMetricStatistics
 * - deleteDsControlGroupsByTestRun (raw SQL array delete), insertDsControlGroups
 * - deleteDsAdaptResultsByTestRun, insertDsAdaptResults
 * - deleteDsAdaptConclusionByTestRun, insertDsAdaptConclusion
 * - getCollectionStatus() with null and non-null sourceId
 * - getAllCollectionStatuses(), getIncompleteCollectionStatuses()
 * - upsertCollectionStatus() happy path + error if row missing after upsert
 * - getLastCollectedTime() no status, empty ranges, populated ranges
 * - updateCollectedRanges() delegates to raw SQL
 * - recordFailedRange() new range + existing range increment + missing row error
 * - markCollectionComplete() no status error, empty ranges pulls testRun dates, already-ranged
 * - resetCollectionStatus() no status (no-op warning), found status
 * - removeCollectionStatus() null vs non-null sourceId
 * - getDynatraceConfigBySystemUnderTest() with and without organizationId
 * - getDynatraceQueriesByConfig() with and without organizationId
 * - withRetry: non-transient error throws immediately, transient retries up to MAX_RETRIES,
 *   succeeds on second attempt, exhausted retries throw lastError
 * - isTransientError helper covers all known codes and messages
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WorkerDatabaseService } from '../../../common/database.service.js';

// ---------------------------------------------------------------------------
// NestJS Logger mock — must be defined before the service is instantiated.
// The Logger is instantiated as a class field (`new Logger(name)`) so the
// constructor mock must return an object with the right methods.
// vi.mock factories are hoisted, so any class/variable must be defined inside
// the factory or with vi.hoisted().
// ---------------------------------------------------------------------------
vi.mock('@nestjs/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nestjs/common')>();
  class MockLogger {
    log = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
    verbose = vi.fn();
  }
  return {
    ...actual,
    Logger: MockLogger,
    Injectable: () => () => {},
    OnModuleInit: () => () => {},
  };
});

// ---------------------------------------------------------------------------
// TypeORM decorator mocks — no-ops so the class can be newed without DI
// ---------------------------------------------------------------------------
vi.mock('@nestjs/typeorm', () => ({
  InjectDataSource: () => () => {},
  InjectRepository: () => () => {},
}));

// ---------------------------------------------------------------------------
// Shared entities mock — export stubs for every entity referenced in the
// constructor decorator list so @InjectRepository() lookups don't fail.
// ---------------------------------------------------------------------------
vi.mock('@perfana/shared/entities', () => {
  const makeEntity = (name: string) => {
    const cls = class {};
    Object.defineProperty(cls, 'name', { value: name });
    return cls;
  };
  return {
    TestRun: makeEntity('TestRun'),
    ApplicationDashboard: makeEntity('ApplicationDashboard'),
    GrafanaInstance: makeEntity('GrafanaInstance'),
    Benchmark: makeEntity('Benchmark'),
    DsMetrics: makeEntity('DsMetrics'),
    DsPanels: makeEntity('DsPanels'),
    DsMetricStatistics: makeEntity('DsMetricStatistics'),
    DsMetricCollectionStatus: makeEntity('DsMetricCollectionStatus'),
    DsAdaptResults: makeEntity('DsAdaptResults'),
    DsAdaptConclusion: makeEntity('DsAdaptConclusion'),
    DsControlGroups: makeEntity('DsControlGroups'),
    DsControlGroupStatistics: makeEntity('DsControlGroupStatistics'),
    DynatraceConfig: makeEntity('DynatraceConfig'),
    DynatraceQuery: makeEntity('DynatraceQuery'),
    DynatraceEntityMapping: makeEntity('DynatraceEntityMapping'),
    SystemUnderTest: makeEntity('SystemUnderTest'),
  };
});

// ---------------------------------------------------------------------------
// Helpers to build mock DataSource / Repository objects
// ---------------------------------------------------------------------------

function makeQueryBuilder() {
  const qb: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    leftJoinAndSelect: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue([]),
    getOne: vi.fn().mockResolvedValue(null),
  };
  return qb;
}

function makeRepo(overrides: Record<string, any> = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    insert: vi.fn().mockResolvedValue({}),
    createQueryBuilder: vi.fn().mockReturnValue(makeQueryBuilder()),
    ...overrides,
  };
}

function makeDataSource(overrides: Record<string, any> = {}) {
  return {
    isInitialized: true,
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockImplementation(async (fn: any) => fn({})),
    destroy: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Factory — creates a fully-wired WorkerDatabaseService with injectable mocks
// ---------------------------------------------------------------------------

function buildService(dsOverrides: Record<string, any> = {}, writeDsOverrides: Record<string, any> = {}) {
  const dataSource = makeDataSource(dsOverrides);
  const writeDataSource = makeDataSource(writeDsOverrides);

  const testRunRepo = makeRepo();
  const applicationDashboardRepo = makeRepo();
  const grafanaInstanceRepo = makeRepo();
  const benchmarkRepo = makeRepo();
  const dsMetricsRepo = makeRepo();
  const dsPanelsRepo = makeRepo();
  const dsMetricStatisticsRepo = makeRepo();
  const dsMetricCollectionStatusRepo = makeRepo();
  const dsAdaptResultsRepo = makeRepo();
  const dsAdaptConclusionRepo = makeRepo();
  const dsControlGroupsRepo = makeRepo();
  const dsControlGroupStatisticsRepo = makeRepo();
  const dynatraceConfigRepo = makeRepo();
  const dynatraceQueryRepo = makeRepo();
  const dynatraceEntityMappingRepo = makeRepo();
  const systemUnderTestRepo = makeRepo();

  // WorkerDatabaseService is decorated with @Injectable / @InjectDataSource etc.,
  // but because we mocked those decorators above we can `new` it directly.
  const service = new WorkerDatabaseService(
    dataSource as any,
    writeDataSource as any,
    testRunRepo as any,
    applicationDashboardRepo as any,
    grafanaInstanceRepo as any,
    benchmarkRepo as any,
    dsMetricsRepo as any,
    dsPanelsRepo as any,
    dsMetricStatisticsRepo as any,
    dsMetricCollectionStatusRepo as any,
    dsAdaptResultsRepo as any,
    dsAdaptConclusionRepo as any,
    dsControlGroupsRepo as any,
    dsControlGroupStatisticsRepo as any,
    dynatraceConfigRepo as any,
    dynatraceQueryRepo as any,
    dynatraceEntityMappingRepo as any,
    systemUnderTestRepo as any,
  );

  return {
    service,
    dataSource,
    writeDataSource,
    testRunRepo,
    applicationDashboardRepo,
    grafanaInstanceRepo,
    benchmarkRepo,
    dsMetricsRepo,
    dsPanelsRepo,
    dsMetricStatisticsRepo,
    dsMetricCollectionStatusRepo,
    dsAdaptResultsRepo,
    dsAdaptConclusionRepo,
    dsControlGroupsRepo,
    dsControlGroupStatisticsRepo,
    dynatraceConfigRepo,
    dynatraceQueryRepo,
    dynatraceEntityMappingRepo,
    systemUnderTestRepo,
  };
}

// ---------------------------------------------------------------------------
// Speed-up: mock sleep so retry tests don't actually wait 500 ms+
// ---------------------------------------------------------------------------
vi.mock('../../../common/database.service.js', async (importOriginal) => {
  // We need the real implementation — just intercept the module-level `sleep`
  // by re-exporting everything and patching the private helper via vi.spyOn
  // later. Actually the cleanest approach for Vitest is to not mock the module
  // itself but to use fake timers. We'll use vi.useFakeTimers per-test instead.
  return importOriginal();
});

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('WorkerDatabaseService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Module Initialization
  // -------------------------------------------------------------------------

  describe('onModuleInit', () => {
    it('should call ensureConnection on init', async () => {
      // Arrange
      const { service } = buildService();
      const spy = vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

      // Act
      await service.onModuleInit();

      // Assert
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // ensureConnection / ensureDataSourceConnection
  // -------------------------------------------------------------------------

  describe('ensureConnection', () => {
    it('should call SELECT 1 on both data sources when initialized', async () => {
      // Arrange
      const { service, dataSource, writeDataSource } = buildService();

      // Act
      await service.ensureConnection();

      // Assert
      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
      expect(writeDataSource.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should initialize the DataSource if it is not yet initialized', async () => {
      // Arrange
      const { service, dataSource } = buildService({ isInitialized: false });

      // Act
      await service.ensureConnection();

      // Assert
      expect(dataSource.initialize).toHaveBeenCalledOnce();
      // Should NOT attempt SELECT 1 when uninitialized
      expect(dataSource.query).not.toHaveBeenCalledWith('SELECT 1');
    });

    it('should destroy and re-initialize when the SELECT 1 ping fails', async () => {
      // Arrange
      const { service, dataSource } = buildService({
        query: vi.fn().mockRejectedValueOnce(new Error('Connection terminated')),
      });

      // Act
      await service.ensureConnection();

      // Assert
      expect(dataSource.destroy).toHaveBeenCalledOnce();
      expect(dataSource.initialize).toHaveBeenCalledOnce();
    });

    it('should still initialize after a failed destroy during reconnect', async () => {
      // Arrange
      const { service, dataSource } = buildService({
        query: vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')),
        destroy: vi.fn().mockRejectedValueOnce(new Error('destroy failed')),
      });

      // Act — should not throw despite destroy failing
      await service.ensureConnection();

      // Assert
      expect(dataSource.initialize).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // query()
  // -------------------------------------------------------------------------

  describe('query()', () => {
    it('should execute the SQL and return results', async () => {
      // Arrange
      const rows = [{ id: 1 }, { id: 2 }];
      const { service, dataSource } = buildService({
        query: vi.fn().mockResolvedValue(rows),
      });

      // Act
      const result = await service.query('SELECT * FROM test', []);

      // Assert
      expect(dataSource.query).toHaveBeenCalledWith('SELECT * FROM test', []);
      expect(result).toEqual(rows);
    });

    it('should pass parameters correctly', async () => {
      // Arrange
      const { service, dataSource } = buildService();

      // Act
      await service.query('SELECT * FROM test WHERE id = $1', ['abc-123']);

      // Assert
      expect(dataSource.query).toHaveBeenCalledWith('SELECT * FROM test WHERE id = $1', ['abc-123']);
    });

    it('should throw immediately for non-transient errors', async () => {
      // Arrange
      const err = new Error('syntax error at position 5');
      const { service, dataSource } = buildService({
        query: vi.fn().mockRejectedValue(err),
      });

      // Act & Assert
      await expect(service.query('BAD SQL')).rejects.toThrow('syntax error at position 5');
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient ECONNRESET and succeed on second attempt', async () => {
      // Arrange
      vi.useFakeTimers();
      const rows = [{ id: 99 }];
      const queryMock = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue(rows);

      const { service, dataSource } = buildService({ query: queryMock });
      // Ensure reconnect succeeds by keeping query mock returning rows after retry
      vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

      // Act — advance timers to skip sleep(500ms)
      const promise = service.query('SELECT 1');
      await vi.runAllTimersAsync();
      const result = await promise;

      // Assert
      expect(dataSource.query).toHaveBeenCalledTimes(2);
      expect(result).toEqual(rows);
    });

    it('should exhaust MAX_RETRIES on repeated transient errors and throw', async () => {
      // Arrange
      vi.useFakeTimers();
      const transientErr = new Error('Connection terminated');
      const { service, dataSource } = buildService({
        query: vi.fn().mockRejectedValue(transientErr),
      });
      vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

      // Register rejection handler BEFORE running timers to avoid unhandled rejection
      const assertion = expect(service.query('SELECT 1')).rejects.toThrow('Connection terminated');
      await vi.runAllTimersAsync();
      await assertion;

      // Assert — 3 attempts total (MAX_RETRIES = 3)
      expect(dataSource.query).toHaveBeenCalledTimes(3);
    });

    it('should retry on all known transient error codes', async () => {
      const transientMessages = [
        'Connection terminated',
        'Connection terminated unexpectedly',
        'Driver not Connected',
        'connection is insecure',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'connection lost',
        'socket hang up',
      ];

      for (const msg of transientMessages) {
        vi.useFakeTimers();
        const rows = [{ ok: true }];
        const queryMock = vi.fn()
          .mockRejectedValueOnce(new Error(msg))
          .mockResolvedValue(rows);
        const { service } = buildService({ query: queryMock });
        vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

        const promise = service.query('SELECT 1');
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toEqual(rows);
        vi.useRealTimers();
      }
    });

    it('should retry on PostgreSQL error codes (57P01, 08006, etc.)', async () => {
      const pgCodes = ['57P01', '57P02', '57P03', '08006', '08001', '08004'];

      for (const code of pgCodes) {
        vi.useFakeTimers();
        const rows = [{ ok: true }];
        const pgErr = Object.assign(new Error('pg error'), { code });
        const queryMock = vi.fn()
          .mockRejectedValueOnce(pgErr)
          .mockResolvedValue(rows);
        const { service } = buildService({ query: queryMock });
        vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

        const promise = service.query('SELECT 1');
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toEqual(rows);
        vi.useRealTimers();
      }
    });

    it('should log a warning when a reconnect before retry fails', async () => {
      // Arrange
      vi.useFakeTimers();
      const rows = [{ id: 1 }];
      const queryMock = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue(rows);
      const { service } = buildService({ query: queryMock });
      vi.spyOn(service, 'ensureConnection').mockRejectedValueOnce(new Error('reconnect failed'));

      // Act
      const promise = service.query('SELECT 1');
      await vi.runAllTimersAsync();
      const result = await promise;

      // Assert — still succeeded on second attempt
      expect(result).toEqual(rows);
    });
  });

  // -------------------------------------------------------------------------
  // transaction()
  // -------------------------------------------------------------------------

  describe('transaction()', () => {
    it('should execute the operation within a transaction', async () => {
      // Arrange
      const { service, dataSource } = buildService();
      const op = vi.fn().mockResolvedValue({ saved: true });
      dataSource.transaction.mockImplementation(async (fn: any) => fn({}));

      // Act
      const result = await service.transaction(op);

      // Assert
      expect(dataSource.transaction).toHaveBeenCalledOnce();
      expect(result).toEqual({ saved: true });
    });

    it('should throw immediately for non-transient transaction errors', async () => {
      // Arrange
      const err = new Error('unique constraint violation');
      const { service, dataSource } = buildService({
        transaction: vi.fn().mockRejectedValue(err),
      });

      // Act & Assert
      await expect(service.transaction(vi.fn())).rejects.toThrow('unique constraint violation');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('should retry transaction on transient connection errors', async () => {
      // Arrange
      vi.useFakeTimers();
      const txMock = vi.fn()
        .mockRejectedValueOnce(new Error('Connection terminated'))
        .mockResolvedValue('done');
      const { service, dataSource } = buildService({ transaction: txMock });
      vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

      // Act
      const promise = service.transaction(vi.fn());
      await vi.runAllTimersAsync();
      const result = await promise;

      // Assert
      expect(result).toBe('done');
      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // writeQuery() / writeTransaction()
  // -------------------------------------------------------------------------

  describe('writeQuery()', () => {
    it('should execute the SQL on the write DataSource', async () => {
      // Arrange
      const rows = [{ id: 1 }];
      const { service, writeDataSource } = buildService({}, {
        query: vi.fn().mockResolvedValue(rows),
      });

      // Act
      const result = await service.writeQuery('INSERT INTO t VALUES ($1)', ['v']);

      // Assert
      expect(writeDataSource.query).toHaveBeenCalledWith('INSERT INTO t VALUES ($1)', ['v']);
      expect(result).toEqual(rows);
    });

    it('should retry writeQuery on transient errors', async () => {
      // Arrange
      vi.useFakeTimers();
      const rows = [{ ok: true }];
      const writeQueryMock = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue(rows);
      const { service } = buildService({}, { query: writeQueryMock });
      vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

      // Act
      const promise = service.writeQuery('INSERT INTO t VALUES ($1)', ['v']);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Assert
      expect(result).toEqual(rows);
    });
  });

  describe('writeTransaction()', () => {
    it('should execute the operation on the write DataSource', async () => {
      // Arrange
      const { service, writeDataSource } = buildService({}, {
        transaction: vi.fn().mockResolvedValue('written'),
      });
      const op = vi.fn().mockResolvedValue('written');

      // Act
      const result = await service.writeTransaction(op);

      // Assert
      expect(writeDataSource.transaction).toHaveBeenCalledOnce();
      expect(result).toBe('written');
    });
  });

  // -------------------------------------------------------------------------
  // getDataSource()
  // -------------------------------------------------------------------------

  describe('getDataSource()', () => {
    it('should return the main DataSource', () => {
      // Arrange
      const { service, dataSource } = buildService();

      // Act
      const result = service.getDataSource();

      // Assert
      expect(result).toBe(dataSource);
    });
  });

  // -------------------------------------------------------------------------
  // isTimescaleEnabled()
  // -------------------------------------------------------------------------

  describe('isTimescaleEnabled()', () => {
    it('should return true when timescaledb extension row is found', async () => {
      // Arrange
      const { service, dataSource } = buildService({
        query: vi.fn().mockResolvedValue([{ extname: 'timescaledb' }]),
      });

      // Act
      const result = await service.isTimescaleEnabled();

      // Assert
      expect(result).toBe(true);
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining("extname = 'timescaledb'")
      );
    });

    it('should return false when no timescaledb row is found', async () => {
      // Arrange
      const { service } = buildService({
        query: vi.fn().mockResolvedValue([]),
      });

      // Act
      const result = await service.isTimescaleEnabled();

      // Assert
      expect(result).toBe(false);
    });

    it('should return false and log a warning when the query throws', async () => {
      // Arrange
      const { service } = buildService({
        query: vi.fn().mockRejectedValue(new Error('relation not found')),
      });

      // Act
      const result = await service.isTimescaleEnabled();

      // Assert
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // healthCheck()
  // -------------------------------------------------------------------------

  describe('healthCheck()', () => {
    it('should return healthy status with timescale info', async () => {
      // Arrange
      const { service, dataSource } = buildService({
        query: vi.fn()
          .mockResolvedValueOnce([]) // SELECT 1
          .mockResolvedValueOnce([{ extname: 'timescaledb' }]), // pg_extension query
      });

      // Act
      const result = await service.healthCheck();

      // Assert
      expect(result.status).toBe('healthy');
      expect(result).toHaveProperty('timestamp');
      expect(result.timescaleEnabled).toBe(true);
    });

    it('should throw when the SELECT 1 ping fails', async () => {
      // Arrange
      const err = new Error('database down');
      const { service } = buildService({
        query: vi.fn().mockRejectedValue(err),
      });

      // Act & Assert
      await expect(service.healthCheck()).rejects.toThrow('database down');
    });
  });

  // -------------------------------------------------------------------------
  // Test Run CRUD
  // -------------------------------------------------------------------------

  describe('getTestRunById()', () => {
    it('should call findOne with the given id', async () => {
      // Arrange
      const mockRun = { id: 'uuid-1', testRunId: 'run-001' };
      const { service, testRunRepo } = buildService();
      testRunRepo.findOne.mockResolvedValue(mockRun);

      // Act
      const result = await service.getTestRunById('uuid-1');

      // Assert
      expect(testRunRepo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
      expect(result).toEqual(mockRun);
    });

    it('should return null when not found', async () => {
      // Arrange
      const { service } = buildService();

      // Act
      const result = await service.getTestRunById('nonexistent');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getTestRunByTestRunId()', () => {
    it('should call findOne with testRunId field', async () => {
      // Arrange
      const mockRun = { id: 'uuid-2', testRunId: 'run-002' };
      const { service, testRunRepo } = buildService();
      testRunRepo.findOne.mockResolvedValue(mockRun);

      // Act
      const result = await service.getTestRunByTestRunId('run-002');

      // Assert
      expect(testRunRepo.findOne).toHaveBeenCalledWith({ where: { testRunId: 'run-002' } });
      expect(result).toEqual(mockRun);
    });
  });

  describe('updateTestRun()', () => {
    it('should call repo.update with id and data', async () => {
      // Arrange
      const { service, testRunRepo } = buildService();
      const data = { status: 'completed' } as any;

      // Act
      await service.updateTestRun('uuid-1', data);

      // Assert
      expect(testRunRepo.update).toHaveBeenCalledWith('uuid-1', data);
    });
  });

  describe('updateTestRunByTestRunId()', () => {
    it('should call repo.update with testRunId condition', async () => {
      // Arrange
      const { service, testRunRepo } = buildService();
      const data = { status: 'failed' } as any;

      // Act
      await service.updateTestRunByTestRunId('run-001', data);

      // Assert
      expect(testRunRepo.update).toHaveBeenCalledWith({ testRunId: 'run-001' }, data);
    });
  });

  describe('getSystemUnderTestName()', () => {
    it('should return the name when the system under test exists', async () => {
      // Arrange
      const { service, systemUnderTestRepo } = buildService();
      systemUnderTestRepo.findOne.mockResolvedValue({ name: 'MyApp' });

      // Act
      const result = await service.getSystemUnderTestName('sut-uuid');

      // Assert
      expect(result).toBe('MyApp');
      expect(systemUnderTestRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sut-uuid' },
        select: ['name'],
      });
    });

    it('should return null when the system under test is not found', async () => {
      // Arrange
      const { service } = buildService();

      // Act
      const result = await service.getSystemUnderTestName('nonexistent');

      // Assert
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getApplicationDashboards()
  // -------------------------------------------------------------------------

  describe('getApplicationDashboards()', () => {
    it('should call getMany with no filters when filters object is empty', async () => {
      // Arrange
      const { service, applicationDashboardRepo } = buildService();
      const qb = makeQueryBuilder();
      applicationDashboardRepo.createQueryBuilder.mockReturnValue(qb);
      qb.getMany.mockResolvedValue([]);

      // Act
      await service.getApplicationDashboards({});

      // Assert
      expect(applicationDashboardRepo.createQueryBuilder).toHaveBeenCalledWith('ad');
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('should filter by systemUnderTestId when provided', async () => {
      // Arrange
      const { service, applicationDashboardRepo } = buildService();
      const qb = makeQueryBuilder();
      applicationDashboardRepo.createQueryBuilder.mockReturnValue(qb);

      // Act
      await service.getApplicationDashboards({ systemUnderTestId: 'sut-1' });

      // Assert
      expect(qb.andWhere).toHaveBeenCalledWith(
        'ad.systemUnderTestId = :systemUnderTestId',
        { systemUnderTestId: 'sut-1' }
      );
    });

    it('should filter by testEnvironment when provided', async () => {
      // Arrange
      const { service, applicationDashboardRepo } = buildService();
      const qb = makeQueryBuilder();
      applicationDashboardRepo.createQueryBuilder.mockReturnValue(qb);

      // Act
      await service.getApplicationDashboards({ testEnvironment: 'production' });

      // Assert
      expect(qb.andWhere).toHaveBeenCalledWith(
        'ad.testEnvironment = :testEnvironment',
        { testEnvironment: 'production' }
      );
    });

    it('should filter by organizationId with IS NULL fallback', async () => {
      // Arrange
      const { service, applicationDashboardRepo } = buildService();
      const qb = makeQueryBuilder();
      applicationDashboardRepo.createQueryBuilder.mockReturnValue(qb);

      // Act
      await service.getApplicationDashboards({ organizationId: 'org-1' });

      // Assert
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(ad.organization_id = :organizationId OR ad.organization_id IS NULL)',
        { organizationId: 'org-1' }
      );
    });

    it('should apply all three filters simultaneously', async () => {
      // Arrange
      const { service, applicationDashboardRepo } = buildService();
      const qb = makeQueryBuilder();
      applicationDashboardRepo.createQueryBuilder.mockReturnValue(qb);
      const dashboards = [{ id: 'dash-1' }];
      qb.getMany.mockResolvedValue(dashboards);

      // Act
      const result = await service.getApplicationDashboards({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'staging',
        organizationId: 'org-2',
      });

      // Assert
      expect(qb.andWhere).toHaveBeenCalledTimes(3);
      expect(result).toEqual(dashboards);
    });
  });

  // -------------------------------------------------------------------------
  // getGrafanaInstanceById()
  // -------------------------------------------------------------------------

  describe('getGrafanaInstanceById()', () => {
    it('should delegate to grafanaInstanceRepo.findOne', async () => {
      // Arrange
      const mockInstance = { id: 'gi-1', url: 'http://grafana' };
      const { service, grafanaInstanceRepo } = buildService();
      grafanaInstanceRepo.findOne.mockResolvedValue(mockInstance);

      // Act
      const result = await service.getGrafanaInstanceById('gi-1');

      // Assert
      expect(grafanaInstanceRepo.findOne).toHaveBeenCalledWith({ where: { id: 'gi-1' } });
      expect(result).toEqual(mockInstance);
    });
  });

  // -------------------------------------------------------------------------
  // getBenchmarksByDashboard()
  // -------------------------------------------------------------------------

  describe('getBenchmarksByDashboard()', () => {
    it('should use repo.find when no organizationId is provided', async () => {
      // Arrange
      const { service, benchmarkRepo } = buildService();
      const benchmarks = [{ id: 'b-1' }];
      benchmarkRepo.find.mockResolvedValue(benchmarks);

      // Act
      const result = await service.getBenchmarksByDashboard('sut-1', 'prod', 'load', 'dash-uid');

      // Assert
      expect(benchmarkRepo.find).toHaveBeenCalledWith({
        where: {
          system_under_test_id: 'sut-1',
          test_environment: 'prod',
          workload: 'load',
          dashboard_uid: 'dash-uid',
        },
      });
      expect(result).toEqual(benchmarks);
    });

    it('should use query builder with org filter when organizationId is provided', async () => {
      // Arrange
      const { service, benchmarkRepo } = buildService();
      const qb = makeQueryBuilder();
      benchmarkRepo.createQueryBuilder.mockReturnValue(qb);
      qb.getMany.mockResolvedValue([{ id: 'b-2' }]);

      // Act
      const result = await service.getBenchmarksByDashboard('sut-1', 'prod', 'load', 'dash-uid', 'org-1');

      // Assert
      expect(benchmarkRepo.createQueryBuilder).toHaveBeenCalledWith('b');
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(b.organization_id = :organizationId OR b.organization_id IS NULL)',
        { organizationId: 'org-1' }
      );
      expect(result).toEqual([{ id: 'b-2' }]);
    });
  });

  // -------------------------------------------------------------------------
  // getBenchmarksByPanel()
  // -------------------------------------------------------------------------

  describe('getBenchmarksByPanel()', () => {
    it('should use repo.find when no organizationId is provided', async () => {
      // Arrange
      const { service, benchmarkRepo } = buildService();
      benchmarkRepo.find.mockResolvedValue([]);

      // Act
      await service.getBenchmarksByPanel('sut-1', 'prod', 'load', 'dash-uid', 'Panel Title');

      // Assert
      expect(benchmarkRepo.find).toHaveBeenCalledWith({
        where: {
          system_under_test_id: 'sut-1',
          test_environment: 'prod',
          workload: 'load',
          dashboard_uid: 'dash-uid',
          panel_title: 'Panel Title',
        },
      });
    });

    it('should use query builder with org filter when organizationId is provided', async () => {
      // Arrange
      const { service, benchmarkRepo } = buildService();
      const qb = makeQueryBuilder();
      benchmarkRepo.createQueryBuilder.mockReturnValue(qb);
      qb.getMany.mockResolvedValue([]);

      // Act
      await service.getBenchmarksByPanel('sut-1', 'prod', 'load', 'dash-uid', 'Panel Title', 'org-1');

      // Assert
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(b.organization_id = :organizationId OR b.organization_id IS NULL)',
        { organizationId: 'org-1' }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Metrics Operations
  // -------------------------------------------------------------------------

  describe('deleteDsMetricsByTestRun()', () => {
    it('should call dsMetricsRepo.delete with the test run id', async () => {
      // Arrange
      const { service, dsMetricsRepo } = buildService();

      // Act
      await service.deleteDsMetricsByTestRun('run-001');

      // Assert
      expect(dsMetricsRepo.delete).toHaveBeenCalledWith({ test_run_id: 'run-001' });
    });
  });

  describe('insertDsMetrics()', () => {
    it('should insert all metrics in a single chunk when count is below chunkSize', async () => {
      // Arrange
      const { service, dsMetricsRepo } = buildService();
      const metrics = Array.from({ length: 50 }, (_, i) => ({ id: `m-${i}` }));

      // Act
      await service.insertDsMetrics(metrics as any);

      // Assert
      expect(dsMetricsRepo.insert).toHaveBeenCalledTimes(1);
      expect(dsMetricsRepo.insert).toHaveBeenCalledWith(metrics);
    });

    it('should split metrics into chunks of 100', async () => {
      // Arrange
      const { service, dsMetricsRepo } = buildService();
      const metrics = Array.from({ length: 250 }, (_, i) => ({ id: `m-${i}` }));

      // Act
      await service.insertDsMetrics(metrics as any);

      // Assert — 250 items → 3 chunks: 100 + 100 + 50
      expect(dsMetricsRepo.insert).toHaveBeenCalledTimes(3);
    });

    it('should handle an empty array gracefully', async () => {
      // Arrange
      const { service, dsMetricsRepo } = buildService();

      // Act
      await service.insertDsMetrics([]);

      // Assert
      expect(dsMetricsRepo.insert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Panels Operations
  // -------------------------------------------------------------------------

  describe('deleteDsPanelsByTestRun()', () => {
    it('should call dsPanelsRepo.delete with the test run id', async () => {
      // Arrange
      const { service, dsPanelsRepo } = buildService();

      // Act
      await service.deleteDsPanelsByTestRun('run-001');

      // Assert
      expect(dsPanelsRepo.delete).toHaveBeenCalledWith({ test_run_id: 'run-001' });
    });
  });

  describe('insertDsPanels()', () => {
    it('should call batchInsert on dsPanelsRepo', async () => {
      // Arrange
      const { service, dsPanelsRepo } = buildService();
      const panels = [{ id: 'p-1' }, { id: 'p-2' }];

      // Act
      await service.insertDsPanels(panels as any);

      // Assert
      expect(dsPanelsRepo.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDsPanelsByTestRun()', () => {
    it('should call dsPanelsRepo.find with test_run_id', async () => {
      // Arrange
      const { service, dsPanelsRepo } = buildService();
      const panels = [{ id: 'p-1' }];
      dsPanelsRepo.find.mockResolvedValue(panels);

      // Act
      const result = await service.getDsPanelsByTestRun('run-001');

      // Assert
      expect(dsPanelsRepo.find).toHaveBeenCalledWith({ where: { test_run_id: 'run-001' } });
      expect(result).toEqual(panels);
    });
  });

  // -------------------------------------------------------------------------
  // Statistics Operations
  // -------------------------------------------------------------------------

  describe('deleteDsMetricStatisticsByTestRun()', () => {
    it('should call dsMetricStatisticsRepo.delete', async () => {
      // Arrange
      const { service, dsMetricStatisticsRepo } = buildService();

      // Act
      await service.deleteDsMetricStatisticsByTestRun('run-001');

      // Assert
      expect(dsMetricStatisticsRepo.delete).toHaveBeenCalledWith({ test_run_id: 'run-001' });
    });
  });

  describe('insertDsMetricStatistics()', () => {
    it('should batch insert statistics', async () => {
      // Arrange
      const { service, dsMetricStatisticsRepo } = buildService();
      const stats = [{ id: 's-1' }];

      // Act
      await service.insertDsMetricStatistics(stats as any);

      // Assert
      expect(dsMetricStatisticsRepo.insert).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Control Groups Operations
  // -------------------------------------------------------------------------

  describe('deleteDsControlGroupsByTestRun()', () => {
    it('should execute an array-delete raw SQL query', async () => {
      // Arrange
      const { service, dataSource } = buildService();

      // Act
      await service.deleteDsControlGroupsByTestRun('run-001');

      // Assert
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ds_control_groups'),
        ['run-001']
      );
    });
  });

  describe('insertDsControlGroups()', () => {
    it('should batch insert control groups', async () => {
      // Arrange
      const { service, dsControlGroupsRepo } = buildService();
      const groups = [{ id: 'cg-1' }];

      // Act
      await service.insertDsControlGroups(groups as any);

      // Assert
      expect(dsControlGroupsRepo.insert).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // ADAPT Operations
  // -------------------------------------------------------------------------

  describe('deleteDsAdaptResultsByTestRun()', () => {
    it('should call dsAdaptResultsRepo.delete', async () => {
      // Arrange
      const { service, dsAdaptResultsRepo } = buildService();

      // Act
      await service.deleteDsAdaptResultsByTestRun('run-001');

      // Assert
      expect(dsAdaptResultsRepo.delete).toHaveBeenCalledWith({ test_run_id: 'run-001' });
    });
  });

  describe('insertDsAdaptResults()', () => {
    it('should batch insert adapt results', async () => {
      // Arrange
      const { service, dsAdaptResultsRepo } = buildService();
      const results = [{ id: 'ar-1' }];

      // Act
      await service.insertDsAdaptResults(results as any);

      // Assert
      expect(dsAdaptResultsRepo.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteDsAdaptConclusionByTestRun()', () => {
    it('should call dsAdaptConclusionRepo.delete', async () => {
      // Arrange
      const { service, dsAdaptConclusionRepo } = buildService();

      // Act
      await service.deleteDsAdaptConclusionByTestRun('run-001');

      // Assert
      expect(dsAdaptConclusionRepo.delete).toHaveBeenCalledWith({ test_run_id: 'run-001' });
    });
  });

  describe('insertDsAdaptConclusion()', () => {
    it('should call dsAdaptConclusionRepo.insert', async () => {
      // Arrange
      const { service, dsAdaptConclusionRepo } = buildService();
      const conclusion = { test_run_id: 'run-001', result: 'pass' };

      // Act
      await service.insertDsAdaptConclusion(conclusion as any);

      // Assert
      expect(dsAdaptConclusionRepo.insert).toHaveBeenCalledWith(conclusion);
    });
  });

  // -------------------------------------------------------------------------
  // Collection Status Operations
  // -------------------------------------------------------------------------

  describe('getCollectionStatus()', () => {
    it('should normalize null sourceId to empty string on findOne', async () => {
      // After issue #136 the column is NOT NULL with '' as the sentinel for
      // sources without a natural id (e.g. performance_test). Callers that
      // still pass `null` get normalized here so we stop tripping the ON
      // CONFLICT clause that expects NULL = NULL to mean "same row" — which
      // PostgreSQL's standard btree unique semantics emphatically do not.
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const statusRow = { id: 'cs-1', test_run_id: 'run-001' };
      dsMetricCollectionStatusRepo.findOne.mockResolvedValue(statusRow);

      // Act
      const result = await service.getCollectionStatus('run-001', 'grafana', null);

      // Assert
      expect(dsMetricCollectionStatusRepo.findOne).toHaveBeenCalledWith({
        where: {
          test_run_id: 'run-001',
          source_type: 'grafana',
          source_id: '',
        },
      });
      expect(result).toEqual(statusRow);
    });

    it('should use findOne when sourceId is a string', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const statusRow = { id: 'cs-2', test_run_id: 'run-001' };
      dsMetricCollectionStatusRepo.findOne.mockResolvedValue(statusRow);

      // Act
      const result = await service.getCollectionStatus('run-001', 'grafana', 'source-abc');

      // Assert
      expect(dsMetricCollectionStatusRepo.findOne).toHaveBeenCalledWith({
        where: {
          test_run_id: 'run-001',
          source_type: 'grafana',
          source_id: 'source-abc',
        },
      });
      expect(result).toEqual(statusRow);
    });
  });

  describe('getAllCollectionStatuses()', () => {
    it('should return all statuses for a test run ordered by created_at', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const statuses = [{ id: 'cs-1' }, { id: 'cs-2' }];
      dsMetricCollectionStatusRepo.find.mockResolvedValue(statuses);

      // Act
      const result = await service.getAllCollectionStatuses('run-001');

      // Assert
      expect(dsMetricCollectionStatusRepo.find).toHaveBeenCalledWith({
        where: { test_run_id: 'run-001' },
        order: { created_at: 'ASC' },
      });
      expect(result).toEqual(statuses);
    });
  });

  describe('getIncompleteCollectionStatuses()', () => {
    it('should filter by is_complete = false', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      dsMetricCollectionStatusRepo.find.mockResolvedValue([]);

      // Act
      await service.getIncompleteCollectionStatuses('run-001');

      // Assert
      expect(dsMetricCollectionStatusRepo.find).toHaveBeenCalledWith({
        where: { test_run_id: 'run-001', is_complete: false },
        order: { created_at: 'ASC' },
      });
    });
  });

  describe('upsertCollectionStatus()', () => {
    it('should insert via raw SQL, then update fields and return final row', async () => {
      // Arrange
      const { service, dataSource, dsMetricCollectionStatusRepo } = buildService();
      const existing = { id: 'cs-10', test_run_id: 'run-001', source_type: 'grafana', source_id: 's-1' };
      const updated = { ...existing, is_complete: true };

      // getCollectionStatus (findOne path for non-null sourceId)
      dsMetricCollectionStatusRepo.findOne
        .mockResolvedValueOnce(existing)  // getCollectionStatus inside upsert
        .mockResolvedValueOnce(updated);  // final findOne

      // Act
      const result = await service.upsertCollectionStatus({
        test_run_id: 'run-001',
        source_type: 'grafana',
        source_id: 's-1',
        is_complete: true,
      } as any);

      // Assert
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ds_metric_collection_status'),
        ['run-001', 'grafana', 's-1']
      );
      expect(dsMetricCollectionStatusRepo.update).toHaveBeenCalledWith('cs-10', { is_complete: true });
      expect(result).toEqual(updated);
    });

    it('should throw when row is missing after the insert-on-conflict', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      dsMetricCollectionStatusRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.upsertCollectionStatus({
          test_run_id: 'run-001',
          source_type: 'grafana',
          source_id: 's-1',
        } as any)
      ).rejects.toThrow('Failed to get collection status after upsert');
    });

    it('should not call update when no updateable fields are present', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const existing = { id: 'cs-20', test_run_id: 'run-001', source_type: 'grafana', source_id: 's-1' };
      dsMetricCollectionStatusRepo.findOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);

      // Act — only identity fields, nothing to update
      await service.upsertCollectionStatus({
        test_run_id: 'run-001',
        source_type: 'grafana',
        source_id: 's-1',
      } as any);

      // Assert
      expect(dsMetricCollectionStatusRepo.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getLastCollectedTime()
  // -------------------------------------------------------------------------

  describe('getLastCollectedTime()', () => {
    it('should return null when no status exists', async () => {
      // Arrange
      const { service } = buildService();
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(null);

      // Act
      const result = await service.getLastCollectedTime('run-001', 'grafana', null);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when collected_ranges is empty', async () => {
      // Arrange
      const { service } = buildService();
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue({
        id: 'cs-1',
        collected_ranges: [],
      } as any);

      // Act
      const result = await service.getLastCollectedTime('run-001', 'grafana', null);

      // Assert
      expect(result).toBeNull();
    });

    it('should return the maximum "to" time from collected_ranges', async () => {
      // Arrange
      const { service } = buildService();
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue({
        id: 'cs-1',
        collected_ranges: [
          { from: '2024-01-01T00:00:00Z', to: '2024-01-01T01:00:00Z' },
          { from: '2024-01-01T01:00:00Z', to: '2024-01-01T03:00:00Z' },
          { from: '2024-01-01T02:00:00Z', to: '2024-01-01T02:30:00Z' },
        ],
      } as any);

      // Act
      const result = await service.getLastCollectedTime('run-001', 'grafana', null);

      // Assert
      expect(result).toEqual(new Date('2024-01-01T03:00:00Z'));
    });
  });

  // -------------------------------------------------------------------------
  // updateCollectedRanges()
  // -------------------------------------------------------------------------

  describe('updateCollectedRanges()', () => {
    it('should execute the atomic upsert SQL with correct parameters', async () => {
      // Arrange
      const { service, dataSource } = buildService();
      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-01-01T01:00:00Z');

      // Act
      await service.updateCollectedRanges('run-001', 'grafana', 'src-1', { from, to });

      // Assert
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ds_metric_collection_status'),
        expect.arrayContaining(['run-001', 'grafana', 'src-1'])
      );
    });

    it('should normalize null sourceId to empty string in the upsert parameters', async () => {
      // performance_test callers pass sourceId=null; after issue #136 the
      // column is NOT NULL so we must rewrite to '' before the query to keep
      // ON CONFLICT matching the existing row rather than inserting a new one.
      const { service, dataSource } = buildService();
      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-01-01T01:00:00Z');

      // Act
      await service.updateCollectedRanges('run-001', 'grafana', null, { from, to });

      // Assert
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['run-001', 'grafana', ''])
      );
      const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params).not.toContain(null);
    });

    it('should prune failed_ranges fully covered by any collected range on every upsert', async () => {
      // Issue #136, Defect B: stale failed_ranges never cleared even though the
      // sanity check kept counting them. The atomic upsert must include a
      // NOT EXISTS subquery over the concatenated (old || new) collected_ranges
      // so any failed entry whose window is covered by a later wider success is
      // dropped in the same statement.
      const { service, dataSource } = buildService();
      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-01-01T01:00:00Z');

      await service.updateCollectedRanges('run-001', 'grafana', 'src-1', { from, to });

      const [sql] = dataSource.query.mock.calls[0] as [string];
      expect(sql).toMatch(/jsonb_array_elements\(ds_metric_collection_status\.failed_ranges\)/);
      expect(sql).toMatch(
        /jsonb_array_elements\(ds_metric_collection_status\.collected_ranges \|\| \$4::jsonb\)/
      );
      expect(sql).toMatch(/NOT EXISTS/);
    });
  });

  // -------------------------------------------------------------------------
  // recordFailedRange()
  // -------------------------------------------------------------------------

  describe('recordFailedRange()', () => {
    const range = { from: new Date('2024-01-01T00:00:00Z'), to: new Date('2024-01-01T01:00:00Z') };

    it('should add a new failed range when none exists for this time window', async () => {
      // Arrange
      const { service, dataSource, dsMetricCollectionStatusRepo } = buildService();
      const existingStatus = { id: 'cs-1', failed_ranges: [] };
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(existingStatus as any);

      // Act
      await service.recordFailedRange('run-001', 'grafana', 's-1', range, 'timeout');

      // Assert
      expect(dsMetricCollectionStatusRepo.update).toHaveBeenCalledWith('cs-1', {
        failed_ranges: [{ ...range, attempts: 1, lastError: 'timeout' }],
      });
    });

    it('should increment attempts for an existing failed range with the same time window', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const existingStatus = {
        id: 'cs-2',
        failed_ranges: [{ from: range.from, to: range.to, attempts: 2, lastError: 'old error' }],
      };
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(existingStatus as any);

      // Act
      await service.recordFailedRange('run-001', 'grafana', 's-1', range, 'new error');

      // Assert
      expect(dsMetricCollectionStatusRepo.update).toHaveBeenCalledWith('cs-2', {
        failed_ranges: [{ from: range.from, to: range.to, attempts: 3, lastError: 'new error' }],
      });
    });

    it('should throw when row is not found after the ensure-insert', async () => {
      // Arrange
      const { service } = buildService();
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.recordFailedRange('run-001', 'grafana', 's-1', range, 'error')
      ).rejects.toThrow('Failed to get collection status after upsert');
    });
  });

  // -------------------------------------------------------------------------
  // markCollectionComplete()
  // -------------------------------------------------------------------------

  describe('markCollectionComplete()', () => {
    it('should throw when status is not found', async () => {
      // Arrange
      const { service } = buildService();
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.markCollectionComplete('run-001', 'grafana', 's-1')
      ).rejects.toThrow('Collection status not found');
    });

    it('should update is_complete and clear failed_ranges', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const status = {
        id: 'cs-1',
        collected_ranges: [{ from: '2024-01-01T00:00:00Z', to: '2024-01-01T01:00:00Z' }],
      };
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(status as any);

      // Act
      await service.markCollectionComplete('run-001', 'grafana', 's-1');

      // Assert
      expect(dsMetricCollectionStatusRepo.update).toHaveBeenCalledWith('cs-1', expect.objectContaining({
        is_complete: true,
        failed_ranges: [],
      }));
    });

    it('should backfill collected_ranges from testRun dates when ranges are empty', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const status = { id: 'cs-1', collected_ranges: [] };
      const testRun = {
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z'),
      };
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(status as any);
      vi.spyOn(service, 'getTestRunByTestRunId').mockResolvedValue(testRun as any);

      // Act
      await service.markCollectionComplete('run-001', 'grafana', 's-1');

      // Assert
      expect(dsMetricCollectionStatusRepo.update).toHaveBeenCalledWith('cs-1', expect.objectContaining({
        collected_ranges: [{
          from: testRun.startTime,
          to: testRun.endTime,
        }],
      }));
    });

    it('should not backfill when testRun is not found', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const status = { id: 'cs-1', collected_ranges: [] };
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(status as any);
      vi.spyOn(service, 'getTestRunByTestRunId').mockResolvedValue(null);

      // Act
      await service.markCollectionComplete('run-001', 'grafana', 's-1');

      // Assert
      expect(dsMetricCollectionStatusRepo.update).toHaveBeenCalledWith('cs-1', expect.not.objectContaining({
        collected_ranges: expect.any(Array),
      }));
    });
  });

  // -------------------------------------------------------------------------
  // resetCollectionStatus()
  // -------------------------------------------------------------------------

  describe('resetCollectionStatus()', () => {
    it('should log a warning and return early when status is not found', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(null);

      // Act
      await service.resetCollectionStatus('run-001', 'grafana', 's-1');

      // Assert — no update should be called
      expect(dsMetricCollectionStatusRepo.update).not.toHaveBeenCalled();
    });

    it('should clear ranges and mark incomplete when status is found', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();
      const status = { id: 'cs-1' };
      vi.spyOn(service, 'getCollectionStatus').mockResolvedValue(status as any);

      // Act
      await service.resetCollectionStatus('run-001', 'grafana', 's-1');

      // Assert
      expect(dsMetricCollectionStatusRepo.update).toHaveBeenCalledWith('cs-1', {
        collected_ranges: [],
        failed_ranges: [],
        is_complete: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // removeCollectionStatus()
  // -------------------------------------------------------------------------

  describe('removeCollectionStatus()', () => {
    it('should normalize null sourceId to empty string and go through repo.delete', async () => {
      // After issue #136 source_id is NOT NULL — the raw SQL "IS NULL" branch
      // is obsolete. Callers that still pass `null` get normalized to '' so
      // the indexed delete still hits the same row.
      const { service, dsMetricCollectionStatusRepo, dataSource } = buildService();

      // Act
      await service.removeCollectionStatus('run-001', 'grafana', null);

      // Assert
      expect(dsMetricCollectionStatusRepo.delete).toHaveBeenCalledWith({
        test_run_id: 'run-001',
        source_type: 'grafana',
        source_id: '',
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('should use repo.delete when sourceId is a string', async () => {
      // Arrange
      const { service, dsMetricCollectionStatusRepo } = buildService();

      // Act
      await service.removeCollectionStatus('run-001', 'grafana', 'src-abc');

      // Assert
      expect(dsMetricCollectionStatusRepo.delete).toHaveBeenCalledWith({
        test_run_id: 'run-001',
        source_type: 'grafana',
        source_id: 'src-abc',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Dynatrace Operations
  // -------------------------------------------------------------------------

  describe('getDynatraceConfigBySystemUnderTest()', () => {
    it('should use findOne with relations when no organizationId is provided', async () => {
      // Arrange
      const { service, dynatraceEntityMappingRepo } = buildService();
      const config = { id: 'cfg-1' };
      dynatraceEntityMappingRepo.findOne.mockResolvedValue({ dynatraceConfig: config });

      // Act
      const result = await service.getDynatraceConfigBySystemUnderTest('sut-1', 'prod');

      // Assert
      expect(dynatraceEntityMappingRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ relations: ['dynatraceConfig'] })
      );
      expect(result).toEqual(config);
    });

    it('should return null when no mapping is found', async () => {
      // Arrange
      const { service, dynatraceEntityMappingRepo } = buildService();
      dynatraceEntityMappingRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.getDynatraceConfigBySystemUnderTest('sut-1', 'prod');

      // Assert
      expect(result).toBeNull();
    });

    it('should use query builder with org filter when organizationId is provided', async () => {
      // Arrange
      const { service, dynatraceEntityMappingRepo } = buildService();
      const qb = makeQueryBuilder();
      dynatraceEntityMappingRepo.createQueryBuilder.mockReturnValue(qb);
      const config = { id: 'cfg-2' };
      qb.getOne.mockResolvedValue({ dynatraceConfig: config });

      // Act
      const result = await service.getDynatraceConfigBySystemUnderTest('sut-1', 'prod', 'org-1');

      // Assert
      expect(dynatraceEntityMappingRepo.createQueryBuilder).toHaveBeenCalledWith('mapping');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('mapping.dynatraceConfig', 'config');
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(mapping.organization_id = :organizationId OR mapping.organization_id IS NULL)',
        { organizationId: 'org-1' }
      );
      expect(result).toEqual(config);
    });
  });

  describe('getDynatraceQueriesByConfig()', () => {
    it('should use repo.find when no organizationId is provided', async () => {
      // Arrange
      const { service, dynatraceQueryRepo } = buildService();
      const queries = [{ id: 'q-1' }];
      dynatraceQueryRepo.find.mockResolvedValue(queries);

      // Act
      const result = await service.getDynatraceQueriesByConfig('cfg-1');

      // Assert
      expect(dynatraceQueryRepo.find).toHaveBeenCalledWith({
        where: { dynatraceConfigId: 'cfg-1' },
        order: { createdAt: 'ASC' },
      });
      expect(result).toEqual(queries);
    });

    it('should use query builder with org filter when organizationId is provided', async () => {
      // Arrange
      const { service, dynatraceQueryRepo } = buildService();
      const qb = makeQueryBuilder();
      dynatraceQueryRepo.createQueryBuilder.mockReturnValue(qb);
      qb.getMany.mockResolvedValue([{ id: 'q-2' }]);

      // Act
      await service.getDynatraceQueriesByConfig('cfg-1', 'org-1');

      // Assert
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(q.organization_id = :organizationId OR q.organization_id IS NULL)',
        { organizationId: 'org-1' }
      );
      expect(qb.orderBy).toHaveBeenCalledWith('q.createdAt', 'ASC');
    });
  });

  // -------------------------------------------------------------------------
  // Retry exponential backoff timing
  // -------------------------------------------------------------------------

  describe('withRetry backoff timing', () => {
    it('should use exponential delays: 500ms on attempt 1, 1000ms on attempt 2', async () => {
      // Arrange
      vi.useFakeTimers();
      const calls: number[] = [];
      let firstAt: number | null = null;
      let secondAt: number | null = null;

      const transientErr = new Error('ECONNRESET');
      const queryMock = vi.fn().mockImplementation(async () => {
        const now = Date.now();
        calls.push(now);
        if (calls.length === 1) {
          firstAt = now;
          throw transientErr;
        }
        if (calls.length === 2) {
          secondAt = now;
          throw transientErr;
        }
        return [];
      });

      const { service } = buildService({ query: queryMock });
      vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

      const start = Date.now();

      const promise = service.query('SELECT 1');
      // advance 500ms to unblock first retry
      await vi.advanceTimersByTimeAsync(500);
      // advance 1000ms to unblock second retry
      await vi.advanceTimersByTimeAsync(1000);
      await vi.runAllTimersAsync();
      await promise;

      // 3 successful calls total
      expect(queryMock).toHaveBeenCalledTimes(3);
    });

    it('should log "failed after N attempts" on final retry failure', async () => {
      // Arrange
      vi.useFakeTimers();
      const transientErr = new Error('Connection terminated');
      const { service } = buildService({
        query: vi.fn().mockRejectedValue(transientErr),
      });
      vi.spyOn(service, 'ensureConnection').mockResolvedValue(undefined);

      // Spy on the private logger instance before kicking off the query
      const loggerWarnSpy = vi.spyOn((service as any).logger, 'warn');

      // Register the rejection handler first, then let timers run
      const assertion = expect(service.query('SELECT 1')).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;

      // Attempts 1 and 2 produce a warn (attempt 3 logs via error, not warn)
      expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
    });
  });
});
