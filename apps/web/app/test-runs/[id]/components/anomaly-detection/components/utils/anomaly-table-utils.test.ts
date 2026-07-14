import { generateThresholdData } from './anomaly-table-utils';

// Builds a drawerData row like the one returned by GET /test-runs/:id/ds-adapt-result.
const makeDrawer = (opts: {
  test: number;
  higherIsBetter: boolean;
  lower: { pct: number; iqr: number; overall: number };
  upper: { pct: number; iqr: number; overall: number };
  checks: { pct: boolean; iqr: boolean; abs: boolean }; // isDifference per threshold
  valid?: { pct?: boolean; iqr?: boolean; abs?: boolean }; // defaults to true
  absoluteThreshold?: number | null;
}) => ({
  statistic: { test: opts.test, control: 24.18, diff: opts.test - 24.18 },
  checks: {
    pct: { isDifference: opts.checks.pct, valid: opts.valid?.pct ?? true },
    iqr: { isDifference: opts.checks.iqr, valid: opts.valid?.iqr ?? true },
    abs: { isDifference: opts.checks.abs, valid: opts.valid?.abs ?? true },
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

describe('generateThresholdData — three-state classification', () => {
  it('lower-is-better metric below the range is an improvement (▼ below)', () => {
    // Real case: T03_Search_Products.search_query_processing, test 6.36ms below both lower bounds.
    const rows = byName(generateThresholdData(makeDrawer({
      test: 6.36,
      higherIsBetter: false,
      lower: { pct: 20.55, iqr: 8.17, overall: 8.17 },
      upper: { pct: 27.81, iqr: 40.18, overall: 40.18 },
      checks: { pct: true, iqr: true, abs: false },
    }) as unknown, 'ms'));

    expect(rows['Percent'].result).toBe('improvement');
    expect(rows['Percent'].side).toBe('below');
    expect(rows['Interquartile Range Factor'].result).toBe('improvement');
    expect(rows['Interquartile Range Factor'].side).toBe('below');
    // Absolute threshold not configured -> skipped, unchanged.
    expect(rows['Absolute'].result).toBe('skipped');
  });

  it('lower-is-better metric above the range is a regression (▲ above)', () => {
    const rows = byName(generateThresholdData(makeDrawer({
      test: 73.5,
      higherIsBetter: false,
      lower: { pct: 20.55, iqr: 8.17, overall: 8.17 },
      upper: { pct: 27.81, iqr: 40.18, overall: 40.18 },
      checks: { pct: true, iqr: true, abs: false },
    }) as unknown, 'ms'));

    expect(rows['Percent'].result).toBe('regression');
    expect(rows['Percent'].side).toBe('above');
    expect(rows['Interquartile Range Factor'].result).toBe('regression');
    expect(rows['Interquartile Range Factor'].side).toBe('above');
  });

  it('higher-is-better metric above the range is an improvement (▲ above)', () => {
    const rows = byName(generateThresholdData(makeDrawer({
      test: 100,
      higherIsBetter: true,
      lower: { pct: 20.55, iqr: 8.17, overall: 8.17 },
      upper: { pct: 27.81, iqr: 40.18, overall: 40.18 },
      checks: { pct: true, iqr: true, abs: false },
    }) as unknown, 'ms'));

    expect(rows['Percent'].result).toBe('improvement');
    expect(rows['Percent'].side).toBe('above');
  });

  it('zero-variance baseline (IQR band collapsed to a point) is invalid (N/A), not in-range or a breach', () => {
    // Reported case: IQR range 4.32% to 4.32%, test 6.06%. control_iqr=0 → checks.iqr.valid=false
    // and isDifference is forced false (#417 guard). The row can't be judged → N/A with a reason.
    const rows = byName(generateThresholdData(makeDrawer({
      test: 6.06,
      higherIsBetter: false,
      lower: { pct: 4.32, iqr: 4.32, overall: 4.32 },
      upper: { pct: 4.32, iqr: 4.32, overall: 4.32 },
      checks: { pct: false, iqr: false, abs: false },
      valid: { iqr: false },
    }) as unknown, '%'));

    expect(rows['Interquartile Range Factor'].result).toBe('invalid');
    expect(rows['Interquartile Range Factor'].reason).toMatch(/variance/i);
    expect(rows['Interquartile Range Factor'].side).toBeUndefined();
  });

  it('within range is neutral (inRange), no side', () => {
    const rows = byName(generateThresholdData(makeDrawer({
      test: 24,
      higherIsBetter: false,
      lower: { pct: 20.55, iqr: 8.17, overall: 8.17 },
      upper: { pct: 27.81, iqr: 40.18, overall: 40.18 },
      checks: { pct: false, iqr: false, abs: false },
    }) as unknown, 'ms'));

    expect(rows['Percent'].result).toBe('inRange');
    expect(rows['Percent'].side).toBeUndefined();
    expect(rows['Interquartile Range Factor'].result).toBe('inRange');
  });
});
