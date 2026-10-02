/**
 * Plotly layout builders for the Analyst chart standard.
 *
 * What the layouts deliberately do NOT have:
 * - a Plotly legend. The legend is an HTML table now (`SeriesTable`), because a legend
 *   that also carries min/mean/max, the unit picker and a cursor readout cannot be drawn
 *   inside a canvas. `buildExportFigure` puts one back for the exported PNG only.
 * - hover labels. `hoverinfo: 'none'` on the traces plus a crosshair: the floating
 *   tooltip is replaced by the table's cursor column, which does not cover the data.
 * - axis titles. The unit is printed once, above its own axis.
 * - vertical gridlines, and any amber.
 */

import type { PerfanaEvent } from '@/lib/events';
import { MONO, SIZE, type ChartTheme } from './tokens';
import { niceStep, tickValues } from './format';
import { toDisplay, type AxisGroup, type AxisMode } from './units';

type Rec = Record<string, unknown>;

/** Shapes and the annotations that label them, so a caller merges both or neither. */
export interface Overlay {
  shapes: Rec[];
  annotations: Rec[];
}

export const EMPTY_OVERLAY: Overlay = { shapes: [], annotations: [] };

export const mergeOverlays = (...overlays: Overlay[]): Overlay => ({
  shapes: overlays.flatMap((o) => o.shapes),
  annotations: overlays.flatMap((o) => o.annotations),
});

/** How many ticks every y axis gets. Shared so the left and right sets line up. */
const TICK_COUNT = 4;

/** A group's largest and smallest plotted (display-unit) values. */
function groupExtent(group: AxisGroup): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const series of group.series) {
    if (typeof series.max === 'number' && Number.isFinite(series.max)) {
      max = Math.max(max, toDisplay(series.max, series.unit, group.display));
    }
    if (typeof series.min === 'number' && Number.isFinite(series.min)) {
      min = Math.min(min, toDisplay(series.min, series.unit, group.display));
    }
  }
  return { min, max };
}

/**
 * The y-axis config for one group.
 *
 * A group whose values are all ≥ 0 gets an explicit `[0, topTick]` range and explicit
 * `tickvals`: that is what makes the right-hand axis share the left one's gridlines
 * instead of interleaving its own. A group with negative values cannot be pinned to
 * zero, so it falls back to autorange and simply takes the same tick COUNT.
 */
function yAxis(group: AxisGroup, theme: ChartTheme, overlaying?: string): Rec {
  const { min, max } = groupExtent(group);
  const grid = overlaying === undefined;
  const base: Rec = {
    showgrid: grid,
    gridcolor: theme.grid,
    griddash: SIZE.gridDash,
    gridwidth: 1,
    showline: false,
    zeroline: true,
    zerolinecolor: theme.divider,
    zerolinewidth: 1,
    color: theme.muted,
    tickfont: { family: MONO, size: SIZE.tickFont, color: theme.faint },
    ticks: '',
    automargin: true,
    // The unit is an annotation above the axis; a Plotly title would re-add the
    // rotated "Time (ms)" label the standard removes.
    title: { text: '' },
  };

  if (min < 0) {
    return { ...base, autorange: true, nticks: TICK_COUNT + 1, ...(overlaying ? { overlaying, side: 'right' } : {}) };
  }

  const ticks = tickValues(max, TICK_COUNT);
  const top = ticks[ticks.length - 1] || niceStep(max || 1);
  return {
    ...base,
    range: [0, top],
    tickvals: ticks,
    ...(overlaying ? { overlaying, side: 'right' } : {}),
  };
}

/** The mono caption that names an axis' unit, once, at its top. */
function unitAnnotation(text: string, theme: ChartTheme, x: number, y: number, right: boolean): Rec {
  return {
    text,
    xref: 'paper',
    yref: 'paper',
    x,
    y,
    xanchor: right ? 'right' : 'left',
    yanchor: 'bottom',
    showarrow: false,
    font: { family: MONO, size: SIZE.axisLabelFont, color: theme.muted },
    // Plotly has no font-weight; 600 is approximated by the colour step up to `muted`.
    align: right ? 'right' : 'left',
  };
}

export interface XAxisSpec {
  /** Tick positions in the chart's own x space (sample index, or a category index). */
  tickvals?: number[];
  ticktext?: string[];
  /** Fixed range, for an index axis that must not float. */
  range?: [number, number];
  /** Shown under the axis when the x space is not wall-clock time. */
  type?: 'linear' | 'date' | 'category';
}

export interface LayoutSpec {
  theme: ChartTheme;
  groups: AxisGroup[];
  x?: XAxisSpec;
  /** Extra shapes/annotations: analysis window, events, SLO lines. */
  overlay?: Overlay;
  /** Overrides the standard height for a card that needs its own (Compare, Trends). */
  height?: number;
}

function xAxis(theme: ChartTheme, spec: XAxisSpec | undefined, anchor: string): Rec {
  return {
    ...(spec?.type ? { type: spec.type } : {}),
    ...(spec?.tickvals ? { tickvals: spec.tickvals } : {}),
    ...(spec?.ticktext ? { ticktext: spec.ticktext } : {}),
    ...(spec?.range ? { range: spec.range } : {}),
    anchor,
    // Vertical gridlines off: they fight the crosshair, which is the vertical line
    // that actually means something.
    showgrid: false,
    showline: false,
    zeroline: false,
    color: theme.muted,
    tickfont: { family: MONO, size: SIZE.tickFont, color: theme.faint },
    ticks: '',
    tickangle: 0,
    automargin: true,
    showspikes: true,
    spikemode: 'across',
    spikesnap: 'cursor',
    spikecolor: theme.faint,
    spikethickness: 1,
    spikedash: 'dot',
    title: { text: '' },
  };
}

function shell(spec: LayoutSpec, height: number): Rec {
  const overlay = spec.overlay ?? EMPTY_OVERLAY;
  return {
    paper_bgcolor: spec.theme.paper,
    plot_bgcolor: spec.theme.plotBg,
    font: { family: MONO, size: SIZE.tickFont, color: spec.theme.muted },
    showlegend: false,
    height,
    // `x` (not `x unified`): the readout is the series table, so Plotly only has to
    // report which x the cursor is on.
    hovermode: 'x',
    shapes: overlay.shapes,
    annotations: overlay.annotations,
  };
}

/** Overlay mode: one left axis, optionally one right axis. */
export function buildTimeSeriesLayout(spec: LayoutSpec): Rec {
  const { theme, groups } = spec;
  const height = spec.height ?? SIZE.overlayHeight;
  const layout = shell(spec, height);
  const right = groups.length > 1;

  layout.margin = { l: 46, r: right ? 46 : 16, t: 20, b: 24 };
  layout.xaxis = xAxis(theme, spec.x, 'y');
  layout.yaxis = yAxis(groups[0] ?? emptyGroup(), theme);
  if (right) layout.yaxis2 = yAxis(groups[1], theme, 'y');

  const labels: Rec[] = [];
  if (groups[0]?.display.label) {
    labels.push(unitAnnotation(groups[0].display.label, theme, 0, 1.02, false));
  }
  if (right && groups[1]?.display.label) {
    labels.push(unitAnnotation(groups[1].display.label, theme, 1, 1.02, true));
  }
  layout.annotations = [...(layout.annotations as Rec[]), ...labels];
  return layout;
}

/**
 * Lanes mode: one stacked subplot per unit family, sharing the x axis and the crosshair.
 *
 * Three or more families on two axes is unreadable — the third is drawn against a label
 * naming the second — so past two families the chart stops overlaying and starts stacking.
 */
export function buildLanesLayout(spec: LayoutSpec): Rec {
  const { theme, groups } = spec;
  const count = Math.max(groups.length, 1);
  const plotArea = count * SIZE.laneHeight + (count - 1) * SIZE.laneGap;
  const top = 20;
  const bottom = 24;
  const height = spec.height ?? plotArea + top + bottom;
  const layout = shell(spec, height);

  layout.margin = { l: 46, r: 16, t: top, b: bottom };

  const laneFraction = SIZE.laneHeight / plotArea;
  const gapFraction = SIZE.laneGap / plotArea;
  const labels: Rec[] = [];

  groups.forEach((group, index) => {
    // Lane 0 at the top: a reader scans the series table top-down and expects the lanes
    // to be in the same order.
    const domainTop = 1 - index * (laneFraction + gapFraction);
    const domain = [Math.max(domainTop - laneFraction, 0), domainTop];
    const axis = yAxis(group, theme);
    axis.domain = domain;
    axis.anchor = 'x';
    layout[index === 0 ? 'yaxis' : `yaxis${index + 1}`] = axis;

    const names = group.series.map((s) => (s as { name?: string }).name).filter(Boolean).join(', ');
    const label = group.display.label || 'no unit';
    labels.push(
      unitAnnotation(names ? `${label} · ${names}` : label, theme, 0, domainTop + 0.01, false),
    );
  });

  // The x axis is drawn once, under the bottom lane.
  layout.xaxis = xAxis(theme, spec.x, groups.length > 1 ? `y${groups.length}` : 'y');
  layout.annotations = [...(layout.annotations as Rec[]), ...labels];
  return layout;
}

/** Dispatch on the mode `resolveAxes` returned. */
export const buildPlotLayout = (mode: AxisMode, spec: LayoutSpec): Rec =>
  (mode === 'lanes' ? buildLanesLayout(spec) : buildTimeSeriesLayout(spec));

function emptyGroup(): AxisGroup {
  return { key: '', series: [], display: { label: '', divisor: 1 }, side: 'L', axis: 'y' };
}

/**
 * The excluded head and tail of the analysis window: a flat `excluded` wash, a hairline
 * boundary, and a mono `start` / `end` label so the band is named rather than guessed at.
 *
 * Indices are in sample-index space; `startIndex` is the first in-window sample and
 * `endIndex` the first excluded trailing one. The amber dashed boundary this replaces was
 * the same colour the SLO charts used for a data series.
 */
export function analysisWindowShapes(
  startIndex: number | null,
  endIndex: number | null,
  n: number,
  theme: ChartTheme,
): Overlay {
  return analysisWindowBands(
    {
      from: 0,
      start: startIndex !== null && startIndex > 0 ? startIndex : null,
      end: endIndex !== null && endIndex < n - 1 ? endIndex : null,
      to: n - 1,
    },
    theme,
  );
}

/** An x position in whatever space the chart uses: a sample index, or a wall-clock time. */
export type XValue = number | string | Date;

/**
 * The same window overlay for a chart whose x axis is NOT a sample index — the Compare
 * drawer chart plots real timestamps. `start`/`end` are the window's edges; `null` means
 * that edge is not trimmed.
 */
export function analysisWindowBands(
  bounds: { from: XValue; start?: XValue | null; end?: XValue | null; to: XValue },
  // Only the two tokens the overlay actually paints with, so a caller that has derived
  // colours rather than a whole theme can still draw the standard band.
  theme: Pick<ChartTheme, 'excluded' | 'faint'>,
): Overlay {
  const shapes: Rec[] = [];
  const annotations: Rec[] = [];

  const wash = (x0: XValue, x1: XValue): Rec => ({
    type: 'rect',
    x0,
    x1,
    y0: 0,
    y1: 1,
    yref: 'paper',
    line: { width: 0 },
    fillcolor: theme.excluded,
    layer: 'below',
  });
  const edge = (x: XValue, text: 'start' | 'end') => {
    shapes.push({
      type: 'line',
      x0: x,
      x1: x,
      y0: 0,
      y1: 1,
      yref: 'paper',
      line: { color: theme.faint, width: 1 },
      opacity: 0.5,
      layer: 'below',
    });
    annotations.push({
      x,
      y: 0,
      yref: 'paper',
      text,
      showarrow: false,
      xanchor: text === 'start' ? 'left' : 'right',
      yanchor: 'bottom',
      font: { family: MONO, size: SIZE.annotationFont, color: theme.faint },
    });
  };

  if (bounds.start !== null && bounds.start !== undefined) {
    shapes.push(wash(bounds.from, bounds.start));
    edge(bounds.start, 'start');
  }
  if (bounds.end !== null && bounds.end !== undefined) {
    shapes.push(wash(bounds.end, bounds.to));
    edge(bounds.end, 'end');
  }
  return { shapes, annotations };
}

/**
 * An SLO / threshold line. Red is reserved for exactly this and for breaches — it is the
 * only colour in the standard that carries a verdict.
 */
export function sloShape(value: number, theme: ChartTheme, label = 'SLO'): Overlay {
  return {
    shapes: [
      {
        type: 'line',
        x0: 0,
        x1: 1,
        xref: 'paper',
        y0: value,
        y1: value,
        line: { color: theme.error, width: 1, dash: 'dash' },
        layer: 'above',
      },
    ],
    annotations: [
      {
        x: 1,
        xref: 'paper',
        y: value,
        text: label,
        showarrow: false,
        xanchor: 'right',
        yanchor: 'bottom',
        font: { family: MONO, size: SIZE.annotationFont, color: theme.error },
      },
    ],
  };
}

const isAlert = (event: PerfanaEvent): boolean => !!event.source && event.source !== 'manual';

/**
 * Event markers in the Analyst style: a hairline in `muted`, labelled in mono with a
 * halo in the plot background so the text stays legible over a dense line.
 *
 * `x` is whatever the chart's x space is — `event-lines.ts` maps timestamps to sample
 * indices before calling this.
 */
export function eventShapes(
  events: Array<{ event: PerfanaEvent; x: number }>,
  theme: ChartTheme,
): Overlay {
  const shapes: Rec[] = [];
  const annotations: Rec[] = [];

  for (const { event, x } of events) {
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: x,
      x1: x,
      y0: 0,
      y1: 1,
      line: { color: isAlert(event) ? theme.error : theme.muted, width: 1 },
      opacity: 0.55,
      layer: 'below',
    });
    annotations.push({
      x,
      y: 1,
      xref: 'x',
      yref: 'paper',
      text: event.title,
      showarrow: false,
      xanchor: 'left',
      yanchor: 'bottom',
      font: {
        family: MONO,
        size: SIZE.annotationFont,
        color: isAlert(event) ? theme.error : theme.muted,
      },
      bgcolor: theme.plotBg,
      borderpad: 2,
    });
  }
  return { shapes, annotations };
}
