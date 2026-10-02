import { ReportHtmlCompilerService } from './report-html-compiler.service';
import { ReportUtilsService } from './report-utils.service';
import { REPORT_DETAILS_CSS } from '../renderers/report-style';

/**
 * `<details>` disclosure in a compiled report, used by the comparisons section's per-row
 * graphs.
 *
 * Three decisions here each fail silently if they drift, and none is visible on screen:
 *
 * 1. **The CSS has to reach the document.** It is NOT in `report-interactivity.ts` on
 *    purpose — that file's CSS only ever matters when its script ran, and the graphs use
 *    native `<details>` precisely because the in-app viewer and the public share page
 *    render the report in an iframe with no `allow-scripts`. If `compileHtml` stops
 *    interpolating this block, the expanders still work and only the print behaviour
 *    silently breaks.
 * 2. **Print forces every disclosure open.** Paper has no triangle to click, so a PDF of
 *    a report with twenty collapsed graphs would contain none of them.
 * 3. **`display: block` alone is not enough.** Chrome hides a closed `details`' content
 *    with `content-visibility` on an internal slot, and Chrome is what Puppeteer prints
 *    with — so the print rule has to override that too.
 */
describe('REPORT_DETAILS_CSS', () => {
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
      '<section><details><summary>Graph</summary><svg></svg></details></section>',
      {},
    );

  /** Everything from `@media print` on — the block is the tail of the constant. */
  const printBlock = (css: string): string => css.slice(css.indexOf('@media print'));

  it('reaches the compiled document, so a PDF is not missing every graph', () => {
    const html = compile();
    expect(html).toContain('details > summary');
    expect(html).toContain('content-visibility: visible !important');
  });

  it('restores the disclosure triangle a UA reset would have removed', () => {
    // Without `list-style: revert` a `summary` is an unmarked line of text, and nothing
    // tells a reader it can be opened.
    expect(REPORT_DETAILS_CSS).toContain('list-style: revert');
  });

  it('hides the summary and forces the content open in print', () => {
    const print = printBlock(REPORT_DETAILS_CSS);
    expect(print).toContain('details > summary');
    expect(print).toContain('display: none');
    // The content, not the summary: both `display` and `content-visibility`, because
    // Chrome needs the second one and Chrome is what Puppeteer prints with.
    expect(print).toContain('details > *:not(summary)');
    expect(print).toContain('display: block !important');
    expect(print).toContain('content-visibility: visible !important');
  });

  it('keeps a graph and its summary on one page', () => {
    expect(printBlock(REPORT_DETAILS_CSS)).toContain('break-inside: avoid');
  });

  it('is a separate block from the interactivity CSS, which needs a script to matter', () => {
    const html = compile();
    const details = html.indexOf('details > summary');
    const interactivity = html.indexOf('REPORT_INTERACTIVITY');
    expect(details).toBeGreaterThan(-1);
    // Whatever the interactivity block's marker is, the details rules stand on their own:
    // no selector in this block is scoped to an interactivity class.
    expect(REPORT_DETAILS_CSS).not.toMatch(/\.report-(sortable|filter|interactive)/);
    expect(interactivity).toBe(-1);   // the constant is interpolated, not named, in the output
  });
});
