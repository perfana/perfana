'use client';

import type { PlotTrace } from './types/chart.types';
import type { Config, Data, Layout } from 'plotly.js';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Typography, useTheme } from '@mui/material';

import { GraphsChartProps, SeriesConfig } from './types';
import {
  buildTimestampMapping,
  calculateXAxisTicks,
  calculateAnalysisWindowIndices,
  analysisRangeClip,
  buildChartConfig,
  zoomRangeFromRelayout,
} from './utils';
import { ChartLoadingState, ChartEmptyState } from './components';
import { mergeEventShapesIntoIndexedLayout } from '../shared/event-lines';
import { seriesRowName } from '@/lib/aggregated-perf-series';

import Plot from '@/components/ResponsivePlot';
import { AnalystChartCard, ChartActions, PillButton, SeriesTable, type SeriesRow } from '@/components/charts';
import {
  EMPTY,
  MONO,
  SIZE,
  analysisWindowShapes,
  axisBadge,
  buildPlotLayout,
  catColor,
  chartTheme,
  fmtClock,
  lanesNote,
  resolveAxes,
  toDisplay,
  unitText,
  windowStats,
  type AxisGroup,
} from '@/lib/charts';
import { dimOtherTraces, type PlotlyGraphDiv } from '@/lib/plotly';

/**
 * GraphsChart — the Analyst chart card for the Graphs builder.
 *
 * - one axis per unit family, lanes past two families (`resolveAxes`)
 * - colours by slot, so removing a series never recolours the rest
 * - the series table is the legend, the stats panel and the cursor readout
 * - no floating tooltip: `hoverinfo: 'none'` plus a crosshair
 */
export default function GraphsChart({
  testRun,
  seriesData,
  seriesConfig,
  loading,
  chartName,
  events,
  showToast,
  titleNode,
  actions,
  cascade,
  axisMode = 'overlay',
  onAxisModeChange,
  onRemoveSeries,
  onUpdateSeriesUnit,
  onToggleSeriesVisibility,
  onZoomRange,
  zoomed = false,
}: GraphsChartProps) {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode === 'dark' ? 'dark' : 'light';
  const theme = chartTheme(mode);

  const [cascadeOpen, setCascadeOpen] = useState(false);
  // Draw the analysis time range only, the way the report's Custom graphs section does.
  const [rangeOnly, setRangeOnly] = useState(false);
  const hasWindow = Boolean(testRun?.analysis_start_offset || testRun?.analysis_end_offset);
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  // Built once, not per render. The card keeps this panel MOUNTED while the picker is
  // closed (the card-link walk needs it), and `cursorIndex` below re-renders this component
  // on every Plotly hover — so an element rebuilt inline would re-render the whole dashboard
  // list, which is every dashboard on the system, on each pointer move across the chart.
  const closeCascade = useCallback(() => setCascadeOpen(false), []);
  const cascadePanel = useMemo(() => cascade?.(closeCascade), [cascade, closeCascade]);
  const graphRef = useRef<HTMLElement | null>(null);
  // The actions live in the header, outside the plot, so they need a re-render when
  // the graph div appears — a ref alone would leave them permanently disabled.
  const [graphEl, setGraphEl] = useState<PlotlyGraphDiv | null>(null);

  const visible = useMemo(() => seriesConfig.filter((s) => !s.hidden), [seriesConfig]);

  const rowName = (series: SeriesConfig) => seriesRowName(series.panelTitle, series.metricName);

  const plot = useMemo(() => {
    if (visible.length === 0 || seriesData.size === 0) return null;

    const { sortedTimestamps, timestampToIndex } = buildTimestampMapping(visible, seriesData);
    if (sortedTimestamps.length === 0) return null;

    const { startIndex, endIndex } = calculateAnalysisWindowIndices(testRun, sortedTimestamps);

    const clip =
      rangeOnly && hasWindow
        ? analysisRangeClip(startIndex, endIndex, sortedTimestamps.length)
        : null;
    const inClip = (time: string) => {
      if (!clip) return true;
      const i = timestampToIndex.get(time);
      return i !== undefined && i >= clip.lo && i <= clip.hi;
    };

    // Ticks come from the samples actually on screen: spacing them over the whole run and
    // then narrowing the axis leaves the labels outside the domain, so a short window on a
    // long run renders with one time label or none at all. The report's chart windows its
    // labels the same way (`labelPoints` in `chart-svg.service.ts`).
    const tickSource = clip ? sortedTimestamps.slice(clip.lo, clip.hi + 1) : sortedTimestamps;
    const { tickValues, tickLabels } = calculateXAxisTicks(tickSource);
    const tickOffset = clip ? clip.lo : 0;

    // The axis scale is chosen from whatever is DRAWN — the whole run normally, the clip in
    // the analysis-range-only view — while the table's stats are the analysis window only.
    // A line is drawn outside the window too, so an axis sized to the window would clip the
    // ramp-up. Zero-pinning is dropped in the narrowed views (`zeroBase` below).
    const axisSeries = visible.map((series) => {
      const data = (seriesData.get(series.id) ?? []).filter((d) => inClip(d.time));
      const values = data.map((d) => d.value).filter((v) => Number.isFinite(v));
      return {
        id: series.id,
        unit: series.yAxisFormat,
        name: series.metricName,
        max: values.length ? Math.max(...values) : undefined,
        min: values.length ? Math.min(...values) : undefined,
      };
    });

    const { mode: axisLayoutMode, groups } = resolveAxes(axisSeries, {
      split: axisMode === 'split',
    });
    const groupOf = new Map<string, AxisGroup<(typeof axisSeries)[number]>>();
    for (const group of groups) for (const s of group.series) groupOf.set(s.id, group);

    const traces: PlotTrace[] = [];
    const traceIndexOf = new Map<string, number>();

    visible.forEach((series) => {
      const data = seriesData.get(series.id);
      const group = groupOf.get(series.id);
      if (!data || data.length === 0 || !group) return;

      const sorted = [...data]
        .filter((d) => inClip(d.time))
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const color = catColor(series.colorSlot ?? seriesConfig.indexOf(series), mode);

      traceIndexOf.set(series.id, traces.length);
      traces.push({
        x: sorted.map((d) => timestampToIndex.get(d.time) as number),
        y: sorted.map((d) => toDisplay(d.value, series.yAxisFormat, group.display)),
        type: 'scatter',
        // A one-point series is a zero-length segment, which Plotly draws as nothing at all:
        // the axes scale to the value and the plot stays empty, so it reads as "no data" rather
        // than as a point. The scenario-level perf-test panels (Error Count, Avg/Max Active
        // Threads) hold exactly one point per run by construction, so this is their normal
        // shape, not an edge case.
        mode: sorted.length === 1 ? 'lines+markers' : 'lines',
        ...(sorted.length === 1 ? { marker: { color, size: SIZE.line * 4 } } : {}),
        // The SAME name the series table shows. ChartActions turns the legend back on for
        // an exported PNG, so a second spelling here means the copied chart's legend
        // disagrees with the table beside it — including the double-titled
        // "All aggregated" case `rowName` exists to avoid.
        name: rowName(series),
        line: { color, width: SIZE.line, shape: 'linear' },
        yaxis: group.axis,
        connectgaps: true,
        hoverinfo: 'none',
      });
    });

    const overlay = analysisWindowShapes(startIndex, endIndex, sortedTimestamps.length, theme);

    let layout = buildPlotLayout(axisLayoutMode, {
      theme,
      groups,
      x: {
        tickvals: tickValues.map((i) => i + tickOffset),
        ticktext: tickLabels,
        // `clip.lo + 1`, never a bare `clip.hi`: a window on a one-sample run clips to a
        // single index, and a zero-width range is what the unclipped arm's `Math.max(…, 1)`
        // exists to avoid. The pad is on the AXIS only — widening the clip itself would pull
        // a neighbouring sample back into the view on a two-sample run.
        range: clip
          ? [clip.lo, Math.max(clip.hi, clip.lo + 1)]
          : [0, Math.max(sortedTimestamps.length - 1, 1)],
      },
      overlay,
      // A narrowed view scales y to what is on screen; the whole run stays pinned to zero.
      zeroBase: !(zoomed || clip !== null),
    });

    if (events && events.length > 0) {
      layout = mergeEventShapesIntoIndexedLayout(layout, events, sortedTimestamps, theme);
    }

    return {
      traces,
      layout,
      // Plotly's modebar floats over the plot and is styled by Plotly; the copy and
      // download actions live in the card header instead (ChartActions).
      config: { ...buildChartConfig(chartName), displayModeBar: false },
      sortedTimestamps,
      timestampToIndex,
      groupOf,
      groups,
      axisLayoutMode,
      startIndex,
      endIndex,
      traceIndexOf,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seriesConfig, seriesData, testRun, mode, axisMode, chartName, events, rangeOnly, hasWindow, zoomed]);

  /**
   * One row per configured series — hidden ones included, or a hidden series could never
   * be shown again, and its stats would vanish rather than grey out.
   */
  const rows: SeriesRow[] = useMemo(() => {
    return seriesConfig.map((series) => {
      const data = seriesData.get(series.id) ?? [];
      const group = plot?.groupOf.get(series.id);
      const display = group?.display ?? { label: unitText(series.yAxisFormat), divisor: 1 };

      // min/mean/max are the analysis window only: a mean that includes the ramp-up is
      // not the number ADAPT compared.
      const windowed = plot
        ? data.filter((d) => {
            const i = plot.timestampToIndex.get(d.time);
            if (i === undefined) return false;
            if (plot.startIndex !== null && i < plot.startIndex) return false;
            if (plot.endIndex !== null && i >= plot.endIndex) return false;
            return true;
          })
        : data;

      const cursorPoint =
        cursorIndex !== null && plot
          ? data.find((d) => plot.timestampToIndex.get(d.time) === cursorIndex)
          : undefined;

      return {
        id: series.id,
        name: rowName(series),
        source: series.source === 'performance-metrics' ? 'performance_test' : series.source,
        sourceLabel: series.dashboardLabel,
        color: catColor(series.colorSlot ?? seriesConfig.indexOf(series), mode),
        unit: series.yAxisFormat,
        panelUnit: series.panelYAxisFormat,
        displayUnit: display.label,
        hidden: series.hidden,
        axis: plot ? axisBadge(plot.groups, series.id) : EMPTY,
        stats: windowStats(windowed.map((d) => d.value), series.yAxisFormat, display),
        cursor: cursorPoint ? toDisplay(cursorPoint.value, series.yAxisFormat, display) : null,
      } satisfies SeriesRow;
    });
  }, [seriesConfig, seriesData, plot, cursorIndex, mode]);

  /**
   * A drag-zoom refetches the visible window at full resolution; a double-click widens back
   * to the whole run. The mapping from Plotly's index axis lives in `zoomRangeFromRelayout`.
   */
  const onRelayout = useCallback(
    (e: Readonly<Record<string, unknown>>) => {
      if (!onZoomRange || !plot) return;
      const range = zoomRangeFromRelayout(e, plot.sortedTimestamps, zoomed);
      if (range !== undefined) onZoomRange(range);
    },
    [onZoomRange, plot, zoomed],
  );

  const onHoverRow = useCallback(
    (seriesId: string | null) => {
      const gd = graphRef.current;
      if (!gd || !plot) return;
      const index = seriesId === null ? null : plot.traceIndexOf.get(seriesId) ?? null;
      dimOtherTraces(gd, plot.traces.length, index);
    },
    [plot],
  );

  const note = plot ? lanesNote(plot.groups, plot.axisLayoutMode) : undefined;

  const sources = new Set(seriesConfig.map((s) => s.dashboardLabel));
  const summary = `${seriesConfig.length} series · ${sources.size} ${sources.size === 1 ? 'source' : 'sources'}`;

  // `loading && plot` is a zoom or an add landing on a chart that is already drawn: keep it
  // rather than swapping it for a spinner. A drag-zoom has already redrawn the narrowed
  // range client-side, and unmounting it there reads as the chart breaking, not sharpening.
  // The busy state is the header's "updating…" instead — see the note beside it for why it
  // is not an opacity on this subtree.
  const body = loading && !plot ? (
    <ChartLoadingState />
  ) : seriesConfig.length === 0 ? (
    <ChartEmptyState variant="no-series" />
  ) : !plot ? (
    <ChartEmptyState variant="no-data" />
  ) : (
    <Plot
      data={plot.traces as unknown as Data[]}
      layout={plot.layout as unknown as Partial<Layout>}
      config={plot.config as unknown as Partial<Config>}
      style={{ width: '100%', height: `${(plot.layout.height as number) ?? SIZE.overlayHeight}px` }}
      onInitialized={(_fig, gd) => {
        graphRef.current = gd as unknown as HTMLElement;
        setGraphEl(gd as unknown as PlotlyGraphDiv);
      }}
      onUpdate={(_fig, gd) => { graphRef.current = gd as unknown as HTMLElement; }}
      onHover={(e) => setCursorIndex(Number(e.points?.[0]?.x ?? NaN))}
      onUnhover={() => setCursorIndex(null)}
      onRelayout={onRelayout}
    />
  );

  return (
    <AnalystChartCard
      mode={mode}
      title={titleNode ?? chartName ?? 'Untitled graph'}
      cursor={
        plot && cursorIndex !== null && plot.sortedTimestamps[cursorIndex]
          ? fmtClock(plot.sortedTimestamps[cursorIndex])
          : ''
      }
      axisMode={onAxisModeChange ? axisMode : undefined}
      onAxisModeChange={onAxisModeChange}
      viewToggle={
        hasWindow
          ? {
              label: 'analysis range only',
              active: rangeOnly,
              title:
                'Draw the analysis time range only, with a small margin so the start/end markers stay visible',
              onToggle: () => setRangeOnly((on) => !on),
            }
          : undefined
      }
      lanesNote={note}
      actions={
        <>
          {actions}
          {loading && plot && (
            // NOT a dim on the plot: `faint` and `muted` paint 9-11px text inside it, and
            // `lib/charts/tokens.ts` measures 0.45 at 3.36:1 — below the floor — which is
            // why `faint` was raised to 0.58. A layer opacity would put the axis labels
            // under it again, during exactly the refetch the reader is meant to read
            // through. The chart stays fully legible and the header says it is updating.
            // `role="status"` carries the implicit `aria-live="polite"`: the plot's own
            // `aria-busy` announces nothing on a container that is not a live region, so
            // without this the refetch is visible to sighted readers only.
            <Typography
              role="status"
              sx={{ fontFamily: MONO, fontSize: 10, color: theme.muted, flexShrink: 0 }}
            >
              updating…
            </Typography>
          )}
          {zoomed && onZoomRange && (
            <PillButton
              theme={theme}
              onClick={() => onZoomRange(null)}
              title="Draw the whole run again, at the whole run's resolution (double-clicking the plot does the same)"
              standalone
            >
              reset zoom
            </PillButton>
          )}
          <ChartActions
            graph={graphEl}
            mode={mode}
            chartName={chartName}
            notify={showToast}
          />
        </>
      }
      addSeries={
        cascadePanel
          ? {
              open: cascadeOpen,
              onToggle: () => setCascadeOpen((open) => !open),
              summary,
              panel: cascadePanel,
            }
          : undefined
      }
      table={
        <SeriesTable
          rows={rows}
          mode={mode}
          onUpdateUnit={onUpdateSeriesUnit}
          onToggleVisibility={onToggleSeriesVisibility}
          onRemove={onRemoveSeries}
          onHoverRow={onHoverRow}
        />
      }
    >
      <Box sx={{ width: '100%' }} aria-busy={loading || undefined}>
        {body}
      </Box>
    </AnalystChartCard>
  );
}
