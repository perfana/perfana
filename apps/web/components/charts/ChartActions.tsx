'use client';

/**
 * Copy-to-clipboard and download, as card chrome rather than Plotly modebar buttons.
 *
 * Plotly's modebar floats over the top-right of the plot area, appears on hover, and is
 * styled by Plotly — three reasons it never matched the card. These sit in the card
 * header's actions slot beside the axis toggle, always visible, and borrow that toggle's
 * geometry (20px, `faint` resting, `theme.hover` on hover) so the header reads as one
 * control strip.
 *
 * The copy path goes through `copyPlotToClipboard`, which exists because the CSP blocks
 * `fetch()` on a `data:` URL — see "Never `fetch()` a `data:` URL" in apps/web/CLAUDE.md.
 * Do not call `Plotly.toImage(...).then(fetch)` here.
 */

import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { ContentCopy, FileDownloadOutlined } from '@mui/icons-material';
import {
  copyPlotToClipboard,
  downloadPng,
  plotlyPngBlob,
  plotSize,
  type PlotlyGraphDiv,
} from '@/lib/plotly';
import { chartTheme, type ChartMode } from '@/lib/charts';

export interface ChartActionsProps {
  /** The live Plotly graph div. Null until the first render completes. */
  graph: PlotlyGraphDiv | null;
  mode: ChartMode;
  /** Used for the export title and the download filename. */
  chartName?: string;
  /** Toast host. Without it a download would appear with nothing to explain it. */
  notify?: (message: string) => void;
}

/** `My chart` -> `my_chart.png`. */
function exportFilename(chartName: string | undefined): string {
  const base = chartName?.trim() ? chartName.trim().toLowerCase().replace(/\s+/g, '_') : 'chart';
  return `${base}.png`;
}

/**
 * Plotly renders an export from the LIVE layout, which deliberately carries neither a
 * title nor a legend — the editable heading above the chart is the title, and the
 * `SeriesTable` below it is the legend (`lib/charts/layout.ts` sets `showlegend: false`).
 * Both are HTML, so neither is on the canvas Plotly rasterises: without this the copied
 * PNG is an unlabelled chart with unnamed lines.
 *
 * Both go back on for the image only. `toImage` accepts a figure object as well as a
 * graph div, so this never touches what is on screen.
 */
function exportFigure(
  graph: PlotlyGraphDiv,
  chartName: string | undefined,
  theme: { text: string; muted: string; paper: string },
  size: { width: number; height: number },
) {
  const g = graph as unknown as { data?: unknown[]; layout?: Record<string, unknown> };
  const layout = g.layout ?? {};
  const margin = (layout.margin ?? {}) as { b?: number };

  // The traces already carry `name` — only `showlegend` was off. Room has to be ADDED
  // rather than taken from the plot area, or a chart with many series squeezes to a
  // sliver. Names here are `panel - metric`, so roughly three fit per row at 1200px.
  const seriesCount = (g.data ?? []).length;
  const legendRows = Math.max(1, Math.ceil(seriesCount / 3));
  const legendPad = legendRows * 18 + 12;
  const titlePad = 24;

  return {
    figure: {
      data: g.data ?? [],
      layout: {
        ...layout,
        height: size.height + legendPad + titlePad,
        title: {
          text: chartName?.trim() || 'Chart',
          font: { color: theme.text, size: 13 },
          x: 0.5,
          xanchor: 'center',
        },
        showlegend: true,
        legend: {
          orientation: 'h',
          xanchor: 'left',
          x: 0,
          yanchor: 'top',
          y: -0.08,
          font: { size: 10, color: theme.muted },
          bgcolor: 'rgba(0,0,0,0)',
          borderwidth: 0,
        },
        // The live layout reserves room for neither.
        margin: { ...margin, t: 44, b: (margin.b ?? 24) + legendPad },
      },
    },
    size: { width: size.width, height: size.height + legendPad + titlePad },
  };
}

export default function ChartActions({ graph, mode, chartName, notify }: ChartActionsProps) {
  const theme = chartTheme(mode);

  const render = () => {
    if (!graph) return Promise.reject(new Error('Chart is not ready yet'));
    const { figure, size } = exportFigure(
      graph,
      chartName,
      theme,
      plotSize(graph, { width: 1200, height: 600 }),
    );
    return plotlyPngBlob(figure, size);
  };

  const onCopy = () => {
    copyPlotToClipboard(render, { fallbackFilename: exportFilename(chartName), notify });
  };

  const onDownload = () => {
    render()
      .then((png) => downloadPng(png, exportFilename(chartName)))
      .catch((err) => {
        console.warn('[chart-export] download failed', err);
        notify?.('Could not download the chart');
      });
  };

  const button = {
    border: 0,
    p: 0,
    width: 22,
    height: 20,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    cursor: graph ? 'pointer' : 'not-allowed',
    bgcolor: 'transparent',
    color: theme.faint,
    transition: 'color 120ms, background-color 120ms',
    '&:hover': { color: theme.text, bgcolor: theme.hover },
    '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
  } as const;

  return (
    <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
      <Tooltip title="Copy chart to clipboard" arrow>
        {/* span: MUI Tooltip needs a focusable child, and a disabled button is not one. */}
        <span>
          <Box component="button" type="button" aria-label="Copy chart to clipboard"
               disabled={!graph} onClick={onCopy} sx={button}>
            <ContentCopy sx={{ fontSize: 13 }} />
          </Box>
        </span>
      </Tooltip>
      <Tooltip title="Download chart as PNG" arrow>
        <span>
          <Box component="button" type="button" aria-label="Download chart as PNG"
               disabled={!graph} onClick={onDownload} sx={button}>
            <FileDownloadOutlined sx={{ fontSize: 14 }} />
          </Box>
        </span>
      </Tooltip>
    </Box>
  );
}
