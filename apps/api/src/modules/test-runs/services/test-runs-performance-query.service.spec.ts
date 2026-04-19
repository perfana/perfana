/**
 * Unit tests for TestRunsPerformanceQueryService
 *
 * Covers all public methods:
 * - getTransactionStats: transaction performance statistics with Apdex scoring
 * - getTransactionSamples: per-sampler statistics for a transaction
 * - getTransactionErrors: grouped error statistics
 * - getVirtualUserStats: VU concurrency statistics
 * - getThroughputStats: peak TPS/RPS statistics
 *
 * Key scenarios tested per method:
 * - Admin bypass (no org filter)
 * - Non-admin with org memberships
 * - Non-admin with NO org memberships → empty result
 * - UUID resolution vs. raw test_run_id
 * - excludeRampUp cutoff logic
 * - sinceMinutes window filter (where applicable)
 * - Data mapping / type parsing from raw SQL rows
 * - Error wrapping into DatabaseException
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { TestRun as TestRunEntity } from '../../../entities';
import { DatabaseException } from '../../../common/exceptions/business.exception';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mock repository shape.
 *
 * The service uses two entry points into TypeORM:
 *  - `testRunRepo.query(...)` for top-level queries (UUID lookup, ramp-up lookup,
 *    VU stats, throughput stats, errors).
 *  - `testRunRepo.manager.transaction(cb)` for queries that need `SET LOCAL work_mem`
 *    (getTransactionStats, getTransactionSamples — the rewrites introduced for #139).
 *
 * Our mock routes the EntityManager passed to the transaction callback back through
 * the same `query` jest.fn so every existing `mockQuerySequence` / `mockWithUuidResolution`
 * helper keeps working untouched. The `SET LOCAL work_mem` prelude issues its own
 * `query` call — the helpers mirror that with an explicit `setLocalWorkMem` step so
 * callers don't have to remember it.
 */
type MockRepo = jest.Mocked<Pick<Repository<TestRunEntity>, 'query'>> & {
  manager: {
    transaction: jest.Mock;
  };
};

function createMockRepo(): MockRepo {
  const query = jest.fn();
  const transaction = jest.fn(async (cb: (em: { query: jest.Mock }) => Promise<unknown>) => {
    return cb({ query });
  });
  return {
    query,
    manager: { transaction },
  };
}

/** Raw DB row shapes used across tests */
const RAW_TRANSACTION_ROW = {
  transaction_name: 'checkout',
  scenario_name: 'load_test',
  total_count: '600',
  passed_count: '590',
  failed_count: '10',
  avg_response_time: '120.50',
  p95_response_time: '300.00',
  p99_response_time: '450.00',
  ranking: '72300.00',
  apdex_score: '0.950',
  active_threshold: '500',
};

const RAW_SAMPLER_ROW = {
  sampler_name: 'POST /checkout',
  scenario_name: 'load_test',
  avg_response_time: '115.25',
  min_response_time: '50',
  max_response_time: '900',
  p95_response_time: '295.00',
  p99_response_time: '440.00',
  passed_count: '580',
  failed_count: '10',
  total_count: '590',
  avg_latency: '10.00',
  avg_connect_time: '5.00',
  total_request_size: '102400',
  total_response_size: '204800',
  apdex_score: '0.940',
  active_threshold: '500',
  url_hash: 'abc123',
  url_pattern: '/checkout',
};

const RAW_ERROR_ROW = {
  error_type: 'HTTP 500',
  response_code: '500',
  response_message: 'Internal Server Error',
  sampler_name: 'POST /checkout',
  url: 'http://example.com/checkout',
  sample_url: 'http://example.com/checkout?session=1',
  url_hash: 'abc123',
  url_pattern: '/checkout',
  count: '10',
  first_occurrence: '2024-01-01T10:00:00Z',
  last_occurrence: '2024-01-01T11:00:00Z',
  sample_response_data: '{"error":"Internal Server Error"}',
  total_requests: '600',
  apdex_score: '0.85',
};

const RAW_VU_OVERALL = {
  peak_active_threads: '100',
  avg_active_threads: '75.50',
  peak_started_threads: '100',
  avg_started_threads: '80.00',
  peak_finished_threads: '99',
  avg_finished_threads: '74.00',
  total_data_points: '360',
};

const RAW_VU_SCENARIO = {
  scenario_name: 'checkout_flow',
  peak_active_threads: '50',
  avg_active_threads: '40.00',
  peak_started_threads: '50',
  avg_started_threads: '42.00',
  peak_finished_threads: '49',
  avg_finished_threads: '39.00',
  total_data_points: '180',
};

const RAW_TRANSACTIONS_TPS = { peak_transactions_per_second: '120' };
const RAW_REQUESTS_RPS = { peak_requests_per_second: '350' };
const RAW_SCENARIO_THROUGHPUT = {
  scenario_name: 'checkout_flow',
  peak_transactions_per_second: '60',
  peak_requests_per_second: '175',
};

// UUIDs used in tests
const UUID = 'e8f37dc1-9d9c-4e25-837d-14aa69ac4b17';
const TEST_RUN_ID = 'PerfanaWebshop-acc-loadTest-00012';
const ORG_IDS = ['org-uuid-1', 'org-uuid-2'];
const ADMIN_ROLES = ['perfana-admin'];
const USER_ROLES = ['user'];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TestRunsPerformanceQueryService', () => {
  let service: TestRunsPerformanceQueryService;
  let testRunRepo: MockRepo;
  let mapper: TestRunsMapperService;

  beforeEach(async () => {
    testRunRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsPerformanceQueryService,
        TestRunsMapperService,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: testRunRepo,
        },
      ],
    }).compile();

    service = module.get<TestRunsPerformanceQueryService>(TestRunsPerformanceQueryService);
    mapper = module.get<TestRunsMapperService>(TestRunsMapperService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Shared helper: UUID resolution
  // =========================================================================

  /**
   * The rewritten Apdex queries run inside a transaction and issue
   * `SET LOCAL work_mem = '512MB'` as the first statement. That call goes
   * through the same mocked `query` fn — so the mock implementations below
   * need to skip it when stepping through the configured result sequence.
   */
  const isSetLocalWorkMem = (sql: unknown): boolean =>
    typeof sql === 'string' && /SET\s+LOCAL\s+work_mem/i.test(sql);

  /**
   * Configures testRunRepo.query so that the first call (UUID lookup) returns
   * the given test_run_id, and all subsequent calls return the provided rows.
   * `SET LOCAL work_mem` preludes are treated as no-op steps.
   */
  function mockWithUuidResolution(
    resolvedTestRunId: string,
    ...subsequentResults: unknown[][]
  ) {
    let uuidServed = false;
    let idx = 0;
    (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
      if (isSetLocalWorkMem(sql)) return [];
      if (!uuidServed) {
        uuidServed = true;
        return [{ test_run_id: resolvedTestRunId }];
      }
      const r = subsequentResults[idx] ?? [];
      idx++;
      return r;
    });
  }

  /**
   * Configure for a plain test_run_id (no UUID lookup needed) with optional
   * ramp-up cutoff resolution as the first query, then data rows.
   * `SET LOCAL work_mem` preludes are treated as no-op steps.
   */
  function mockQuerySequence(...results: unknown[][]) {
    let idx = 0;
    (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
      if (isSetLocalWorkMem(sql)) return [];
      const r = results[idx] ?? [];
      idx++;
      return r;
    });
  }

  // =========================================================================
  // getTransactionStats
  // =========================================================================

  describe('getTransactionStats', () => {
    describe('authorization', () => {
      it('returns empty array for non-admin with no org memberships', async () => {
        // Arrange – no repo calls expected
        // Act
        const result = await service.getTransactionStats(TEST_RUN_ID, false, USER_ROLES, []);

        // Assert
        expect(result).toEqual([]);
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        // Arrange – admin bypasses org check
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        // Act
        const result = await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        // Assert
        expect(result).toHaveLength(1);
        expect(testRunRepo.query).toHaveBeenCalled();
      });

      it('queries database for non-admin with org memberships', async () => {
        // Arrange
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        // Act
        const result = await service.getTransactionStats(TEST_RUN_ID, false, USER_ROLES, ORG_IDS);

        // Assert
        expect(result).toHaveLength(1);
        expect(testRunRepo.query).toHaveBeenCalled();
      });

      it('recognises super-admin role as admin', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ['super-admin'], []);
        expect(result).toHaveLength(1);
      });

      it('recognises admin role as admin', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ['admin'], []);
        expect(result).toHaveLength(1);
      });
    });

    describe('UUID resolution', () => {
      it('resolves UUID to test_run_id before querying', async () => {
        // Arrange – first query = UUID lookup, second query = stats
        mockWithUuidResolution(TEST_RUN_ID, [RAW_TRANSACTION_ROW]);

        // Act
        const result = await service.getTransactionStats(UUID, false, ADMIN_ROLES, []);

        // Assert
        expect(result).toHaveLength(1);
        // First call should be UUID lookup query
        const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(firstCall[0]).toContain('SELECT test_run_id FROM test_runs WHERE id');
        expect(firstCall[1]).toEqual([UUID]);
      });

      it('skips UUID lookup for plain test_run_id', async () => {
        // Arrange
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        // Act
        await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        // Assert – UUID lookup query is NOT issued (only 1 query: the stats query)
        const allCalls = (testRunRepo.query as jest.Mock).mock.calls;
        // No call should contain "WHERE id ="
        const hasUuidLookup = allCalls.some(([sql]: [string]) =>
          sql.includes('WHERE id = $1')
        );
        expect(hasUuidLookup).toBe(false);
      });

      it('throws DatabaseException when UUID not found', async () => {
        (testRunRepo.query as jest.Mock).mockResolvedValueOnce([]);

        await expect(
          service.getTransactionStats(UUID, false, ADMIN_ROLES, [])
        ).rejects.toThrow(DatabaseException);
      });
    });

    describe('ramp-up exclusion', () => {
      it('fetches cutoff time when excludeRampUp is true', async () => {
        // Arrange – plain test_run_id → no UUID lookup
        // First query: ramp-up cutoff; second: SET LOCAL work_mem; third: stats
        const startTime = new Date('2024-01-01T10:00:00Z');
        mockQuerySequence(
          [{ start_time: startTime.toISOString(), ramp_up: '300' }],
          [RAW_TRANSACTION_ROW],
        );

        // Act
        const result = await service.getTransactionStats(TEST_RUN_ID, true, ADMIN_ROLES, []);

        // Assert
        expect(result).toHaveLength(1);
        // 3 calls: ramp-up lookup + SET LOCAL work_mem + stats query
        expect(testRunRepo.query).toHaveBeenCalledTimes(3);
        const rampUpCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(rampUpCall[0]).toContain('SELECT start_time, ramp_up');
      });

      it('passes null cutoff when excludeRampUp is false', async () => {
        // Arrange – only 1 query (stats), no ramp-up lookup
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        // Act
        await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        // Assert – stats query receives $3 = null (cutoffTime)
        const statsCalls = (testRunRepo.query as jest.Mock).mock.calls;
        // The stats query is identified by the approx_percentile call (new shape)
        const statsCall = statsCalls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        );
        expect(statsCall).toBeDefined();
        expect(statsCall![1][2]).toBeNull();
      });

      it('passes null cutoff when ramp_up data missing from DB', async () => {
        mockQuerySequence(
          [{ start_time: null, ramp_up: null }], // ramp-up query returns no usable data
          [RAW_TRANSACTION_ROW],
        );

        const result = await service.getTransactionStats(TEST_RUN_ID, true, ADMIN_ROLES, []);
        expect(result).toHaveLength(1);
      });
    });

    describe('sinceMinutes window filter', () => {
      it('includes window filter when sinceMinutes is provided (admin)', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, [], 60);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(statsCall[0]).toContain("interval '1 minute'");
        // Admin params: [testRunId, excludeRampUp, cutoffTime, sinceMinutes]
        expect(statsCall[1]).toHaveLength(4);
        expect(statsCall[1][3]).toBe(60);
      });

      it('includes window filter and org filter for non-admin with sinceMinutes', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, USER_ROLES, ORG_IDS, 30);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        // Non-admin params: [testRunId, excludeRampUp, cutoffTime, sinceMinutes, orgIds]
        expect(statsCall[1]).toHaveLength(5);
        expect(statsCall[1][3]).toBe(30);
        expect(statsCall[1][4]).toEqual(ORG_IDS);
      });

      it('omits window filter when sinceMinutes is undefined (admin)', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, [], undefined);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        // Admin params without sinceMinutes: [testRunId, excludeRampUp, cutoffTime]
        expect(statsCall[1]).toHaveLength(3);
      });
    });

    describe('SQL structure (query shape regressions)', () => {
      it('uses approx_percentile + percentile_agg (no PERCENTILE_CONT)', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(statsCall[0]).toContain('percentile_agg(t.response_time::double precision)');
        expect(statsCall[0]).toContain('approx_percentile(0.95, a.pct_agg)');
        expect(statsCall[0]).toContain('approx_percentile(0.99, a.pct_agg)');
        expect(statsCall[0]).toContain('approx_percentile_rank');
        expect(statsCall[0]).not.toContain('PERCENTILE_CONT');
      });

      it('joins apdex thresholds on sut.id (no name OR id::text OR-join)', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(statsCall[0]).toContain('wat.system_under_test_id = a.system_under_test_id');
        expect(statsCall[0]).toContain('wtat.system_under_test_id = a.system_under_test_id');
        expect(statsCall[0]).not.toContain('sut.name OR');
        expect(statsCall[0]).not.toContain('sut.id::text');
      });

      it('wraps query in a transaction with SET LOCAL work_mem', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(testRunRepo.manager.transaction).toHaveBeenCalledTimes(1);
        const setLocalCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          /SET\s+LOCAL\s+work_mem/i.test(sql)
        );
        expect(setLocalCall).toBeDefined();
      });
    });

    describe('data mapping', () => {
      it('maps all fields from raw DB row correctly', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result).toHaveLength(1);
        const row = result[0];
        expect(row.transaction_name).toBe('checkout');
        expect(row.scenario_name).toBe('load_test');
        expect(row.total_count).toBe(600);
        expect(row.passed_count).toBe(590);
        expect(row.failed_count).toBe(10);
        expect(row.avg_response_time).toBe(120.5);
        expect(row.p95_response_time).toBe(300);
        expect(row.p99_response_time).toBe(450);
        expect(row.ranking).toBe(72300);
        expect(row.apdex_score).toBe(0.95);
        expect(row.active_threshold).toBe(500);
      });

      it('maps null scenario_name to undefined', async () => {
        mockQuerySequence([{ ...RAW_TRANSACTION_ROW, scenario_name: null }]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result[0].scenario_name).toBeUndefined();
      });

      it('maps empty string scenario_name to undefined', async () => {
        mockQuerySequence([{ ...RAW_TRANSACTION_ROW, scenario_name: '' }]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result[0].scenario_name).toBeUndefined();
      });

      it('defaults null numeric fields to 0', async () => {
        mockQuerySequence([{
          ...RAW_TRANSACTION_ROW,
          avg_response_time: null,
          p95_response_time: null,
          p99_response_time: null,
          apdex_score: null,
        }]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result[0].avg_response_time).toBe(0);
        expect(result[0].p95_response_time).toBe(0);
        expect(result[0].p99_response_time).toBe(0);
        expect(result[0].apdex_score).toBe(0);
      });

      it('defaults null active_threshold to 500', async () => {
        mockQuerySequence([{ ...RAW_TRANSACTION_ROW, active_threshold: null }]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result[0].active_threshold).toBe(500);
      });

      it('returns empty array when no rows found', async () => {
        mockQuerySequence([]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result).toEqual([]);
      });

      it('maps multiple rows preserving order', async () => {
        const row2 = { ...RAW_TRANSACTION_ROW, transaction_name: 'login' };
        mockQuerySequence([RAW_TRANSACTION_ROW, row2]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result).toHaveLength(2);
        expect(result[0].transaction_name).toBe('checkout');
        expect(result[1].transaction_name).toBe('login');
      });
    });

    describe('error handling', () => {
      it('wraps raw DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));

        await expect(
          service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, [])
        ).rejects.toThrow('Failed to retrieve transaction statistics');
      });

      it('propagates existing DatabaseException wrapped', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(
          new DatabaseException('pre-existing db error')
        );

        await expect(
          service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, [])
        ).rejects.toThrow(DatabaseException);
      });
    });
  });

  // =========================================================================
  // getTransactionSamples
  // =========================================================================

  describe('getTransactionSamples', () => {
    const TRANSACTION = 'checkout';

    describe('authorization', () => {
      it('returns empty array for non-admin with no org memberships', async () => {
        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, USER_ROLES, []);

        expect(result).toEqual([]);
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, []);

        expect(result).toHaveLength(1);
      });

      it('queries database for non-admin with org memberships', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, USER_ROLES, ORG_IDS);

        expect(result).toHaveLength(1);
      });
    });

    describe('ramp-up exclusion', () => {
      it('fetches cutoff time when excludeRampUp is true', async () => {
        const startTime = new Date('2024-01-01T10:00:00Z');
        mockQuerySequence(
          [{ start_time: startTime.toISOString(), ramp_up: '120' }],
          [RAW_SAMPLER_ROW],
        );

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, true, ADMIN_ROLES, []);

        expect(result).toHaveLength(1);
        expect(testRunRepo.query).toHaveBeenCalledTimes(2);
      });

      it('does not fetch cutoff when excludeRampUp is false', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, []);

        // Only 1 query — no ramp-up lookup
        expect(testRunRepo.query).toHaveBeenCalledTimes(1);
      });
    });

    describe('sinceMinutes window filter', () => {
      it('appends sinceMinutes param for admin', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, [], 45);

        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(samplerCall[0]).toContain("interval '1 minute'");
        // Params: [testRunId, transactionName, excludeRampUp, cutoffTime, sinceMinutes]
        expect(samplerCall[1]).toHaveLength(5);
        expect(samplerCall[1][4]).toBe(45);
      });

      it('appends orgIds after sinceMinutes for non-admin', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, USER_ROLES, ORG_IDS, 15);

        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        // Params: [testRunId, transactionName, excludeRampUp, cutoffTime, sinceMinutes, orgIds]
        expect(samplerCall[1]).toHaveLength(6);
        expect(samplerCall[1][4]).toBe(15);
        expect(samplerCall[1][5]).toEqual(ORG_IDS);
      });

      it('places orgIds at position 5 when sinceMinutes absent (non-admin)', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, USER_ROLES, ORG_IDS);

        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        // Params: [testRunId, transactionName, excludeRampUp, cutoffTime, orgIds]
        expect(samplerCall[1]).toHaveLength(5);
        expect(samplerCall[1][4]).toEqual(ORG_IDS);
      });
    });

    describe('data mapping', () => {
      it('maps all fields correctly from raw row', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, []);

        expect(result).toHaveLength(1);
        const row = result[0];
        expect(row.sampler_name).toBe('POST /checkout');
        expect(row.scenario_name).toBe('load_test');
        expect(row.avg_response_time).toBe(115.25);
        expect(row.min_response_time).toBe(50);
        expect(row.max_response_time).toBe(900);
        expect(row.p95_response_time).toBe(295);
        expect(row.p99_response_time).toBe(440);
        expect(row.passed_count).toBe(580);
        expect(row.failed_count).toBe(10);
        expect(row.total_count).toBe(590);
        expect(row.avg_latency).toBe(10);
        expect(row.avg_connect_time).toBe(5);
        expect(row.total_request_size).toBe(102400);
        expect(row.total_response_size).toBe(204800);
        expect(row.apdex_score).toBe(0.94);
        expect(row.active_threshold).toBe(500);
        expect(row.url_hash).toBe('abc123');
        expect(row.url_pattern).toBe('/checkout');
      });

      it('maps null url_hash and url_pattern to null', async () => {
        mockQuerySequence([{ ...RAW_SAMPLER_ROW, url_hash: null, url_pattern: null }]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, []);

        expect(result[0].url_hash).toBeNull();
        expect(result[0].url_pattern).toBeNull();
      });

      it('maps null scenario_name to undefined', async () => {
        mockQuerySequence([{ ...RAW_SAMPLER_ROW, scenario_name: null }]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, []);

        expect(result[0].scenario_name).toBeUndefined();
      });

      it('returns empty array when no samplers found', async () => {
        mockQuerySequence([]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, []);

        expect(result).toEqual([]);
      });

      it('defaults null numeric fields to 0', async () => {
        mockQuerySequence([{
          ...RAW_SAMPLER_ROW,
          avg_response_time: null,
          avg_latency: null,
          apdex_score: null,
        }]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, []);

        expect(result[0].avg_response_time).toBe(0);
        expect(result[0].avg_latency).toBe(0);
        expect(result[0].apdex_score).toBe(0);
      });
    });

    describe('error handling', () => {
      it('wraps DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('db error'));

        await expect(
          service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, ADMIN_ROLES, [])
        ).rejects.toThrow('Failed to retrieve transaction sampler statistics');
      });
    });
  });

  // =========================================================================
  // getTransactionErrors
  // =========================================================================

  describe('getTransactionErrors', () => {
    describe('authorization', () => {
      it('returns empty array for non-admin with no org memberships', async () => {
        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, USER_ROLES, []);

        expect(result).toEqual([]);
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, []);

        expect(result).toHaveLength(1);
      });

      it('queries database for non-admin with org memberships', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, USER_ROLES, ORG_IDS);

        expect(result).toHaveLength(1);
      });
    });

    describe('UUID resolution', () => {
      it('resolves UUID before querying', async () => {
        mockWithUuidResolution(TEST_RUN_ID, [RAW_ERROR_ROW]);

        const result = await service.getTransactionErrors(UUID, undefined, undefined, ADMIN_ROLES, []);

        expect(result).toHaveLength(1);
        const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(firstCall[0]).toContain('SELECT test_run_id FROM test_runs WHERE id');
      });
    });

    describe('optional filters', () => {
      it('builds query without transaction or sampler filter', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, []);

        const call = (testRunRepo.query as jest.Mock).mock.calls[0];
        // Params should only contain testRunId (no extra filters)
        expect(call[1]).toEqual([TEST_RUN_ID]);
      });

      it('appends transaction filter param when transactionName provided', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, ADMIN_ROLES, []);

        const call = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(call[1]).toContain('checkout');
        expect(call[1]).toHaveLength(2);
      });

      it('appends sampler filter param when samplerName provided', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, undefined, 'POST /checkout', ADMIN_ROLES, []);

        const call = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(call[1]).toContain('POST /checkout');
        expect(call[1]).toHaveLength(2);
      });

      it('appends both transaction and sampler filter params', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', 'POST /checkout', ADMIN_ROLES, []);

        const call = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(call[1]).toContain('checkout');
        expect(call[1]).toContain('POST /checkout');
        expect(call[1]).toHaveLength(3);
      });

      it('appends orgIds as last param for non-admin', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, USER_ROLES, ORG_IDS);

        const call = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(call[1][call[1].length - 1]).toEqual(ORG_IDS);
      });
    });

    describe('data mapping', () => {
      it('maps all fields correctly from raw row', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, []);

        expect(result).toHaveLength(1);
        const row = result[0];
        expect(row.error_type).toBe('HTTP 500');
        expect(row.response_code).toBe('500');
        expect(row.response_message).toBe('Internal Server Error');
        expect(row.sampler_name).toBe('POST /checkout');
        // url should prefer sample_url
        expect(row.url).toBe('http://example.com/checkout?session=1');
        expect(row.url_hash).toBe('abc123');
        expect(row.url_pattern).toBe('/checkout');
        expect(row.count).toBe(10);
        expect(row.first_occurrence).toBe('2024-01-01T10:00:00Z');
        expect(row.last_occurrence).toBe('2024-01-01T11:00:00Z');
        expect(row.sample_response_data).toBe('{"error":"Internal Server Error"}');
        expect(row.total_requests).toBe(600);
        expect(row.apdex_score).toBe(0.85);
      });

      it('falls back to url field when sample_url is null', async () => {
        mockQuerySequence([{ ...RAW_ERROR_ROW, sample_url: null }]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, []);

        expect(result[0].url).toBe('http://example.com/checkout');
      });

      it('maps null url_hash and url_pattern to null', async () => {
        mockQuerySequence([{ ...RAW_ERROR_ROW, url_hash: null, url_pattern: null }]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, []);

        expect(result[0].url_hash).toBeNull();
        expect(result[0].url_pattern).toBeNull();
      });

      it('defaults null sample_response_data to empty string', async () => {
        mockQuerySequence([{ ...RAW_ERROR_ROW, sample_response_data: null }]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, []);

        expect(result[0].sample_response_data).toBe('');
      });

      it('returns empty array when no errors found', async () => {
        mockQuerySequence([]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, []);

        expect(result).toEqual([]);
      });
    });

    describe('error handling', () => {
      it('wraps DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('db error'));

        await expect(
          service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, ADMIN_ROLES, [])
        ).rejects.toThrow('Failed to retrieve transaction errors');
      });
    });
  });

  // =========================================================================
  // getVirtualUserStats
  // =========================================================================

  describe('getVirtualUserStats', () => {
    /**
     * getVirtualUserStats issues two parallel queries (overall + by_scenario)
     * via Promise.all. We configure the mock to return results in call order.
     */
    function mockVuQueries(overallRows: unknown[], scenarioRows: unknown[]) {
      let callCount = 0;
      (testRunRepo.query as jest.Mock).mockImplementation(async () => {
        if (callCount === 0) {
          callCount++;
          return overallRows;
        }
        callCount++;
        return scenarioRows;
      });
    }

    function mockVuQueriesWithRampUp(
      rampUpRow: unknown,
      overallRows: unknown[],
      scenarioRows: unknown[]
    ) {
      let callCount = 0;
      (testRunRepo.query as jest.Mock).mockImplementation(async () => {
        if (callCount === 0) {
          callCount++;
          return [rampUpRow];
        }
        if (callCount === 1) {
          callCount++;
          return overallRows;
        }
        callCount++;
        return scenarioRows;
      });
    }

    describe('authorization', () => {
      it('returns empty struct for non-admin with no org memberships', async () => {
        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, USER_ROLES, []);

        expect(result).toEqual({
          overall: {
            peak_active_threads: 0,
            avg_active_threads: 0,
            peak_started_threads: 0,
            avg_started_threads: 0,
            peak_finished_threads: 0,
            avg_finished_threads: 0,
            total_data_points: 0,
          },
          by_scenario: [],
        });
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        mockVuQueries([RAW_VU_OVERALL], [RAW_VU_SCENARIO]);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.overall.peak_active_threads).toBe(100);
        expect(result.by_scenario).toHaveLength(1);
      });

      it('queries database for non-admin with org memberships', async () => {
        mockVuQueries([RAW_VU_OVERALL], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, USER_ROLES, ORG_IDS);

        expect(result.overall.peak_active_threads).toBe(100);
      });
    });

    describe('UUID resolution', () => {
      it('resolves UUID before querying', async () => {
        // UUID lookup + ramp-up + 2 parallel queries
        let callCount = 0;
        (testRunRepo.query as jest.Mock).mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [{ test_run_id: TEST_RUN_ID }]; // UUID lookup
          if (callCount === 2) return [RAW_VU_OVERALL]; // overall
          return [RAW_VU_SCENARIO]; // by_scenario
        });

        const result = await service.getVirtualUserStats(UUID, false, ADMIN_ROLES, []);

        expect(result.overall.peak_active_threads).toBe(100);
        const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(firstCall[0]).toContain('WHERE id = $1');
      });
    });

    describe('ramp-up exclusion', () => {
      it('fetches cutoff time when excludeRampUp is true', async () => {
        const startTime = new Date('2024-01-01T10:00:00Z');
        mockVuQueriesWithRampUp(
          { start_time: startTime.toISOString(), ramp_up: '300' },
          [RAW_VU_OVERALL],
          [RAW_VU_SCENARIO],
        );

        await service.getVirtualUserStats(TEST_RUN_ID, true, ADMIN_ROLES, []);

        // 3 calls: ramp-up + 2 parallel VU queries
        expect(testRunRepo.query).toHaveBeenCalledTimes(3);
      });
    });

    describe('data mapping', () => {
      it('maps overall stats correctly', async () => {
        mockVuQueries([RAW_VU_OVERALL], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        const o = result.overall;
        expect(o.peak_active_threads).toBe(100);
        expect(o.avg_active_threads).toBe(75.5);
        expect(o.peak_started_threads).toBe(100);
        expect(o.avg_started_threads).toBe(80);
        expect(o.peak_finished_threads).toBe(99);
        expect(o.avg_finished_threads).toBe(74);
        expect(o.total_data_points).toBe(360);
      });

      it('maps by_scenario stats correctly', async () => {
        mockVuQueries([RAW_VU_OVERALL], [RAW_VU_SCENARIO]);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.by_scenario).toHaveLength(1);
        const s = result.by_scenario[0];
        expect(s.scenario_name).toBe('checkout_flow');
        expect(s.peak_active_threads).toBe(50);
        expect(s.avg_active_threads).toBe(40);
        expect(s.total_data_points).toBe(180);
      });

      it('returns zero-filled overall when DB returns empty result', async () => {
        mockVuQueries([], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.overall.peak_active_threads).toBe(0);
        expect(result.overall.total_data_points).toBe(0);
      });

      it('returns empty by_scenario array when no scenarios', async () => {
        mockVuQueries([RAW_VU_OVERALL], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.by_scenario).toEqual([]);
      });

      it('defaults null numeric fields to 0 in overall', async () => {
        mockVuQueries([{
          ...RAW_VU_OVERALL,
          peak_active_threads: null,
          avg_active_threads: null,
        }], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.overall.peak_active_threads).toBe(0);
        expect(result.overall.avg_active_threads).toBe(0);
      });
    });

    describe('error handling', () => {
      it('wraps DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('db error'));

        await expect(
          service.getVirtualUserStats(TEST_RUN_ID, false, ADMIN_ROLES, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getVirtualUserStats(TEST_RUN_ID, false, ADMIN_ROLES, [])
        ).rejects.toThrow('Failed to retrieve virtual user statistics');
      });
    });
  });

  // =========================================================================
  // getThroughputStats
  // =========================================================================

  describe('getThroughputStats', () => {
    /**
     * getThroughputStats issues 3 parallel queries (transactions, requests, scenarios).
     * Call order in Promise.all: transactions → requests → scenarios.
     */
    function mockThroughputQueries(
      transactionRows: unknown[],
      requestRows: unknown[],
      scenarioRows: unknown[]
    ) {
      let callCount = 0;
      (testRunRepo.query as jest.Mock).mockImplementation(async () => {
        if (callCount === 0) { callCount++; return transactionRows; }
        if (callCount === 1) { callCount++; return requestRows; }
        callCount++;
        return scenarioRows;
      });
    }

    function mockThroughputWithRampUp(
      rampUpRow: unknown,
      transactionRows: unknown[],
      requestRows: unknown[],
      scenarioRows: unknown[]
    ) {
      let callCount = 0;
      (testRunRepo.query as jest.Mock).mockImplementation(async () => {
        if (callCount === 0) { callCount++; return [rampUpRow]; }
        if (callCount === 1) { callCount++; return transactionRows; }
        if (callCount === 2) { callCount++; return requestRows; }
        callCount++;
        return scenarioRows;
      });
    }

    describe('authorization', () => {
      it('returns empty struct for non-admin with no org memberships', async () => {
        const result = await service.getThroughputStats(TEST_RUN_ID, false, USER_ROLES, []);

        expect(result).toEqual({
          overall: {
            peak_transactions_per_second: 0,
            peak_requests_per_second: 0,
          },
          by_scenario: [],
        });
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        mockThroughputQueries(
          [RAW_TRANSACTIONS_TPS],
          [RAW_REQUESTS_RPS],
          [RAW_SCENARIO_THROUGHPUT],
        );

        const result = await service.getThroughputStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.overall.peak_transactions_per_second).toBe(120);
        expect(result.overall.peak_requests_per_second).toBe(350);
        expect(result.by_scenario).toHaveLength(1);
      });

      it('queries database for non-admin with org memberships', async () => {
        mockThroughputQueries([RAW_TRANSACTIONS_TPS], [RAW_REQUESTS_RPS], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, USER_ROLES, ORG_IDS);

        expect(result.overall.peak_transactions_per_second).toBe(120);
      });
    });

    describe('UUID resolution', () => {
      it('resolves UUID before querying', async () => {
        let callCount = 0;
        (testRunRepo.query as jest.Mock).mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [{ test_run_id: TEST_RUN_ID }]; // UUID lookup
          if (callCount === 2) return [RAW_TRANSACTIONS_TPS];
          if (callCount === 3) return [RAW_REQUESTS_RPS];
          return [RAW_SCENARIO_THROUGHPUT];
        });

        await service.getThroughputStats(UUID, false, ADMIN_ROLES, []);

        const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(firstCall[0]).toContain('WHERE id = $1');
      });
    });

    describe('ramp-up exclusion', () => {
      it('fetches cutoff time when excludeRampUp is true', async () => {
        const startTime = new Date('2024-01-01T10:00:00Z');
        mockThroughputWithRampUp(
          { start_time: startTime.toISOString(), ramp_up: '600' },
          [RAW_TRANSACTIONS_TPS],
          [RAW_REQUESTS_RPS],
          [],
        );

        await service.getThroughputStats(TEST_RUN_ID, true, ADMIN_ROLES, []);

        // 4 calls: ramp-up + 3 parallel throughput queries
        expect(testRunRepo.query).toHaveBeenCalledTimes(4);
      });
    });

    describe('data mapping', () => {
      it('maps overall throughput correctly', async () => {
        mockThroughputQueries([RAW_TRANSACTIONS_TPS], [RAW_REQUESTS_RPS], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.overall.peak_transactions_per_second).toBe(120);
        expect(result.overall.peak_requests_per_second).toBe(350);
      });

      it('maps by_scenario throughput correctly', async () => {
        mockThroughputQueries(
          [RAW_TRANSACTIONS_TPS],
          [RAW_REQUESTS_RPS],
          [RAW_SCENARIO_THROUGHPUT],
        );

        const result = await service.getThroughputStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.by_scenario).toHaveLength(1);
        const s = result.by_scenario[0];
        expect(s.scenario_name).toBe('checkout_flow');
        expect(s.peak_transactions_per_second).toBe(60);
        expect(s.peak_requests_per_second).toBe(175);
      });

      it('returns zero overall when DB returns empty result', async () => {
        mockThroughputQueries([], [], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.overall.peak_transactions_per_second).toBe(0);
        expect(result.overall.peak_requests_per_second).toBe(0);
      });

      it('returns empty by_scenario array when no scenarios', async () => {
        mockThroughputQueries([RAW_TRANSACTIONS_TPS], [RAW_REQUESTS_RPS], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.by_scenario).toEqual([]);
      });

      it('defaults null peak_transactions_per_second to 0', async () => {
        mockThroughputQueries(
          [{ peak_transactions_per_second: null }],
          [{ peak_requests_per_second: null }],
          [],
        );

        const result = await service.getThroughputStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

        expect(result.overall.peak_transactions_per_second).toBe(0);
        expect(result.overall.peak_requests_per_second).toBe(0);
      });
    });

    describe('error handling', () => {
      it('wraps DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('db error'));

        await expect(
          service.getThroughputStats(TEST_RUN_ID, false, ADMIN_ROLES, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getThroughputStats(TEST_RUN_ID, false, ADMIN_ROLES, [])
        ).rejects.toThrow('Failed to retrieve throughput statistics');
      });
    });
  });

  // =========================================================================
  // Cross-cutting: isGlobalAdmin
  // =========================================================================

  describe('role-based admin detection', () => {
    it('treats perfana-admin role as admin and bypasses org filtering', async () => {
      mockQuerySequence([RAW_TRANSACTION_ROW]);
      const result = await service.getTransactionStats(TEST_RUN_ID, false, ['perfana-admin'], []);
      expect(result).toHaveLength(1);
    });

    it('treats super-admin role as admin and bypasses org filtering', async () => {
      mockQuerySequence([RAW_TRANSACTION_ROW]);
      const result = await service.getTransactionStats(TEST_RUN_ID, false, ['super-admin'], []);
      expect(result).toHaveLength(1);
    });

    it('treats admin role as admin and bypasses org filtering', async () => {
      mockQuerySequence([RAW_TRANSACTION_ROW]);
      const result = await service.getTransactionStats(TEST_RUN_ID, false, ['admin'], []);
      expect(result).toHaveLength(1);
    });

    it('treats mixed roles including perfana-admin as admin', async () => {
      mockQuerySequence([RAW_TRANSACTION_ROW]);
      const result = await service.getTransactionStats(TEST_RUN_ID, false, ['user', 'perfana-admin'], []);
      expect(result).toHaveLength(1);
    });

    it('treats unknown roles as non-admin and requires org memberships', async () => {
      const result = await service.getTransactionStats(TEST_RUN_ID, false, ['viewer', 'reporter'], []);

      expect(result).toEqual([]);
      expect(testRunRepo.query).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Cross-cutting: mapper integration
  // =========================================================================

  describe('mapper integration', () => {
    it('uses mapper.parseFloat for floating-point response time fields', async () => {
      const parseFloatSpy = jest.spyOn(mapper, 'parseFloat');
      mockQuerySequence([RAW_TRANSACTION_ROW]);

      await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

      // parseFloat called for avg, p95, p99, ranking, apdex_score
      expect(parseFloatSpy).toHaveBeenCalledTimes(5);
    });

    it('uses mapper.parseInt for integer count fields', async () => {
      const parseIntSpy = jest.spyOn(mapper, 'parseInt');
      mockQuerySequence([RAW_TRANSACTION_ROW]);

      await service.getTransactionStats(TEST_RUN_ID, false, ADMIN_ROLES, []);

      // parseInt called for total_count, passed_count, failed_count, active_threshold
      expect(parseIntSpy).toHaveBeenCalledTimes(4);
    });
  });
});
