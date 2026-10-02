'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, Typography, useTheme } from '@mui/material';
import type { Config, Data, Layout } from 'plotly.js';
import Plot from '@/components/ResponsivePlot';
import { GraphData, Panel, RelatedTestRun } from '../types/compare.types';
import { TestRun } from '@/types/test-runs';
import { PlotlyGraphDiv, copyPlotToClipboard, dimOtherTraces, plotlyPngBlob, plotSize } from '@/lib/plotly';
import { AnalystChartCard, SeriesTable, UnitPicker, type SeriesRow } from '@/components/charts';
import {
  MONO,
  SIZE,
  analysisWindowShapes,
  buildTimeSeriesLayout,
  chartTheme,
  resolveAxes,
  toDisplay,
  unitText,
  windowStats,
} from '@/lib/charts';

interface ComparisonPlotProps {
  metricName: string;
  graphData: GraphData | undefined;
  graphLoading: boolean;
  selectedMetric: Panel | null;
  /** The compared row's own unit. Falls back to the cascade's primary panel. */
  panelUnit?: string;
  testRun: TestRun | null;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
}

type Sample = { time: string; value: number; ramp_up?: boolean };

/**
 * The analysis window in sample-index space: `[start, end)` are the in-window samples.
 *
 * The `StatisticsPipeline` bakes `ramp_up = true` onto BOTH the leading start-offset and
 * the trailing end-offset samples — the exact flag the statistics aggregate on — so that
 * is preferred; the offsets are only a fallback for data that carries no flag.
 */
function analysisWindow(samples: Sample[], testRun: TestRun | null): {
  startIndex: number | null;
  endIndex: number | null;
} {
  const n = samples.length;
  if (n === 0) return { startIndex: null, endIndex: null };

  if (samples.some((d) => typeof d.ramp_up === 'boolean')) {
    const first = samples.findIndex((d) => d.ramp_up === false);
    if (first !== -1) {
      let last = first;
      for (let i = n - 1; i >= first; i -= 1) {
        if (samples[i].ramp_up === false) { last = i; break; }
      }
      return { startIndex: first, endIndex: last + 1 };
    }
    return { startIndex: null, endIndex: null };
  }

  if (n < 2 || !testRun?.start_time) return { startIndex: null, endIndex: null };
  const bucketSeconds =
    (new Date(samples[1].time).getTime() - new Date(samples[0].time).getTime()) / 1000;
  if (bucketSeconds <= 0) return { startIndex: null, endIndex: null };

  return {
    startIndex: testRun.analysis_start_offset
      ? Math.min(Math.floor(testRun.analysis_start_offset / bucketSeconds), n - 1)
      : null,
    endIndex: testRun.analysis_end_offset
      ? Math.max(0, n - Math.floor(testRun.analysis_end_offset / bucketSeconds))
      : null,
  };
}

const COPY_ICON = {
  width: 1792,
  height: 1792,
  path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
  transform: 'scale(0.8)',
};

/**
 * Baseline vs current for one metric.
 *
 * **The x axis stays the sample index on purpose.** The two runs happened at different
 * wall-clock times; overlaying them by sample index is what makes them comparable at all,
 * and a time axis would draw them as two disjoint lines with a gap between.
 *
 * `buildAnalysisWindowShapes` and the four-branch unit conversion that used to live in
 * this file are `@/lib/charts` now — the same code the Graphs and Trends cards run.
 */
export default function ComparisonPlot({
  metricName,
  graphData,
  graphLoading,
  selectedMetric,
  panelUnit,
  testRun,
  showToast,
}: ComparisonPlotProps) {
  const mode = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const theme = chartTheme(mode);

  const storedUnit = panelUnit ?? selectedMetric?.yAxesFormat;
  // One unit for the whole panel: baseline and current are the same metric, so a per-row
  // override would let them be drawn against two different scales.
  const [unitOverride, setUnitOverride] = useState<string | undefined>(undefined);
  const unit = unitOverride ?? storedUnit;
  const [pickerEl, setPickerEl] = useState<HTMLElement | null>(null);
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const graphRef = useRef<HTMLElement | null>(null);

  const plot = useMemo(() => {
    if (!graphData) return null;

    const byTime = (a: { time: string }, b: { time: string }) =>
      new Date(a.time).getTime() - new Date(b.time).getTime();
    const baseline = [...graphData.baselineMetrics].sort(byTime) as Sample[];
    const current = [...graphData.currentMetrics].sort(byTime) as Sample[];

    const all = [...baseline, ...current].map((d) => d.value).filter((v) => Number.isFinite(v));
    const axisInput = [
      {
        id: 'panel',
        unit,
        max: all.length ? Math.max(...all) : undefined,
        min: all.length ? Math.min(...all) : undefined,
      },
    ];
    const { groups } = resolveAxes(axisInput);
    const display = groups[0]?.display ?? { label: unitText(unit), divisor: 1 };

    // The window is read off the CURRENT run; the baseline is overlaid on the same
    // sample-index axis, so drawing its own window too would say the current run's
    // ramp-up belongs to both.
    const { startIndex, endIndex } = analysisWindow(current, testRun);

    const line = (samples: Sample[], name: string, isBaseline: boolean) => ({
      x: samples.map((_, index) => index),
      y: samples.map((d) => toDisplay(d.value, unit, display)),
      type: 'scatter' as const,
      mode: 'lines' as const,
      name,
      line: {
        color: isBaseline ? theme.baseline : theme.primary,
        width: SIZE.line,
        shape: 'linear' as const,
        ...(isBaseline ? { dash: SIZE.baselineDash } : {}),
      },
      connectgaps: true,
      hoverinfo: 'none' as const,
    });

    const traces = [
      line(baseline, `Baseline (${graphData.baselineTestRunId})`, true),
      line(current, `Current (${graphData.currentTestRunId})`, false),
    ];

    const layout = buildTimeSeriesLayout({
      theme,
      groups,
      x: { range: [0, Math.max(current.length, baseline.length, 2) - 1] },
      overlay: analysisWindowShapes(startIndex, endIndex, current.length, theme),
      height: SIZE.compareHeight,
    });

    const windowed = (samples: Sample[]) =>
      samples
        .filter((_, i) => (startIndex === null || i >= startIndex) && (endIndex === null || i < endIndex))
        .map((d) => d.value);

    const rows: SeriesRow[] = [
      {
        id: 'baseline',
        name: `Baseline · ${graphData.baselineTestRunId}`,
        color: theme.baseline,
        dashed: true,
        unit,
        displayUnit: display.label,
        axis: 'L',
        stats: windowStats(windowed(baseline), unit, display),
        cursor:
          cursorIndex !== null && baseline[cursorIndex]
            ? toDisplay(baseline[cursorIndex].value, unit, display)
            : null,
      },
      {
        id: 'current',
        name: `Current · ${graphData.currentTestRunId}`,
        color: theme.primary,
        unit,
        displayUnit: display.label,
        axis: 'L',
        stats: windowStats(windowed(current), unit, display),
        cursor:
          cursorIndex !== null && current[cursorIndex]
            ? toDisplay(current[cursorIndex].value, unit, display)
            : null,
      },
    ];

    const config = {
      displayModeBar: true,
      modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
      displaylogo: false,
      responsive: true,
      toImageButtonOptions: {
        format: 'png',
        filename: `${metricName}_comparison`,
        height: SIZE.compareHeight,
        width: 1200,
        scale: 2,
      },
      modeBarButtonsToAdd: [
        {
          name: 'Copy to Clipboard',
          icon: COPY_ICON,
          click: function (gd: PlotlyGraphDiv) {
            copyPlotToClipboard(
              () => plotlyPngBlob(gd, plotSize(gd, { width: 800, height: SIZE.compareHeight })),
              { fallbackFilename: `${metricName}_comparison.png`, notify: showToast },
            );
          },
        },
      ],
    };

    return { traces, layout, config, rows, display };
  }, [graphData, unit, testRun, theme, metricName, showToast, cursorIndex]);

  const onHoverRow = useCallback((seriesId: string | null) => {
    dimOtherTraces(graphRef.current, 2, seriesId === 'baseline' ? 0 : seriesId === 'current' ? 1 : null);
  }, []);

  if (graphLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, py: 4 }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          Loading graph data...
        </Typography>
      </Box>
    );
  }

  if (!plot) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No graph data available
        </Typography>
      </Box>
    );
  }

  const chipLabel = `${unitText(unit) || 'none'}${
    plot.display.label && plot.display.label !== unitText(unit) ? ` →${plot.display.label}` : ''
  }`;

  return (
    <>
      <AnalystChartCard
        mode={mode}
        title={metricName}
        subtitle="sample"
        cursor={cursorIndex !== null ? `sample ${cursorIndex}` : ''}
        footerNote="Applies to baseline and current"
        headerExtra={
          <Box
            component="button"
            type="button"
            aria-label={`Panel unit for ${metricName}`}
            onClick={(e) => setPickerEl(e.currentTarget)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.4,
              height: 18,
              px: 0.5,
              flexShrink: 0,
              border: `1px solid ${theme.divider}`,
              borderRadius: '4px',
              bgcolor: 'transparent',
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 10,
              color: theme.muted,
              '&:hover': { bgcolor: theme.hover },
            }}
          >
            {unitOverride && (
              <Box
                aria-hidden="true"
                sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: theme.primary }}
              />
            )}
            {chipLabel} ▾
          </Box>
        }
        table={<SeriesTable rows={plot.rows} mode={mode} onHoverRow={onHoverRow} />}
      >
        <Plot
          data={plot.traces as unknown as Data[]}
          layout={plot.layout as unknown as Partial<Layout>}
          config={plot.config as unknown as Partial<Config>}
          style={{ width: '100%', height: `${SIZE.compareHeight}px` }}
          onInitialized={(_fig, gd) => { graphRef.current = gd as unknown as HTMLElement; }}
          onUpdate={(_fig, gd) => { graphRef.current = gd as unknown as HTMLElement; }}
          onHover={(e) => setCursorIndex(Number(e.points?.[0]?.x ?? NaN))}
          onUnhover={() => setCursorIndex(null)}
        />
      </AnalystChartCard>

      <UnitPicker
        open={!!pickerEl}
        anchorEl={pickerEl}
        onClose={() => setPickerEl(null)}
        mode={mode}
        title={`Panel unit · ${metricName}`}
        value={unit}
        panelUnit={storedUnit}
        panelSource={selectedMetric?.title}
        onSelect={(unitId) => setUnitOverride(unitId === storedUnit ? undefined : unitId)}
      />
    </>
  );
}
