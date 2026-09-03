import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataSanityCheckPipeline } from '../../../pipelines/DataSanityCheckPipeline.js';

// Mock dependencies
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
};

const mockDb = {
  transaction: vi.fn(),
  query: vi.fn(),
  getTestRunByTestRunId: vi.fn(),
  updateTestRunByTestRunId: vi.fn(),
  getAllCollectionStatuses: vi.fn().mockResolvedValue([]),
};

vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDb),
}));

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
  logPerformance: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../lib/utils/timing.js', () => ({
  createPerformanceTimer: vi.fn(() => ({
    logSummary: vi.fn(),
  })),
}));

vi.mock('../../../services/MetricCollectionGapService.js', () => ({
  MetricCollectionGapService: vi.fn().mockImplementation(() => ({
    getCollectionSummary: vi.fn().mockResolvedValue({
      totalSources: 0,
      coverage: 100,
      failedRanges: 0,
    }),
  })),
}));

function createMockTestRun(overrides: Record<string, unknown> = {}) {
  return {
    testRunId: 'test-run-001',
    systemUnderTestId: 'sut-001',
    testEnvironment: 'production',
    workload: 'frontend',
    startTime: new Date('2026-04-04T07:00:00Z'),
    endTime: new Date('2026-04-04T07:06:00Z'),
    analysisStartOffset: 60,
    adaptConfig: { mode: 'DEFAULT', differencesAccepted: 'TBD' },
    status: { evaluatingAdapt: 'COMPLETED', evaluatingChecks: 'COMPLETED' },
    ...overrides,
  };
}

/**
 * Set up mock query responses for the pipeline's SQL queries.
 * The pipeline calls this.query() multiple times with different SQL.
 * We match based on key table names in the SQL to return the right mock data.
 */
function setupQueryMock(responses: {
  panels?: { panels: string; dashboards_with_panels: string };
  metrics?: { has_metrics: string };
  sparse?: any[];
  sparseExclusions?: any[];
  statistics?: { total: string; all_missing: string };
  rampUpCheck?: { total: string; ramp_up_only: string };
  adapt?: { adapt_count: string; baseline_count: string; is_changepoint: string };
  collectionSources?: { count: string };
  appDashboards?: any[];
  dtConfigs?: any[];
}) {
  mockDb.query.mockImplementation((sql: string) => {
    if (sql.includes('ds_panels') && sql.includes('application_dashboards')) {
      return Promise.resolve([responses.panels ?? { panels: '10', dashboards_with_panels: '2' }]);
    }
    if (sql.includes('ds_metrics') && sql.includes('EXISTS')) {
      return Promise.resolve([responses.metrics ?? { has_metrics: 'true' }]);
    }
    // Sparse-metric check: reads pre-aggregated counts from ds_metric_statistics, so it
    // must be matched before the statistics-completeness branch below.
    if (sql.includes('ds_metric_statistics') && sql.includes('GROUP BY')) {
      return Promise.resolve(responses.sparse ?? []);
    }
    if (sql.includes('sparse_metric_exclusions')) {
      return Promise.resolve(responses.sparseExclusions ?? []);
    }
    if (sql.includes('ds_metric_statistics')) {
      return Promise.resolve([responses.statistics ?? { total: '100', all_missing: '0' }]);
    }
    if (sql.includes('ramp_up')) {
      return Promise.resolve([responses.rampUpCheck ?? { total: '100', ramp_up_only: '0' }]);
    }
    if (sql.includes('ds_adapt_results')) {
      return Promise.resolve([responses.adapt ?? { adapt_count: '50', baseline_count: '10', is_changepoint: '0' }]);
    }
    if (sql.includes('ds_metric_collection_status') && sql.includes('failed_ranges')) {
      return Promise.resolve([responses.collectionSources ?? { count: '0' }]);
    }
    if (sql.includes('application_dashboards') && sql.includes('grafana_instance_id')) {
      return Promise.resolve(responses.appDashboards ?? []);
    }
    if (sql.includes('dynatrace_queries')) {
      return Promise.resolve(responses.dtConfigs ?? []);
    }
    return Promise.resolve([]);
  });
}

describe('DataSanityCheckPipeline', () => {
  let pipeline: DataSanityCheckPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new DataSanityCheckPipeline(mockLogger as any);
  });

  describe('ADAPT results check (step 8)', () => {
    it('should flag invalid when ADAPT completed with baselines but no results', async () => {
      const testRun = createMockTestRun();
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({
        adapt: { adapt_count: '0', baseline_count: '5', is_changepoint: '0' },
      });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        valid: false,
        reasons: expect.arrayContaining(['ADAPT analysis completed but no results found']),
      });
    });

    it('should NOT flag changepoint runs even if baselines exist but no ADAPT results', async () => {
      const testRun = createMockTestRun();
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({
        adapt: { adapt_count: '0', baseline_count: '5', is_changepoint: '1' },
      });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        valid: true,
        reasons: [],
      });
    });

    it('should NOT flag when ADAPT has both results and baselines', async () => {
      const testRun = createMockTestRun();
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({
        adapt: { adapt_count: '10', baseline_count: '5', is_changepoint: '0' },
      });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        valid: true,
        reasons: [],
      });
    });

    it('should NOT flag when no baselines exist (first run or no control group)', async () => {
      const testRun = createMockTestRun();
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({
        adapt: { adapt_count: '0', baseline_count: '0', is_changepoint: '0' },
      });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        valid: true,
        reasons: [],
      });
    });

    it('should skip ADAPT check when evaluatingAdapt is not COMPLETED', async () => {
      const testRun = createMockTestRun({
        status: { evaluatingAdapt: 'NO_BASELINES_FOUND', evaluatingChecks: 'COMPLETED' },
      });
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({});

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      // The ADAPT query should not be called
      const adaptQueryCalled = mockDb.query.mock.calls.some(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('ds_adapt_results')
      );
      expect(adaptQueryCalled).toBe(false);
      expect(result.data).toMatchObject({ valid: true, reasons: [] });
    });

    it('should skip ADAPT check when no adaptConfig exists', async () => {
      const testRun = createMockTestRun({ adaptConfig: null });
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({});

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      const adaptQueryCalled = mockDb.query.mock.calls.some(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('ds_adapt_results')
      );
      expect(adaptQueryCalled).toBe(false);
      expect(result.data).toMatchObject({ valid: true, reasons: [] });
    });
  });

  describe('basic validation', () => {
    it('should return valid=null when test run not found', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(null);

      const result = await pipeline.execute({ testRunId: 'nonexistent' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ valid: null, error: 'Test run not found' });
    });

    it('should flag missing time window', async () => {
      const testRun = createMockTestRun({ startTime: null, endTime: null });
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({});

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.data).toMatchObject({
        valid: false,
        reasons: expect.arrayContaining(['Test run has no start/end time']),
      });
    });

    it('should flag no metrics data', async () => {
      const testRun = createMockTestRun();
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({ metrics: { has_metrics: 'false' } });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.data).toMatchObject({
        valid: false,
        reasons: expect.arrayContaining(['No metrics data collected']),
      });
    });

    it('should pass when all checks are clean', async () => {
      const testRun = createMockTestRun({
        adaptConfig: null,
        status: { evaluatingAdapt: null, evaluatingChecks: 'COMPLETED' },
      });
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({});

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ valid: true, reasons: [] });
      expect(mockDb.updateTestRunByTestRunId).toHaveBeenCalledWith('test-run-001', {
        valid: true,
        reasonsNotValid: null,
        dataWarnings: null,
      });
    });
  });

  describe('error handling', () => {
    it('should never throw — returns success with error message', async () => {
      mockDb.getTestRunByTestRunId.mockRejectedValue(new Error('DB connection lost'));

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        valid: null,
        error: 'DB connection lost',
      });
    });
  });

  describe('zero/negative analysis window warning (step 3c)', () => {
    it('should add zero-window warning when start + end offset >= duration', async () => {
      // testRun: 6 min (360s) duration, 60s analysisStartOffset + 300s analysisEndOffset = 360s >= 360s
      const testRun = createMockTestRun({
        analysisStartOffset: 60,
        analysisEndOffset: 300,
      });
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({ adaptConfig: null });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(result.data.warnings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Analysis window is zero or negative/),
        ]),
      );
    });

    it('should add zero-window warning when offsets exceed duration', async () => {
      // testRun: 6 min (360s) duration, 200s + 200s = 400s > 360s
      const testRun = createMockTestRun({
        analysisStartOffset: 200,
        analysisEndOffset: 200,
      });
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({});

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      const warnings: string[] = result.data.warnings ?? [];
      expect(warnings.some((w: string) => w.includes('Analysis window is zero or negative'))).toBe(true);
    });

    it('should warn on sparse metrics without ever scanning ds_metrics', async () => {
      const testRun = createMockTestRun();  // 360s run
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({
        sparse: [
          { metric_name: 'cpu', dashboard_label: 'Host', panel_title: 'CPU', data_points: '3' },
        ],
      });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      const warnings: string[] = result.data.warnings ?? [];
      expect(warnings.some(w => w.includes('Host / cpu: 3 points across a 360s run'))).toBe(true);

      // The whole point of the rewrite: this check reads pre-aggregated counts, it must
      // never group raw data points again. That query read ~103 GB across four runs.
      const groupedRawScans = mockDb.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('ds_metrics') &&
          call[0].includes('GROUP BY')
      );
      expect(groupedRawScans).toHaveLength(0);

      // The replacement must be well formed, not merely absent: the old assertion above
      // passes just as happily if the sparse check stopped querying anything at all.
      const sparseQuery = mockDb.query.mock.calls
        .map((call: unknown[]) => call[0])
        .find((sql: unknown) => typeof sql === 'string' && sql.includes('SUM(count)')) as string;
      expect(sparseQuery).toContain('ds_metric_statistics');
      expect(sparseQuery).toContain('HAVING SUM(count) <');
    });

    it('should NOT add zero-window warning when both offsets are 0', async () => {
      const testRun = createMockTestRun({
        analysisStartOffset: 0,
        analysisEndOffset: 0,
      });
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({ adaptConfig: null });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      const warnings: string[] = result.data.warnings ?? [];
      expect(warnings.some((w: string) => w.includes('Analysis window is zero or negative'))).toBe(false);
    });

    it('should NOT add zero-window warning when offsets leave a positive window', async () => {
      // testRun: 6 min (360s) duration, 60s + 60s = 120s < 360s
      const testRun = createMockTestRun({
        analysisStartOffset: 60,
        analysisEndOffset: 60,
      });
      mockDb.getTestRunByTestRunId.mockResolvedValue(testRun);
      setupQueryMock({});

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      const warnings: string[] = result.data.warnings ?? [];
      expect(warnings.some((w: string) => w.includes('Analysis window is zero or negative'))).toBe(false);
    });
  });
});
