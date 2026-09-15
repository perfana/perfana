/**
 * ADAPT sample floor: a metric with fewer than `minSampleCount` points on the test run,
 * or fewer pooled over its control group, is `incomparable` instead of being judged on a
 * handful of samples.
 *
 * Found on SONAR-acceptatie-loadtest_perfana-00014: a JMeter sampler whose parent chain
 * broke in the last seconds of the run landed as a separate bare-named metric with ONE
 * sample (759 ms) against a control group that held ONE sample (436 ms), and ADAPT
 * reported a full `regression` on it. Replayed against the dev DB with this change the
 * label is `incomparable` and the real `transaction.sampler` series is untouched.
 *
 * DB-free string assertions on the generated SQL, same shape as adapt-iqr-zero-variance.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AdaptSQLFragments,
  adaptMinSampleCount,
} from '../../../pipelines/helpers/adapt/results/sql-fragments.js';
import { AdaptResultsSQLBuilder } from '../../../pipelines/helpers/adapt/results/sql-builder.js';
import { TrackedResultsSQLBuilder } from '../../../pipelines/helpers/adapt/results/tracked-results-sql-builder.js';
import {
  createDsCompareConfigRecordPanelLevel,
  createDsCompareConfigRecordPanelLevelNoClassification,
} from '../../../pipelines/helpers/metrics-builder.js';
import { ErrorsProcessor, VirtualUsersProcessor } from '../../../pipelines/helpers/scenario-processors.js';
import type { DashboardManager } from '../../../pipelines/helpers/dashboard-manager.js';
import { METRIC_TYPE_PANEL_IDS, METRIC_TYPE_PANEL_NAMES } from '../../../constants/performance-metrics.js';
import type { TestRunMetadata } from '../../../types/performance-metrics.js';

const ORIGINAL = process.env.ADAPT_MIN_SAMPLE_COUNT;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADAPT_MIN_SAMPLE_COUNT;
  else process.env.ADAPT_MIN_SAMPLE_COUNT = ORIGINAL;
});

describe('adaptMinSampleCount', () => {
  test.each([
    [undefined, 2],
    ['', 2],
    ['5', 5],
    ['1', 1],
    ['0', 2],
    ['abc', 2],
    ['2.5', 2],
    ['-1', 2],
  ])('env %j → %i', (raw, expected) => {
    if (raw === undefined) delete process.env.ADAPT_MIN_SAMPLE_COUNT;
    else process.env.ADAPT_MIN_SAMPLE_COUNT = raw;
    expect(adaptMinSampleCount()).toBe(expected);
  });
});

describe('control_exists carries the sample floor', () => {
  test('the column gates on the raw join AND both counts, with the config override first', () => {
    process.env.ADAPT_MIN_SAMPLE_COUNT = '3';
    const col = new AdaptSQLFragments().buildControlExistsColumn();
    expect(col).toContain('wcc.control_row_exists');
    // Both counts are nullable in the entities and must read as 0, never as a NULL that
    // skips the incomparable branch; the config value is untrusted, so a non-number is
    // ignored, a fraction floored, and a zero/negative override clamped to 1.
    expect(col).toContain("COALESCE(wcc.test_n, 0) >= GREATEST(1, COALESCE(CASE WHEN jsonb_typeof(wcc.compare_config->'thresholds'->'minSampleCount') = 'number' THEN floor((wcc.compare_config->'thresholds'->'minSampleCount')::text::numeric) END, 3))");
    expect(col).toContain("COALESCE(wcc.control_n, 0) >= GREATEST(1, COALESCE(CASE WHEN jsonb_typeof(wcc.compare_config->'thresholds'->'minSampleCount') = 'number' THEN floor((wcc.compare_config->'thresholds'->'minSampleCount')::text::numeric) END, 3))");
    expect(col.trim().endsWith('as control_exists')).toBe(true);
  });

  test.each([
    ['results', () => new AdaptResultsSQLBuilder().buildAdaptResultsSQL('$1', '', 1)],
    ['tracked', () => new TrackedResultsSQLBuilder().buildTrackedResultsSQL('$1', 1)],
  ])('%s builder derives control_exists after config resolution, not in with_control', (_, build) => {
    const sql = build();
    // with_control only reports whether a row joined
    expect(sql).toContain('cgs.control_group_id IS NOT NULL as control_row_exists');
    expect(sql).not.toMatch(/cgs\.control_group_id IS NOT NULL THEN true[\s\S]*?as control_exists/);
    // exactly one definition of control_exists, and it is the floored one
    expect(sql.match(/as control_exists/g)).toHaveLength(1);
    expect(sql.indexOf('as control_exists')).toBeGreaterThan(sql.indexOf('with_compare_config AS'));
    expect(sql).toContain("jsonb_typeof(wcc.compare_config->'thresholds'->'minSampleCount') = 'number'");
    // every downstream check still keys on it
    expect((sql.match(/w(ds|tc)\.control_exists/g) ?? []).length).toBeGreaterThanOrEqual(7);
    // ...and nothing downstream reads the raw join outcome, which would bypass the floor
    expect(sql.match(/w(ds|tc)\.control_row_exists/g)).toBeNull();
  });

  const controlExistsColumn = (sql: string): string => {
    const m = sql.match(/wcc\.control_row_exists[\s\S]*?as control_exists/);
    expect(m).not.toBeNull();
    return m![0].replace(/\s+/g, ' ');
  };

  test('the env floor reaches BOTH full builders, and they emit the identical column', () => {
    process.env.ADAPT_MIN_SAMPLE_COUNT = '4';
    const results = controlExistsColumn(new AdaptResultsSQLBuilder().buildAdaptResultsSQL('$1', '', 1));
    const tracked = controlExistsColumn(new TrackedResultsSQLBuilder().buildTrackedResultsSQL('$1', 1));
    expect(results).toBe(tracked);
    // the deployment floor is the COALESCE fallback on both counts, never a hardcoded 2
    expect(results.match(/END, 4\)\)/g)).toHaveLength(2);
    expect(results).not.toContain('END, 2))');
  });

  test('the fragment is re-read per build, so a changed env is not cached', () => {
    process.env.ADAPT_MIN_SAMPLE_COUNT = '2';
    expect(new AdaptSQLFragments().buildControlExistsColumn()).toContain('END, 2))');
    process.env.ADAPT_MIN_SAMPLE_COUNT = '7';
    expect(new AdaptSQLFragments().buildControlExistsColumn()).toContain('END, 7))');
  });
});

describe('createDsCompareConfigRecordPanelLevel', () => {
  const testRun = { system_under_test_id: 'sut', test_environment: 'acc', workload: 'load' } as any;
  const dashboard = { dashboardId: 'dash' } as any;
  const panel = { panelId: 301 } as any;

  test('writes minSampleCount only when given', () => {
    const withFloor = createDsCompareConfigRecordPanelLevel(testRun, dashboard, panel, 'mean', undefined, 1);
    expect(withFloor.config_data.thresholds).toMatchObject({ minSampleCount: 1 });
    const without = createDsCompareConfigRecordPanelLevel(testRun, dashboard, panel, 'mean');
    expect(without.config_data.thresholds).not.toHaveProperty('minSampleCount');
  });

  test('a floor of 0 is written as 0, not dropped as falsy', () => {
    // The guard is `!== undefined` on purpose: 0 is written verbatim, not dropped as falsy.
    // (The SQL then clamps it to 1 with GREATEST, so 0 and 1 behave alike; the point here
    // is that the record builder does not silently lose a configured value.)
    const zero = createDsCompareConfigRecordPanelLevel(testRun, dashboard, panel, 'mean', undefined, 0);
    expect(zero.config_data.thresholds).toMatchObject({ minSampleCount: 0 });
  });

  test('the floor is added beside the existing thresholds, not in place of them', () => {
    const withFloor = createDsCompareConfigRecordPanelLevel(testRun, dashboard, panel, 'p95', undefined, 1);
    const without = createDsCompareConfigRecordPanelLevel(testRun, dashboard, panel, 'p95');
    const { minSampleCount: _, ...rest } = withFloor.config_data.thresholds as Record<string, unknown>;
    expect(rest).toEqual(without.config_data.thresholds);
    expect(rest).toMatchObject({ aggregation: 'p95' });
  });

  test('the no-classification wrapper passes no floor, so those panels use the env default', () => {
    const record = createDsCompareConfigRecordPanelLevelNoClassification(testRun, dashboard, panel, 'mean');
    expect(record.config_data.thresholds).not.toHaveProperty('minSampleCount');
  });
});

/**
 * The four scenario-panel sites. Panels 301-303 hold ONE point per run by construction,
 * so without the opt-out the default floor of 2 would label them incomparable forever.
 */
describe('scenario-level compare configs opt out of the floor', () => {
  const makeDashboardManager = () =>
    ({
      getOrCreateScenarioDashboard: vi.fn(async (scenarioName: string) => ({
        dashboardId: `dash-${scenarioName}`,
        dashboardUid: `uid-${scenarioName}`,
        dashboardLabel: `Performance test metrics ${scenarioName}`,
      })),
      getMetricTypePanel: (panelId: number) => ({ panelId, panelName: METRIC_TYPE_PANEL_NAMES[panelId]! }),
    }) as unknown as DashboardManager;
  const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;
  const testRun = {
    system_under_test_id: 'sut-1',
    test_environment: 'acc',
    workload: 'load',
    start_time: new Date('2026-01-01T00:00:00Z'),
    end_time: new Date('2026-01-01T01:00:00Z'),
    ramp_up_time: 0,
    organization_id: 'org-1',
    completed: true,
  } as unknown as TestRunMetadata;

  const floors = (configs: Array<{ panel_id: number; config_data: { thresholds: Record<string, unknown> } }>) =>
    configs.map(c => [c.panel_id, c.config_data.thresholds.minSampleCount]);

  test('ErrorsProcessor, has-errors branch: every Error Count config carries minSampleCount 1', async () => {
    const dataSource = {
      query: vi.fn(async () => [
        { scenario_name: 'loadtest', error_count: '3' },
        { scenario_name: 'soak', error_count: '4' },
      ]),
    };
    const { compareConfigs } = await new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger())
      .process('run-1', testRun);

    expect(compareConfigs).toHaveLength(2);
    expect(floors(compareConfigs)).toEqual([
      [METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT, 1],
      [METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT, 1],
    ]);
  });

  test('ErrorsProcessor, zero-errors branch: the same opt-out on the scenario-lookup path', async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ scenario_name: 'loadtest' }]),
    };
    const { compareConfigs } = await new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger())
      .process('run-1', testRun);

    expect(floors(compareConfigs)).toEqual([[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT, 1]]);
  });

  test('VirtualUsersProcessor: both the Avg and Max Active Threads configs carry minSampleCount 1', async () => {
    const dataSource = {
      query: vi.fn(async () => [
        { scenario_name: 'loadtest', avg_active_threads: '10.5', max_active_threads: '20', active_thread_count: '100' },
      ]),
    };
    const { compareConfigs } = await new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger())
      .process('run-1', testRun);

    expect(floors(compareConfigs)).toEqual([
      [METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS, 1],
      [METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS, 1],
    ]);
  });

  test('the all-aggregated roll-up still gets no compare config at all (display-only)', async () => {
    const dataSource = {
      query: vi.fn(async () => [{ scenario_name: 'loadtest', error_count: '3' }]),
    };
    const { compareConfigs } = await new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger())
      .process('run-1', testRun);

    expect(compareConfigs.map(c => c.application_dashboard_id)).toEqual(['dash-loadtest']);
  });
});
