/**
 * The one name for a picked set of series, shared by Compare and Graphs.
 *
 * Both cards used to name a selection by its SIZE — "3 Series", "Multi-metric Analysis
 * (5 series)", "T01 vs T02 (+4 more)" — which told a reader nothing and made every preset
 * on a system collide on the same handful of names. It is now what the selection holds:
 * `dashboard · panel · metric`, with each level collapsed to a count once it holds more
 * than two values.
 */
import { composeSeriesName } from '@/lib/series-name';

const s = (dashboardLabel: string, panelTitle: string, metricName: string) =>
  ({ dashboardLabel, panelTitle, metricName });

it('names one series by all three levels', () => {
  expect(composeSeriesName([s('JVM', 'Heap', 'used')])).toBe('JVM · Heap · used');
});

it('lists two values of a level, and counts three or more', () => {
  expect(composeSeriesName([s('JVM', 'Heap', 'used'), s('JVM', 'Non-heap', 'used')]))
    .toBe('JVM · Heap + Non-heap · used');

  expect(composeSeriesName([
    s('JVM', 'Heap', 'used'), s('JVM', 'Non-heap', 'used'), s('JVM', 'Threads', 'live'),
  ])).toBe('JVM · 3 panels · used + live');
});

it('counts dashboards too, so a wide selection stays short', () => {
  const wide = [
    s('JVM', 'Heap', 'used'), s('Docker', 'CPU', 'Usage'),
    s('HTTP', 'Requests', 'rate'), s('k6', 'VUs', 'count'),
  ];
  expect(composeSeriesName(wide)).toBe('4 dashboards · 4 panels · 4 metrics');
});

it('drops a level that would only repeat the one before it', () => {
  // A Grafana panel with a single series routinely names both the same thing, and
  // `CPU · CPU` reads as a bug.
  expect(composeSeriesName([s('Docker', 'CPU', 'CPU')])).toBe('Docker · CPU');
});

it('skips a level nothing fills rather than writing a zero into the name', () => {
  expect(composeSeriesName([{ dashboardLabel: 'JVM', metricName: 'used' }]))
    .toBe('JVM · used');
  expect(composeSeriesName([{ panelTitle: '  ', metricName: 'used' }])).toBe('used');
});

it('returns nothing for an empty selection, so each caller keeps its own fallback', () => {
  // The modal can be opened with nothing added.
  expect(composeSeriesName([])).toBe('');
});

it('counts distinct values, not series', () => {
  // Three series, one panel, one metric name: the name must not read "3 panels".
  const sameName = [
    s('JVM', 'Heap', 'used'), s('JVM', 'Heap', 'used'), s('JVM', 'Heap', 'committed'),
  ];
  expect(composeSeriesName(sameName)).toBe('JVM · Heap · used + committed');
});

/**
 * The Graphs card reaches this through `generateChartName`, and the chart's name is also
 * what the save dialog offers as the preset name (`GraphsCard` passes `chartName` as
 * `defaultName`). So one composer covers both, and the two cannot drift apart.
 */
it('is what the Graphs chart name resolves to', async () => {
  const { generateChartName } = await import(
    '@/app/test-runs/[id]/components/graphs/utils/graph-formatters'
  );
  const series = [
    { dashboardId: 'd', panelId: 1, panelTitle: 'Heap', metricName: 'used', dashboardLabel: 'JVM' },
    { dashboardId: 'd', panelId: 1, panelTitle: 'Heap', metricName: 'committed', dashboardLabel: 'JVM' },
  ] as never;
  expect(generateChartName(series)).toBe('JVM · Heap · used + committed');
  expect(generateChartName([] as never)).toBe('');
});

/** And the fallback the save dialog uses when the chart has no name at all. */
it('is what the graph preset fallback resolves to, with its own empty case', async () => {
  const { GraphPresetUtils } = await import('@/lib/graph-presets');
  expect(GraphPresetUtils.generatePresetName([
    { dashboardId: 'd', panelId: 1, panelTitle: 'CPU', metricName: 'Usage', dashboardLabel: 'Docker' },
  ] as never)).toBe('Docker · CPU · Usage');
  // Empty composes to '', and a preset still needs a name.
  expect(GraphPresetUtils.generatePresetName([])).toBe('Custom Graph');
});
