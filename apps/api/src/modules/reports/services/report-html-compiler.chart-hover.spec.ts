import { ReportHtmlCompilerService } from './report-html-compiler.service';
import { ReportUtilsService } from './report-utils.service';
import { CHART_HOVER_CSS } from '../renderers/chart-tokens';

/**
 * Chart hover in a compiled report — the CSS half of it.
 *
 * The charts are server-rendered SVG and the markup for both behaviours is already in the
 * document (`chart-svg.service.ts` emits a `data-series` group per series and a
 * pre-rendered readout per hover band). `CHART_HOVER_CSS` is the only thing that makes any
 * of it move, which puts four failures here that nothing on screen would report:
 *
 * 1. **The CSS has to reach the document.** Like `REPORT_DETAILS_CSS` it is deliberately
 *    NOT in `report-interactivity.ts`, whose CSS only matters when its script ran — and
 *    the in-app viewer and the public share page both render the report in an iframe with
 *    no `allow-scripts`. If `compileHtml` stops interpolating this block the charts still
 *    draw, every readout stays at `opacity: 0`, and the report looks finished.
 * 2. **The dim rule has to reach INTO the svg and stop there.** `:has()` is what lets a
 *    series-table row that sits *below* the chart dim the lines above it; scoping the
 *    dimmed side to `svg [data-series]` is what stops the hovered row dimming its own text.
 * 3. **One un-dim rule per series slot.** Nothing in CSS selects "the element whose
 *    attribute equals the hovered one's", so the pairing is generated: lose the generated
 *    block and hovering a row dims the whole chart, the hovered series included.
 * 4. **Print has to hide the readouts.** A PDF has no pointer, so every band's readout
 *    would otherwise be a stack of boxes in the plot — and `opacity: 0` is not enough,
 *    because Puppeteer prints with `printBackground` and an SVG group at zero opacity is
 *    still a group Chrome lays out and embeds.
 */
describe('CHART_HOVER_CSS', () => {
  /** `compileHtml` reads nothing but `this.utils`, so it needs no DI container. */
  const compile = (): string =>
    (ReportHtmlCompilerService.prototype.compileHtml as (
      this: { utils: ReportUtilsService },
      name: string,
      sections: string,
      styling: Record<string, unknown>,
    ) => string).call(
      { utils: new ReportUtilsService() },
      'Nightly comparison',
      '<section><div class="chart-hover"><svg><g data-series="0"></g></svg></div></section>',
      {},
    );

  /** Everything from `@media print` on — the block is the tail of the constant. */
  const printBlock = (css: string): string => css.slice(css.indexOf('@media print'));

  /** The generated un-dim rules, one per series slot. */
  const slotRules = (css: string): string[] =>
    css.match(/\.chart-hover:has\(\[data-series="\d+"\]:hover\) svg \[data-series="\d+"\] \{ opacity: 1; \}/g) ?? [];

  it('reaches the compiled document, or no chart in the report hovers at all', () => {
    const html = compile();
    expect(html).toContain('.chart-hover:has([data-series]:hover)');
    expect(html).toContain('.chart-cursor-band:hover .chart-cursor');
    // Before the custom-CSS override, so a template can still overrule it — the override
    // block is the last thing in the style element on purpose.
    expect(html.indexOf('.chart-cursor-band:hover')).toBeLessThan(html.indexOf('/* Custom CSS Override */'));
  });

  it('dims only what is inside the svg, so a hovered row does not dim its own text', () => {
    // The dimmed side is `svg [data-series]`. Drop the `svg` and the rule also catches the
    // series-table rows, which are `[data-series]` too — the reader then hovers a row and
    // watches that row fade.
    expect(CHART_HOVER_CSS).toContain('.chart-hover:has([data-series]:hover) svg [data-series]');
    expect(CHART_HOVER_CSS).not.toMatch(/:has\(\[data-series\]:hover\)\s+\[data-series\]/);
    // Scoped to the chart's own wrapper, not the page: two charts in one report must not
    // dim each other.
    expect(CHART_HOVER_CSS.startsWith('\n    .chart-hover')).toBe(true);
  });

  it('generates one un-dim rule per series slot, and pairs each slot with itself', () => {
    const rules = slotRules(CHART_HOVER_CSS);
    // 64 slots: a wildcard graph preset is capped at 50 series, with room left over.
    expect(rules.length).toBe(64);
    expect(CHART_HOVER_CSS).toContain('.chart-hover:has([data-series="0"]:hover) svg [data-series="0"] { opacity: 1; }');
    expect(CHART_HOVER_CSS).toContain('.chart-hover:has([data-series="63"]:hover) svg [data-series="63"] { opacity: 1; }');
    // Past the last slot a series simply never un-dims — it is not a rule that matches
    // the wrong series.
    expect(CHART_HOVER_CSS).not.toContain('[data-series="64"]');
    // Every rule hovers and un-dims the SAME slot. A generated block that drifted by one
    // would dim the series the reader is pointing at and light up its neighbour.
    for (const rule of rules) {
      const [hovered, lit] = [...rule.matchAll(/data-series="(\d+)"/g)].map((m) => m[1]);
      expect(lit).toBe(hovered);
    }
  });

  it('keeps every cursor readout invisible until its own band is hovered', () => {
    // The readouts are all pre-rendered into the SVG — 36 of them on a standard-width
    // chart. Without the default they would all be on the plot at once. The markup
    // carries `opacity="0"` too, so a consumer that misses this stylesheet (the section
    // preview did) degrades to "no hover" rather than to 36 stacked boxes.
    expect(CHART_HOVER_CSS).toMatch(/\.chart-cursor \{\s*opacity: 0;/);
    expect(CHART_HOVER_CSS).toMatch(/\.chart-cursor \{[^}]*pointer-events: none;/);
    expect(CHART_HOVER_CSS).toMatch(/\.chart-cursor-band:hover \.chart-cursor \{\s*opacity: 1;\s*\}/);
  });

  it('hides the readouts on paper, where there is no pointer to read one with', () => {
    const print = printBlock(CHART_HOVER_CSS);
    expect(print).toContain('.chart-cursor');
    // `display: none`, not a second `opacity: 0`: Chrome is what Puppeteer prints with and
    // it still lays out and embeds a zero-opacity group.
    expect(print).toContain('display: none');
    // The dim rule needs no print counterpart — paper cannot fire `:hover` — so it must
    // not appear in the print block either, where it could only mis-dim a static page.
    expect(print).not.toContain(':hover');
  });

  it('needs no script, and no class the interactivity script adds', () => {
    // The iframe the viewer and the share page use has no `allow-scripts`. A selector
    // scoped to a `.report-*` class would make hover work in the downloaded file and
    // silently not in the two places most reports are read.
    expect(CHART_HOVER_CSS).not.toMatch(/\.report-(sortable|filter|interactive)/);
    expect(CHART_HOVER_CSS).not.toContain('script');
  });
});
