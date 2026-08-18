/**
 * Unit tests for ReportDataFetcherService
 *
 * Tests cover:
 * - Organization filter clause construction (admin bypass, org membership, empty orgs)
 * - getRampUpCutoffTime: excludeRampUp flag, DB row handling, admin/non-admin paths
 * - getScenarioDataFromDatabase: data mapping, error pct, null-field safety, empty result, errors
 * - getApdexDataFromDatabase: weighted average math, scenario grouping, threshold logic, empty result
 * - getThroughputStatsForReport: overall + per-scenario mapping, org filter CTE variants, error path
 * - getVirtualUserStatsForReport: overall + per-scenario mapping, org filter join variants, error path
 * - getMockScenarioData: known scenarios, unknown scenario
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TestRun } from '@perfana/shared';
import { ReportDataFetcherService } from './report-data-fetcher.service';
import { AuthorizationService } from '../../../common/services/authorization.service';

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeTestRun = (overrides: Partial<TestRun> = {}): TestRun =>
  ({
    id: 'uuid-test-run-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'baseline',
    systemUnderTestId: 'sut-1',
    startTime: new Date('2025-01-01T10:00:00Z'),
    endTime: new Date('2025-01-01T11:00:00Z'),
    ...overrides,
  }) as TestRun;

const makeTransactionRow = (overrides: Record<string, string> = {}) => ({
  transaction_name: 'T01_Login',
  avg_ms: '120.50',
  p95_ms: '250.00',
  p99_ms: '350.75',
  pass: '990',
  fail: '10',
  total: '1000',
  ...overrides,
});

const makeApdexTransactionRow = (overrides: Record<string, string> = {}) => ({
  transaction_name: 'T01_Login',
  scenario_name: 'BrowseAndSearch',
  avg_ms: '100.00',
  p95_ms: '200.00',
  p99_ms: '300.00',
  pass: '900',
  fail: '100',
  total: '1000',
  satisfied: '800',
  tolerating: '150',
  active_threshold: '500',
  ...overrides,
});

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('ReportDataFetcherService', () => {
  let service: ReportDataFetcherService;
  let testRunRepo: jest.Mocked<Pick<Repository<TestRun>, 'query' | 'findOne'>>;
  let authzService: jest.Mocked<Pick<AuthorizationService, 'isGlobalAdmin' | 'getAccessibleOrganizations'>>;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    testRunRepo = {
      query: jest.fn(),
      // getAwrData resolves the human test run id to a uuid before querying awr_reports.
      findOne: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-0000-0000-0000-000000000001' }),
    };

    authzService = {
      isGlobalAdmin: jest.fn().mockReturnValue(false),
      getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportDataFetcherService,
        {
          provide: getRepositoryToken(TestRun),
          useValue: testRunRepo,
        },
        {
          provide: AuthorizationService,
          useValue: authzService,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<ReportDataFetcherService>(ReportDataFetcherService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getRampUpCutoffTime
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getRampUpCutoffTime', () => {
    describe('when excludeRampUp is false', () => {
      it('should return null immediately without querying the database', async () => {
        const result = await service.getRampUpCutoffTime('run-001', false, 'user-1', []);

        expect(result).toBeNull();
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });
    });

    describe('when excludeRampUp is true', () => {
      it('should return cutoff time calculated from start_time + ramp_up seconds', async () => {
        // start_time = 2025-01-01T10:00:00Z, ramp_up = 120 (seconds)
        testRunRepo.query.mockResolvedValueOnce([
          { start_time: '2025-01-01T10:00:00.000Z', ramp_up: '120' },
        ]);
        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getRampUpCutoffTime('run-001', true, 'admin-user', ['perfana-admin']);

        expect(result).toBeInstanceOf(Date);
        // 10:00:00 + 120 seconds = 10:02:00
        expect(result!.toISOString()).toBe('2025-01-01T10:02:00.000Z');
      });

      it('should return null when the database returns no rows', async () => {
        testRunRepo.query.mockResolvedValueOnce([]);
        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getRampUpCutoffTime('run-001', true, 'admin-user', ['perfana-admin']);

        expect(result).toBeNull();
      });

      it('should return null when start_time is missing from the row', async () => {
        testRunRepo.query.mockResolvedValueOnce([{ start_time: null, ramp_up: '60' }]);
        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getRampUpCutoffTime('run-001', true, 'admin-user', ['perfana-admin']);

        expect(result).toBeNull();
      });

      it('should return null when ramp_up is missing from the row', async () => {
        testRunRepo.query.mockResolvedValueOnce([{ start_time: '2025-01-01T10:00:00.000Z', ramp_up: null }]);
        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getRampUpCutoffTime('run-001', true, 'admin-user', ['perfana-admin']);

        expect(result).toBeNull();
      });

      it('should skip org filter and not call getAccessibleOrganizations for admin users', async () => {
        testRunRepo.query.mockResolvedValueOnce([]);
        authzService.isGlobalAdmin.mockReturnValue(true);

        await service.getRampUpCutoffTime('run-001', true, 'admin-user', ['perfana-admin']);

        expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
      });

      it('should skip org filter when userId is empty (system/internal call)', async () => {
        testRunRepo.query.mockResolvedValueOnce([]);

        await service.getRampUpCutoffTime('run-001', true, '', []);

        expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
        expect(authzService.isGlobalAdmin).not.toHaveBeenCalled();
      });

      it('should append org filter params to query when user is non-admin with org memberships', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce(['org-1', 'org-2']);
        testRunRepo.query.mockResolvedValueOnce([]);

        await service.getRampUpCutoffTime('run-001', true, 'user-1', []);

        expect(authzService.getAccessibleOrganizations).toHaveBeenCalledWith('user-1');
        const [sql, params] = testRunRepo.query.mock.calls[0] as [string, unknown[]];
        // Query should include the org filter clause
        expect(sql).toContain('organization_id IN');
        // params[0] = testRunId, then org ids
        expect(params).toContain('org-1');
        expect(params).toContain('org-2');
      });

      it('should use IS NULL filter when non-admin user has no org memberships', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce([]);
        testRunRepo.query.mockResolvedValueOnce([]);

        await service.getRampUpCutoffTime('run-001', true, 'user-1', []);

        const [sql] = testRunRepo.query.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('organization_id IS NULL');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getScenarioDataFromDatabase
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getScenarioDataFromDatabase', () => {
    const testRun = makeTestRun();

    describe('happy path', () => {
      it('should map transaction rows to typed ReportTransaction objects', async () => {
        const row = makeTransactionRow();
        testRunRepo.query
          .mockResolvedValueOnce([row]) // transactions query
          .mockResolvedValueOnce([]); // time-series query

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'BrowseAndSearch', 'admin', ['perfana-admin']);

        expect(result).not.toBeNull();
        expect(result!.scenario).toBe('BrowseAndSearch');
        expect(result!.transactions).toHaveLength(1);

        const txn = result!.transactions[0];
        expect(txn.name).toBe('T01_Login');
        expect(txn.avgMs).toBe(120.5);
        expect(txn.p95Ms).toBe(250.0);
        expect(txn.p99Ms).toBe(350.75);
        expect(txn.pass).toBe(990);
        expect(txn.fail).toBe(10);
      });

      it('should calculate error percentage correctly (fail / total * 100)', async () => {
        const row = makeTransactionRow({ pass: '90', fail: '10', total: '100' });
        testRunRepo.query
          .mockResolvedValueOnce([row])
          .mockResolvedValueOnce([]);

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'Scenario', 'admin', ['perfana-admin']);

        expect(result!.transactions[0].errPct).toBeCloseTo(10.0);
      });

      it('should return zero errPct when total is zero', async () => {
        const row = makeTransactionRow({ pass: '0', fail: '0', total: '0' });
        testRunRepo.query
          .mockResolvedValueOnce([row])
          .mockResolvedValueOnce([]);

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'Scenario', 'admin', ['perfana-admin']);

        expect(result!.transactions[0].errPct).toBe(0);
      });

      it('should handle zero errors (errPct = 0)', async () => {
        const row = makeTransactionRow({ pass: '500', fail: '0', total: '500' });
        testRunRepo.query
          .mockResolvedValueOnce([row])
          .mockResolvedValueOnce([]);

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'Scenario', 'admin', ['perfana-admin']);

        expect(result!.transactions[0].errPct).toBe(0);
      });

      it('should include time series data in the result', async () => {
        const timeSeriesRow = { transaction_name: 'T01_Login', time_bucket: '2025-01-01T10:01:00Z', avg_response_time: 125 };
        testRunRepo.query
          .mockResolvedValueOnce([makeTransactionRow()])
          .mockResolvedValueOnce([timeSeriesRow]);

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'BrowseAndSearch', 'admin', ['perfana-admin']);

        expect(result!.timeSeries).toHaveLength(1);
        expect(result!.timeSeries![0]).toEqual(timeSeriesRow);
      });

      it('should handle multiple transaction rows', async () => {
        const rows = [
          makeTransactionRow({ transaction_name: 'T01_Login', pass: '100', fail: '0', total: '100' }),
          makeTransactionRow({ transaction_name: 'T02_Search', pass: '200', fail: '5', total: '205' }),
        ];
        testRunRepo.query
          .mockResolvedValueOnce(rows)
          .mockResolvedValueOnce([]);

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'Multi', 'admin', ['perfana-admin']);

        expect(result!.transactions).toHaveLength(2);
        expect(result!.transactions[0].name).toBe('T01_Login');
        expect(result!.transactions[1].name).toBe('T02_Search');
      });

      it('should use testRunId (not id) when constructing the query params', async () => {
        testRunRepo.query
          .mockResolvedValueOnce([makeTransactionRow()])
          .mockResolvedValueOnce([]);

        authzService.isGlobalAdmin.mockReturnValue(true);

        await service.getScenarioDataFromDatabase(testRun, 'MyScenario', 'admin', ['perfana-admin']);

        const firstCallParams = testRunRepo.query.mock.calls[0][1] as unknown[];
        expect(firstCallParams[0]).toBe('run-001'); // testRunId, not UUID
        expect(firstCallParams[1]).toBe('MyScenario');
      });
    });

    describe('edge cases', () => {
      it('should return null when transactions query returns empty array', async () => {
        testRunRepo.query.mockResolvedValueOnce([]);

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'Empty', 'admin', ['perfana-admin']);

        expect(result).toBeNull();
      });

      it('should default to 0 for NaN-producing numeric fields', async () => {
        const row = makeTransactionRow({
          avg_ms: 'NaN',
          p95_ms: '',
          p99_ms: 'null',
          pass: '',
          fail: '',
          total: '0',
        });
        testRunRepo.query
          .mockResolvedValueOnce([row])
          .mockResolvedValueOnce([]);

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'Scenario', 'admin', ['perfana-admin']);

        const txn = result!.transactions[0];
        expect(txn.avgMs).toBe(0);
        expect(txn.p95Ms).toBe(0);
        expect(txn.p99Ms).toBe(0);
        expect(txn.pass).toBe(0);
        expect(txn.fail).toBe(0);
      });
    });

    describe('error handling', () => {
      it('should return null and not throw when the database query throws', async () => {
        testRunRepo.query.mockRejectedValueOnce(new Error('DB connection lost'));

        authzService.isGlobalAdmin.mockReturnValue(true);

        const result = await service.getScenarioDataFromDatabase(testRun, 'Scenario', 'admin', ['perfana-admin']);

        expect(result).toBeNull();
      });
    });

    describe('org filtering', () => {
      it('should call getAccessibleOrganizations for non-admin users', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce(['org-a']);
        testRunRepo.query.mockResolvedValue([]);

        await service.getScenarioDataFromDatabase(testRun, 'Scenario', 'user-1', []);

        expect(authzService.getAccessibleOrganizations).toHaveBeenCalledWith('user-1');
      });

      it('should not call getAccessibleOrganizations for admin users', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        testRunRepo.query.mockResolvedValue([]);

        await service.getScenarioDataFromDatabase(testRun, 'Scenario', 'admin', ['perfana-admin']);

        expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
      });

      it('should include org filter in SQL when user has org memberships', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce(['org-x', 'org-y']);
        testRunRepo.query.mockResolvedValue([]);

        await service.getScenarioDataFromDatabase(testRun, 'Scenario', 'user-1', []);

        const [sql] = testRunRepo.query.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('organization_id IN');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getApdexDataFromDatabase
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getApdexDataFromDatabase', () => {
    const testRun = makeTestRun();

    // We need to stub out the subordinate methods that are called internally
    // (getThroughputStatsForReport and getVirtualUserStatsForReport).
    const defaultThroughput = {
      overall: { peak_transactions_per_second: 50, peak_requests_per_second: 60 },
      by_scenario: [{ scenario_name: 'BrowseAndSearch', peak_transactions_per_second: 50, peak_requests_per_second: 60 }],
    };

    const defaultVirtualUsers = {
      overall: { peak_active_threads: 100, avg_active_threads: 75 },
      by_scenario: [{ scenario_name: 'BrowseAndSearch', peak_active_threads: 10, avg_active_threads: 8 }],
    };

    const setupSubordinateMocks = () => {
      // getRampUpCutoffTime returns null (excludeRampUp = false)
      // allTransactions query is the first call; throughput & VU come next via Promise.all(3 queries)
      // We mock them via the service's own methods for isolation
      jest.spyOn(service, 'getThroughputStatsForReport').mockResolvedValue(defaultThroughput);
      jest.spyOn(service, 'getVirtualUserStatsForReport').mockResolvedValue(defaultVirtualUsers);
    };

    describe('happy path', () => {
      it('should return null when no transactions are found in the database', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        // getRampUpCutoffTime -> returns null (excludeRampUp = false)
        testRunRepo.query.mockResolvedValueOnce([]); // allTransactions

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        expect(result).toBeNull();
      });

      it('should compute overall weighted-average metrics from a single transaction row', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        setupSubordinateMocks();

        // 1 row: 1000 total, 800 satisfied, 150 tolerating, 100 failed
        const row = makeApdexTransactionRow({
          total: '1000',
          pass: '900',
          fail: '100',
          satisfied: '800',
          tolerating: '150',
          avg_ms: '100.00',
          p95_ms: '200.00',
          p99_ms: '300.00',
          active_threshold: '500',
        });

        testRunRepo.query.mockResolvedValueOnce([row]); // allTransactions

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        expect(result).not.toBeNull();

        // apdex = (800 + 0.5 * 150) / 1000 = 0.875
        expect(result!.overall.apdex).toBeCloseTo(0.875);
        // weighted avg = (100 * 1000) / 1000 = 100
        expect(result!.overall.avgMs).toBe(100);
        expect(result!.overall.p95Ms).toBe(200);
        expect(result!.overall.p99Ms).toBe(300);
        // errorRate = 100 / 1000 * 100 = 10%
        expect(result!.overall.errorRate).toBeCloseTo(10);
        expect(result!.overall.failedCount).toBe(100);
      });

      it('should set threshold to the single value when all transactions share the same threshold', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        setupSubordinateMocks();

        const rows = [
          makeApdexTransactionRow({ transaction_name: 'T01', active_threshold: '500', total: '100', satisfied: '80', tolerating: '10' }),
          makeApdexTransactionRow({ transaction_name: 'T02', active_threshold: '500', total: '100', satisfied: '90', tolerating: '5' }),
        ];

        testRunRepo.query.mockResolvedValueOnce(rows);

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        expect(result!.overall.threshold).toBe(500);
        expect(result!.overall.thresholdVaries).toBe(false);
      });

      it('should set threshold to null and thresholdVaries to true when transactions have different thresholds', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        setupSubordinateMocks();

        const rows = [
          makeApdexTransactionRow({ transaction_name: 'T01', active_threshold: '500', total: '100', satisfied: '80', tolerating: '10' }),
          makeApdexTransactionRow({ transaction_name: 'T02', active_threshold: '1000', total: '100', satisfied: '90', tolerating: '5' }),
        ];

        testRunRepo.query.mockResolvedValueOnce(rows);

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        expect(result!.overall.threshold).toBeNull();
        expect(result!.overall.thresholdVaries).toBe(true);
      });

      it('should group transactions by scenario_name and produce correct scenario summaries', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);

        const throughput = {
          overall: { peak_transactions_per_second: 20, peak_requests_per_second: 25 },
          by_scenario: [
            { scenario_name: 'ScenarioA', peak_transactions_per_second: 10, peak_requests_per_second: 12 },
            { scenario_name: 'ScenarioB', peak_transactions_per_second: 10, peak_requests_per_second: 13 },
          ],
        };
        const virtualUsers = {
          overall: { peak_active_threads: 20, avg_active_threads: 15 },
          by_scenario: [
            { scenario_name: 'ScenarioA', peak_active_threads: 10, avg_active_threads: 7 },
            { scenario_name: 'ScenarioB', peak_active_threads: 10, avg_active_threads: 8 },
          ],
        };

        jest.spyOn(service, 'getThroughputStatsForReport').mockResolvedValue(throughput);
        jest.spyOn(service, 'getVirtualUserStatsForReport').mockResolvedValue(virtualUsers);

        const rows = [
          makeApdexTransactionRow({
            transaction_name: 'T01',
            scenario_name: 'ScenarioA',
            total: '100',
            pass: '90',
            fail: '10',
            satisfied: '80',
            tolerating: '10',
            avg_ms: '100.00',
            p95_ms: '200.00',
            p99_ms: '300.00',
          }),
          makeApdexTransactionRow({
            transaction_name: 'T01',
            scenario_name: 'ScenarioB',
            total: '50',
            pass: '48',
            fail: '2',
            satisfied: '45',
            tolerating: '3',
            avg_ms: '80.00',
            p95_ms: '150.00',
            p99_ms: '180.00',
          }),
        ];

        testRunRepo.query.mockResolvedValueOnce(rows);

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        expect(result!.scenarios).toHaveProperty('ScenarioA');
        expect(result!.scenarios).toHaveProperty('ScenarioB');

        const scA = result!.scenarios['ScenarioA'];
        expect(scA.scenario).toBe('ScenarioA');
        expect(scA.transactions).toHaveLength(1);
        expect(scA.transactions[0].name).toBe('T01');
        // Apdex for ScenarioA: (80 + 0.5 * 10) / 100 = 0.85
        expect(scA.transactions[0].apdex).toBeCloseTo(0.85);
        expect(scA.summary.peakTxnsPerSec).toBe(10);
        expect(scA.summary.peakVu).toBe(10);
      });

      it('should populate overall peak metrics from throughput and VU stats', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        setupSubordinateMocks();

        testRunRepo.query.mockResolvedValueOnce([makeApdexTransactionRow()]);

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        expect(result!.overall.peakTxnsPerSec).toBe(50);
        expect(result!.overall.peakReqsPerSec).toBe(60);
        expect(result!.overall.peakActiveUsers).toBe(100);
        expect(result!.overall.avgActiveUsers).toBe(75);
      });

      it('should fall back to "Unknown" scenario name when scenario_name is null/empty', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        setupSubordinateMocks();

        const row = makeApdexTransactionRow({ scenario_name: '', total: '50', satisfied: '40', tolerating: '5' });
        testRunRepo.query.mockResolvedValueOnce([row]);

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        expect(result!.scenarios).toHaveProperty('Unknown');
      });

      it('should call getRampUpCutoffTime and include cutoff in query params when excludeRampUp=true', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        setupSubordinateMocks();

        const cutoff = new Date('2025-01-01T10:02:00Z');
        jest.spyOn(service, 'getRampUpCutoffTime').mockResolvedValueOnce(cutoff);

        testRunRepo.query.mockResolvedValueOnce([]);

        await service.getApdexDataFromDatabase(testRun, 500, true, 'admin', ['perfana-admin']);

        expect(service.getRampUpCutoffTime).toHaveBeenCalledWith('run-001', true, 'admin', ['perfana-admin']);
      });
    });

    describe('weighted average math', () => {
      it('should compute correctly weighted averages across two transactions with different volumes', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        setupSubordinateMocks();

        // T01: 1000 rows, avg=100ms; T02: 500 rows, avg=200ms
        // weighted avg = (100*1000 + 200*500) / 1500 = 133.33ms
        const rows = [
          makeApdexTransactionRow({
            transaction_name: 'T01',
            total: '1000',
            pass: '900',
            fail: '100',
            satisfied: '800',
            tolerating: '150',
            avg_ms: '100.00',
            p95_ms: '200.00',
            p99_ms: '300.00',
          }),
          makeApdexTransactionRow({
            transaction_name: 'T02',
            total: '500',
            pass: '480',
            fail: '20',
            satisfied: '450',
            tolerating: '40',
            avg_ms: '200.00',
            p95_ms: '400.00',
            p99_ms: '600.00',
          }),
        ];

        testRunRepo.query.mockResolvedValueOnce(rows);

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        const expectedWeightedAvg = (100 * 1000 + 200 * 500) / 1500;
        expect(result!.overall.avgMs).toBeCloseTo(expectedWeightedAvg, 1);

        const expectedWeightedP95 = (200 * 1000 + 400 * 500) / 1500;
        expect(result!.overall.p95Ms).toBeCloseTo(expectedWeightedP95, 1);
      });
    });

    describe('error handling', () => {
      it('should return null when the database query throws', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        testRunRepo.query.mockRejectedValueOnce(new Error('Timeout'));

        const result = await service.getApdexDataFromDatabase(testRun, 500, false, 'admin', ['perfana-admin']);

        expect(result).toBeNull();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getThroughputStatsForReport
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getThroughputStatsForReport', () => {
    /**
     * The CAGG-vs-fallback decision is made by `loadThroughputRunInfoForReport`,
     * which runs ahead of the three parallel data queries. The lookup SQL is
     * recognized by the SUT/env projection + `has_cagg` column. See issue #288.
     */
    const isReportRunInfoLookup = (sql: unknown): boolean =>
      typeof sql === 'string' && /sut\.name\s+AS\s+sut[\s\S]*has_cagg/i.test(sql);

    /** Run-info row that flips the service into the CAGG-backed query path. */
    const REPORT_RUN_INFO_CAGG = {
      sut: 'webshop',
      env: 'acc',
      start_time: '2025-01-01T10:00:00Z',
      end_time: '2025-01-01T11:00:00Z',
      has_cagg: true,
    };
    /** Run-info row that flips the service into the legacy raw-scan fallback. */
    const REPORT_RUN_INFO_NO_CAGG = { ...REPORT_RUN_INFO_CAGG, has_cagg: false };

    /**
     * Mock the throughput query sequence:
     *   1) run-info lookup (returns the row above; null = inaccessible run)
     *   2..4) three parallel data queries (transactions, requests, scenarios)
     *
     * The mock dispatches by matching `isReportRunInfoLookup(sql)` so existing
     * call-order assertions in non-throughput tests are unaffected.
     */
    function mockThroughputCalls(
      runInfoRow: unknown | null,
      ...dataResults: unknown[][]
    ) {
      let dataIdx = 0;
      testRunRepo.query.mockImplementation(async (sql: unknown) => {
        if (isReportRunInfoLookup(sql)) {
          return runInfoRow === null ? [] : [runInfoRow];
        }
        const r = dataResults[dataIdx] ?? [];
        dataIdx++;
        return r;
      });
    }

    /** Returns only the post-run-info data calls (filters out the lookup). */
    const dataCalls = (): jest.Mock['mock']['calls'] =>
      testRunRepo.query.mock.calls.filter((c) => !isReportRunInfoLookup(c[0]));

    describe('CAGG fast path (issue #288)', () => {
      it('reads from transactions_5s / requests_raw_5s when has_cagg is true', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        mockThroughputCalls(
          REPORT_RUN_INFO_CAGG,
          [{ peak_transactions_per_second: '42' }],
          [{ peak_requests_per_second: '55' }],
          [],
        );

        await service.getThroughputStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        const sqls = dataCalls().map((c) => c[0] as string).join('\n');
        expect(sqls).toContain('FROM transactions_5s c');
        expect(sqls).toContain('FROM requests_raw_5s c');
        expect(sqls).not.toMatch(/FROM\s+transactions\b(?!_5s)/);
        expect(sqls).not.toMatch(/FROM\s+requests_raw\b(?!_5s)/);
      });

      it('passes (sut, env, start, end, excludeRampUp, cutoff) to the CAGG queries', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        mockThroughputCalls(REPORT_RUN_INFO_CAGG, [], [], []);

        const cutoff = new Date('2025-01-01T10:02:00Z');
        await service.getThroughputStatsForReport('run-001', true, cutoff, 'admin', ['perfana-admin']);

        const dc = dataCalls();
        expect(dc).toHaveLength(3);
        for (const call of dc) {
          const params = call[1] as unknown[];
          expect(params[0]).toBe('webshop');
          expect(params[1]).toBe('acc');
          expect(params[2]).toEqual(new Date(REPORT_RUN_INFO_CAGG.start_time));
          expect(params[3]).toEqual(new Date(REPORT_RUN_INFO_CAGG.end_time));
          expect(params[4]).toBe(true);
          expect(params[5]).toBe(cutoff);
        }
      });
    });

    describe('happy path (raw-scan fallback)', () => {
      it('should return overall and per-scenario throughput from database results', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        mockThroughputCalls(
          REPORT_RUN_INFO_NO_CAGG,
          [{ peak_transactions_per_second: '42' }],
          [{ peak_requests_per_second: '55' }],
          [
            { scenario_name: 'BrowseAndSearch', peak_transactions_per_second: '20', peak_requests_per_second: '25' },
            { scenario_name: 'Checkout', peak_transactions_per_second: '22', peak_requests_per_second: '30' },
          ],
        );

        const result = await service.getThroughputStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(result.overall.peak_transactions_per_second).toBe(42);
        expect(result.overall.peak_requests_per_second).toBe(55);
        expect(result.by_scenario).toHaveLength(2);
        expect(result.by_scenario[0]).toEqual({
          scenario_name: 'BrowseAndSearch',
          peak_transactions_per_second: 20,
          peak_requests_per_second: 25,
        });
      });

      it('should default to 0 when database returns no rows for overall', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        mockThroughputCalls(REPORT_RUN_INFO_NO_CAGG, [], [], []);

        const result = await service.getThroughputStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(result.overall.peak_transactions_per_second).toBe(0);
        expect(result.overall.peak_requests_per_second).toBe(0);
        expect(result.by_scenario).toHaveLength(0);
      });

      it('should default to 0 when overall row fields are null/non-numeric', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        mockThroughputCalls(
          REPORT_RUN_INFO_NO_CAGG,
          [{ peak_transactions_per_second: null }],
          [{ peak_requests_per_second: undefined }],
          [],
        );

        const result = await service.getThroughputStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(result.overall.peak_transactions_per_second).toBe(0);
        expect(result.overall.peak_requests_per_second).toBe(0);
      });

      it('should pass cutoffTime in query params when provided', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        mockThroughputCalls(REPORT_RUN_INFO_NO_CAGG, [], [], []);

        const cutoff = new Date('2025-01-01T10:02:00Z');
        await service.getThroughputStatsForReport('run-001', true, cutoff, 'admin', ['perfana-admin']);

        // The fallback path's three data queries each carry the cutoff at $3.
        for (const call of dataCalls()) {
          const params = call[1] as unknown[];
          expect(params[2]).toBe(cutoff);
        }
      });

      it('should pass null cutoffTime when not provided', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        mockThroughputCalls(REPORT_RUN_INFO_NO_CAGG, [], [], []);

        await service.getThroughputStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        for (const call of dataCalls()) {
          const params = call[1] as unknown[];
          expect(params[2]).toBeNull();
        }
      });
    });

    describe('org filtering (raw-scan fallback)', () => {
      it('should use CTE-based org filter in SQL when user has org memberships', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce(['org-1']);
        mockThroughputCalls(REPORT_RUN_INFO_NO_CAGG, [], [], []);

        await service.getThroughputStatsForReport('run-001', false, null, 'user-1', []);

        const sqls = dataCalls().map((c) => c[0] as string);
        expect(sqls.some((sql) => sql.includes('org_filter'))).toBe(true);
      });

      it('should use IS NULL variant CTE when user has no org memberships', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce([]);
        mockThroughputCalls(REPORT_RUN_INFO_NO_CAGG, [], [], []);

        await service.getThroughputStatsForReport('run-001', false, null, 'user-1', []);

        const sqls = dataCalls().map((c) => c[0] as string);
        expect(sqls.some((sql) => sql.includes('organization_id IS NULL'))).toBe(true);
      });

      it('should not include org_filter CTE for admin users', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        mockThroughputCalls(REPORT_RUN_INFO_NO_CAGG, [], [], []);

        await service.getThroughputStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        const sqls = dataCalls().map((c) => c[0] as string);
        expect(sqls.every((sql) => !sql.includes('org_filter'))).toBe(true);
      });

      it('threads orgIds into the run-info lookup for non-admin users', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce(['org-1', 'org-2']);
        mockThroughputCalls(REPORT_RUN_INFO_NO_CAGG, [], [], []);

        await service.getThroughputStatsForReport('run-001', false, null, 'user-1', []);

        const lookup = testRunRepo.query.mock.calls.find((c) => isReportRunInfoLookup(c[0]));
        expect(lookup).toBeDefined();
        expect(lookup![0]).toContain('tr.organization_id IN');
        expect(lookup![1]).toEqual(['run-001', 'org-1', 'org-2']);
      });
    });

    describe('error handling', () => {
      it('should return zero stats and not throw when the query rejects', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        testRunRepo.query.mockRejectedValueOnce(new Error('DB error'));

        const result = await service.getThroughputStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(result.overall.peak_transactions_per_second).toBe(0);
        expect(result.overall.peak_requests_per_second).toBe(0);
        expect(result.by_scenario).toHaveLength(0);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getVirtualUserStatsForReport
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getVirtualUserStatsForReport', () => {
    describe('happy path', () => {
      it('should return overall and per-scenario virtual user stats', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);

        testRunRepo.query
          .mockResolvedValueOnce([{ peak_active_threads: '150', avg_active_threads: '112.50' }])
          .mockResolvedValueOnce([
            { scenario_name: 'BrowseAndSearch', peak_active_threads: '75', avg_active_threads: '55.25' },
            { scenario_name: 'Checkout', peak_active_threads: '75', avg_active_threads: '57.25' },
          ]);

        const result = await service.getVirtualUserStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(result.overall.peak_active_threads).toBe(150);
        expect(result.overall.avg_active_threads).toBeCloseTo(112.5);
        expect(result.by_scenario).toHaveLength(2);
        expect(result.by_scenario[0]).toEqual({
          scenario_name: 'BrowseAndSearch',
          peak_active_threads: 75,
          avg_active_threads: 55.25,
        });
      });

      it('should default to 0 when database returns no rows', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        testRunRepo.query
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        const result = await service.getVirtualUserStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(result.overall.peak_active_threads).toBe(0);
        expect(result.overall.avg_active_threads).toBe(0);
        expect(result.by_scenario).toHaveLength(0);
      });

      it('should default to 0 when overall row fields are null', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        testRunRepo.query
          .mockResolvedValueOnce([{ peak_active_threads: null, avg_active_threads: null }])
          .mockResolvedValueOnce([]);

        const result = await service.getVirtualUserStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(result.overall.peak_active_threads).toBe(0);
        expect(result.overall.avg_active_threads).toBe(0);
      });

      it('should pass cutoffTime in query params when provided', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        testRunRepo.query.mockResolvedValue([]);

        const cutoff = new Date('2025-01-01T10:02:00Z');
        await service.getVirtualUserStatsForReport('run-001', true, cutoff, 'admin', ['perfana-admin']);

        for (const call of testRunRepo.query.mock.calls) {
          const params = call[1] as unknown[];
          expect(params[2]).toBe(cutoff);
        }
      });
    });

    describe('org filtering', () => {
      it('should use EXISTS subquery with org IN list when user has org memberships', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce(['org-1', 'org-2']);
        testRunRepo.query.mockResolvedValue([]);

        await service.getVirtualUserStatsForReport('run-001', false, null, 'user-1', []);

        const sqls = testRunRepo.query.mock.calls.map((c) => c[0] as string);
        expect(sqls.some((sql) => sql.includes('organization_id IN'))).toBe(true);
      });

      it('should use EXISTS subquery with IS NULL when user has no org memberships', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValueOnce([]);
        testRunRepo.query.mockResolvedValue([]);

        await service.getVirtualUserStatsForReport('run-001', false, null, 'user-1', []);

        const sqls = testRunRepo.query.mock.calls.map((c) => c[0] as string);
        expect(sqls.some((sql) => sql.includes('organization_id IS NULL'))).toBe(true);
      });

      it('should not add org filter for admin users', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        testRunRepo.query.mockResolvedValue([]);

        await service.getVirtualUserStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should return zero stats and not throw when the query rejects', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        testRunRepo.query.mockRejectedValueOnce(new Error('Query failed'));

        const result = await service.getVirtualUserStatsForReport('run-001', false, null, 'admin', ['perfana-admin']);

        expect(result.overall.peak_active_threads).toBe(0);
        expect(result.overall.avg_active_threads).toBe(0);
        expect(result.by_scenario).toHaveLength(0);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getMockScenarioData
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getMockScenarioData', () => {
    it('should return BrowseAndSearch scenario with 7 transactions', () => {
      const result = service.getMockScenarioData('BrowseAndSearch');

      expect(result).not.toBeNull();
      expect(result!.scenario).toBe('BrowseAndSearch');
      expect(result!.transactions).toHaveLength(7);
      expect(result!.transactions[0].name).toBe('T01_Homepage_Load');
    });

    it('should return Checkout scenario with 7 transactions', () => {
      const result = service.getMockScenarioData('Checkout');

      expect(result).not.toBeNull();
      expect(result!.scenario).toBe('Checkout');
      expect(result!.transactions).toHaveLength(7);
      expect(result!.transactions[0].name).toBe('T01_Add_To_Cart');
    });

    it('should return the "all" aggregate scenario with 2 scenario-level transactions', () => {
      const result = service.getMockScenarioData('all');

      expect(result).not.toBeNull();
      expect(result!.scenario).toBe('All Scenarios');
      expect(result!.transactions).toHaveLength(2);
    });

    it('should return null for an unknown scenario name', () => {
      const result = service.getMockScenarioData('NonExistentScenario');

      expect(result).toBeNull();
    });

    it('should return null for an empty string scenario name', () => {
      const result = service.getMockScenarioData('');

      expect(result).toBeNull();
    });

    it('should include summary data for BrowseAndSearch', () => {
      const result = service.getMockScenarioData('BrowseAndSearch');

      expect(result!.summary).toBeDefined();
      expect(result!.summary!.peakTxnsPerSec).toBe(6);
      expect(result!.summary!.peakVu).toBe(10);
      expect(result!.summary!.apdex).toBe(0.992);
    });

    it('should include a non-zero error rate in the Checkout scenario summary', () => {
      const result = service.getMockScenarioData('Checkout');

      expect(result!.summary!.errors).toBeGreaterThan(0);
    });

    it('BrowseAndSearch transactions should all have zero error percentage', () => {
      const result = service.getMockScenarioData('BrowseAndSearch');

      for (const txn of result!.transactions) {
        expect(txn.errPct).toBe(0.0);
        expect(txn.fail).toBe(0);
      }
    });

    it('Checkout T04_Payment_Processing should have a non-zero fail count', () => {
      const result = service.getMockScenarioData('Checkout');

      const t04 = result!.transactions.find((t) => t.name === 'T04_Payment_Processing');
      expect(t04).toBeDefined();
      expect(t04!.fail).toBeGreaterThan(0);
      expect(t04!.errPct).toBeGreaterThan(0);
    });

    it('should not mutate the returned object (returns same reference each call)', () => {
      const result1 = service.getMockScenarioData('BrowseAndSearch');
      const result2 = service.getMockScenarioData('BrowseAndSearch');

      // Both point to the same underlying mock data object
      expect(result1!.scenario).toBe(result2!.scenario);
      expect(result1!.transactions.length).toBe(result2!.transactions.length);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // buildOrganizationFilterClause (via observable behaviour in public methods)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('organization filter clause construction (via getRampUpCutoffTime)', () => {
    it('should produce correct placeholder indices starting from paramStartIndex', async () => {
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValueOnce(['org-A', 'org-B']);
      testRunRepo.query.mockResolvedValueOnce([]);

      // getRampUpCutoffTime uses paramStartIndex=2 ($2, $3 for org params)
      await service.getRampUpCutoffTime('run-001', true, 'user-1', []);

      const [sql, params] = testRunRepo.query.mock.calls[0] as [string, unknown[]];
      // The clause should reference $2 and $3
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      // Params: [testRunId, org-A, org-B]
      expect(params).toEqual(['run-001', 'org-A', 'org-B']);
    });

    it('should include IS NULL backward-compat clause for non-empty org list', async () => {
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValueOnce(['org-X']);
      testRunRepo.query.mockResolvedValueOnce([]);

      await service.getRampUpCutoffTime('run-001', true, 'user-1', []);

      const [sql] = testRunRepo.query.mock.calls[0] as [string, unknown[]];
      // Should combine IN clause with IS NULL for backward compat
      expect(sql).toContain('organization_id IN');
      expect(sql).toContain('organization_id IS NULL');
    });
  });
});

describe('ReportDataFetcherService getAwrData id resolution', () => {
  // awr_reports.test_run_id is a uuid FK onto test_runs(id) — the only table this service reads
  // that is keyed that way. Every renderer passes the human test run id, so handing it straight
  // through was a 22P02, swallowed by the catch as a warning, leaving the AWR section silently
  // empty in every generated report.
  let service: ReportDataFetcherService;
  let testRunRepo: { query: jest.Mock; findOne: jest.Mock };
  let dataSource: { query: jest.Mock };

  const RUN_UUID = 'aaaaaaaa-0000-0000-0000-000000000001';

  beforeEach(async () => {
    testRunRepo = { query: jest.fn(), findOne: jest.fn().mockResolvedValue({ id: RUN_UUID }) };
    dataSource = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportDataFetcherService,
        { provide: getRepositoryToken(TestRun), useValue: testRunRepo },
        {
          provide: AuthorizationService,
          useValue: {
            isGlobalAdmin: jest.fn().mockReturnValue(true),
            getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(ReportDataFetcherService);
  });

  it('queries awr_reports by the uuid, never the human id', async () => {
    await service.getAwrData('EA-acc-loadtest-00020');

    expect(testRunRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { testRunId: 'EA-acc-loadtest-00020' } }),
    );
    const [sql, params] = dataSource.query.mock.calls[0];
    expect(String(sql)).toMatch(/FROM awr_reports/);
    expect(params).toEqual([RUN_UUID]);
  });

  it('returns null for a run that does not exist rather than querying', async () => {
    testRunRepo.findOne.mockResolvedValue(null);

    const result = await service.getAwrData('no-such-run');

    expect(result).toBeNull();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('takes a uuid straight through when it matches a run', async () => {
    testRunRepo.findOne.mockResolvedValue({ id: RUN_UUID });

    await service.getAwrData(RUN_UUID);

    const [, params] = dataSource.query.mock.calls[0];
    expect(params).toEqual([RUN_UUID]);
  });
});

describe('ReportDataFetcherService getPreviousTestRun', () => {
  let service: ReportDataFetcherService;
  let qb: Record<string, jest.Mock>;

  const testRun = {
    id: 'run-2',
    systemUnderTestId: 'sut-1',
    testEnvironment: 'acc',
    workload: 'loadTest',
    startTime: new Date('2026-08-18T10:00:00Z'),
  } as never;

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ testRunId: 'EA-acc-loadtest-00019' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportDataFetcherService,
        {
          provide: getRepositoryToken(TestRun),
          useValue: { query: jest.fn(), findOne: jest.fn(), createQueryBuilder: () => qb },
        },
        {
          provide: AuthorizationService,
          useValue: {
            isGlobalAdmin: jest.fn().mockReturnValue(true),
            getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: DataSource, useValue: { query: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = module.get(ReportDataFetcherService);
  });

  it('takes only runs that started BEFORE this one', async () => {
    // Ordering by start time alone would hand back a LATER run whenever a report is generated
    // for anything but the newest, reading the change backwards.
    await service.getPreviousTestRun(testRun);

    expect(qb.andWhere).toHaveBeenCalledWith('tr.startTime < :startTime', {
      startTime: testRun.startTime,
    });
    expect(qb.orderBy).toHaveBeenCalledWith('tr.startTime', 'DESC');
    expect(qb.limit).toHaveBeenCalledWith(1);
  });

  it('scopes to the same system, environment and workload, completed only', async () => {
    // Same scope the baseline dropdown uses, so "previous" is the run a person would have picked.
    await service.getPreviousTestRun(testRun);

    const clauses = [...qb.where.mock.calls, ...qb.andWhere.mock.calls].map((c) => c[0]);
    expect(clauses).toEqual(
      expect.arrayContaining([
        'tr.systemUnderTestId = :systemUnderTestId',
        'tr.testEnvironment = :testEnvironment',
        'tr.workload = :workload',
        'tr.completed = :completed',
        'tr.id != :id',
      ]),
    );
  });

  it('returns null when the run is the first in its scope', async () => {
    qb.getOne.mockResolvedValue(null);

    expect(await service.getPreviousTestRun(testRun)).toBeNull();
  });
});
