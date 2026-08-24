/**
 * The anchor contract, pinned end-to-end instead of by inspection.
 *
 * Three sites must agree on the same slug:
 *   1. the compiler's `<a id="…">` stamped before each linkable section,
 *   2. the index renderer's `href="#…"`,
 *   3. the web builder's inserted `[title](#…)` markdown.
 *
 * Sites 1 and 2 both live in the API and are checked here by running the real
 * compiler and the real index renderer together and then feeding the output to
 * the real `ReportGenerationValidatorService.findDeadAnchors` — the same dead-link
 * detector production uses. A drift between the two shows up as a dead anchor.
 *
 * Site 3 is pinned in apps/web (SectionLinkAnchorContract.test.tsx) against the
 * same literal slugs, because apps/web cannot import API code.
 *
 * These sections are deliberately UNTITLED: since `handleAddSection` stopped
 * stamping the palette label onto new sections, the default-title path
 * (SECTION_RENDER_TITLES) is the common case, not the exotic one.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ReportHtmlCompilerService } from './report-html-compiler.service';
import { ReportUtilsService } from './report-utils.service';
import { ReportGenerationValidatorService } from './report-generation-validator.service';
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

const stubRenderer = (marker: string) => ({
  [marker]: jest.fn().mockResolvedValue(`<section class="${marker}"></section>`),
});

const idsIn = (html: string): string[] =>
  [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1] as string);

const indexHrefsIn = (html: string): string[] =>
  [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1] as string);

describe('report anchor contract (compiler id ⇄ index href)', () => {
  let service: ReportHtmlCompilerService;
  let validator: ReportGenerationValidatorService;

  const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig =>
    ({ type: 'slo', order: 0, ...over }) as ReportSectionConfig;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ReportHtmlCompilerService, ReportUtilsService, IndexRenderer],
    })
      .useMocker(token => {
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
    validator = new ReportGenerationValidatorService();
  });

  it('every index link resolves to an anchor the compiler actually stamped', async () => {
    const html = await service.renderSections(
      [
        section({ type: 'header', order: 0 }),
        section({ type: 'index', order: 1 }),
        section({ type: 'slo', order: 2 }),
        section({ type: 'text_block', order: 3, config: { content: 'prose' } }),
        section({ type: 'graphs', order: 4 }),
        section({ type: 'error_analysis', order: 5 }),
      ],
      null,
      null,
    );

    expect(validator.findDeadAnchors(html)).toEqual([]);
  });

  it('the index href set is exactly the stamped id set, for untitled sections', async () => {
    // Slugs derive from SECTION_RENDER_TITLES ("SLO Results", "Custom Graphs",
    // "Error Analysis"), which ReportUtilsService.getSectionTitle pins literally.
    const html = await service.renderSections(
      [
        section({ type: 'header', order: 0 }),
        section({ type: 'index', order: 1 }),
        section({ type: 'slo', order: 2 }),
        section({ type: 'graphs', order: 3 }),
        section({ type: 'error_analysis', order: 4 }),
      ],
      null,
      null,
    );

    expect(idsIn(html)).toEqual(['slo-results', 'custom-graphs', 'error-analysis']);
    expect(indexHrefsIn(html)).toEqual(['slo-results', 'custom-graphs', 'error-analysis']);
  });

  it('keeps id and href in step when two sections share a default title', async () => {
    const html = await service.renderSections(
      [
        section({ type: 'index', order: 0 }),
        section({ type: 'graphs', order: 1 }),
        section({ type: 'graphs', order: 2 }),
      ],
      null,
      null,
    );

    expect(idsIn(html)).toEqual(['custom-graphs', 'custom-graphs-2']);
    expect(indexHrefsIn(html)).toEqual(['custom-graphs', 'custom-graphs-2']);
    expect(validator.findDeadAnchors(html)).toEqual([]);
  });

  it('does not orphan the index link to a section whose renderer threw', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ReportHtmlCompilerService, ReportUtilsService, IndexRenderer],
    })
      .useMocker(token => {
        if (token === ReportUtilsService) return undefined;
        if (token === IndexRenderer) return undefined;
        if (token === SloRenderer)
          return { renderSloSection: jest.fn().mockRejectedValue(new Error('boom')) };
        if (token === PlaceholderRenderer)
          return {
            renderPlaceholderSection: jest.fn().mockReturnValue('<section class="placeholder"></section>'),
            renderErrorSection: jest.fn().mockReturnValue('<section class="error"></section>'),
          };
        return { render: jest.fn() };
      })
      .compile();

    const failing = moduleRef.get(ReportHtmlCompilerService);
    const html = await failing.renderSections(
      [section({ type: 'index', order: 0 }), section({ type: 'slo', order: 1 })],
      null,
      null,
    );

    expect(html).toContain('id="slo-results"');
    expect(html).toContain('href="#slo-results"');
    expect(validator.findDeadAnchors(html)).toEqual([]);
  });
});
