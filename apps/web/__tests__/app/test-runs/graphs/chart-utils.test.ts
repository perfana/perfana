/**
 * Unit tests for chart-utils.ts
 *
 * Tests all exported utility functions for chart data transformation,
 * axis assignment, unit conversion, time formatting, and layout building.
 */

import {
  CHART_COLOR_PALETTE,
  getChartSeriesColor,
  assignSeriesToAxes,
  getUnitConversion,
  formatTimeLabel,
  buildTimestampMapping,
  calculateXAxisTicks,
  calculateRampUpEndIndex,
  buildTrace,
  buildChartLayout,
  buildChartConfig,
} from '@/app/test-runs/[id]/components/graphs/utils/chart-utils';
import { SeriesConfig, MetricDataPoint } from '@/app/test-runs/[id]/components/graphs/types';
import { UnitConversion, ChartThemeColors } from '@/app/test-runs/[id]/components/graphs/types/chart.types';
import { TestRun } from '@/types/test-runs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSeriesConfig(overrides: Partial<SeriesConfig> = {}): SeriesConfig {
  return {
    id: 'series-1',
    dashboardId: 'dash-1',
    dashboardLabel: 'Dashboard 1',
    panelId: 1,
    panelTitle: 'Panel 1',
    metricName: 'metric.name',
    source: 'grafana',
    yAxisFormat: 'ms',
    ...overrides,
  };
}

function makeDataPoint(time: string, value: number): MetricDataPoint {
  return { time, metric_name: 'metric', value, timestep: 0 };
}

function makeTestRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'test-run-uuid',
    test_run_id: 'run-1',
    system_name: 'sys',
    test_environment: 'env',
    workload: 'wl',
    completed: false,
    start_time: null,
    end_time: null,
    duration: null,
    planned_duration: null,
    analysis_start_offset: undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as TestRun;
}

function makeThemeColors(): ChartThemeColors {
  return {
    textColor: '#000000',
    textSecondary: '#666666',
    bgColor: '#ffffff',
    plotBgColor: '#f5f5f5',
    gridColor: '#e0e0e0',
    dividerColor: '#cccccc',
    fontFamily: 'Roboto, sans-serif',
    hoverBgColor: '#ffffff',
  };
}

// ISO timestamps spaced 10 seconds apart
const T0 = '2024-01-01T00:00:00.000Z';
const T1 = '2024-01-01T00:00:10.000Z';
const T2 = '2024-01-01T00:00:20.000Z';
const T3 = '2024-01-01T00:00:30.000Z';
const T4 = '2024-01-01T00:00:40.000Z';

// ---------------------------------------------------------------------------
// getChartSeriesColor
// ---------------------------------------------------------------------------

describe('getChartSeriesColor', () => {
  it('returns the first palette color for index 0', () => {
    expect(getChartSeriesColor(0)).toBe(CHART_COLOR_PALETTE[0]);
  });

  it('returns the correct color for each index within palette length', () => {
    CHART_COLOR_PALETTE.forEach((color, idx) => {
      expect(getChartSeriesColor(idx)).toBe(color);
    });
  });

  it('wraps around for indices exceeding palette length', () => {
    const paletteLen = CHART_COLOR_PALETTE.length;
    expect(getChartSeriesColor(paletteLen)).toBe(CHART_COLOR_PALETTE[0]);
    expect(getChartSeriesColor(paletteLen + 1)).toBe(CHART_COLOR_PALETTE[1]);
    expect(getChartSeriesColor(paletteLen * 2)).toBe(CHART_COLOR_PALETTE[0]);
  });

  it('handles large index values via modulo', () => {
    const result = getChartSeriesColor(1000);
    expect(CHART_COLOR_PALETTE).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// CHART_COLOR_PALETTE
// ---------------------------------------------------------------------------

describe('CHART_COLOR_PALETTE', () => {
  it('contains 8 colors', () => {
    expect(CHART_COLOR_PALETTE).toHaveLength(8);
  });

  it('all entries are valid hex color strings', () => {
    CHART_COLOR_PALETTE.forEach(color => {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
});

// ---------------------------------------------------------------------------
// assignSeriesToAxes
// ---------------------------------------------------------------------------

describe('assignSeriesToAxes', () => {
  describe('empty input', () => {
    it('returns empty arrays when no series are provided', () => {
      const result = assignSeriesToAxes([], new Map());
      expect(result.leftAxisSeries).toEqual([]);
      expect(result.rightAxisSeries).toEqual([]);
    });
  });

  describe('single unit — all series on left axis', () => {
    it('places all series on the left axis when they share the same unit', () => {
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: 'ms' });
      const s2 = makeSeriesConfig({ id: 's2', yAxisFormat: 'ms' });
      const data = new Map([
        ['s1', [makeDataPoint(T0, 100), makeDataPoint(T1, 200)]],
        ['s2', [makeDataPoint(T0, 150), makeDataPoint(T1, 180)]],
      ]);

      const result = assignSeriesToAxes([s1, s2], data);

      expect(result.leftAxisSeries).toHaveLength(2);
      expect(result.rightAxisSeries).toHaveLength(0);
    });

    it('handles series with no data — falls back to left axis', () => {
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: 'ms' });
      const result = assignSeriesToAxes([s1], new Map());

      expect(result.leftAxisSeries).toHaveLength(1);
      expect(result.rightAxisSeries).toHaveLength(0);
    });
  });

  describe('single unit — magnitude split', () => {
    it('splits series across axes when max/min ratio exceeds 100', () => {
      // s1 has small values (~1), s2 has large values (~200)
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: 'ms' });
      const s2 = makeSeriesConfig({ id: 's2', yAxisFormat: 'ms' });
      const data = new Map([
        ['s1', [makeDataPoint(T0, 1), makeDataPoint(T1, 2)]],
        ['s2', [makeDataPoint(T0, 200), makeDataPoint(T1, 210)]],
      ]);

      const result = assignSeriesToAxes([s1, s2], data);

      // Total range: 1 to 210 → ratio 210 > 100 → magnitude split
      expect(result.leftAxisSeries.length + result.rightAxisSeries.length).toBe(2);
    });

    it('does not split when max/min ratio is exactly 100', () => {
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: 'ms' });
      const data = new Map([
        ['s1', [makeDataPoint(T0, 1), makeDataPoint(T1, 100)]],
      ]);

      const result = assignSeriesToAxes([s1], data);

      // Ratio = 100 which is NOT > 100, so no split
      expect(result.leftAxisSeries).toHaveLength(1);
      expect(result.rightAxisSeries).toHaveLength(0);
    });

    it('does not split when globalMin is 0 (would cause division-by-zero-like condition)', () => {
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: 'ms' });
      const data = new Map([
        ['s1', [makeDataPoint(T0, 0), makeDataPoint(T1, 10000)]],
      ]);

      const result = assignSeriesToAxes([s1], data);

      // globalMin is 0, condition requires globalMin > 0 — no split
      expect(result.leftAxisSeries).toHaveLength(1);
      expect(result.rightAxisSeries).toHaveLength(0);
    });
  });

  describe('multiple units', () => {
    it('puts first unit on left axis and additional units on right axis', () => {
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: 'ms' });
      const s2 = makeSeriesConfig({ id: 's2', yAxisFormat: 'bytes' });
      const data = new Map([
        ['s1', [makeDataPoint(T0, 100)]],
        ['s2', [makeDataPoint(T0, 1024)]],
      ]);

      const result = assignSeriesToAxes([s1, s2], data);

      expect(result.leftAxisSeries).toHaveLength(1);
      expect(result.leftAxisSeries[0].id).toBe('s1');
      expect(result.rightAxisSeries).toHaveLength(1);
      expect(result.rightAxisSeries[0].id).toBe('s2');
    });

    it('groups multiple series with the same secondary unit on right axis', () => {
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: 'ms' });
      const s2 = makeSeriesConfig({ id: 's2', yAxisFormat: 'bytes' });
      const s3 = makeSeriesConfig({ id: 's3', yAxisFormat: 'bytes' });
      const data = new Map([
        ['s1', [makeDataPoint(T0, 100)]],
        ['s2', [makeDataPoint(T0, 1024)]],
        ['s3', [makeDataPoint(T0, 2048)]],
      ]);

      const result = assignSeriesToAxes([s1, s2, s3], data);

      expect(result.leftAxisSeries).toHaveLength(1);
      expect(result.rightAxisSeries).toHaveLength(2);
    });

    it('handles three different units — second and third unit go to right axis', () => {
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: 'ms' });
      const s2 = makeSeriesConfig({ id: 's2', yAxisFormat: 's' });
      const s3 = makeSeriesConfig({ id: 's3', yAxisFormat: 'bytes' });
      const data = new Map();

      const result = assignSeriesToAxes([s1, s2, s3], data);

      expect(result.leftAxisSeries).toHaveLength(1);
      expect(result.rightAxisSeries).toHaveLength(2);
    });

    it('treats missing yAxisFormat as "default" unit group', () => {
      const s1 = makeSeriesConfig({ id: 's1', yAxisFormat: undefined });
      const s2 = makeSeriesConfig({ id: 's2', yAxisFormat: undefined });
      const data = new Map();

      const result = assignSeriesToAxes([s1, s2], data);

      expect(result.leftAxisSeries).toHaveLength(2);
      expect(result.rightAxisSeries).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// getUnitConversion
// ---------------------------------------------------------------------------

describe('getUnitConversion', () => {
  describe('undefined / short / none format', () => {
    it('returns factor 1 and "Value" label for typical values', () => {
      const data = [makeDataPoint(T0, 500)];
      const result = getUnitConversion(undefined, data);
      expect(result.factor).toBe(1);
      expect(result.label).toBe('Value');
    });

    it('returns "Value (decimal)" label when max < 1', () => {
      const data = [makeDataPoint(T0, 0.5)];
      const result = getUnitConversion('short', data);
      expect(result.label).toBe('Value (decimal)');
      expect(result.factor).toBe(1);
    });

    it('returns "Value (thousands)" when max > 1000 and <= 1000000', () => {
      const data = [makeDataPoint(T0, 5000)];
      const result = getUnitConversion('none', data);
      expect(result.label).toBe('Value (thousands)');
      expect(result.factor).toBeCloseTo(1 / 1000);
    });

    it('returns "Value (millions)" when max > 1000000', () => {
      const data = [makeDataPoint(T0, 2000000)];
      const result = getUnitConversion(undefined, data);
      expect(result.label).toBe('Value (millions)');
      expect(result.factor).toBeCloseTo(1 / 1000000);
    });
  });

  describe('percentunit format', () => {
    it('multiplies by 100 and labels as Percentage (%)', () => {
      const data = [makeDataPoint(T0, 0.75)];
      const result = getUnitConversion('percentunit', data);
      expect(result.factor).toBe(100);
      expect(result.label).toBe('Percentage (%)');
    });
  });

  describe('seconds format', () => {
    it('converts to ms when all values < 1', () => {
      const data = [makeDataPoint(T0, 0.3), makeDataPoint(T1, 0.7)];
      const result = getUnitConversion('s', data);
      expect(result.factor).toBe(1000);
      expect(result.label).toBe('Time (ms)');
    });

    it('keeps seconds when max >= 1', () => {
      const data = [makeDataPoint(T0, 5), makeDataPoint(T1, 10)];
      const result = getUnitConversion('s', data);
      expect(result.factor).toBe(1);
      expect(result.label).toBe('Time (s)');
    });
  });

  describe('milliseconds format', () => {
    it('converts to seconds when all values > 1000', () => {
      const data = [makeDataPoint(T0, 2000), makeDataPoint(T1, 3000)];
      const result = getUnitConversion('ms', data);
      expect(result.factor).toBeCloseTo(1 / 1000);
      expect(result.label).toBe('Time (s)');
    });

    it('keeps milliseconds when min is not above 1000', () => {
      const data = [makeDataPoint(T0, 500), makeDataPoint(T1, 1500)];
      const result = getUnitConversion('ms', data);
      expect(result.factor).toBe(1);
      expect(result.label).toBe('Time (ms)');
    });

    it('keeps milliseconds for a single value of exactly 1000', () => {
      // globalMin = 1000, condition is > 1000 which is false
      const data = [makeDataPoint(T0, 1000)];
      const result = getUnitConversion('ms', data);
      expect(result.factor).toBe(1);
      expect(result.label).toBe('Time (ms)');
    });
  });

  describe('bytes format', () => {
    it('converts to bytes with no conversion when max <= 1024', () => {
      const data = [makeDataPoint(T0, 512)];
      const result = getUnitConversion('bytes', data);
      expect(result.factor).toBe(1);
      expect(result.label).toBe('Size (bytes)');
    });

    it('converts to KB when max > 1024 and <= 1048576', () => {
      const data = [makeDataPoint(T0, 2048)];
      const result = getUnitConversion('bytes', data);
      expect(result.factor).toBeCloseTo(1 / 1024);
      expect(result.label).toBe('Size (KB)');
    });

    it('converts to MB when max > 1048576 and <= 1073741824', () => {
      const data = [makeDataPoint(T0, 2 * 1048576)];
      const result = getUnitConversion('bytes', data);
      expect(result.factor).toBeCloseTo(1 / 1048576);
      expect(result.label).toBe('Size (MB)');
    });

    it('converts to GB when max > 1073741824', () => {
      const data = [makeDataPoint(T0, 2 * 1073741824)];
      const result = getUnitConversion('bytes', data);
      expect(result.factor).toBeCloseTo(1 / 1073741824);
      expect(result.label).toBe('Size (GB)');
    });
  });

  describe('reqps / rps format', () => {
    it('returns Requests/sec label for reqps', () => {
      const data = [makeDataPoint(T0, 100)];
      expect(getUnitConversion('reqps', data).label).toBe('Requests/sec');
    });

    it('returns Requests/sec label for rps', () => {
      const data = [makeDataPoint(T0, 100)];
      expect(getUnitConversion('rps', data).label).toBe('Requests/sec');
    });

    it('uses factor of 1 for reqps', () => {
      const data = [makeDataPoint(T0, 100)];
      expect(getUnitConversion('reqps', data).factor).toBe(1);
    });
  });

  describe('ops / iops format', () => {
    it('returns Operations/sec for ops', () => {
      const data = [makeDataPoint(T0, 50)];
      expect(getUnitConversion('ops', data).label).toBe('Operations/sec');
    });

    it('returns Operations/sec for iops', () => {
      const data = [makeDataPoint(T0, 50)];
      expect(getUnitConversion('iops', data).label).toBe('Operations/sec');
    });
  });

  describe('unknown / passthrough format', () => {
    it('returns the raw format string as label and factor 1', () => {
      const data = [makeDataPoint(T0, 100)];
      const result = getUnitConversion('custom-unit', data);
      expect(result.factor).toBe(1);
      expect(result.label).toBe('custom-unit');
    });
  });

  describe('empty data', () => {
    it('handles empty data array without throwing', () => {
      expect(() => getUnitConversion('ms', [])).not.toThrow();
    });

    it('returns a conversion result without throwing for empty data and ms format', () => {
      // globalMin = Infinity (> 1000 is true), so ms-to-seconds conversion fires
      const result = getUnitConversion('ms', []);
      expect(result).toHaveProperty('factor');
      expect(result).toHaveProperty('label');
      expect(typeof result.factor).toBe('number');
      expect(typeof result.label).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// formatTimeLabel
// ---------------------------------------------------------------------------

describe('formatTimeLabel', () => {
  it('returns a formatted time string', () => {
    // The exact output depends on the test environment locale, but it must
    // contain digits separated by colons in HH:MM:SS form.
    const result = formatTimeLabel(T0);
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it('returns a non-empty string for a valid ISO timestamp', () => {
    expect(formatTimeLabel(T1).length).toBeGreaterThan(0);
  });

  it('handles different timestamps producing different labels', () => {
    const r0 = formatTimeLabel(T0);
    const r1 = formatTimeLabel(T1); // 10 seconds later
    expect(r0).not.toBe(r1);
  });
});

// ---------------------------------------------------------------------------
// buildTimestampMapping
// ---------------------------------------------------------------------------

describe('buildTimestampMapping', () => {
  it('returns empty arrays when no series data exists', () => {
    const result = buildTimestampMapping([], new Map());
    expect(result.sortedTimestamps).toEqual([]);
    expect(result.timestampToIndex.size).toBe(0);
  });

  it('collects and sorts timestamps across all series', () => {
    const s1 = makeSeriesConfig({ id: 's1' });
    const s2 = makeSeriesConfig({ id: 's2' });
    const data = new Map([
      ['s1', [makeDataPoint(T2, 1), makeDataPoint(T0, 2)]],
      ['s2', [makeDataPoint(T1, 3)]],
    ]);

    const { sortedTimestamps, timestampToIndex } = buildTimestampMapping([s1, s2], data);

    expect(sortedTimestamps).toEqual([T0, T1, T2]);
    expect(timestampToIndex.get(T0)).toBe(0);
    expect(timestampToIndex.get(T1)).toBe(1);
    expect(timestampToIndex.get(T2)).toBe(2);
  });

  it('deduplicates timestamps shared across multiple series', () => {
    const s1 = makeSeriesConfig({ id: 's1' });
    const s2 = makeSeriesConfig({ id: 's2' });
    const data = new Map([
      ['s1', [makeDataPoint(T0, 10)]],
      ['s2', [makeDataPoint(T0, 20)]],
    ]);

    const { sortedTimestamps } = buildTimestampMapping([s1, s2], data);

    expect(sortedTimestamps).toHaveLength(1);
    expect(sortedTimestamps[0]).toBe(T0);
  });

  it('handles a series with no data in the map', () => {
    const s1 = makeSeriesConfig({ id: 's1' });
    const result = buildTimestampMapping([s1], new Map());

    expect(result.sortedTimestamps).toHaveLength(0);
  });

  it('handles a series whose data array is empty', () => {
    const s1 = makeSeriesConfig({ id: 's1' });
    const data = new Map([['s1', []]]);

    const { sortedTimestamps } = buildTimestampMapping([s1], data);
    expect(sortedTimestamps).toHaveLength(0);
  });

  it('produces sequential indices starting from 0', () => {
    const s1 = makeSeriesConfig({ id: 's1' });
    const data = new Map([
      ['s1', [makeDataPoint(T0, 1), makeDataPoint(T1, 2), makeDataPoint(T2, 3)]],
    ]);

    const { timestampToIndex } = buildTimestampMapping([s1], data);

    expect(timestampToIndex.get(T0)).toBe(0);
    expect(timestampToIndex.get(T1)).toBe(1);
    expect(timestampToIndex.get(T2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// calculateXAxisTicks
// ---------------------------------------------------------------------------

describe('calculateXAxisTicks', () => {
  it('returns empty arrays for empty timestamp list', () => {
    const { tickValues, tickLabels } = calculateXAxisTicks([]);
    expect(tickValues).toEqual([]);
    expect(tickLabels).toEqual([]);
  });

  it('returns a single tick for a single timestamp', () => {
    const { tickValues, tickLabels } = calculateXAxisTicks([T0]);
    expect(tickValues).toHaveLength(1);
    expect(tickValues[0]).toBe(0);
    expect(tickLabels).toHaveLength(1);
  });

  it('tick count does not exceed targetTicks + 1 (for the last index)', () => {
    const timestamps = [T0, T1, T2, T3, T4];
    const { tickValues } = calculateXAxisTicks(timestamps, 2);
    // At most 3 ticks (every 2 or 3 points + last)
    expect(tickValues.length).toBeLessThanOrEqual(4);
  });

  it('always includes the last timestamp index', () => {
    const timestamps = [T0, T1, T2, T3, T4];
    const { tickValues } = calculateXAxisTicks(timestamps, 10);
    const lastIndex = timestamps.length - 1;
    expect(tickValues).toContain(lastIndex);
  });

  it('does not duplicate the last index when it is already included', () => {
    // With targetTicks >= totalDataPoints, every point is a tick,
    // including the last one — ensure no duplication.
    const timestamps = [T0, T1, T2];
    const { tickValues } = calculateXAxisTicks(timestamps, 10);
    const lastIndex = timestamps.length - 1;
    const lastOccurrences = tickValues.filter(v => v === lastIndex);
    expect(lastOccurrences).toHaveLength(1);
  });

  it('tick labels correspond to the timestamps at tick indices', () => {
    const timestamps = [T0, T1, T2, T3, T4];
    const { tickValues, tickLabels } = calculateXAxisTicks(timestamps, 10);

    tickValues.forEach((idx, i) => {
      expect(tickLabels[i]).toBe(formatTimeLabel(timestamps[idx]));
    });
  });

  it('uses default targetTicks of 10', () => {
    // 5 timestamps with default 10 ticks — every point becomes a tick
    const timestamps = [T0, T1, T2, T3, T4];
    const { tickValues } = calculateXAxisTicks(timestamps);
    expect(tickValues).toContain(0);
    expect(tickValues).toContain(4);
  });
});

// ---------------------------------------------------------------------------
// calculateRampUpEndIndex
// ---------------------------------------------------------------------------

describe('calculateRampUpEndIndex', () => {
  it('returns 0 when testRun is null', () => {
    expect(calculateRampUpEndIndex(null, [T0, T1])).toBe(0);
  });

  it('returns 0 when testRun has no analysis_start_offset', () => {
    const run = makeTestRun({ analysis_start_offset: undefined });
    expect(calculateRampUpEndIndex(run, [T0, T1])).toBe(0);
  });

  it('returns 0 when timestamps array is empty', () => {
    const run = makeTestRun({ analysis_start_offset: 30 });
    expect(calculateRampUpEndIndex(run, [])).toBe(0);
  });

  it('returns correct index when ramp-up ends within the data range', () => {
    // Timestamps are 10 seconds apart; analysis_start_offset = 15s → ends between T1 and T2
    const run = makeTestRun({ analysis_start_offset: 15 });
    const timestamps = [T0, T1, T2, T3, T4];
    const result = calculateRampUpEndIndex(run, timestamps);
    // T2 (20s mark) is the first timestamp >= 15s after T0
    expect(result).toBe(2);
  });

  it('returns last index when ramp-up duration extends beyond all data', () => {
    const run = makeTestRun({ analysis_start_offset: 9999 });
    const timestamps = [T0, T1, T2];
    const result = calculateRampUpEndIndex(run, timestamps);
    // findIndex returns -1, so we get length - 1
    expect(result).toBe(timestamps.length - 1);
  });

  it('returns 0 when analysis_start_offset is 0', () => {
    const run = makeTestRun({ analysis_start_offset: 0 });
    // analysis_start_offset is falsy (0) — guard at top returns 0
    expect(calculateRampUpEndIndex(run, [T0, T1])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildTrace
// ---------------------------------------------------------------------------

describe('buildTrace', () => {
  const conversion: UnitConversion = { factor: 1, label: 'ms' };
  const timestampToIndex = new Map([[T0, 0], [T1, 1], [T2, 2]]);
  const baseColor = '#2E86AB';
  const bgColor = '#ffffff';

  it('returns a scatter trace with correct type and mode', () => {
    const series = makeSeriesConfig({ id: 's1', panelTitle: 'P1', metricName: 'cpu' });
    const data = [makeDataPoint(T0, 100), makeDataPoint(T1, 200)];

    const trace = buildTrace(series, data, false, conversion, baseColor, bgColor, timestampToIndex);

    expect(trace.type).toBe('scatter');
    expect(trace.mode).toBe('lines+markers'); // < 50 data points
  });

  it('uses "lines" mode when data has 50 or more points', () => {
    const series = makeSeriesConfig();
    const data = Array.from({ length: 50 }, (_, i) =>
      makeDataPoint(new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(), i)
    );
    const tsIndex = new Map(data.map((d, i) => [d.time, i]));

    const trace = buildTrace(series, data, false, conversion, baseColor, bgColor, tsIndex);

    expect(trace.mode).toBe('lines');
  });

  it('applies unit conversion factor to y values', () => {
    const factor2: UnitConversion = { factor: 2, label: 'x2' };
    const series = makeSeriesConfig();
    const data = [makeDataPoint(T0, 50)];

    const trace = buildTrace(series, data, false, factor2, baseColor, bgColor, timestampToIndex);

    expect(trace.y[0]).toBe(100); // 50 * 2
  });

  it('sets yaxis to "y2" for right-axis series', () => {
    const series = makeSeriesConfig();
    const data = [makeDataPoint(T0, 10)];
    const trace = buildTrace(series, data, true, conversion, baseColor, bgColor, timestampToIndex);
    expect(trace.yaxis).toBe('y2');
  });

  it('sets yaxis to "y" for left-axis series', () => {
    const series = makeSeriesConfig();
    const data = [makeDataPoint(T0, 10)];
    const trace = buildTrace(series, data, false, conversion, baseColor, bgColor, timestampToIndex);
    expect(trace.yaxis).toBe('y');
  });

  it('builds trace name from panelTitle and metricName', () => {
    const series = makeSeriesConfig({ panelTitle: 'Panel A', metricName: 'my.metric' });
    const data = [makeDataPoint(T0, 1)];
    const trace = buildTrace(series, data, false, conversion, baseColor, bgColor, timestampToIndex);
    expect(trace.name).toBe('Panel A - my.metric');
  });

  it('sorts data by time before building x/y arrays', () => {
    const series = makeSeriesConfig();
    // Provide data out-of-order
    const data = [makeDataPoint(T2, 300), makeDataPoint(T0, 100), makeDataPoint(T1, 200)];
    const trace = buildTrace(series, data, false, conversion, baseColor, bgColor, timestampToIndex);

    expect(trace.x).toEqual([0, 1, 2]);
    expect(trace.y).toEqual([100, 200, 300]);
  });

  it('uses the provided line color', () => {
    const series = makeSeriesConfig();
    const data = [makeDataPoint(T0, 1)];
    const trace = buildTrace(series, data, false, conversion, '#FF0000', bgColor, timestampToIndex);
    expect(trace.line.color).toBe('#FF0000');
    expect(trace.marker.color).toBe('#FF0000');
  });

  it('sets marker line color to bgColor', () => {
    const series = makeSeriesConfig();
    const data = [makeDataPoint(T0, 1)];
    const trace = buildTrace(series, data, false, conversion, baseColor, '#123456', timestampToIndex);
    expect(trace.marker.line.color).toBe('#123456');
  });

  it('includes hovertemplate with series info', () => {
    const series = makeSeriesConfig({ panelTitle: 'My Panel', metricName: 'req.rate' });
    const data = [makeDataPoint(T0, 1)];
    const trace = buildTrace(series, data, false, conversion, baseColor, bgColor, timestampToIndex);
    expect(trace.hovertemplate).toContain('My Panel');
    expect(trace.hovertemplate).toContain('req.rate');
  });

  it('sets connectgaps to true', () => {
    const series = makeSeriesConfig();
    const data = [makeDataPoint(T0, 1)];
    const trace = buildTrace(series, data, false, conversion, baseColor, bgColor, timestampToIndex);
    expect(trace.connectgaps).toBe(true);
  });

  it('handles empty data array', () => {
    const series = makeSeriesConfig();
    const trace = buildTrace(series, [], false, conversion, baseColor, bgColor, timestampToIndex);
    expect(trace.x).toEqual([]);
    expect(trace.y).toEqual([]);
    expect(trace.text).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildChartLayout
// ---------------------------------------------------------------------------

describe('buildChartLayout', () => {
  const themeColors = makeThemeColors();
  const leftConversion: UnitConversion = { factor: 1, label: 'Time (ms)' };

  it('returns an object with required layout keys', () => {
    const layout = buildChartLayout(
      themeColors, 'Test Chart', leftConversion, null,
      [0, 5], ['00:00:00', '00:00:05'], 10, 0, false, 800
    );

    expect(layout).toHaveProperty('xaxis');
    expect(layout).toHaveProperty('yaxis');
    expect(layout).toHaveProperty('title');
    expect(layout).toHaveProperty('legend');
    expect(layout).toHaveProperty('hovermode', 'x unified');
  });

  it('uses chartName in the title', () => {
    const layout = buildChartLayout(
      themeColors, 'My Chart Title', leftConversion, null,
      [], [], 0, 0, false, 800
    );
    const title = layout.title as { text: string };
    expect(title.text).toBe('My Chart Title');
  });

  it('falls back to "Custom Metrics Chart" when chartName is undefined', () => {
    const layout = buildChartLayout(
      themeColors, undefined, leftConversion, null,
      [], [], 0, 0, false, 800
    );
    const title = layout.title as { text: string };
    expect(title.text).toBe('Custom Metrics Chart');
  });

  it('uses leftConversion.label as the yaxis title', () => {
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      [], [], 5, 0, false, 800
    );
    const yaxis = layout.yaxis as { title: { text: string } };
    expect(yaxis.title.text).toBe('Time (ms)');
  });

  it('adds yaxis2 when rightConversion is provided', () => {
    const rightConversion: UnitConversion = { factor: 1, label: 'Size (MB)' };
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, rightConversion,
      [], [], 5, 0, false, 800
    );
    expect(layout).toHaveProperty('yaxis2');
    const yaxis2 = layout.yaxis2 as { title: { text: string } };
    expect(yaxis2.title.text).toBe('Size (MB)');
  });

  it('does not add yaxis2 when rightConversion is null', () => {
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      [], [], 5, 0, false, 800
    );
    expect(layout).not.toHaveProperty('yaxis2');
  });

  it('uses larger right margin when right axis is present', () => {
    const rightConversion: UnitConversion = { factor: 1, label: 'MB' };
    const withRight = buildChartLayout(
      themeColors, 'Chart', leftConversion, rightConversion,
      [], [], 5, 0, false, 800
    ) as { margin: { r: number } };
    const withoutRight = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      [], [], 5, 0, false, 800
    ) as { margin: { r: number } };

    expect(withRight.margin.r).toBeGreaterThan(withoutRight.margin.r);
  });

  it('includes ramp-up shape when hasRampUp is true and rampUpEndIndex > 0', () => {
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      [0, 5], ['00:00:00', '00:00:05'], 10, 3, true, 800
    );
    const shapes = layout.shapes as unknown[];
    expect(shapes).toHaveLength(1);
  });

  it('excludes ramp-up shape when hasRampUp is false', () => {
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      [0, 5], ['00:00:00', '00:00:05'], 10, 3, false, 800
    );
    const shapes = layout.shapes as unknown[];
    expect(shapes).toHaveLength(0);
  });

  it('excludes ramp-up shape when rampUpEndIndex is 0', () => {
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      [0, 5], ['00:00:00', '00:00:05'], 10, 0, true, 800
    );
    const shapes = layout.shapes as unknown[];
    expect(shapes).toHaveLength(0);
  });

  it('sets container width on the layout', () => {
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      [], [], 5, 0, false, 1200
    );
    expect(layout.width).toBe(1200);
  });

  it('applies theme colors to font, grid, and background', () => {
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      [], [], 5, 0, false, 800
    );
    const font = layout.font as { color: string };
    expect(font.color).toBe(themeColors.textColor);
    expect(layout.plot_bgcolor).toBe(themeColors.plotBgColor);
    expect(layout.paper_bgcolor).toBe(themeColors.bgColor);
  });

  it('sets tick values and labels on the xaxis', () => {
    const tickValues = [0, 2, 4];
    const tickLabels = ['00:00:00', '00:00:20', '00:00:40'];
    const layout = buildChartLayout(
      themeColors, 'Chart', leftConversion, null,
      tickValues, tickLabels, 5, 0, false, 800
    );
    const xaxis = layout.xaxis as { tickvals: number[]; ticktext: string[] };
    expect(xaxis.tickvals).toEqual(tickValues);
    expect(xaxis.ticktext).toEqual(tickLabels);
  });
});

// ---------------------------------------------------------------------------
// buildChartConfig
// ---------------------------------------------------------------------------

describe('buildChartConfig', () => {
  it('returns an object with displayModeBar enabled', () => {
    const config = buildChartConfig('My Chart');
    expect(config.displayModeBar).toBe(true);
  });

  it('sets responsive to true', () => {
    const config = buildChartConfig('My Chart');
    expect(config.responsive).toBe(true);
  });

  it('hides the Plotly logo', () => {
    const config = buildChartConfig('My Chart');
    expect(config.displaylogo).toBe(false);
  });

  it('generates download filename from chartName', () => {
    const config = buildChartConfig('My Performance Chart');
    const options = config.toImageButtonOptions as { filename: string };
    expect(options.filename).toBe('my_performance_chart');
  });

  it('uses default filename when chartName is undefined', () => {
    const config = buildChartConfig(undefined);
    const options = config.toImageButtonOptions as { filename: string };
    expect(options.filename).toBe('custom_metrics_chart');
  });

  it('includes copy-to-clipboard button in modeBarButtonsToAdd', () => {
    const config = buildChartConfig('My Chart');
    const buttons = config.modeBarButtonsToAdd as Array<{ name: string }>;
    expect(buttons).toHaveLength(1);
    expect(buttons[0].name).toBe('Copy to Clipboard');
  });

  it('removes the expected mode bar buttons', () => {
    const config = buildChartConfig('My Chart');
    const removed = config.modeBarButtonsToRemove as string[];
    expect(removed).toContain('pan2d');
    expect(removed).toContain('lasso2d');
    expect(removed).toContain('select2d');
    expect(removed).toContain('zoom2d');
  });

  it('sets toImageButtonOptions scale to 2', () => {
    const config = buildChartConfig('My Chart');
    const options = config.toImageButtonOptions as { scale: number };
    expect(options.scale).toBe(2);
  });

  it('sets toImageButtonOptions height to 500', () => {
    const config = buildChartConfig('My Chart');
    const options = config.toImageButtonOptions as { height: number };
    expect(options.height).toBe(600);
  });

  it('copy button has an icon property with path', () => {
    const config = buildChartConfig('My Chart');
    const buttons = config.modeBarButtonsToAdd as Array<{ icon: { path: string } }>;
    expect(buttons[0].icon).toBeDefined();
    expect(typeof buttons[0].icon.path).toBe('string');
    expect(buttons[0].icon.path.length).toBeGreaterThan(0);
  });

  it('copy button has a click handler function', () => {
    const config = buildChartConfig('My Chart');
    const buttons = config.modeBarButtonsToAdd as Array<{ click: unknown }>;
    expect(typeof buttons[0].click).toBe('function');
  });

  it('handles chartName with spaces and mixed case for filename', () => {
    const config = buildChartConfig('CPU Usage Over Time');
    const options = config.toImageButtonOptions as { filename: string };
    expect(options.filename).toBe('cpu_usage_over_time');
  });
});
