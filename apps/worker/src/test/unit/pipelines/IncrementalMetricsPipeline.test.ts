/**
 * IncrementalMetricsPipeline Unit Tests
 *
 * Covers the collector-failure propagation path added to prevent
 * ds_metric_collection_status from being marked complete when an
 * upsert silently failed inside a collector (e.g. SQLSTATE 42P10).
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { IncrementalMetricsPipeline } from '../../../pipelines/IncrementalMetricsPipeline.js';
import { getLogger } from '../../../lib/utils/logger.js';

vi.mock('../../../lib/utils/logger.js');
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => ({
    dataSource: {},
    query: vi.fn(),
    transaction: vi.fn(),
  })),
}));

describe('IncrementalMetricsPipeline', () => {
  let pipeline: IncrementalMetricsPipeline;
  let mockLogger: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    (getLogger as any).mockReturnValue(mockLogger);

    pipeline = new IncrementalMetricsPipeline(mockLogger);

    // loadTestRun stub — any non-null value is fine
    (pipeline as any).loadTestRun = vi.fn().mockResolvedValue({
      testRunId: 'test-run-42p10',
      systemUnderTestId: 'sut-1',
      workload: 'baseline',
      testEnvironment: 'acc',
      startTime: new Date('2026-04-18T10:00:00Z'),
      endTime: new Date('2026-04-18T10:30:00Z'),
    });
  });

  const validInput = {
    testRunId: 'test-run-42p10',
    fromTime: new Date('2026-04-18T10:00:00Z'),
    toTime: new Date('2026-04-18T10:10:00Z'),
    collectGrafanaMetrics: true,
    collectDynatraceMetrics: false,
    collectPerformanceTestMetrics: false,
  };

  describe('collector failure propagation', () => {
    test('returns success: false when an enabled collector reports failure (regression guard for #132)', async () => {
      (pipeline as any).grafanaCollector.collect = vi.fn().mockResolvedValue({
        success: false,
        dataPoints: 0,
        errors: ['there is no unique or exclusion constraint matching the ON CONFLICT specification'],
        duration: 1411,
      });

      const result = await pipeline.execute(validInput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INCREMENTAL_COLLECTOR_FAILED');
      expect(result.error?.message).toContain('grafana');
      expect(result.error?.message).toContain('ON CONFLICT');
    });

    test('ignores failures from disabled collectors', async () => {
      (pipeline as any).grafanaCollector.collect = vi.fn().mockResolvedValue({
        success: true,
        dataPoints: 10,
        errors: [],
        duration: 12,
      });
      // Dynatrace is disabled in input; its default `success: true` default is
      // what we exercise here. Make sure the pipeline doesn't fail-close on a
      // default-initialized result for a disabled source.
      const result = await pipeline.execute(validInput);

      expect(result.success).toBe(true);
    });

    test('returns success: true when every enabled collector succeeds', async () => {
      (pipeline as any).grafanaCollector.collect = vi.fn().mockResolvedValue({
        success: true,
        dataPoints: 42,
        errors: [],
        duration: 7,
      });

      const result = await pipeline.execute(validInput);

      expect(result.success).toBe(true);
      expect((result.data as any).totalDataPoints).toBe(42);
    });

    test('reports every failed enabled source when multiple fail', async () => {
      (pipeline as any).grafanaCollector.collect = vi.fn().mockResolvedValue({
        success: false,
        dataPoints: 0,
        errors: ['grafana upsert rolled back'],
        duration: 1,
      });
      (pipeline as any).dynatraceCollector.collect = vi.fn().mockResolvedValue({
        success: false,
        dataPoints: 0,
        errors: ['dynatrace API timeout'],
        duration: 2,
      });

      const result = await pipeline.execute({
        ...validInput,
        collectDynatraceMetrics: true,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('grafana');
      expect(result.error?.message).toContain('dynatrace');
      expect(result.error?.message).toContain('2 source(s)');
    });
  });
});
