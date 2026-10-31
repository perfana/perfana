import { ReportHtmlCompilerService } from './report-html-compiler.service';
import { ReportUtilsService } from './report-utils.service';
import { REPORT_DETAILS_CSS, REPORT_GROUP_FILTER_CSS } from '../renderers/report-style';

/**
 * `<details>` disclosure in a compiled report, used by the comparisons section's per-row
 * graphs and by each of its dashboard / scenario groups (`.report-group`).
 *
 * Four decisions here each fail silently if they drift, and none is visible on screen:
 *
 * 1. **The CSS has to reach the document.** It is NOT in `report-interactivity.ts` on
 *    purpose — that file's CSS only ever matters when its script ran, and the graphs use
 *    native `<details>` precisely because the in-app viewer and the public share page
 *    render the report in an iframe with no `allow-scripts`. If `compileHtml` or
 *    `compilePreviewHtml` stops interpolating this block, the expanders still open, but
 *    a group heading loses its layout (the bare marker on a line of its own, no chevron)
 *    and print stops forcing the disclosures open.
 * 2. **Print forces every disclosure open.** Paper has no triangle to click, so a PDF of
 *    a report with twenty collapsed graphs would contain none of them.
 * 3. **The rule has to target `::details-content`, not the children.** Chrome hides a
 *    closed `details`' content with `content-visibility` on that internal slot, and Chrome
 *    is what Puppeteer prints with. Until v0.2.97.40 the rule styled the children instead,
 *    which a PDF text extraction against Chromium 149 showed prints nothing at all.
 * 4. **A group's summary is its heading.** The print rules that hide a graph's
 *    "Graph · …" toggle and keep a graph on one page name `.report-row-graph`: a group's
 *    heading must print, and a group can run for pages, so `break-inside: avoid` on it
 *    strands whole pages blank.
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

  it('hides a graph\'s toggle and forces every disclosure open in print', () => {
    const print = printBlock(REPORT_DETAILS_CSS);
    expect(print).toMatch(/\.report-row-graph > summary \{\s*display: none;/);
    // The slot that holds the content, not the content: Chrome puts `content-visibility`
    // on the slot, so styling the children cannot reach it.
    expect(print).toMatch(/details::details-content \{[^}]*display: block !important;[^}]*content-visibility: visible !important;/);
    expect(print).not.toContain('details > *:not(summary)');
  });

  it('keeps a graph and its summary on one page', () => {
    expect(printBlock(REPORT_DETAILS_CSS)).toMatch(/\.report-row-graph \{\s*break-inside: avoid;/);
  });

  it('keeps a group heading in print and lets the group break across pages', () => {
    // Both print rules name the graphs; written against every `details`, they hid a
    // group's heading and kept a pages-long group on one page.
    const print = printBlock(REPORT_DETAILS_CSS);
    expect(print).not.toMatch(/(^|\n)\s*details > summary \{/);
    expect(print).not.toMatch(/(^|\n)\s*details \{/);
  });

  const preview = (): string =>
    (ReportHtmlCompilerService.prototype.compilePreviewHtml as (
      this: { utils: ReportUtilsService },
      sectionHtml: string,
      section: Record<string, unknown>,
      styling: Record<string, unknown>,
    ) => string).call({ utils: new ReportUtilsService() }, '<section></section>', { type: 'comparisons' }, {});

  it('reaches the section preview too, which renders the same groups', () => {
    expect(preview()).toContain('.report-group > summary::before');
  });

  /**
   * The group filter is radios + `:has()` so it works in the viewer's script-less iframe;
   * it lives in the same no-script layer and has to reach both documents the same way.
   */
  describe('REPORT_GROUP_FILTER_CSS', () => {
    it('reaches the compiled report and the section preview', () => {
      for (const html of [compile(), preview()]) {
        expect(html).toContain('.report-group-filter:has(input[value="regression"]:checked)');
      }
    });

    it('hides a group lacking the checked band on screen only, so a filtered report still prints whole', () => {
      const screen = /@media screen \{([\s\S]*?)\n {4}\}/.exec(REPORT_GROUP_FILTER_CSS)?.[1] ?? '';
      for (const band of ['regression', 'warning', 'ok']) {
        expect(screen).toContain(
          `.report-group-filter:has(input[value="${band}"]:checked) ~ .report-group:not([data-has-${band}])`,
        );
      }
      // Hiding outside the screen block would reach paper.
      expect(REPORT_GROUP_FILTER_CSS.replace(screen, '')).not.toContain(':not([data-has-');
      // Both filter bars are screen controls; paper shows every row.
      expect(printBlock(REPORT_GROUP_FILTER_CSS)).toMatch(/\.report-group-filter,\s*\.report-band-filter \{\s*display: none;/);
    });

    it('hides a group\'s unticked bands, with each row\'s chart, on screen only', () => {
      const screen = /@media screen \{([\s\S]*?)\n {4}\}/.exec(REPORT_GROUP_FILTER_CSS)?.[1] ?? '';
      for (const band of ['regression', 'warning', 'ok']) {
        const scope = `[data-band-scope]:has(.report-band-filter input:checked):not(:has(.report-band-filter input[value="${band}"]:checked))`;
        expect(screen).toContain(`${scope} tr[data-band="${band}"],`);
        expect(screen).toContain(`${scope} tr[data-band="${band}"] + tr:not([data-band])`);
      }
      expect(REPORT_GROUP_FILTER_CSS.replace(screen, '')).not.toContain('tr[data-band=');
      // The dimmed unticked chip is a screen state too; paper shows plain counts.
      expect(screen).toContain('[data-band-filter]:not(:has(> input:checked))');
    });

    // Value: protects=a template's customCss still overrides the no-script details and group-filter blocks in both entry points; fails_when=either block is interpolated after customCss in compileHtml or compilePreviewHtml; why_new=the existing override test covers only the interactivity CSS in compileHtml; seam=none; no_claim=overrides that lose on specificity
    it('comes before a template\'s customCss in both documents, so the template still wins', () => {
      const customCss = '/* template-override */ .report-group-filter { display: none; }';
      const styling = { customCss };
      const report = (ReportHtmlCompilerService.prototype.compileHtml as (
        this: { utils: ReportUtilsService },
        name: string,
        sections: string,
        styling: Record<string, unknown>,
      ) => string).call({ utils: new ReportUtilsService() }, 'Nightly comparison', '<section></section>', styling);
      const sectionPreview = (ReportHtmlCompilerService.prototype.compilePreviewHtml as (
        this: { utils: ReportUtilsService },
        sectionHtml: string,
        section: Record<string, unknown>,
        styling: Record<string, unknown>,
      ) => string).call({ utils: new ReportUtilsService() }, '<section></section>', { type: 'comparisons' }, styling);

      for (const html of [report, sectionPreview]) {
        const custom = html.indexOf(customCss);
        expect(custom).toBeGreaterThan(-1);
        for (const block of [REPORT_DETAILS_CSS, REPORT_GROUP_FILTER_CSS]) {
          const at = html.indexOf(block);
          expect(at).toBeGreaterThan(-1);
          expect(at + block.length).toBeLessThanOrEqual(custom);
        }
      }
    });
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
