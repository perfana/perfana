/**
 * The Analyst standard's Plotly layouts.
 *
 * `layout.ts` is where the standard's *negative* decisions live — no Plotly legend, no
 * hover label, no axis title, no vertical gridline, no amber — and a negative decision is
 * exactly the kind a well-meaning edit puts back without noticing. Each `expect(...)
 * .toBe(false)` below is one of those.
 *
 * The one positive behaviour worth as much: a right-hand axis gets the LEFT axis' tick
 * COUNT and an explicit `[0, topTick]` range, which is what makes two scales share one set
 * of gridlines instead of interleaving two sets into visual noise. A group that dips
 * negative cannot be pinned to zero, so it falls back to autorange and keeps only the
 * count — that fallback is the branch to hold.
 */
import {
  EMPTY_OVERLAY,
  analysisWindowBands,
  analysisWindowShapes,
  buildLanesLayout,
  buildPlotLayout,
  buildTimeSeriesLayout,
  eventShapes,
  mergeOverlays,
  sloShape,
} from './layout';
import { SIZE, chartTheme } from './tokens';
import { resolveAxes } from './units';
import type { AxisSeries } from './units';
import type { PerfanaEvent } from '@/lib/events';

const theme = chartTheme('light');

const s = (id: string, unit?: string, max?: number, min?: number): AxisSeries =>
  ({ id, unit, max, min, name: id });

const groupsOf = (...series: AxisSeries[]) => resolveAxes(series).groups;

type Axis = {
  showgrid?: boolean;
  showline?: boolean;
  zeroline?: boolean;
  range?: [number, number];
  tickvals?: number[];
  nticks?: number;
  autorange?: boolean;
  overlaying?: string;
  side?: string;
  anchor?: string;
  domain?: number[];
  tickangle?: number;
  showspikes?: boolean;
  spikedash?: string;
  type?: string;
  ticktext?: string[];
  title?: { text?: string };
  tickfont?: { family?: string };
};
type Layout = {
  showlegend: boolean;
  hovermode: string;
  height: number;
  paper_bgcolor: string;
  plot_bgcolor: string;
  margin: { l: number; r: number; t: number; b: number };
  xaxis: Axis;
  yaxis: Axis;
  yaxis2?: Axis;
  yaxis3?: Axis;
  shapes: Record<string, unknown>[];
  annotations: Record<string, unknown>[];
};

const overlay = (...series: AxisSeries[]) =>
  buildTimeSeriesLayout({ theme, groups: groupsOf(...series) }) as unknown as Layout;

describe('buildTimeSeriesLayout — what the standard removes', () => {
  it('draws no Plotly legend: the legend is the HTML series table', () => {
    expect(overlay(s('a', 'ms', 100)).showlegend).toBe(false);
  });

  it('hovers on x alone, not unified — the readout is the table, not a floating label', () => {
    expect(overlay(s('a', 'ms', 100)).hovermode).toBe('x');
  });

  it('titles no axis: the unit is an annotation above it, printed once', () => {
    const layout = overlay(s('a', 'ms', 100), s('b', 'req/s', 50));
    expect(layout.yaxis.title).toEqual({ text: '' });
    expect(layout.yaxis2!.title).toEqual({ text: '' });
    expect(layout.xaxis.title).toEqual({ text: '' });
    // ...and the unit reaches the chart as an annotation instead.
    const texts = layout.annotations.map((a) => a.text);
    expect(texts).toContain('ms');
    expect(texts).toContain('req/s');
  });

  it('draws no vertical gridlines, and spikes the x axis instead', () => {
    const { xaxis } = overlay(s('a', 'ms', 100));
    expect(xaxis.showgrid).toBe(false);
    expect(xaxis.showline).toBe(false);
    expect(xaxis.zeroline).toBe(false);
    expect(xaxis.showspikes).toBe(true);
    expect(xaxis.spikedash).toBe('dot');
    // Horizontal ticks: the standard has no -45° labels to decode.
    expect(xaxis.tickangle).toBe(0);
  });

  it('labels both axes in the mono face, so a column of digits does not ripple', () => {
    const layout = overlay(s('a', 'ms', 100));
    expect(layout.xaxis.tickfont?.family).toContain('Mono');
    expect(layout.yaxis.tickfont?.family).toContain('Mono');
  });

  it('takes its surfaces from the theme in both modes, defining no colour of its own', () => {
    for (const mode of ['light', 'dark'] as const) {
      const t = chartTheme(mode);
      const layout = buildTimeSeriesLayout({ theme: t, groups: groupsOf(s('a', 'ms', 100)) }) as unknown as Layout;
      expect(layout.paper_bgcolor).toBe(t.paper);
      expect(layout.plot_bgcolor).toBe(t.plotBg);
    }
  });
});

describe('buildTimeSeriesLayout — shared gridlines', () => {
  it('pins a non-negative axis to zero with explicit ticks', () => {
    const { yaxis } = overlay(s('a', 'ms', 95, 0));
    expect(yaxis.range).toEqual([0, 100]);
    expect(yaxis.tickvals).toEqual([0, 25, 50, 75, 100]);
    expect(yaxis.autorange).toBeUndefined();
  });

  it('gives the right axis the SAME number of ticks, so the two sets land together', () => {
    const layout = overlay(s('a', 'ms', 95), s('b', 'req/s', 380));
    expect(layout.yaxis2!.overlaying).toBe('y');
    expect(layout.yaxis2!.side).toBe('right');
    expect(layout.yaxis2!.tickvals).toHaveLength(layout.yaxis.tickvals!.length);
    // Only the left axis paints the gridlines; the right one would double every line.
    expect(layout.yaxis.showgrid).toBe(true);
    expect(layout.yaxis2!.showgrid).toBe(false);
  });

  it('falls back to autorange for a group that dips below zero, keeping the tick count', () => {
    // Pinning [0, top] would clip the data; the count is what still has to match.
    const { yaxis } = overlay(s('a', 'short', 10, -5));
    expect(yaxis.autorange).toBe(true);
    expect(yaxis.range).toBeUndefined();
    expect(yaxis.tickvals).toBeUndefined();
    expect(yaxis.nticks).toBe(5);
  });

  it('survives a chart with no series at all rather than emitting an undefined axis', () => {
    const layout = buildTimeSeriesLayout({ theme, groups: [] }) as unknown as Layout;
    expect(layout.yaxis).toBeDefined();
    expect(layout.yaxis2).toBeUndefined();
    expect(layout.annotations).toEqual([]);
  });

  it('reserves room on the right only when there is a right axis', () => {
    expect(overlay(s('a', 'ms', 1)).margin.r).toBe(16);
    expect(overlay(s('a', 'ms', 1), s('b', 'req/s', 1)).margin.r).toBe(46);
  });

  it('takes the overlay height unless a card overrides it', () => {
    expect(overlay(s('a', 'ms', 1)).height).toBe(SIZE.overlayHeight);
    const sized = buildTimeSeriesLayout({
      theme, groups: groupsOf(s('a', 'ms', 1)), height: SIZE.compareHeight,
    }) as unknown as Layout;
    expect(sized.height).toBe(SIZE.compareHeight);
  });

  it('passes an x spec straight through, for an index axis that must not float', () => {
    const layout = buildTimeSeriesLayout({
      theme,
      groups: groupsOf(s('a', 'ms', 1)),
      x: { type: 'linear', tickvals: [0, 1], ticktext: ['04 Oct', '05 Oct'], range: [-0.5, 1.5] },
    }) as unknown as Layout;
    expect(layout.xaxis.type).toBe('linear');
    expect(layout.xaxis.range).toEqual([-0.5, 1.5]);
    expect(layout.xaxis.ticktext).toEqual(['04 Oct', '05 Oct']);
  });

  it('keeps a caller overlay and appends the unit labels to it', () => {
    const layout = buildTimeSeriesLayout({
      theme,
      groups: groupsOf(s('a', 'ms', 10)),
      overlay: sloShape(5, theme),
    }) as unknown as Layout;
    expect(layout.shapes).toHaveLength(1);
    // The SLO's own label plus the axis unit.
    expect(layout.annotations.map((a) => a.text)).toEqual(['SLO', 'ms']);
  });
});

describe('buildLanesLayout', () => {
  const lanes = () =>
    buildLanesLayout({
      theme,
      groups: resolveAxes([s('a', 'ms', 100), s('b', 'req/s', 50), s('c', 'percent', 80)]).groups,
    }) as unknown as Layout;

  it('stacks one subplot per unit family, lane 0 at the top', () => {
    const layout = lanes();
    const tops = [layout.yaxis, layout.yaxis2!, layout.yaxis3!].map((a) => a.domain![1]!);
    // Strictly descending: the series table reads top-down and the lanes must match.
    expect(tops[0]).toBeGreaterThan(tops[1]!);
    expect(tops[1]).toBeGreaterThan(tops[2]!);
    expect(tops[0]).toBeCloseTo(1);
  });

  it('draws the x axis once, anchored under the BOTTOM lane', () => {
    expect(lanes().xaxis.anchor).toBe('y3');
    // One family is one lane, so the only axis to anchor to is `y`.
    const single = buildLanesLayout({ theme, groups: groupsOf(s('a', 'ms', 1)) }) as unknown as Layout;
    expect(single.xaxis.anchor).toBe('y');
  });

  it('names each lane by its unit AND the series sharing it', () => {
    const texts = lanes().annotations.map((a) => a.text);
    expect(texts[0]).toBe('ms · a');
    expect(texts[1]).toBe('req/s · b');
  });

  it('calls an unlabelled family "no unit" rather than leaving the lane unnamed', () => {
    const layout = buildLanesLayout({
      theme, groups: resolveAxes([s('a', 'short', 1)], { split: true }).groups,
    }) as unknown as Layout;
    expect(layout.annotations[0]!.text).toBe('no unit · a');
  });

  it('grows with the lane count instead of squeezing three lanes into one height', () => {
    const one = buildLanesLayout({ theme, groups: groupsOf(s('a', 'ms', 1)) }) as unknown as Layout;
    expect(one.height).toBe(SIZE.laneHeight + 44);
    expect(lanes().height).toBe(3 * SIZE.laneHeight + 2 * SIZE.laneGap + 44);
  });

  it('never divides by a zero plot area when there are no groups', () => {
    const layout = buildLanesLayout({ theme, groups: [] }) as unknown as Layout;
    expect(Number.isFinite(layout.height)).toBe(true);
    expect(layout.annotations).toEqual([]);
  });
});

describe('buildPlotLayout', () => {
  it('dispatches on the mode resolveAxes returned', () => {
    const series = [s('a', 'ms', 1), s('b', 'req/s', 1), s('c', 'percent', 1)];
    const { mode, groups } = resolveAxes(series);
    expect(mode).toBe('lanes');
    // Lanes give every group a domain; overlay gives the second one `overlaying: 'y'`.
    expect(((buildPlotLayout(mode, { theme, groups }) as unknown as Layout).yaxis).domain).toBeDefined();
    const two = resolveAxes([s('a', 'ms', 1), s('b', 'req/s', 1)]);
    const flat = buildPlotLayout(two.mode, { theme, groups: two.groups }) as unknown as Layout;
    expect(flat.yaxis.domain).toBeUndefined();
    expect(flat.yaxis2!.overlaying).toBe('y');
  });
});

describe('analysis window overlay', () => {
  it('washes and names only the ends that are actually trimmed', () => {
    const both = analysisWindowShapes(5, 90, 100, theme);
    expect(both.shapes).toHaveLength(4);                       // wash + edge, twice
    expect(both.annotations.map((a) => a.text)).toEqual(['start', 'end']);

    // A window that starts at sample 0 trims nothing at the head.
    const headOnly = analysisWindowShapes(0, 90, 100, theme);
    expect(headOnly.annotations.map((a) => a.text)).toEqual(['end']);

    // ...and one whose end is the last sample trims nothing at the tail.
    const tailOnly = analysisWindowShapes(5, 99, 100, theme);
    expect(tailOnly.annotations.map((a) => a.text)).toEqual(['start']);

    expect(analysisWindowShapes(null, null, 100, theme)).toEqual(EMPTY_OVERLAY);
  });

  it('paints the wash under the data, never over it', () => {
    const { shapes } = analysisWindowShapes(5, 90, 100, theme);
    for (const shape of shapes) expect(shape.layer).toBe('below');
    expect(shapes[0]!.fillcolor).toBe(theme.excluded);
  });

  it('is amber-free: the boundary is a theme hairline, not the old dashed amber', () => {
    const json = JSON.stringify(analysisWindowShapes(5, 90, 100, theme));
    expect(json.toLowerCase()).not.toContain('f59e0b');
    expect(json.toLowerCase()).not.toContain('ffc107');
  });

  it('takes timestamps as happily as indices, for the Compare chart', () => {
    const from = new Date('2026-10-02T10:00:00Z');
    const start = new Date('2026-10-02T10:05:00Z');
    const { shapes, annotations } = analysisWindowBands(
      { from, start, end: null, to: new Date('2026-10-02T11:00:00Z') },
      theme,
    );
    expect(shapes[0]!.x0).toBe(from);
    expect(shapes[0]!.x1).toBe(start);
    expect(annotations).toHaveLength(1);
  });

  it('treats an omitted edge the same as an explicit null', () => {
    expect(analysisWindowBands({ from: 0, to: 10 }, theme)).toEqual(EMPTY_OVERLAY);
  });
});

describe('sloShape', () => {
  it('is the one red line in the standard, dashed and above the data', () => {
    const { shapes, annotations } = sloShape(250, theme, 'p95 < 250ms');
    expect(shapes[0]!.line).toMatchObject({ color: theme.error, dash: 'dash' });
    expect(shapes[0]!.layer).toBe('above');
    expect(shapes[0]!.y0).toBe(250);
    expect(annotations[0]!.text).toBe('p95 < 250ms');
  });

  it('labels itself "SLO" when the caller has no better name', () => {
    expect(sloShape(1, theme).annotations[0]!.text).toBe('SLO');
  });
});

describe('eventShapes', () => {
  const event = (over: Partial<PerfanaEvent> = {}): PerfanaEvent =>
    ({ title: 'deploy', source: 'manual', ...over }) as PerfanaEvent;

  it('draws a hairline and a haloed label per event, below the data', () => {
    const { shapes, annotations } = eventShapes([{ event: event(), x: 12 }], theme);
    expect(shapes[0]!.x0).toBe(12);
    expect(shapes[0]!.layer).toBe('below');
    expect(annotations[0]!.text).toBe('deploy');
    // The halo is what keeps the text legible over a dense line.
    expect(annotations[0]!.bgcolor).toBe(theme.plotBg);
  });

  it('reddens an ALERT but not a manual annotation — red carries a verdict', () => {
    const manual = eventShapes([{ event: event(), x: 0 }], theme);
    const alert = eventShapes([{ event: event({ source: 'prometheus' }), x: 0 }], theme);
    expect((manual.shapes[0]!.line as { color: string }).color).toBe(theme.muted);
    expect((alert.shapes[0]!.line as { color: string }).color).toBe(theme.error);
  });

  it('is empty for no events', () => {
    expect(eventShapes([], theme)).toEqual(EMPTY_OVERLAY);
  });
});

describe('mergeOverlays', () => {
  it('concatenates shapes and annotations so a caller merges both or neither', () => {
    const merged = mergeOverlays(sloShape(1, theme), analysisWindowShapes(5, 90, 100, theme));
    expect(merged.shapes).toHaveLength(5);
    expect(merged.annotations.map((a) => a.text)).toEqual(['SLO', 'start', 'end']);
    expect(mergeOverlays()).toEqual(EMPTY_OVERLAY);
  });
});
