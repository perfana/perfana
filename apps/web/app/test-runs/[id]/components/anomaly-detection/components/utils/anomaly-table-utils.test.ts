import { generateThresholdData } from './anomaly-table-utils';

// Builds a drawerData row like the one returned by GET /test-runs/:id/ds-adapt-result.
const makeDrawer = (opts: {
  test: number;
  higherIsBetter: boolean;
  lower: { pct: number; iqr: number; overall: number };
  upper: { pct: number; iqr: number; overall: number };
  checks: { pct: boolean; iqr: boolean; abs: boolean }; // isDifference per threshold
  absoluteThreshold?: number | null;
}) => ({
  statistic: { test: opts.test, control: 24.18, diff: opts.test - 24.18 },
  checks: {
    pct: { isDifference: opts.checks.pct },
    iqr: { isDifference: opts.checks.iqr },
    abs: { isDifference: opts.checks.abs },
  },
  thresholds: { lower: opts.lower, upper: opts.upper },
  compare_config: {
    source: 'default',
    thresholds: { percentageThreshold: 0.15, iqrThreshold: 2, absoluteThreshold: opts.absoluteThreshold ?? null },
    metricClassification: { higherIsBetter: opts.higherIsBetter },
  },
});

const byName = (rows: ReturnType<typeof generateThresholdData>) =>
  Object.fromEntries(rows.map(r => [r.threshold, r]));

describe('generateThresholdData — favorable-breach classification', () => {
  it('lower-is-better metric that dropped below the range is an improvement (down arrow), not a failure', () => {
    // Real case: T03_Search_Products.search_query_processing, test 6.36ms below both lower bounds.
    const rows = byName(generateThresholdData(makeDrawer({
      test: 6.36,
      higherIsBetter: false,
      lower: { pct: 20.55, iqr: 8.17, overall: 8.17 },
      upper: { pct: 27.81, iqr: 40.18, overall: 40.18 },
      checks: { pct: true, iqr: true, abs: false },
    }) as unknown, 'ms'));

    expect(rows['Percent'].result).toBe('improved');
    expect(rows['Percent'].direction).toBe('down');
    expect(rows['Interquartile Range Factor'].result).toBe('improved');
    expect(rows['Interquartile Range Factor'].direction).toBe('down');
    // Absolute threshold not configured -> skipped (amber warning), unchanged.
    expect(rows['Absolute'].result).toBe('skipped');
  });

  it('lower-is-better metric that rose above the range is a regression (failed)', () => {
    const rows = byName(generateThresholdData(makeDrawer({
      test: 73.5,
      higherIsBetter: false,
      lower: { pct: 20.55, iqr: 8.17, overall: 8.17 },
      upper: { pct: 27.81, iqr: 40.18, overall: 40.18 },
      checks: { pct: true, iqr: true, abs: false },
    }) as unknown, 'ms'));

    expect(rows['Percent'].result).toBe('failed');
    expect(rows['Interquartile Range Factor'].result).toBe('failed');
  });

  it('higher-is-better metric that rose above the range is an improvement (up arrow)', () => {
    const rows = byName(generateThresholdData(makeDrawer({
      test: 100,
      higherIsBetter: true,
      lower: { pct: 20.55, iqr: 8.17, overall: 8.17 },
      upper: { pct: 27.81, iqr: 40.18, overall: 40.18 },
      checks: { pct: true, iqr: true, abs: false },
    }) as unknown, 'ms'));

    expect(rows['Percent'].result).toBe('improved');
    expect(rows['Percent'].direction).toBe('up');
  });

  it('within range stays passed', () => {
    const rows = byName(generateThresholdData(makeDrawer({
      test: 24,
      higherIsBetter: false,
      lower: { pct: 20.55, iqr: 8.17, overall: 8.17 },
      upper: { pct: 27.81, iqr: 40.18, overall: 40.18 },
      checks: { pct: false, iqr: false, abs: false },
    }) as unknown, 'ms'));

    expect(rows['Percent'].result).toBe('passed');
    expect(rows['Interquartile Range Factor'].result).toBe('passed');
  });
});
