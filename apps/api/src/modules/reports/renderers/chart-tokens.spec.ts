import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CHART_CAT,
  CHART_INK,
  CHART_MONO,
  CHART_SANS,
  CHART_SIZE,
  chartColor,
  chartSeriesTable,
  safeChartColor,
} from './chart-tokens';

/**
 * The drift guard.
 *
 * `chart-tokens.ts` is a hand copy of `apps/web/lib/charts/tokens.ts`, because `apps/api`
 * has no import path into `apps/web`. A copy with no test is a copy that silently rots, so
 * this reads the web file off disk and compares the values that both sides draw with. If
 * the app changes its palette, this fails here rather than producing a report whose teal is
 * last quarter's teal.
 *
 * The parsing is deliberately crude — a regex per token, no TypeScript parser. It only has
 * to survive the shape that file actually has, and a parse that finds nothing fails loudly
 * (every `expect` below would compare against `undefined`).
 */
describe('chart-tokens', () => {
  const webTokens = (() => {
    // From src/modules/reports/renderers up to the repo root, then into apps/web.
    const path = join(__dirname, '../../../../../../apps/web/lib/charts/tokens.ts');
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  })();

  /**
   * The slice from a named anchor to the end of the file.
   *
   * It THROWS on a missing anchor rather than returning something: `indexOf` gives -1 there
   * and `slice(-1)` is the file's last character, which would make every comparison below
   * fail with a mystery instead of naming the renamed declaration.
   */
  const from = (marker: string): string => {
    const at = (webTokens ?? '').indexOf(marker);
    if (at < 0) {
      throw new Error(`chart-tokens drift guard: "${marker}" not found in apps/web/lib/charts/tokens.ts`);
    }
    return (webTokens ?? '').slice(at);
  };

  /** `faint: 'rgba(0,0,0,0.58)',` inside the LIGHT theme literal. */
  const lightValue = (key: string): string | undefined => {
    if (!webTokens) return undefined;
    return new RegExp(`\\n  ${key}: '([^']+)'`).exec(from('const LIGHT: ChartTheme = {'))?.[1];
  };

  /** `line: 1.25,` or `gridDash: '2 3',` inside the SIZE literal. */
  const sizeValue = (key: string): string | undefined => {
    if (!webTokens) return undefined;
    return new RegExp(`\\n  ${key}: '?([^,']+)'?,`).exec(from('export const SIZE = {'))?.[1];
  };

  describe('mirrors apps/web/lib/charts/tokens.ts', () => {
    it('finds the web tokens at all — the rest of this block is vacuous without it', () => {
      // A moved or renamed web file must fail here, not silently pass every comparison
      // below against `undefined`.
      expect(webTokens).not.toBeNull();
      expect(webTokens).toContain('const LIGHT: ChartTheme = {');
      expect(webTokens).toContain('export const SIZE = {');
    });

    it('carries the light categorical palette, in order', () => {
      const light = /light: \[([^\]]+)\]/.exec(webTokens ?? '')?.[1] ?? '';
      const colors = [...light.matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
      expect(colors.length).toBe(8);
      expect([...CHART_CAT]).toEqual(colors);
    });

    it.each(['paper', 'plotBg', 'text', 'muted', 'faint', 'divider', 'grid', 'excluded', 'baseline', 'error'])(
      'carries the light theme\'s %s',
      (key) => {
        expect(CHART_INK[key as keyof typeof CHART_INK]).toBe(lightValue(key));
      },
    );

    it('carries the line widths, marker size and radius', () => {
      expect(String(CHART_SIZE.line)).toBe(sizeValue('line'));
      expect(String(CHART_SIZE.markedLine)).toBe(sizeValue('trendsLine'));
      expect(String(CHART_SIZE.marker)).toBe(sizeValue('trendsMarker'));
      expect(String(CHART_SIZE.radius)).toBe(sizeValue('radius'));
    });

    it('carries the type scale', () => {
      expect(String(CHART_SIZE.tickFont)).toBe(sizeValue('tickFont'));
      expect(String(CHART_SIZE.axisLabelFont)).toBe(sizeValue('axisLabelFont'));
      expect(String(CHART_SIZE.tableFont)).toBe(sizeValue('tableFont'));
      expect(String(CHART_SIZE.titleFont)).toBe(sizeValue('titleFont'));
    });

    it('carries the dash patterns, with SVG commas for Plotly spaces', () => {
      // Same lengths, different separator: Plotly takes `'2 3'`, SVG takes `"2,3"`.
      expect(CHART_SIZE.gridDash.replace(',', ' ')).toBe(sizeValue('gridDash'));
      expect(CHART_SIZE.baselineDash.replace(',', ' ')).toBe(sizeValue('baselineDash'));
    });

    it('carries both font stacks, quotes aside', () => {
      // The sans stack is single-quoted here on purpose: the report sets it inside an
      // inline `style="…"` attribute, which a double-quoted family name would close.
      const quoteless = (stack: string) => stack.replace(/["']/g, '');
      const webMono = /export const MONO = "([^"]+)"/.exec(webTokens ?? '')?.[1];
      // Quote-agnostic: the point of the case is that quoting does NOT matter, so pinning
      // the web file's outer quote style here would fail on a prettier re-quote.
      const webSans = /export const SANS = ['"](.+?)['"];/.exec(webTokens ?? '')?.[1];
      expect(webMono).toBeDefined();
      expect(webSans).toBeDefined();
      expect(quoteless(CHART_MONO)).toBe(quoteless(webMono!));
      expect(quoteless(CHART_SANS)).toBe(quoteless(webSans!));
      // And the report's own stack must be safe to inline in a style attribute.
      expect(CHART_SANS).not.toContain('"');
      expect(CHART_MONO).not.toContain('"');
    });
  });

  describe('chartColor', () => {
    it('assigns by slot and wraps rather than returning undefined', () => {
      expect(chartColor(0)).toBe(CHART_CAT[0]);
      expect(chartColor(7)).toBe(CHART_CAT[7]);
      expect(chartColor(8)).toBe(CHART_CAT[0]);
      expect(chartColor(99)).toBe(CHART_CAT[99 % 8]);
    });

    it('folds a negative, fractional or non-finite slot into the palette', () => {
      // A slot that indexed past the end would land in a `stroke="undefined"`.
      expect(chartColor(-3)).toBe(CHART_CAT[3]);
      expect(chartColor(2.7)).toBe(CHART_CAT[2]);
      expect(chartColor(NaN)).toBe(CHART_CAT[0]);
      expect(chartColor(Infinity)).toBe(CHART_CAT[0]);
    });
  });

  describe('safeChartColor', () => {
    it('passes a plain hex through, in either length', () => {
      expect(safeChartColor('#abc', '#000000')).toBe('#abc');
      expect(safeChartColor('#2f6fed', '#000000')).toBe('#2f6fed');
    });

    it('refuses anything that could break out of the attribute', () => {
      // The value lands unescaped in `stroke=` on a page served without auth.
      expect(safeChartColor('" onload="alert(1)', '#000000')).toBe('#000000');
      expect(safeChartColor('red', '#000000')).toBe('#000000');
      expect(safeChartColor('url(#x)', '#000000')).toBe('#000000');
      expect(safeChartColor(undefined, '#000000')).toBe('#000000');
    });
  });

  describe('chartSeriesTable', () => {
    const escape = (text: string) =>
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const row = (over: Partial<Parameters<typeof chartSeriesTable>[0][number]> = {}) => ({
      name: 'CPU · All aggregated',
      color: '#2563eb',
      unit: '%',
      min: '12.4',
      mean: '48.1',
      max: '91.0',
      ...over,
    });

    it('renders nothing at all when there are no series', () => {
      // An empty <table> with a header and no rows is worse than no legend.
      expect(chartSeriesTable([], escape)).toBe('');
    });

    it('carries the min/mean/max columns the app legend carries', () => {
      const html = chartSeriesTable([row()], escape);
      expect(html).toContain('Min');
      expect(html).toContain('Mean');
      expect(html).toContain('Max');
      expect(html).toContain('12.4');
      expect(html).toContain('48.1');
      expect(html).toContain('91.0');
      expect(html).toContain('%');
    });

    it('escapes the series name through the caller\'s escaper', () => {
      const html = chartSeriesTable([row({ name: '<script>a & b' })], escape);
      expect(html).toContain('&lt;script&gt;a &amp; b');
      expect(html).not.toContain('<script>');
    });

    it('drops the Unit column when no series has a unit, and keeps it when one does', () => {
      // A chart whose series share one unit names it once above the axis; a column of
      // identical cells would only compete with the numbers in a table that prints small.
      const none = chartSeriesTable([row({ unit: undefined }), row({ name: 'B', unit: undefined })], escape);
      expect(none).not.toContain('Unit');
      expect((none.match(/role="columnheader"/g) ?? []).length).toBe(4);

      // Mixed: the column earns its place, and the row without a unit says so.
      const mixed = chartSeriesTable([row({ unit: 'ms' }), row({ name: 'B', unit: undefined })], escape);
      expect(mixed).toContain('Unit');
      expect((mixed.match(/role="columnheader"/g) ?? []).length).toBe(5);
      expect(mixed).toContain('—');
    });

    it('shares ONE grid across all rows, so the number columns line up', () => {
      // Each row re-declaring the template makes it its own grid, sized to its own content:
      // "12.4" and "1,234.56" then land at different x and `text-align:right` aligns nothing.
      const html = chartSeriesTable([row(), row({ name: 'B', min: '1,234.56' })], escape);
      expect((html.match(/grid-template-columns/g) ?? []).length).toBe(1);
      expect((html.match(/role="row" style="display:contents;"/g) ?? []).length).toBe(3);
    });

    it('lets a series name wrap but never a number', () => {
      // The report has no hover and, on paper, no cursor: an ellipsized series name is lost.
      const html = chartSeriesTable([row({ name: 'A very long panel title · a very long metric name' })], escape);
      const cells = [...html.matchAll(/<div role="cell" style="([^"]*)"/g)].map((m) => m[1]!);
      expect(cells.length).toBe(5);
      // The two left cells (name, unit) wrap; the three numbers never do.
      expect(cells.slice(0, 2).every((c) => c.includes('overflow-wrap:anywhere'))).toBe(true);
      expect(cells.slice(0, 2).some((c) => c.includes('white-space:nowrap'))).toBe(false);
      expect(cells.slice(2).every((c) => c.includes('white-space:nowrap'))).toBe(true);
    });

    it('marks a dashed series in its swatch too, so it survives a greyscale print', () => {
      expect(chartSeriesTable([row({ dashed: true })], escape)).toContain('border-top:2px dashed #2563eb');
      expect(chartSeriesTable([row()], escape)).not.toContain('dashed');
    });

    it('is a grid with table roles, never an HTML table', () => {
      // The comparisons section draws a chart inside a detail row of its own data table,
      // and report-interactivity enhances every `.table-scroll table`: a real <table> here
      // would get sortable headers and a filter box inside the chart card, and would put
      // <td>s inside a detail cell that must hold exactly one.
      const html = chartSeriesTable([row(), row({ name: 'B' })], escape);
      expect(html).not.toContain('<table');
      expect(html).not.toContain('<td');
      expect(html).not.toContain('<tr');
      expect(html).toContain('role="table"');
      expect((html.match(/role="row"/g) ?? []).length).toBe(3); // header + two series
      expect((html.match(/role="columnheader"/g) ?? []).length).toBe(5);
    });

    it('prints every number in mono — a proportional font makes a column of digits ripple', () => {
      const html = chartSeriesTable([row()], escape);
      expect(html).toContain(CHART_MONO);
    });
  });
});
