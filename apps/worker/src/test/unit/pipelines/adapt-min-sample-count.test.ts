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
import { afterEach, describe, expect, test } from 'vitest';
import {
  AdaptSQLFragments,
  adaptMinSampleCount,
} from '../../../pipelines/helpers/adapt/results/sql-fragments.js';
import { AdaptResultsSQLBuilder } from '../../../pipelines/helpers/adapt/results/sql-builder.js';
import { TrackedResultsSQLBuilder } from '../../../pipelines/helpers/adapt/results/tracked-results-sql-builder.js';
import { createDsCompareConfigRecordPanelLevel } from '../../../pipelines/helpers/metrics-builder.js';

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
    expect(col).toContain("wcc.test_n >= COALESCE((wcc.compare_config->'thresholds'->>'minSampleCount')::int, 3)");
    expect(col).toContain("COALESCE(wcc.control_n, 0) >= COALESCE((wcc.compare_config->'thresholds'->>'minSampleCount')::int, 3)");
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
    expect(sql).toContain("->>'minSampleCount')::int");
    // every downstream check still keys on it
    expect((sql.match(/w(ds|tc)\.control_exists/g) ?? []).length).toBeGreaterThanOrEqual(7);
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
});
