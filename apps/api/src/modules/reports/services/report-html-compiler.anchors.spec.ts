import { Test, TestingModule } from '@nestjs/testing';
import { ReportHtmlCompilerService } from './report-html-compiler.service';
import { ReportUtilsService } from './report-utils.service';
import { ReportSectionConfig } from '@perfana/shared';
import { HeaderRenderer } from '../renderers/header-renderer';
import { TextBlockRenderer } from '../renderers/text-block-renderer';
import { SloRenderer } from '../renderers/slo-renderer';
import { ApdexRenderer } from '../renderers/apdex-renderer';
import { TransactionResponseTimesRenderer } from '../renderers/transaction-response-times-renderer';
import { RegressionsRenderer } from '../renderers/regressions-renderer';
import { AwrRenderer } from '../renderers/awr-renderer';
import { TrendsRenderer } from '../renderers/trends-renderer';
import { ComparisonsRenderer } from '../renderers/comparisons-renderer';
import { GraphsRenderer } from '../renderers/graphs-renderer';
import { Top10ListsRenderer } from '../renderers/top-10-lists-renderer';
import { ErrorAnalysisRenderer } from '../renderers/error-analysis-renderer';
import { PlaceholderRenderer } from '../renderers/placeholder-renderer';
import { IndexRenderer } from '../renderers/index-renderer';

// Every renderer is stubbed: this suite is about the anchors the compiler emits
// around section HTML, not about what any renderer produces. Each stub exposes
// only the exact method renderSection() calls on that renderer, so a section
// that fails to render falls through to the real placeholder path instead of
// throwing on an unrelated mock shape.
const stubRenderer = (marker: string) => ({
  [marker]: jest.fn().mockResolvedValue(`<section class="${marker}"></section>`),
});

describe('ReportHtmlCompilerService anchors', () => {
  let service: ReportHtmlCompilerService;
  let moduleRef: TestingModule;

  const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig =>
    ({ type: 'slo', order: 0, ...over }) as ReportSectionConfig;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        ReportHtmlCompilerService,
        ReportUtilsService,
        // IndexRenderer is real too (not stubbed) — the Step 7 test below
        // asserts on the actual anchors it renders, not on a marker string.
        IndexRenderer,
        // Renderer providers are supplied by the module in production; the
        // helper below replaces whichever ones each test needs.
      ],
    })
      .useMocker((token) => {
        if (token === ReportUtilsService) return undefined;
        if (token === IndexRenderer) return undefined;
        if (token === HeaderRenderer) return stubRenderer('renderHeaderSection');
        if (token === TextBlockRenderer) return stubRenderer('renderTextBlockSection');
        if (token === SloRenderer) return stubRenderer('renderSloSection');
        if (token === ApdexRenderer) return stubRenderer('renderApdexSection');
        if (token === TransactionResponseTimesRenderer)
          return stubRenderer('renderTransactionResponseTimesSection');
        if (token === RegressionsRenderer) return stubRenderer('renderRegressionsSection');
        if (token === AwrRenderer) return stubRenderer('renderAwrSection');
        if (token === TrendsRenderer) return stubRenderer('renderTrendsSection');
        if (token === ComparisonsRenderer) return stubRenderer('renderComparisonsSection');
        if (token === GraphsRenderer) return stubRenderer('renderGraphsSection');
        if (token === Top10ListsRenderer) return stubRenderer('renderTop10ListsSection');
        if (token === ErrorAnalysisRenderer) return stubRenderer('renderErrorAnalysisSection');
        if (token === PlaceholderRenderer)
          return {
            renderPlaceholderSection: jest.fn().mockReturnValue('<section class="placeholder"></section>'),
            renderErrorSection: jest.fn().mockReturnValue('<section class="error"></section>'),
          };
        return { render: jest.fn() };
      })
      .compile();

    service = moduleRef.get(ReportHtmlCompilerService);
  });

  it('emits an anchor before a section, slugged from its title', async () => {
    const html = await service.renderSections(
      [section({ type: 'slo', order: 0, title: 'SLO Results' })],
      null,
      null,
    );
    expect(html).toContain(
      '<a id="section-slo-results" class="section-anchor" aria-hidden="true"></a>',
    );
  });

  it('uses the type default title when the section has none', async () => {
    const html = await service.renderSections([section({ type: 'trends', order: 0 })], null, null);
    expect(html).toContain('id="section-trends"');
  });

  it('emits no anchor for a text block', async () => {
    const html = await service.renderSections(
      [section({ type: 'text_block', order: 0, config: { content: 'hi' } })],
      null,
      null,
    );
    expect(html).not.toContain('class="section-anchor"');
  });

  it('emits no anchor for a header section', async () => {
    const html = await service.renderSections(
      [section({ type: 'header', order: 0 })],
      null,
      null,
    );
    expect(html).not.toContain('class="section-anchor"');
  });

  it('emits no anchor for an index section', async () => {
    const html = await service.renderSections(
      [section({ type: 'index', order: 0 })],
      null,
      null,
    );
    expect(html).not.toContain('class="section-anchor"');
  });

  it('still anchors a section whose renderer throws', async () => {
    const sloRenderer = moduleRef.get(SloRenderer);
    (sloRenderer.renderSloSection as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    const html = await service.renderSections(
      [section({ type: 'slo', order: 0, title: 'SLO Results' })],
      null,
      null,
    );

    // The slug was reserved before rendering began, so the failed section
    // must still be a valid link target — it just resolves to the error
    // placeholder instead of the renderer's own markup.
    expect(html).toContain(
      '<a id="section-slo-results" class="section-anchor" aria-hidden="true"></a>',
    );
    expect(html).toContain('<section class="error"></section>');
  });

  it('suffixes a duplicate title in document order', async () => {
    const html = await service.renderSections(
      [
        section({ type: 'graphs', order: 0, title: 'Graphs' }),
        section({ type: 'graphs', order: 1, title: 'Graphs' }),
      ],
      null,
      null,
    );
    expect(html).toContain('id="section-graphs"');
    expect(html).toContain('id="section-graphs-2"');
  });

  it('anchors by sorted order, not array order', async () => {
    const html = await service.renderSections(
      [
        section({ type: 'graphs', order: 5, title: 'Graphs' }),
        section({ type: 'graphs', order: 1, title: 'Graphs' }),
      ],
      null,
      null,
    );
    // The order:1 section renders first, so it owns the bare slug.
    expect(html.indexOf('id="section-graphs"')).toBeLessThan(html.indexOf('id="section-graphs-2"'));
  });

  it('lists every target section but not itself, a header, or a text block', async () => {
    const html = await service.renderSections(
      [
        section({ type: 'header', order: 0 }),
        section({ type: 'index', order: 1 }),
        section({ type: 'slo', order: 2, title: 'SLO Results' }),
        section({ type: 'text_block', order: 3, config: { content: 'prose' } }),
      ],
      null,
      null,
    );
    expect(html).toContain('href="#section-slo-results"');
    expect(html).not.toContain('href="#index"');
    expect(html).not.toContain('href="#text"');
    expect(html).not.toContain('href="#header"');
    expect(html).not.toContain('href="#report-header"');
  });
});
