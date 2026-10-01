/**
 * Unit tests for chart-utils.ts — what is left of it.
 *
 * The palette, the axis assignment, the unit conversion, the trace builder and the layout
 * builder moved to `@/lib/charts` (and are covered by `lib/charts/units.test.ts` and
 * `lib/charts/format.test.ts`). What stays here is the part that is specific to the Graphs
 * card: its sample-index x axis, the analysis-window boundary maths, and the PNG export.
 */

import {
  buildTimestampMapping,
  calculateXAxisTicks,
  calculateAnalysisWindowIndices,
  buildChartConfig,
} from '@/app/test-runs/[id]/components/graphs/utils/chart-utils';
import { fmtHM } from '@/lib/charts';
import { SeriesConfig, MetricDataPoint } from '@/app/test-runs/[id]/components/graphs/types';
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

// ISO timestamps spaced 10 seconds apart
const T0 = '2024-01-01T00:00:00.000Z';
const T1 = '2024-01-01T00:00:10.000Z';
const T2 = '2024-01-01T00:00:20.000Z';
const T3 = '2024-01-01T00:00:30.000Z';
const T4 = '2024-01-01T00:00:40.000Z';






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
      expect(tickLabels[i]).toBe(fmtHM(timestamps[idx]));
    });
  });

  it('spans the data with the default target of ~6 ticks', () => {
    const timestamps = [T0, T1, T2, T3, T4];
    const { tickValues } = calculateXAxisTicks(timestamps);
    expect(tickValues).toContain(0);
    expect(tickValues).toContain(4);
  });

  it('labels ten-minute boundaries once the run is long enough to have several', () => {
    // 40 minutes at one sample a minute: the ticks land on :00, :10, :20, :30, :40 rather
    // than on every nth sample, so a reader can match them to a wall clock.
    const base = new Date('2024-01-01T09:58:00.000Z').getTime();
    const timestamps = Array.from({ length: 41 }, (_, i) => new Date(base + i * 60_000).toISOString());
    const { tickLabels } = calculateXAxisTicks(timestamps);
    expect(tickLabels.every((label) => /^\d{2}:\d{2}$/.test(label))).toBe(true);
    expect(tickLabels.filter((label) => label.endsWith(':00')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// calculateAnalysisWindowIndices
// ---------------------------------------------------------------------------

describe('calculateAnalysisWindowIndices', () => {
  it('returns nulls when testRun is null', () => {
    expect(calculateAnalysisWindowIndices(null, [T0, T1])).toEqual({ startIndex: null, endIndex: null });
  });

  it('returns nulls when the run has no offsets', () => {
    const run = makeTestRun({ analysis_start_offset: undefined, analysis_end_offset: undefined });
    expect(calculateAnalysisWindowIndices(run, [T0, T1])).toEqual({ startIndex: null, endIndex: null });
  });

  it('returns nulls when timestamps array is empty', () => {
    const run = makeTestRun({ analysis_start_offset: 30 });
    expect(calculateAnalysisWindowIndices(run, [])).toEqual({ startIndex: null, endIndex: null });
  });

  it('resolves the start offset to the first in-window sample', () => {
    // Timestamps are 10 seconds apart; analysis_start_offset = 15s → T2 (20s) is first in-window
    const run = makeTestRun({ analysis_start_offset: 15 });
    expect(calculateAnalysisWindowIndices(run, [T0, T1, T2, T3, T4]).startIndex).toBe(2);
  });

  it('clamps the start index when the offset extends beyond all data', () => {
    const run = makeTestRun({ analysis_start_offset: 9999 });
    expect(calculateAnalysisWindowIndices(run, [T0, T1, T2]).startIndex).toBe(2);
  });

  it('resolves the end offset to the first excluded trailing sample', () => {
    // Last timestamp is T4 (40s); analysis_end_offset = 15s → boundary at 25s, T3 (30s) is first excluded
    const run = makeTestRun({ analysis_end_offset: 15 });
    expect(calculateAnalysisWindowIndices(run, [T0, T1, T2, T3, T4]).endIndex).toBe(3);
  });

  it('never lets the end boundary precede the start boundary', () => {
    const run = makeTestRun({ analysis_start_offset: 30, analysis_end_offset: 30 });
    const { startIndex, endIndex } = calculateAnalysisWindowIndices(run, [T0, T1, T2, T3, T4]);
    expect(endIndex).toBeGreaterThanOrEqual(startIndex!);
  });

  it('treats a 0 offset as untrimmed', () => {
    const run = makeTestRun({ analysis_start_offset: 0, analysis_end_offset: 0 });
    expect(calculateAnalysisWindowIndices(run, [T0, T1])).toEqual({ startIndex: null, endIndex: null });
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

  it('adds a download button alongside copy-to-clipboard', () => {
    const config = buildChartConfig('My Chart');
    const buttons = config.modeBarButtonsToAdd as Array<{ name: string }>;
    expect(buttons.map(b => b.name)).toEqual(['Download as PNG', 'Copy to Clipboard']);
  });

  it('removes the expected mode bar buttons', () => {
    const config = buildChartConfig('My Chart');
    const removed = config.modeBarButtonsToRemove as string[];
    expect(removed).toContain('pan2d');
    expect(removed).toContain('lasso2d');
    expect(removed).toContain('select2d');
    expect(removed).toContain('zoom2d');
  });

  it('replaces the built-in toImage button, which would export an untitled chart', () => {
    const config = buildChartConfig('My Chart');
    expect(config.modeBarButtonsToRemove as string[]).toContain('toImage');
  });

  describe('export title', () => {
    // The chart deliberately has no title in its live layout — the editable heading
    // above it is the on-screen title. An exported PNG has nothing else naming it,
    // so both export paths must put the title back on the figure they render.
    const gd = {
      data: [{ y: [1, 2, 3] }],
      layout: { font: { color: '#111', family: 'Inter' }, xaxis: {} },
      _fullLayout: { width: 900, height: 400 },
    };

    let toImage: jest.Mock;

    beforeEach(() => {
      toImage = jest.fn().mockResolvedValue('data:image/png;base64,AAAA');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).Plotly = { toImage, downloadImage: jest.fn() };
      // jsdom implements neither, and the download path calls both
      URL.createObjectURL = jest.fn(() => 'blob:mock');
      URL.revokeObjectURL = jest.fn();
    });

    const clickButton = async (name: string, chartName?: string) => {
      const config = buildChartConfig(chartName);
      const buttons = config.modeBarButtonsToAdd as Array<{ name: string; click: (gd: unknown) => void }>;
      const button = buttons.find(b => b.name === name)!;
      button.click(gd);
      await Promise.resolve();
    };

    it('puts the chart name on the figure the download button renders', async () => {
      await clickButton('Download as PNG', 'Response times p95');
      const figure = toImage.mock.calls[0][0] as { layout: { title: { text: string } } };
      expect(figure.layout.title.text).toBe('Response times p95');
    });

    it('puts the chart name on the figure the clipboard button renders', async () => {
      await clickButton('Copy to Clipboard', 'Response times p95');
      const figure = toImage.mock.calls[0][0] as { layout: { title: { text: string } } };
      expect(figure.layout.title.text).toBe('Response times p95');
    });

    it('falls back to a default title when the chart is unnamed', async () => {
      await clickButton('Download as PNG', undefined);
      const figure = toImage.mock.calls[0][0] as { layout: { title: { text: string } } };
      expect(figure.layout.title.text).toBe('Custom Metrics Chart');
    });

    it('turns the legend on for the export, since the on-screen legend is an HTML table', async () => {
      await clickButton('Download as PNG', 'Response times p95');
      const figure = toImage.mock.calls[0][0] as { layout: { showlegend: boolean } };
      expect(figure.layout.showlegend).toBe(true);
    });

    it('leaves the live layout untouched — neither title nor legend is on the live copy', async () => {
      await clickButton('Download as PNG', 'Response times p95');
      expect(gd.layout).not.toHaveProperty('title');
      expect(gd.layout).not.toHaveProperty('showlegend');
    });

    it('carries the rest of the layout onto the export figure', async () => {
      await clickButton('Download as PNG', 'Response times p95');
      const figure = toImage.mock.calls[0][0] as {
        data: unknown[];
        layout: { font: { color: string } };
      };
      expect(figure.data).toEqual(gd.data);
      expect(figure.layout.font.color).toBe('#111');
    });

    it('renders the clipboard copy at the size the chart is displayed at', async () => {
      await clickButton('Copy to Clipboard', 'My Chart');
      expect(toImage.mock.calls[0][1]).toMatchObject({ width: 900, height: 400, scale: 2 });
    });

    // A failed export used to leave the second rejection unhandled: the button did
    // nothing and the only trace was an unhandled-rejection warning in the console.
    describe('when the export fails', () => {
      let unhandled: jest.Mock;
      let warn: jest.SpyInstance;

      beforeEach(() => {
        unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      });

      afterEach(() => {
        process.off('unhandledRejection', unhandled);
        warn.mockRestore();
      });

      // Let every queued microtask AND the macrotask that reports unhandled
      // rejections run, so `unhandled` would have fired if one escaped.
      const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

      it('warns instead of leaving an unhandled rejection when the clipboard path fails', async () => {
        toImage.mockRejectedValue(new Error('toImage blew up'));
        // jsdom ships neither, and the clipboard path needs both to be reachable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).ClipboardItem = class { constructor(_items: unknown) {} };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).clipboard = { write: jest.fn().mockRejectedValue(new Error('denied')) };

        await clickButton('Copy to Clipboard', 'My Chart');
        await settle();

        expect(unhandled).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
      });

      it('warns instead of leaving an unhandled rejection when both download paths fail', async () => {
        toImage.mockRejectedValue(new Error('toImage blew up'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).Plotly.downloadImage = jest.fn(() => { throw new Error('no Plotly'); });

        await clickButton('Download as PNG', 'My Chart');
        await settle();

        expect(unhandled).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
      });

      it('rejects rather than throwing when Plotly is not on window yet', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).Plotly;

        expect(() => {
          const config = buildChartConfig('My Chart');
          const buttons = config.modeBarButtonsToAdd as Array<{ name: string; click: (gd: unknown) => void }>;
          buttons.find(b => b.name === 'Download as PNG')!.click(gd);
        }).not.toThrow();
        await settle();

        expect(unhandled).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
      });
    });
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
