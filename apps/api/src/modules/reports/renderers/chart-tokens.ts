/**
 * The "Analyst" chart standard, as a report can use it.
 *
 * Mirror of `apps/web/lib/charts/tokens.ts`, light mode only — a report is read on white
 * and printed on paper, and has no theme switch. Copied rather than imported: `apps/api`
 * has no path into `apps/web`, and this is eight hex strings and a handful of numbers.
 * `chart-tokens.spec.ts` pins every value against the web file — and `npm run preflight`
 * runs that spec — so a drift is a failing gate rather than two subtly different blues in
 * two places the same person reads.
 *
 * `packages/shared` WAS the other option: both apps already depend on it, and these values
 * have no React coupling. It was not taken because the shared route costs a new `exports`
 * subpath (`check:workspace-exports`) and makes `apps/api` type-check against
 * `packages/shared/dist`, so every token edit needs a shared rebuild before the API sees it
 * — more moving parts than a 40-line mirror with a gate on it. Revisit if a third consumer
 * appears.
 *
 * The four rules this file exists to enforce, which the report's three hand-rolled SVG
 * charts each used to answer differently:
 *
 * 1. **One palette, by slot.** `CHART_CAT`, same order as the app, so a metric that is
 *    teal in the Graphs card is teal in the report of that run.
 * 2. **A 1.25px line, markers only where points are discrete.** A time series is a line;
 *    a trend over runs gets markers, because a run is an event and not a sample.
 * 3. **Horizontal gridlines only, hairline, and no plot border.** The frame around the
 *    plot area was the loudest mark on the old report charts; the app has none.
 * 4. **Every number in mono, the unit named once above its own axis** — never a rotated
 *    axis title.
 *
 * Deliberately NOT mirrored: the dark palette (no dark report), and the y-axis domain.
 * The app pins a non-negative axis to `[0, niceTop]`; the report keeps its padded
 * min..max, because re-framing a shipped report's charts is not a styling change.
 */

/** Categorical series colours. Index = colour slot. `CAT.light` in the web tokens. */
export const CHART_CAT = [
  '#2563eb', '#0d9488', '#c026d3', '#ea580c', '#7c3aed', '#65a30d', '#db2777', '#0891b2',
] as const;

/**
 * The light `ChartTheme`, as far as a report uses it.
 *
 * `faint` is 0.58 rather than 0.45 for the contrast reason given in the web tokens: it
 * paints 10px axis ticks, and 0.45 resolves to 3.4:1 — under the 4.5:1 floor for text
 * that small. On paper it matters more, not less.
 */
export const CHART_INK = {
  paper: '#ffffff',
  plotBg: '#f8fafc',
  text: 'rgba(0,0,0,0.87)',
  muted: 'rgba(0,0,0,0.6)',
  faint: 'rgba(0,0,0,0.58)',
  divider: 'rgba(0,0,0,0.12)',
  grid: 'rgba(15,23,42,0.07)',
  /** Mirror-only: no report reads this — use `excludedPrint`. Here so the drift spec can pin it. */
  excluded: 'rgba(15,23,42,0.04)',
  /**
   * The excluded-band fill, for a report.
   *
   * The app's `excluded` is 4% — enough on a screen, invisible on paper. A report's
   * analysis-window band has to survive a PDF the same way its boundary lines keep amber
   * (see `ANALYSIS_BOUNDARY_COLOR`), so the report uses the same hue at 10%.
   */
  excludedPrint: 'rgba(15,23,42,0.10)',
  /** Mirror-only, as above: pinned against the web file, not drawn by any renderer yet. */
  baseline: '#94a3b8',
  error: '#dc2626',
} as const;

/** Sizes the standard shares. `SIZE` in the web tokens, minus the Plotly-only heights. */
export const CHART_SIZE = {
  /** Time-series line width. No markers on a time series. */
  line: 1.25,
  /** A run-over-run series: thicker, and marked, because runs are discrete. */
  markedLine: 1.5,
  marker: 2.5,
  /** Dash patterns. SVG wants commas; Plotly wants spaces. Same lengths. */
  gridDash: '2,3',
  baselineDash: '4,3',
  tickFont: 10,
  axisLabelFont: 10,
  tableFont: 10,
  titleFont: 13,
  /**
   * The series table's own body size. NOT mirrored from the app, and a point larger than
   * `tableFont` on purpose: `report-html-compiler.service.ts` prints the document under
   * `body { zoom: 0.8 }`, so 10px reaches paper at 8px — smaller than the 9pt legend this
   * table replaced. The SVG is unaffected; its text scales with the viewBox, not the zoom.
   */
  legendFont: 11,
  radius: 8,
} as const;

/**
 * `--font-mono` from the app's tokens.
 *
 * A report is one self-contained file with no webfont, so JetBrains Mono resolves only on
 * a machine that happens to have it and the stack falls through to the platform's
 * monospace. That is the point: a column of digits must not ripple, and every
 * fallback here is fixed-width.
 */
export const CHART_MONO = "'JetBrains Mono', 'Fira Code', Monaco, 'Cascadia Code', 'Roboto Mono', monospace";

/**
 * Titles and prose. The app's `SANS`, with the family names in SINGLE quotes.
 *
 * Equivalent CSS, and not a cosmetic difference: a report sets fonts through inline
 * `style="…"` attributes, so the web file's `"Inter"` closes the attribute and the rest of
 * the declaration lands in the markup as stray text. `chart-tokens.spec.ts` compares the
 * two stacks with quotes normalised, so the stacks still cannot drift apart.
 */
export const CHART_SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/** The colour of a slot, wrapping once the palette is exhausted. Negatives fold in. */
export function chartColor(slot: number): string {
  const i = Number.isFinite(slot) ? Math.abs(Math.trunc(slot)) : 0;
  return CHART_CAT[i % CHART_CAT.length]!;
}

/**
 * A caller-supplied colour, or the slot default if it is not a plain hex.
 *
 * The colour lands unescaped in a `stroke=` and in the legend's `background:`, and a
 * report is served from the public share page with no authentication, so this refuses
 * `" onload=` rather than trusting its callers.
 */
export function safeChartColor(color: string | undefined, fallback: string): string {
  return color && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback;
}

/** One row of the series table: the legend, with the numbers the app's legend carries. */
export interface ChartLegendRow {
  name: string;
  color: string;
  /** Printed in its own column, so the series name is not "Response time (ms)". */
  unit?: string;
  /** Already formatted for display — the caller owns unit conversion. */
  min: string;
  mean: string;
  max: string;
  /** A baseline run, drawn dashed; the swatch says so too. */
  dashed?: boolean;
}

/**
 * The swatch: a line, dashed when the series is, because that is how it reads on paper.
 *
 * The colour is re-checked here rather than trusted from the row. It lands in a `style=`
 * attribute on a page served without authentication, and a shared helper that documents an
 * invariant its callers must keep is one refactor away from not having it.
 */
function swatch(color: string, dashed: boolean): string {
  const safe = safeChartColor(color, CHART_CAT[0]);
  return dashed
    ? `<span style="display:inline-block; width:14px; height:0; border-top:2px dashed ${safe}; vertical-align:middle;"></span>`
    : `<span style="display:inline-block; width:14px; height:2px; background:${safe}; border-radius:1px; vertical-align:middle;"></span>`;
}

/**
 * min / mean / max over a series, already formatted.
 *
 * One loop, not `Math.min(...values)`: a report chart is handed one row per `ds_metrics`
 * point and the spread form throws `RangeError: Maximum call stack size exceeded` somewhere
 * north of 100k arguments. (`chart-svg.service.ts` has two older spreads over larger arrays
 * that would blow first — they are fixed alongside this, so the ceiling is gone rather than
 * moved.) An empty series reads as em dashes, never `Infinity` or `NaN` on the page.
 */
export function legendStats(
  values: readonly number[],
  format: (value: number) => string,
): Pick<ChartLegendRow, 'min' | 'mean' | 'max'> {
  if (values.length === 0) return { min: '—', mean: '—', max: '—' };
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  for (const value of values) {
    if (value < lo) lo = value;
    if (value > hi) hi = value;
    sum += value;
  }
  return { min: format(lo), mean: format(sum / values.length), max: format(hi) };
}

/**
 * The legend, as the app's series table.
 *
 * The app replaced the chart legend with a table because a legend that also carries
 * min/mean/max cannot be drawn inside a canvas. A report has the same problem for the same
 * reason — the chart is an SVG with no hover — and the same answer, minus the cursor
 * column: there is no pointer to read a value under.
 *
 * **A CSS grid with table roles, not an HTML `<table>`, and that is load-bearing.** The
 * comparisons section draws a chart inside a detail row of its own data table, and
 * `report-interactivity.ts` enhances every `.table-scroll table` on the page — so a real
 * `<table>` here would be given sortable headers and its own "Filter rows..." box, inside
 * the chart card. It would also put `<td>`s inside a detail cell that
 * `collectUnits` requires to be the row's only cell. The roles keep the semantics a screen
 * reader needs; the enhancer only looks for the element.
 *
 * `escape` is the caller's HTML escaper, passed in so this file stays free of the
 * renderers' DI graph.
 */
export function chartSeriesTable(
  rows: ChartLegendRow[],
  escape: (text: string) => string,
): string {
  if (rows.length === 0) return '';

  // ONE grid, on the container. The rows are `display:contents`, so every cell is a direct
  // grid item of that single grid and the five tracks are shared — which is the whole point
  // of a table of numbers. Re-declaring the template per row makes each row its own grid
  // sized to its own content, and then `text-align:right` aligns nothing: "12.3 ms" and
  // "1,234.56 ms" land at different x and the mono font buys nothing. The app's
  // `SeriesTable` gets away with per-row grids only because its tracks are fixed pixel
  // widths; a report's numbers are formatted per unit, so the tracks have to be content-sized.
  const GRID = 'display:grid; grid-template-columns:minmax(0,1fr) auto auto auto auto; align-items:center;';
  // Type, colour and the font stacks are declared ONCE and inherited. Repeating them per
  // cell cost ~1.9 KB per series row in a document that is stored in Postgres, mailed and
  // run through Puppeteer.
  const TABLE = `${GRID} margin:0 0 12px; font-family:${CHART_MONO};`
    + ` font-size:${CHART_SIZE.legendFont}px; color:${CHART_INK.muted};`;
  const head = (align: 'left' | 'right') =>
    `font-size:${CHART_SIZE.tableFont}px; font-weight:600; color:${CHART_INK.faint};`
    + ` text-align:${align}; padding:0 0 6px ${align === 'left' ? '0' : '14px'}; white-space:nowrap;`;
  const cell = (align: 'left' | 'right') =>
    `text-align:${align}; padding:3px 0 3px ${align === 'left' ? '0' : '14px'};`
    + ` border-top:1px solid ${CHART_INK.divider};`
    // A number must not wrap; a series name must, because this is the only place it is
    // written and a report has no hover to recover an ellipsis from — on paper, not even a
    // cursor. The names here are the product's longest strings ("panel · metric", raw
    // JMeter transaction names).
    + (align === 'right' ? ' white-space:nowrap;' : ' overflow-wrap:anywhere;');

  // A chart whose series all share one unit names it once, above the axis; a Unit column of
  // identical cells would just compete with the numbers. Only a mixed-unit chart earns it.
  const units = rows.some((row) => row.unit);

  const headerCells = [
    `<div role="columnheader" style="${head('left')}">Series</div>`,
    units ? `<div role="columnheader" style="${head('left')} padding-left:14px;">Unit</div>` : '',
    `<div role="columnheader" style="${head('right')}">Min</div>`,
    `<div role="columnheader" style="${head('right')}">Mean</div>`,
    `<div role="columnheader" style="${head('right')}">Max</div>`,
  ].join('');

  return `
      <div role="table" style="${TABLE}${units ? '' : ' grid-template-columns:minmax(0,1fr) auto auto auto;'}">
        <div role="row" style="display:contents;">${headerCells}</div>
        ${rows.map((row) => `
        <div role="row" style="display:contents;">
          <div role="cell" style="${cell('left')} color:${CHART_INK.text};">
            ${swatch(row.color, row.dashed === true)}
            <span style="font-family:${CHART_SANS}; margin-left:8px;">${escape(row.name)}</span>
          </div>
          ${units ? `<div role="cell" style="${cell('left')} color:${CHART_INK.faint}; padding-left:14px;">${escape(row.unit || '—')}</div>` : ''}
          <div role="cell" style="${cell('right')}">${escape(row.min)}</div>
          <div role="cell" style="${cell('right')}">${escape(row.mean)}</div>
          <div role="cell" style="${cell('right')}">${escape(row.max)}</div>
        </div>`).join('')}
      </div>`;
}

/** The mono caption naming an axis' unit, once, above it. Replaces a rotated axis title. */
export function axisUnitLabel(
  unit: string,
  x: number,
  y: number,
  anchor: 'start' | 'end',
  color: string = CHART_INK.muted,
): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${CHART_MONO}"`
    + ` font-size="${CHART_SIZE.axisLabelFont}" font-weight="600" fill="${color}">${unit}</text>`;
}

/** A horizontal gridline at `y`, spanning the plot area. The only gridline the standard has. */
export function gridLine(x0: number, x1: number, y: number): string {
  return `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${CHART_INK.grid}"`
    + ` stroke-width="1" stroke-dasharray="${CHART_SIZE.gridDash}"/>`;
}

/** An axis tick label, mono and faint, as the standard prints every number. */
export function tickLabel(
  text: string,
  x: number,
  y: number,
  anchor: 'start' | 'middle' | 'end',
  extra: string = '',
  color: string = CHART_INK.faint,
): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${CHART_MONO}"`
    + ` font-size="${CHART_SIZE.tickFont}" fill="${color}"${extra ? ` ${extra}` : ''}>${text}</text>`;
}

/**
 * The card a report chart sits in: paper, a hairline border, the standard's radius.
 *
 * One card, not the two nested boxes (a grey `#f5f5f5` outer and a white inner) the
 * report charts used to draw. The plot area's own `plotBg` is painted inside the SVG,
 * which is where the app puts it too.
 */
export function chartCard(innerHtml: string): string {
  return `<div style="background:${CHART_INK.paper}; border:1px solid ${CHART_INK.divider};`
    + ` border-radius:${CHART_SIZE.radius}px; padding:14px;">${innerHtml}</div>`;
}
