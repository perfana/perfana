'use client';

import type { PlotTrace } from './types/chart.types';
import type { Config, Data, Layout } from 'plotly.js';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, useTheme } from '@mui/material';

import { GraphsChartProps, SeriesConfig } from './types';
import {
  buildTimestampMapping,
  calculateXAxisTicks,
  calculateAnalysisWindowIndices,
  buildChartConfig,
} from './utils';
import { ChartLoadingState, ChartEmptyState } from './components';
import { mergeEventShapesIntoIndexedLayout } from '../shared/event-lines';
import { ALL_AGGREGATED_OPTION } from '@/lib/aggregated-perf-series';

import Plot from '@/components/ResponsivePlot';
import { AnalystChartCard, ChartActions, SeriesTable, type SeriesRow } from '@/components/charts';
import {
  EMPTY,
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
}: GraphsChartProps) {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode === 'dark' ? 'dark' : 'light';
  const theme = chartTheme(mode);

  const [cascadeOpen, setCascadeOpen] = useState(false);
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

  /**
   * `panelTitle · metricName`, except for the run-wide aggregate: its stored metric name
   * already composes in the panel title ("All aggregated — Transaction RT Avg"), so the
   * pair would read the title twice.
   */
  const rowName = (series: SeriesConfig) =>
    (series.metricName.startsWith(ALL_AGGREGATED_OPTION)
      ? series.metricName
      : `${series.panelTitle} · ${series.metricName}`);

  const plot = useMemo(() => {
    if (visible.length === 0 || seriesData.size === 0) return null;

    const { sortedTimestamps, timestampToIndex } = buildTimestampMapping(visible, seriesData);
    if (sortedTimestamps.length === 0) return null;

    const { tickValues, tickLabels } = calculateXAxisTicks(sortedTimestamps);
    const { startIndex, endIndex } = calculateAnalysisWindowIndices(testRun, sortedTimestamps);

    // The axis scale is chosen from the WHOLE series; the table's stats are the analysis
    // window only. A line is drawn outside the window too, so an axis sized to the window
    // would clip the ramp-up.
    const axisSeries = visible.map((series) => {
      const data = seriesData.get(series.id) ?? [];
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

      const sorted = [...data].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const color = catColor(series.colorSlot ?? seriesConfig.indexOf(series), mode);

      traceIndexOf.set(series.id, traces.length);
      traces.push({
        x: sorted.map((d) => timestampToIndex.get(d.time) as number),
        y: sorted.map((d) => toDisplay(d.value, series.yAxisFormat, group.display)),
        type: 'scatter',
        mode: 'lines',
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
        tickvals: tickValues,
        ticktext: tickLabels,
        range: [0, Math.max(sortedTimestamps.length - 1, 1)],
      },
      overlay,
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
  }, [visible, seriesConfig, seriesData, testRun, mode, axisMode, chartName, events]);

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

  const body = loading ? (
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
      lanesNote={note}
      actions={
        <>
          {actions}
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
      <Box sx={{ width: '100%' }}>{body}</Box>
    </AnalystChartCard>
  );
}
