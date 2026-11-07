'use client';

import type { Config, Data, Layout } from 'plotly.js';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Typography, CircularProgress, Button, useTheme } from '@mui/material';
import Plot from '@/components/ResponsivePlot';
import { RunMeta, TrendsSeries } from '../types';
import { AnalystChartCard, ChartActions, SeriesTable, type SeriesRow } from '@/components/charts';
import { SIZE, chartTheme } from '@/lib/charts';
import { dimOtherTraces, type PlotlyGraphDiv } from '@/lib/plotly';

interface TrendsChartProps {
  addedSeries: TrendsSeries[];
  metricsLoading: boolean;
  plotData: unknown[];
  plotLayout: unknown;
  plotConfig: unknown;
  /** Rows built by `useTrendsPlot`, which knows the per-run stats. */
  rows: SeriesRow[];
  /** Run ids in x order, so hovering position n can name the run. */
  runIds: string[];
  traceIndexOf: Map<string, number>;
  /** Release and annotations per run, for the cursor readout. Absent for a run with neither. */
  runMeta?: Map<string, RunMeta>;
  onCursorChange: (index: number | null) => void;
  cursorIndex: number | null;
  onRemoveSeries: (seriesId: string) => void;
  onClearAllSeries: () => void;
  onUpdateSeriesUnit: (seriesId: string, newUnit: string) => void;
  onToggleSeriesVisibility: (seriesId: string) => void;
  /** The cascade, opened from `+ add series`. */
  cascade?: (close: () => void) => React.ReactNode;
  title?: string;
  /** Set when three or more unit families forced the chart into lanes. */
  lanesNote?: string;
  /** Says when a copy fell back to a download, or could not render. */
  showToast?: (message: string) => void;
}

/** Placeholder that keeps the chart's footprint while there is nothing to draw. */
function ChartPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      height: SIZE.trendsHeight,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      textAlign: 'center',
      px: 2,
    }}>
      {children}
    </Box>
  );
}

export function TrendsChart({
  addedSeries,
  metricsLoading,
  plotData,
  plotLayout,
  plotConfig,
  rows,
  runIds,
  traceIndexOf,
  runMeta,
  onCursorChange,
  cursorIndex,
  onRemoveSeries,
  onClearAllSeries,
  onUpdateSeriesUnit,
  onToggleSeriesVisibility,
  cascade,
  title = 'Trends',
  lanesNote,
  showToast,
}: TrendsChartProps) {
  const mode = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const theme = chartTheme(mode);
  const [cascadeOpen, setCascadeOpen] = useState(false);
  const graphRef = useRef<HTMLElement | null>(null);
  // The actions live in the header, outside the plot, so they need a re-render when the
  // graph div appears: a ref alone would leave them permanently disabled.
  const [graphEl, setGraphEl] = useState<PlotlyGraphDiv | null>(null);
  // Built once, not per render — the card keeps this panel MOUNTED while the picker is
  // closed (the card-link walk needs it), and the cursor state in TrendsCard re-renders this
  // component on every Plotly hover. An element rebuilt inline would re-render the whole
  // dashboard list on each pointer move.
  const closeCascade = useCallback(() => setCascadeOpen(false), []);
  const cascadePanel = useMemo(() => cascade?.(closeCascade), [cascade, closeCascade]);

  // The run id, plus its release and annotations when it has them: the Analyst standard
  // has no floating tooltip, so the header readout is where a hover answers "which run".
  const cursorRun = cursorIndex !== null ? runIds[cursorIndex] ?? '' : '';
  const cursorMeta = cursorRun ? runMeta?.get(cursorRun) : undefined;
  const cursorText = [cursorRun, cursorMeta?.version, cursorMeta?.annotations]
    .filter(Boolean)
    .join(' · ');

  const onHoverRow = useCallback(
    (seriesId: string | null) => {
      const index = seriesId === null ? null : traceIndexOf.get(seriesId) ?? null;
      dimOtherTraces(graphRef.current, plotData.length, index);
    },
    [plotData.length, traceIndexOf],
  );

  const body = addedSeries.length === 0 ? (
    <ChartPlaceholder>
      <Typography variant="body2" color="text.secondary">
        Pick dashboards, panels and series from “add series”, then add them to plot a trend.
      </Typography>
    </ChartPlaceholder>
  ) : metricsLoading ? (
    <ChartPlaceholder>
      <CircularProgress size={18} />
      <Typography variant="body2" color="text.secondary">
        Loading trends data…
      </Typography>
    </ChartPlaceholder>
  ) : plotData.length === 0 ? (
    <ChartPlaceholder>
      <Typography variant="body2" color="text.secondary">
        No data for these series in the selected time range. Widen the range, or remove a
        series below.
      </Typography>
    </ChartPlaceholder>
  ) : (
    <Plot
      data={plotData as Data[]}
      layout={plotLayout as Partial<Layout>}
      config={plotConfig as Partial<Config>}
      useResizeHandler
      style={{
        width: '100%',
        height: `${((plotLayout as { height?: number }).height ?? SIZE.trendsHeight)}px`,
      }}
      onInitialized={(_fig, gd) => {
        graphRef.current = gd as unknown as HTMLElement;
        setGraphEl(gd as unknown as PlotlyGraphDiv);
      }}
      onUpdate={(_fig, gd) => { graphRef.current = gd as unknown as HTMLElement; }}
      // The plot unmounts when the chart empties or reloads, and a purged div exports blank.
      onPurge={() => setGraphEl(null)}
      onHover={(e) => onCursorChange(Number(e.points?.[0]?.x ?? NaN))}
      onUnhover={() => onCursorChange(null)}
      onClick={(e) => {
        const runId = runIds[Number(e.points?.[0]?.x ?? NaN)];
        if (runId) window.open(`/test-runs/${encodeURIComponent(runId)}`, '_blank', 'noopener,noreferrer');
      }}
    />
  );

  return (
    <AnalystChartCard
      mode={mode}
      title={title}
      subtitle={`${runIds.length} ${runIds.length === 1 ? 'run' : 'runs'}`}
      cursor={cursorText}
      lanesNote={lanesNote}
      actions={
        <>
          <Button
            size="small"
            onClick={onClearAllSeries}
            sx={{ textTransform: 'none', fontSize: 11, color: theme.faint, '&:hover': { color: theme.error } }}
          >
            Remove all
          </Button>
          <ChartActions graph={graphEl} mode={mode} chartName={title} notify={showToast} />
        </>
      }
      addSeries={
        cascadePanel
          ? {
              open: cascadeOpen,
              onToggle: () => setCascadeOpen((open) => !open),
              summary: `${addedSeries.length} series`,
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
