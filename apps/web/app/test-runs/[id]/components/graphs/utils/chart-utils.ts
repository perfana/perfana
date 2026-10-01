import { SeriesConfig, MetricDataPoint } from '../types';
import { TestRun } from '@/types/test-runs';
import { MONO, SANS, fmtHM } from '@/lib/charts';
import { PlotlyGraphDiv, copyPlotToClipboard, downloadPng, plotlyPngBlob, plotSize } from '@/lib/plotly';

/**
 * What used to live here — `CHART_COLOR_PALETTE`, `assignSeriesToAxes`,
 * `getUnitConversion`, `buildChartLayout`, `buildTrace` and `buildAnalysisWindowShapes` —
 * is now `@/lib/charts`, shared with Compare and Trends. What is left is the part that is
 * genuinely specific to the Graphs card: its x axis is a sample index that stands for
 * wall-clock time, and its modebar exports a PNG.
 */

/**
 * Build sorted timestamps and index mapping from series data
 */
export function buildTimestampMapping(
  allSeries: SeriesConfig[],
  seriesData: Map<string, MetricDataPoint[]>
): { sortedTimestamps: string[]; timestampToIndex: Map<string, number> } {
  const allTimestamps = new Set<string>();

  allSeries.forEach((series) => {
    const data = seriesData.get(series.id);
    if (data && data.length > 0) {
      data.forEach(d => allTimestamps.add(d.time));
    }
  });

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) =>
    new Date(a).getTime() - new Date(b).getTime()
  );
  const timestampToIndex = new Map(sortedTimestamps.map((ts, idx) => [ts, idx]));

  return { sortedTimestamps, timestampToIndex };
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * Tick positions for the sample-index x axis, labelled with wall-clock `HH:MM`.
 *
 * A tick on each ten-minute boundary once the run is long enough to have several, so the
 * labels fall on round times a reader can match to an incident; otherwise about six
 * evenly spaced ones. Horizontal either way — the old −45° labels had to be read sideways
 * for no gain once the labels are four characters.
 */
export function calculateXAxisTicks(
  sortedTimestamps: string[],
  targetTicks = 6
): { tickValues: number[]; tickLabels: string[] } {
  const n = sortedTimestamps.length;
  if (n === 0) return { tickValues: [], tickLabels: [] };

  const times = sortedTimestamps.map((ts) => new Date(ts).getTime());
  const indices: number[] = [];

  if (times[n - 1] - times[0] >= 3 * TEN_MINUTES_MS) {
    let lastBucket = Number.NaN;
    for (let i = 0; i < n; i += 1) {
      const bucket = Math.floor(times[i] / TEN_MINUTES_MS);
      if (bucket !== lastBucket) {
        indices.push(i);
        lastBucket = bucket;
      }
    }
  }

  // Either the run is short, or ten-minute buckets produced too many ticks to read.
  if (indices.length === 0 || indices.length > targetTicks * 2) {
    indices.length = 0;
    const step = Math.max(1, Math.ceil(n / targetTicks));
    for (let i = 0; i < n; i += step) indices.push(i);
    if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);
  }

  return { tickValues: indices, tickLabels: indices.map((i) => fmtHM(sortedTimestamps[i])) };
}

/**
 * Analysis-window boundaries in sample-index space, derived from the test run's
 * `analysis_start_offset` / `analysis_end_offset` (seconds trimmed off the head and
 * tail). `startIndex` is the first in-window sample, `endIndex` the first excluded
 * trailing sample; `null` means that edge is not trimmed.
 */
export function calculateAnalysisWindowIndices(
  testRun: TestRun | null,
  sortedTimestamps: string[]
): { startIndex: number | null; endIndex: number | null } {
  const n = sortedTimestamps.length;
  if (!testRun || n === 0) return { startIndex: null, endIndex: null };

  const firstTime = new Date(sortedTimestamps[0]).getTime();
  const lastTime = new Date(sortedTimestamps[n - 1]).getTime();

  let startIndex: number | null = null;
  if (testRun.analysis_start_offset) {
    const boundary = firstTime + testRun.analysis_start_offset * 1000;
    const found = sortedTimestamps.findIndex(ts => new Date(ts).getTime() >= boundary);
    startIndex = found === -1 ? n - 1 : found;
  }

  let endIndex: number | null = null;
  if (testRun.analysis_end_offset) {
    const boundary = lastTime - testRun.analysis_end_offset * 1000;
    const found = sortedTimestamps.findIndex(ts => new Date(ts).getTime() > boundary);
    endIndex = found === -1 ? n - 1 : Math.max(startIndex ?? 0, found);
  }

  return { startIndex, endIndex };
}

/**
 * Plotly renders an export from the live layout, which carries neither a title nor a
 * legend — the heading above the chart is the title now, and the legend is an HTML table.
 * An exported PNG is a different context: once it leaves the app nothing else names its
 * series, so both go back on for the image only. `toImage` accepts a figure object as
 * well as a graph div, so building one here never touches what is on screen.
 */
function buildExportFigure(gd: unknown, chartName: string | undefined) {
  const graph = gd as { data?: unknown[]; layout?: Record<string, unknown> };
  const layout = graph.layout ?? {};
  const font = (layout.font ?? {}) as { color?: string };
  const margin = (layout.margin ?? {}) as Record<string, number>;

  return {
    data: graph.data ?? [],
    layout: {
      ...layout,
      title: {
        text: chartName || 'Custom Metrics Chart',
        font: { color: font.color, size: 15, family: SANS },
        x: 0.5,
        xanchor: 'center',
        y: 0.97,
        yanchor: 'top'
      },
      showlegend: true,
      legend: {
        x: 0.5,
        y: -0.18,
        xanchor: 'center',
        yanchor: 'top',
        orientation: 'h',
        bgcolor: 'rgba(0,0,0,0)',
        bordercolor: 'rgba(0,0,0,0)',
        font: { color: font.color, size: 10, family: MONO }
      },
      // The on-screen layout is drawn tight against a card that supplies the title and
      // the legend; the image has to carry both itself.
      margin: { ...margin, t: 44, b: 80 }
    }
  };
}

/** Filename shared by every export path, so a PNG is named the same however it was saved. */
function exportFilename(chartName: string | undefined): string {
  return chartName ? chartName.toLowerCase().replace(/\s+/g, '_') : 'custom_metrics_chart';
}

/** Trigger a browser download for an already-rendered blob. */
function downloadBlob(blob: Blob, chartName: string | undefined): void {
  downloadPng(blob, exportFilename(chartName) + '.png');
}

/** Last resort when both the export and its fallback fail, so it is never silent. */
function warnExportFailed(err: unknown): void {
  console.warn('[chart-export] could not export the chart image', err);
}

/** Render the chart to a PNG blob with the export title applied. */
function renderExportPng(
  gd: unknown,
  chartName: string | undefined,
  size: { width: number; height: number }
): Promise<Blob> {
  return plotlyPngBlob(buildExportFigure(gd, chartName), size);
}

/**
 * Build the Plotly config with copy to clipboard functionality
 */
export function buildChartConfig(chartName: string | undefined): Record<string, unknown> {
  return {
    displayModeBar: true,
    // 'toImage' is removed and replaced below: the built-in download renders the live
    // layout, which deliberately has no title and no legend, so its PNG would come out
    // unlabelled.
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d', 'toImage'],
    displaylogo: false,
    responsive: true,
    toImageButtonOptions: {
      format: 'png',
      filename: exportFilename(chartName),
      height: 600,
      width: 1200,
      scale: 2
    },
    modeBarButtonsToAdd: [
      {
        name: 'Download as PNG',
        icon: {
          width: 1000,
          height: 1000,
          path: 'm500 450c-83 0-150-67-150-150 0-83 67-150 150-150 83 0 150 67 150 150 0 83-67 150-150 150z m400 150h-120c-16 0-34 13-39 29l-31 93c-6 15-23 28-40 28h-340c-16 0-34-13-39-28l-31-94c-6-15-23-28-40-28h-120c-55 0-100-45-100-100v-450c0-55 45-100 100-100h800c55 0 100 45 100 100v450c0 55-45 100-100 100z m-400-550c-138 0-250 112-250 250 0 138 112 250 250 250 138 0 250-112 250-250 0-138-112-250-250-250z m365 380c-19 0-35 16-35 35 0 19 16 35 35 35 19 0 35-16 35-35 0-19-16-35-35-35z',
          transform: 'matrix(1 0 0 -1 0 850)'
        },
        click: function(gd: unknown) {
          renderExportPng(gd, chartName, { width: 1200, height: 600 })
            .then((blob) => downloadBlob(blob, chartName))
            .catch(() => {
              // Fall back to Plotly's own download so the button is never a dead end.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (window as any).Plotly.downloadImage(gd, {
                format: 'png',
                filename: exportFilename(chartName),
                width: 1200,
                height: 600,
                scale: 2
              });
            })
            // Both paths can fail (Plotly absent, toImage throwing). Without this the
            // second rejection is unhandled and the button silently does nothing.
            .catch(warnExportFailed);
        }
      },
      {
        name: 'Copy to Clipboard',
        icon: {
          width: 1792,
          height: 1792,
          path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
          transform: 'scale(0.8)'
        },
        click: function(gd: PlotlyGraphDiv) {
          copyPlotToClipboard(
            () => renderExportPng(gd, chartName, plotSize(gd, { width: 1200, height: 600 })),
            // chart-export-fallbacks.test.ts pins this download as a regression guard —
            // the ReferenceError era left the button doing nothing and downloading
            // nothing. No toast is in scope, but the explicit "Download as PNG" button
            // one icon to the left means a file appearing here is not a surprise.
            { fallbackFilename: exportFilename(chartName) + '.png' },
          );
        }
      }
    ]
  };
}
