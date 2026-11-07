'use client';

import type { PlotData } from 'plotly.js';

type TrendsTrace = Partial<PlotData>;
import { useMemo } from 'react';
import { useTheme } from '@mui/material';
import { MetricStatistic, RunMeta, TrendsSeries } from '../types';
import { trendsSeriesLabel } from '../utils';
import type { SeriesRow } from '@/components/charts';
import {
  SIZE,
  axisBadge,
  buildPlotLayout,
  catColor,
  chartTheme,
  fmtDay,
  fmtDayHM,
  lanesNote,
  resolveAxes,
  toDisplay,
  unitText,
  windowStats,
} from '@/lib/charts';

interface UseTrendsPlotProps {
  metricsData: MetricStatistic[];
  trendsExpanded: boolean;
  addedSeries: TrendsSeries[];
  /** Which run the cursor is on, so the table's cursor column can be filled. */
  cursorIndex: number | null;
}

interface PlotDataPoint {
  x: string;
  y: number;
  created_at: string;
  is_changepoint?: boolean;
  consolidated_result?: {
    overall?: boolean;
    passed?: boolean;
  } | null;
}

/**
 * The Trends chart in the Analyst standard.
 *
 * The x axis is one position per run, in `created_at` order, labelled with the run's
 * DATE — runs are discrete events, not samples on a clock, so positions stay evenly
 * spaced (a linear axis over run index, never a date axis) while the tick text answers
 * "when". The line gets markers and a failed run keeps its red cross; red is reserved for
 * exactly that kind of verdict.
 */
export function useTrendsPlot({
  metricsData,
  trendsExpanded,
  addedSeries,
  cursorIndex,
}: UseTrendsPlotProps) {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode === 'dark' ? 'dark' : 'light';

  return useMemo(() => {
    const theme = chartTheme(mode);
    const empty = {
      plotData: [] as unknown[],
      plotLayout: {} as Record<string, unknown>,
      plotConfig: {} as Record<string, unknown>,
      rows: [] as SeriesRow[],
      runIds: [] as string[],
      traceIndexOf: new Map<string, number>(),
      runMeta: new Map<string, RunMeta>(),
      lanesNote: undefined as string | undefined,
    };
    if (!trendsExpanded || metricsData.length === 0) return empty;

    // Release and annotations are per-run, repeated on every row of that run; keep the
    // first row that actually carries one.
    const runMeta = new Map<string, RunMeta>();
    for (const item of metricsData) {
      if ((item.version || item.annotations) && !runMeta.has(item.test_run_id)) {
        runMeta.set(item.test_run_id, { version: item.version, annotations: item.annotations });
      }
    }

    // Group by series (not metric_name — two panels can share one) and sort by created_at.
    const bySeries = new Map<string, PlotDataPoint[]>();
    for (const item of metricsData) {
      const bucket = bySeries.get(item.series_id) ?? [];
      bucket.push({
        x: item.test_run_id,
        y: item.value,
        created_at: item.created_at,
        is_changepoint: item.is_changepoint,
        consolidated_result: item.consolidated_result,
      });
      bySeries.set(item.series_id, bucket);
    }
    for (const points of bySeries.values()) {
      points.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }

    const visible = addedSeries.filter((s) => !s.hidden && bySeries.has(s.id));
    const labelOf = (series: TrendsSeries) => trendsSeriesLabel(series, addedSeries);

    const axisSeries = visible.map((series) => {
      const values = (bySeries.get(series.id) ?? []).map((p) => p.y).filter((v) => Number.isFinite(v));
      return {
        id: series.id,
        unit: series.yAxisFormat,
        name: labelOf(series),
        max: values.length ? Math.max(...values) : undefined,
        min: values.length ? Math.min(...values) : undefined,
      };
    });
    const { mode: axisLayoutMode, groups } = resolveAxes(axisSeries);
    const groupOf = new Map(groups.flatMap((g) => g.series.map((s) => [s.id, g] as const)));

    // The x positions are shared across series: the run list of whichever series has the
    // most points, so a series missing a run simply skips that position.
    const runIds: string[] = [];
    const seenRuns = new Set<string>();
    for (const points of bySeries.values()) {
      for (const point of points) {
        if (!seenRuns.has(point.x)) {
          seenRuns.add(point.x);
          runIds.push(point.x);
        }
      }
    }
    const runOrder = new Map<string, string>();
    for (const points of bySeries.values()) for (const p of points) runOrder.set(p.x, p.created_at);
    runIds.sort((a, b) => new Date(runOrder.get(a)!).getTime() - new Date(runOrder.get(b)!).getTime());
    const runIndex = new Map(runIds.map((id, i) => [id, i]));

    const traceIndexOf = new Map<string, number>();
    const traces: TrendsTrace[] = [];

    for (const series of visible) {
      const points = bySeries.get(series.id) ?? [];
      const group = groupOf.get(series.id);
      if (!group) continue;
      const color = catColor(series.colorSlot ?? addedSeries.indexOf(series), mode);
      const failed = points.map((p) => p.consolidated_result?.overall === false);

      traceIndexOf.set(series.id, traces.length);
      traces.push({
        x: points.map((p) => runIndex.get(p.x) ?? 0),
        y: points.map((p) => toDisplay(p.y, series.yAxisFormat, group.display)),
        type: 'scatter',
        mode: 'lines+markers',
        name: labelOf(series),
        line: { color, width: SIZE.trendsLine, shape: 'linear' },
        marker: {
          // A failed run is called out in red and with a cross — the one verdict colour.
          size: failed.map((f) => (f ? SIZE.trendsMarker * 2.4 : SIZE.trendsMarker * 2)),
          symbol: failed.map((f) => (f ? 'x' : 'circle')),
          color: failed.map((f) => (f ? theme.error : color)),
        },
        yaxis: group.axis,
        connectgaps: true,
        hoverinfo: 'none',
      });
    }

    // Changepoints: a hairline at the run where the trend shifted.
    const changepoints = new Set<number>();
    for (const points of bySeries.values()) {
      for (const point of points) {
        if (point.is_changepoint) changepoints.add(runIndex.get(point.x) ?? -1);
      }
    }
    const changepointOverlay = {
      shapes: Array.from(changepoints)
        .filter((i) => i >= 0)
        .map((i) => ({
          type: 'line',
          x0: i,
          x1: i,
          y0: 0,
          y1: 1,
          yref: 'paper',
          line: { color: theme.muted, width: 1, dash: 'dot' },
          opacity: 0.55,
          layer: 'below',
        })),
      annotations: [] as Record<string, unknown>[],
    };

    // Ticks are the run's DATE, not its id. A reader asks "when did this regress", and a
    // run id answers that only if you have the naming convention memorised. The id is not
    // lost: hovering a point puts it in the card header's cursor readout.
    //
    // 12 rather than the 8 a run id needed — `04 Oct` is a sixth of the width.
    const tickStep = Math.max(1, Math.ceil(runIds.length / 12));
    const tickRuns = runIds
      .map((id, index) => ({ id, index }))
      .filter(({ index }) => index % tickStep === 0);
    // Nightly runs are one a day and want the bare date. A workload run several times in
    // one day would otherwise label two positions identically, so the clock goes on ALL
    // of them — a mixed axis is harder to read than a uniformly longer one.
    const tickTimes = tickRuns.map(({ id }) => runOrder.get(id) ?? '');
    const dayLabels = tickTimes.map(fmtDay);
    const fmtTick = new Set(dayLabels).size < dayLabels.length ? fmtDayHM : fmtDay;

    const plotLayout = buildPlotLayout(axisLayoutMode, {
      theme,
      groups,
      x: {
        type: 'linear',
        // Label at most every nth position: a 40-run trend would otherwise be a solid
        // band of overlapping text.
        tickvals: tickRuns.map(({ index }) => index),
        ticktext: tickTimes.map(fmtTick),
        range: [-0.5, Math.max(runIds.length - 0.5, 0.5)],
      },
      overlay: changepointOverlay,
      // A trend is read for its SHAPE: is this metric drifting up across releases. Pinned to
      // zero, a run-over-run series that sits at 820-840ms is a flat line in the top tenth of
      // a 0-900 axis and a 20ms climb is invisible. The only overlay here is the changepoint
      // marker, which is `yref: 'paper'` — nothing data-referenced can stretch the autorange.
      zeroBase: false,
      height: axisLayoutMode === 'lanes' ? undefined : SIZE.trendsHeight,
    });

    // No modebar: Plotly's own buttons export the live layout, which has no title and no
    // legend. The copy and download actions are in the card header instead (ChartActions).
    const plotConfig = { responsive: true, displayModeBar: false };

    // One row per added series, hidden included — the swatch is how a hidden one comes back.
    const rows: SeriesRow[] = addedSeries.map((series) => {
      const points = bySeries.get(series.id) ?? [];
      const group = groupOf.get(series.id);
      const display = group?.display ?? { label: unitText(series.yAxisFormat), divisor: 1 };
      const cursorRun = cursorIndex !== null ? runIds[cursorIndex] : undefined;
      const cursorPoint = cursorRun ? points.find((p) => p.x === cursorRun) : undefined;
      return {
        id: series.id,
        name: labelOf(series),
        source: series.source === 'performance-metrics' ? 'performance_test' : series.source,
        sourceLabel: series.dashboardLabel,
        color: catColor(series.colorSlot ?? addedSeries.indexOf(series), mode),
        unit: series.yAxisFormat,
        panelUnit: series.panelYAxisFormat,
        displayUnit: display.label,
        hidden: series.hidden,
        axis: axisBadge(groups, series.id),
        // Every point IS a run aggregate, so the stats are over the runs on screen —
        // there is no in-run analysis window left to trim here.
        stats: windowStats(points.map((p) => p.y), series.yAxisFormat, display),
        cursor: cursorPoint ? toDisplay(cursorPoint.y, series.yAxisFormat, display) : null,
      } satisfies SeriesRow;
    });

    return {
      plotData: traces, plotLayout, plotConfig, rows, runIds, traceIndexOf, runMeta,
      lanesNote: lanesNote(groups, axisLayoutMode),
    };
  }, [metricsData, trendsExpanded, addedSeries, mode, cursorIndex]);
}
