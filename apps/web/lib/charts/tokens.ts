/**
 * Chart design tokens — the "Analyst" chart standard.
 *
 * One palette, one theme, one set of sizes for every chart in the app. Nothing outside
 * `lib/charts` should define a chart colour.
 *
 * Migrated so far: Graphs, Compare, Trends, the transaction graph modal, the errors
 * chart. That removed three palettes (`CHART_COLOR_PALETTE`, `SERIES_COLORS`,
 * `--color-metric-*`) and three copies of the dark-mode paper/plot colours. Still
 * outstanding, and tracked in TODOS.md: the SLO and anomaly-detection charts, which keep
 * `METRIC_COLOR_PALETTE` and their own `#121212`/`#1e1e1e` surfaces in
 * `service-level-objectives/utils/slo-chart-utils.ts`.
 *
 * Colours are assigned BY SLOT, not by index — see `catColor`. Removing a series frees
 * its slot, so the remaining lines keep the colour the user has been reading.
 */

import { SOURCE_DISPLAY } from '@/lib/metrics-source-utils';

export type ChartMode = 'light' | 'dark';

/** Categorical series colours. Index = colour slot. */
export const CAT = {
  light: ['#2563eb', '#0d9488', '#c026d3', '#ea580c', '#7c3aed', '#65a30d', '#db2777', '#0891b2'],
  dark: ['#60a5fa', '#2dd4bf', '#e879f9', '#fb923c', '#a78bfa', '#a3e635', '#f472b6', '#22d3ee'],
} as const;

export interface ChartTheme {
  paper: string;
  plotBg: string;
  text: string;
  muted: string;
  faint: string;
  divider: string;
  grid: string;
  excluded: string;
  primary: string;
  baseline: string;
  error: string;
  success: string;
  hover: string;
  selectedBg: string;
  selectedBorder: string;
}

const DARK: ChartTheme = {
  paper: '#1e293b',
  plotBg: '#172033',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.7)',
  faint: 'rgba(255,255,255,0.5)',
  divider: 'rgba(255,255,255,0.12)',
  grid: 'rgba(255,255,255,0.07)',
  excluded: 'rgba(255,255,255,0.035)',
  primary: '#60a5fa',
  baseline: '#94a3b8',
  error: '#f87171',
  success: '#4ade80',
  hover: 'rgba(255,255,255,0.06)',
  selectedBg: 'rgba(96,165,250,0.14)',
  selectedBorder: 'rgba(96,165,250,0.45)',
};

const LIGHT: ChartTheme = {
  paper: '#ffffff',
  plotBg: '#f8fafc',
  text: 'rgba(0,0,0,0.87)',
  muted: 'rgba(0,0,0,0.6)',
  // 0.58, not 0.45. `faint` paints ~28 sites of 9-11px text — the series table's column
  // headers and its unit/axis columns, the axis ticks, the window's start/end labels, the
  // cascade's group headings, the inactive half of the overlay/split toggle. At 0.45 it
  // resolves to #8c8c8c: 3.36:1 on `paper` and 3.17:1 on `plotBg`, under the 4.5:1 floor
  // for text below 18.66px. 0.58 is ~5.6:1 and still clearly below `muted`. The dark
  // value needs no change (~5.1:1).
  faint: 'rgba(0,0,0,0.58)',
  divider: 'rgba(0,0,0,0.12)',
  grid: 'rgba(15,23,42,0.07)',
  excluded: 'rgba(15,23,42,0.04)',
  primary: '#2563eb',
  baseline: '#94a3b8',
  error: '#dc2626',
  success: '#16a34a',
  hover: 'rgba(0,0,0,0.04)',
  selectedBg: 'rgba(37,99,235,0.08)',
  selectedBorder: 'rgba(37,99,235,0.35)',
};

export const chartTheme = (mode: ChartMode): ChartTheme => (mode === 'dark' ? DARK : LIGHT);

/** The source dot colours, reused as-is so a chart and a picker agree on "Dynatrace purple". */
export const SOURCE_COLOR = SOURCE_DISPLAY;

/**
 * `--font-mono` from styles/tokens.css. Numbers, ticks, the legend table and the unit
 * chips all use it: a proportional font makes a column of digits ripple.
 */
export const MONO = "'JetBrains Mono', 'Fira Code', Monaco, 'Cascadia Code', 'Roboto Mono', monospace";

/** Titles and prose. Matches `theme.typography.fontFamily`. */
export const SANS = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** The colour of a slot. Wraps once the palette is exhausted. */
export function catColor(slot: number, mode: ChartMode): string {
  const palette = CAT[mode];
  // A negative or non-integer slot would index past the end and return undefined,
  // which Plotly draws as its own default blue — silently off-palette.
  const i = Number.isFinite(slot) ? Math.abs(Math.trunc(slot)) : 0;
  return palette[i % palette.length];
}

/**
 * The lowest colour slot not already taken. Removing a series frees its slot, so the
 * lines that stay keep their colours and the next series added reuses the gap.
 */
export function nextFreeSlot(taken: Iterable<number | undefined>): number {
  const used = new Set<number>();
  for (const slot of taken) {
    if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 0) used.add(slot);
  }
  let slot = 0;
  while (used.has(slot)) slot += 1;
  return slot;
}

/** Sizes the whole standard shares, so two cards cannot drift apart by a pixel. */
export const SIZE = {
  /** Time-series line width. No markers on a time series. */
  line: 1.25,
  /** Trends is a run-over-run series: thicker line, and markers, because runs are discrete. */
  trendsLine: 1.5,
  trendsMarker: 2.5,
  /** Baseline is dashed so it reads as "the other run" even in a greyscale print. */
  baselineDash: '4 3',
  gridDash: '2 3',
  /** Plot heights per card. Overlay is one box; split mode is `lane` per unit family. */
  overlayHeight: 300,
  laneHeight: 140,
  laneGap: 30,
  /**
   * Compare and Trends read as full charts, not sparklines, so both match the Graphs
   * overlay. They stay separate knobs: Compare draws one of these per expanded table row
   * and several can be open at once, so it is the one most likely to want its own value
   * back.
   */
  compareHeight: 300,
  trendsHeight: 300,
  /** Type scale. Everything numeric is mono. */
  tickFont: 10,
  axisLabelFont: 10,
  tableFont: 10,
  valueFont: 11,
  titleFont: 13,
  annotationFont: 9,
  /** Card chrome. */
  radius: 8,
} as const;
