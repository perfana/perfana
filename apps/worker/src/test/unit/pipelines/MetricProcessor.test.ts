/**
 * MetricProcessor Unit Tests
 *
 * Covers:
 * - ramp_up flag calculation for start-exclusion (analysisStartOffset)
 * - ramp_up flag calculation for end-exclusion (analysisEndOffset)
 * - Edge cases: offsets absent, zero, or no startTime
 */

import { describe, it, expect, vi } from 'vitest';
import { MetricProcessor } from '../../../pipelines/helpers/incremental/metric-processor.js';
import type { TestRunContext } from '../../../pipelines/helpers/incremental/metric-processor.js';

// ---------------------------------------------------------------------------
// Minimal stubs — MetricProcessor only calls logger / db inside upsert paths
// ---------------------------------------------------------------------------

const mockLogger: any = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const mockDb: any = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const START_TIME = new Date('2026-01-01T10:00:00Z'); // t=0

/** Build a Date that is `elapsedSeconds` after START_TIME */
const at = (elapsedSeconds: number) =>
  new Date(START_TIME.getTime() + elapsedSeconds * 1000);

/** Minimal Grafana metrics document */
const makeGrafanaDoc = (records: Array<{ elapsed: number }>) => ({
  test_run_id: 'run-1',
  application_dashboard_id: 'ad-1',
  metrics_source_id: null,
  dashboard_uid: 'uid-1',
  panel_id: 1,
  panel_title: 'Panel A',
  dashboard_label: 'Label A',
  benchmark_ids: null,
  errors: undefined,
  data: records.map((r) => ({
    metric_name: 'some_metric',
    time: at(r.elapsed).toISOString(),
    timestep: null,
    value: 42,
    unit: null,
  })),
});

/** Minimal Dynatrace metrics document */
const makeDynatraceDoc = (records: Array<{ elapsed: number }>) => ({
  testRunId: 'run-1',
  applicationDashboardId: 'ad-1',
  metricsSourceId: null,
  dashboardUid: 'uid-1',
  panelId: 1,
  panelTitle: 'Panel A',
  dashboardLabel: 'Label A',
  benchmarkIds: null,
  errors: undefined,
  data: records.map((r) => ({
    metricName: 'some_metric',
    time: at(r.elapsed).toISOString(),
    timestep: null,
    value: 42,
    unit: null,
  })),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricProcessor', () => {
  const processor = new MetricProcessor(mockLogger, mockDb);

  // -------------------------------------------------------------------------
  describe('flattenGrafanaMetricsDocument — start exclusion (analysisStartOffset)', () => {
    it('marks records before analysisStartOffset as ramp_up=true', () => {
      const ctx: TestRunContext = {
        startTime: START_TIME,
        analysisStartOffset: 60,
      };
      const doc = makeGrafanaDoc([
        { elapsed: 30 },  // inside ramp-up
        { elapsed: 90 },  // past offset → normal
      ]);

      const result = processor.flattenGrafanaMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(true);
      expect(result[1].ramp_up).toBe(false);
    });

    it('marks no records as ramp_up when analysisStartOffset is 0', () => {
      const ctx: TestRunContext = {
        startTime: START_TIME,
        analysisStartOffset: 0,
      };
      const doc = makeGrafanaDoc([{ elapsed: 10 }, { elapsed: 200 }]);

      const result = processor.flattenGrafanaMetricsDocument(doc, ctx);

      expect(result.every((r) => r.ramp_up === false)).toBe(true);
    });

    it('marks no records as ramp_up when analysisStartOffset is absent', () => {
      const ctx: TestRunContext = { startTime: START_TIME };
      const doc = makeGrafanaDoc([{ elapsed: 10 }]);

      const result = processor.flattenGrafanaMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('flattenGrafanaMetricsDocument — end exclusion (analysisEndOffset)', () => {
    it('marks records after (endTime - analysisEndOffset) as ramp_up=true', () => {
      // duration = 600 s; cutoff = 600 - 60 = 540 s
      const ctx: TestRunContext = {
        startTime: START_TIME,
        endTime: at(600),
        analysisEndOffset: 60,
      };
      const doc = makeGrafanaDoc([
        { elapsed: 480 }, // 10:08:00 — inside window
        { elapsed: 570 }, // 10:09:30 — past cutoff (570 > 540)
      ]);

      const result = processor.flattenGrafanaMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(false);
      expect(result[1].ramp_up).toBe(true);
    });

    it('does not exclude tail when analysisEndOffset is 0', () => {
      const ctx: TestRunContext = {
        startTime: START_TIME,
        endTime: at(600),
        analysisEndOffset: 0,
      };
      const doc = makeGrafanaDoc([
        { elapsed: 480 },
        { elapsed: 570 },
      ]);

      const result = processor.flattenGrafanaMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(false);
      expect(result[1].ramp_up).toBe(false);
    });

    it('does not exclude tail when analysisEndOffset is absent', () => {
      const ctx: TestRunContext = {
        startTime: START_TIME,
        endTime: at(600),
      };
      const doc = makeGrafanaDoc([{ elapsed: 590 }]);

      const result = processor.flattenGrafanaMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(false);
    });

    it('does not exclude tail when endTime is absent even if analysisEndOffset is set', () => {
      const ctx: TestRunContext = {
        startTime: START_TIME,
        analysisEndOffset: 60,
        // no endTime — duration unknown → cannot compute cutoff
      };
      const doc = makeGrafanaDoc([{ elapsed: 590 }]);

      const result = processor.flattenGrafanaMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(false);
    });

    it('combines start and end exclusion correctly', () => {
      // duration = 600 s; start cutoff = 60 s; end cutoff = 540 s
      const ctx: TestRunContext = {
        startTime: START_TIME,
        endTime: at(600),
        analysisStartOffset: 60,
        analysisEndOffset: 60,
      };
      const doc = makeGrafanaDoc([
        { elapsed: 30 },  // ramp_up: start exclusion
        { elapsed: 300 }, // normal
        { elapsed: 570 }, // ramp_up: end exclusion
      ]);

      const result = processor.flattenGrafanaMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(true);
      expect(result[1].ramp_up).toBe(false);
      expect(result[2].ramp_up).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('flattenDynatraceMetricsDocument — end exclusion (analysisEndOffset)', () => {
    it('marks records after (endTime - analysisEndOffset) as ramp_up=true', () => {
      const ctx: TestRunContext = {
        startTime: START_TIME,
        endTime: at(600),
        analysisEndOffset: 60,
      };
      const doc = makeDynatraceDoc([
        { elapsed: 480 }, // inside window
        { elapsed: 570 }, // past cutoff
      ]);

      const result = processor.flattenDynatraceMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(false);
      expect(result[1].ramp_up).toBe(true);
    });

    it('does not exclude tail when analysisEndOffset is 0', () => {
      const ctx: TestRunContext = {
        startTime: START_TIME,
        endTime: at(600),
        analysisEndOffset: 0,
      };
      const doc = makeDynatraceDoc([{ elapsed: 570 }]);

      const result = processor.flattenDynatraceMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(false);
    });

    it('combines start and end exclusion correctly for Dynatrace', () => {
      const ctx: TestRunContext = {
        startTime: START_TIME,
        endTime: at(600),
        analysisStartOffset: 60,
        analysisEndOffset: 60,
      };
      const doc = makeDynatraceDoc([
        { elapsed: 30 },
        { elapsed: 300 },
        { elapsed: 570 },
      ]);

      const result = processor.flattenDynatraceMetricsDocument(doc, ctx);

      expect(result[0].ramp_up).toBe(true);
      expect(result[1].ramp_up).toBe(false);
      expect(result[2].ramp_up).toBe(true);
    });
  });
});
