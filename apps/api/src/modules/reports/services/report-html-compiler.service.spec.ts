/**
 * Unit tests for ReportHtmlCompilerService
 *
 * Tests for HTML compilation including:
 * - renderSections: section ordering, per-renderer dispatch, error fallback
 * - compilePreviewHtml: document structure, CSS variable injection, custom CSS
 * - compileHtml: full document assembly, date stamping, footer, escaping
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ReportHtmlCompilerService } from './report-html-compiler.service';
import { ReportUtilsService } from './report-utils.service';
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
import {
  ReportSectionConfig,
  ReportStyling,
} from '@perfana/shared';
import { TestRun, GeneratedReport } from '../../../entities';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeStyling = (overrides?: Partial<ReportStyling>): ReportStyling => ({
  primaryColor: '#1976d2',
  secondaryColor: '#9c27b0',
  fontFamily: 'Arial, sans-serif',
  customCss: '',
  ...overrides,
});

const makeSection = (
  type: ReportSectionConfig['type'],
  order = 0,
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({ type, order, ...overrides });

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-test-run-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'system-001',
    startTime: new Date('2025-01-01T10:00:00Z'),
    endTime: new Date('2025-01-01T11:00:00Z'),
    duration: 3600,
    ...overrides,
  }) as TestRun;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ReportHtmlCompilerService', () => {
  let service: ReportHtmlCompilerService;

  // Mocked renderer instances
  let headerRenderer: jest.Mocked<HeaderRenderer>;
  let textBlockRenderer: jest.Mocked<TextBlockRenderer>;
  let sloRenderer: jest.Mocked<SloRenderer>;
  let apdexRenderer: jest.Mocked<ApdexRenderer>;
  let transactionResponseTimesRenderer: jest.Mocked<TransactionResponseTimesRenderer>;
  let regressionsRenderer: jest.Mocked<RegressionsRenderer>;
  let awrRenderer: jest.Mocked<AwrRenderer>;
  let trendsRenderer: jest.Mocked<TrendsRenderer>;
  let comparisonsRenderer: jest.Mocked<ComparisonsRenderer>;
  let graphsRenderer: jest.Mocked<GraphsRenderer>;
  let top10ListsRenderer: jest.Mocked<Top10ListsRenderer>;
  let errorAnalysisRenderer: jest.Mocked<ErrorAnalysisRenderer>;
  let placeholderRenderer: jest.Mocked<PlaceholderRenderer>;
  let indexRenderer: jest.Mocked<IndexRenderer>;
  // Real utils so we can verify escaping behaviour without extra mocking noise
  let utils: ReportUtilsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportHtmlCompilerService,
        ReportUtilsService,
        {
          provide: HeaderRenderer,
          useValue: {
            renderHeaderSection: jest.fn().mockResolvedValue('<div>header</div>'),
          },
        },
        {
          provide: TextBlockRenderer,
          useValue: {
            renderTextBlockSection: jest.fn().mockReturnValue('<div>text_block</div>'),
          },
        },
        {
          provide: SloRenderer,
          useValue: {
            renderSloSection: jest.fn().mockResolvedValue('<div>slo</div>'),
          },
        },
        {
          provide: ApdexRenderer,
          useValue: {
            renderApdexSection: jest.fn().mockResolvedValue('<div>apdex</div>'),
          },
        },
        {
          provide: TransactionResponseTimesRenderer,
          useValue: {
            renderTransactionResponseTimesSection: jest.fn().mockResolvedValue('<div>trt</div>'),
          },
        },
        {
          provide: RegressionsRenderer,
          useValue: {
            renderRegressionsSection: jest.fn().mockResolvedValue('<div>regressions</div>'),
          },
        },
        {
          provide: AwrRenderer,
          useValue: {
            renderAwrSection: jest.fn().mockResolvedValue('<div>awr</div>'),
          },
        },
        {
          provide: TrendsRenderer,
          useValue: {
            renderTrendsSection: jest.fn().mockResolvedValue('<div>trends</div>'),
          },
        },
        {
          provide: ComparisonsRenderer,
          useValue: {
            renderComparisonsSection: jest.fn().mockResolvedValue('<div>comparisons</div>'),
          },
        },
        {
          provide: GraphsRenderer,
          useValue: {
            renderGraphsSection: jest.fn().mockReturnValue('<div>graphs</div>'),
          },
        },
        {
          provide: Top10ListsRenderer,
          useValue: {
            renderTop10ListsSection: jest.fn().mockResolvedValue('<div>top_10_lists</div>'),
          },
        },
        {
          provide: ErrorAnalysisRenderer,
          useValue: {
            renderErrorAnalysisSection: jest.fn().mockResolvedValue('<div>error_analysis</div>'),
          },
        },
        {
          provide: PlaceholderRenderer,
          useValue: {
            renderPlaceholderSection: jest
              .fn()
              .mockImplementation(
                (title: string, type: string) => `<div>placeholder:${type}</div>`,
              ),
            renderErrorSection: jest
              .fn()
              .mockImplementation(
                (section: ReportSectionConfig, msg: string) =>
                  `<div class="error-section">${msg}</div>`,
              ),
          },
        },
        {
          provide: IndexRenderer,
          useValue: {
            renderIndexSection: jest.fn().mockReturnValue('<div>index</div>'),
          },
        },
      ],
    }).compile();

    service = module.get(ReportHtmlCompilerService);
    utils = module.get(ReportUtilsService);

    headerRenderer = module.get(HeaderRenderer);
    textBlockRenderer = module.get(TextBlockRenderer);
    sloRenderer = module.get(SloRenderer);
    apdexRenderer = module.get(ApdexRenderer);
    transactionResponseTimesRenderer = module.get(TransactionResponseTimesRenderer);
    regressionsRenderer = module.get(RegressionsRenderer);
    awrRenderer = module.get(AwrRenderer);
    trendsRenderer = module.get(TrendsRenderer);
    comparisonsRenderer = module.get(ComparisonsRenderer);
    graphsRenderer = module.get(GraphsRenderer);
    top10ListsRenderer = module.get(Top10ListsRenderer);
    errorAnalysisRenderer = module.get(ErrorAnalysisRenderer);
    placeholderRenderer = module.get(PlaceholderRenderer);
    indexRenderer = module.get(IndexRenderer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Smoke test
  // =========================================================================

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // =========================================================================
  // renderSections
  // =========================================================================

  describe('renderSections', () => {
    describe('Happy Path Scenarios', () => {
      it('should return empty string when no sections are provided', async () => {
        const result = await service.renderSections([], null, null);
        expect(result).toBe('');
      });

      it('should render a single header section', async () => {
        const sections = [makeSection('header', 0)];
        const result = await service.renderSections(sections, null, null);

        expect(headerRenderer.renderHeaderSection).toHaveBeenCalledTimes(1);
        expect(result).toContain('<div>header</div>');
      });

      it('should render a text_block section', async () => {
        const sections = [makeSection('text_block', 0)];
        await service.renderSections(sections, null, null);

        expect(textBlockRenderer.renderTextBlockSection).toHaveBeenCalledTimes(1);
      });

      it('should render an slo section', async () => {
        const sections = [makeSection('slo', 0)];
        await service.renderSections(sections, null, null);

        expect(sloRenderer.renderSloSection).toHaveBeenCalledTimes(1);
      });

      it('should render an apdex section (async renderer)', async () => {
        const sections = [makeSection('apdex', 0)];
        const result = await service.renderSections(sections, null, null, 'user-1', ['user']);

        expect(apdexRenderer.renderApdexSection).toHaveBeenCalledTimes(1);
        expect(apdexRenderer.renderApdexSection).toHaveBeenCalledWith(
          sections[0],
          null,
          'user-1',
          ['user'],
        );
        expect(result).toContain('<div>apdex</div>');
      });

      it('should render a transaction_response_times section (async renderer)', async () => {
        const sections = [makeSection('transaction_response_times', 0)];
        await service.renderSections(sections, null, null, 'user-1', ['user']);

        expect(transactionResponseTimesRenderer.renderTransactionResponseTimesSection).toHaveBeenCalledWith(
          sections[0],
          null,
          'user-1',
          ['user'],
        );
      });

      it('should render a regressions section', async () => {
        const sections = [makeSection('regressions', 0)];
        await service.renderSections(sections, null, null);

        expect(regressionsRenderer.renderRegressionsSection).toHaveBeenCalledTimes(1);
      });

      it('should render an awr section', async () => {
        const sections = [makeSection('awr', 0)];
        await service.renderSections(sections, null, null);

        expect(awrRenderer.renderAwrSection).toHaveBeenCalledTimes(1);
      });

      it('should render a trends section', async () => {
        const sections = [makeSection('trends', 0)];
        await service.renderSections(sections, null, null);

        expect(trendsRenderer.renderTrendsSection).toHaveBeenCalledTimes(1);
      });

      it('should render a comparisons section', async () => {
        const sections = [makeSection('comparisons', 0)];
        await service.renderSections(sections, null, null);

        expect(comparisonsRenderer.renderComparisonsSection).toHaveBeenCalledTimes(1);
      });

      it('should render a graphs section', async () => {
        const sections = [makeSection('graphs', 0)];
        await service.renderSections(sections, null, null);

        expect(graphsRenderer.renderGraphsSection).toHaveBeenCalledTimes(1);
      });

      it('should render a top_10_lists section (async renderer)', async () => {
        const sections = [makeSection('top_10_lists', 0)];
        await service.renderSections(sections, null, null, 'user-1', ['user']);

        expect(top10ListsRenderer.renderTop10ListsSection).toHaveBeenCalledWith(
          sections[0],
          null,
          'user-1',
          ['user'],
        );
      });

      it('should delegate unknown section types to placeholderRenderer', async () => {
        const sections = [makeSection('unknown_type' as ReportSectionConfig['type'], 0)];
        const result = await service.renderSections(sections, null, null);

        expect(placeholderRenderer.renderPlaceholderSection).toHaveBeenCalledTimes(1);
        expect(result).toContain('placeholder:unknown_type');
      });

      it('should pass testRun and report to renderers that accept them', async () => {
        const testRun = makeTestRun();
        const sections = [makeSection('header', 0), makeSection('slo', 1)];
        await service.renderSections(sections, testRun, null);

        expect(headerRenderer.renderHeaderSection).toHaveBeenCalledWith(sections[0], testRun, '', []);
        expect(sloRenderer.renderSloSection).toHaveBeenCalledWith(sections[1], testRun, '', []);
      });

      it('should concatenate multiple section outputs joined by newline', async () => {
        const sections = [makeSection('header', 0), makeSection('slo', 1)];
        const result = await service.renderSections(sections, null, null);

        expect(result).toContain('<div>header</div>');
        expect(result).toContain('<div>slo</div>');
        // Sections are joined with '\n'
        const parts = result.split('\n');
        expect(parts.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('Section Ordering', () => {
      it('should sort sections by order before rendering', async () => {
        // Provide sections in reverse order to verify sorting
        const sections: ReportSectionConfig[] = [
          makeSection('slo', 2),
          makeSection('header', 0),
          makeSection('text_block', 1),
        ];

        headerRenderer.renderHeaderSection.mockResolvedValue('<div>HEADER</div>');
        textBlockRenderer.renderTextBlockSection.mockReturnValue('<div>TEXT</div>');
        sloRenderer.renderSloSection.mockResolvedValue('<div>SLO</div>');

        const result = await service.renderSections(sections, null, null);

        const headerPos = result.indexOf('HEADER');
        const textPos = result.indexOf('TEXT');
        const sloPos = result.indexOf('SLO');

        expect(headerPos).toBeLessThan(textPos);
        expect(textPos).toBeLessThan(sloPos);
      });

      it('should not mutate the original sections array when sorting', async () => {
        const sections: ReportSectionConfig[] = [
          makeSection('slo', 2),
          makeSection('header', 0),
        ];
        const originalOrder = sections.map((s) => s.type);

        await service.renderSections(sections, null, null);

        expect(sections.map((s) => s.type)).toEqual(originalOrder);
      });
    });

    describe('Error Handling', () => {
      it('should fall back to renderErrorSection when a renderer throws synchronously', async () => {
        headerRenderer.renderHeaderSection.mockImplementation(() => {
          throw new Error('render boom');
        });
        const sections = [makeSection('header', 0)];

        const result = await service.renderSections(sections, null, null);

        expect(placeholderRenderer.renderErrorSection).toHaveBeenCalledTimes(1);
        expect(placeholderRenderer.renderErrorSection).toHaveBeenCalledWith(
          sections[0],
          'render boom',
        );
        expect(result).toContain('render boom');
      });

      it('should fall back to renderErrorSection when an async renderer rejects', async () => {
        apdexRenderer.renderApdexSection.mockRejectedValue(new Error('async failure'));
        const sections = [makeSection('apdex', 0)];

        const result = await service.renderSections(sections, null, null);

        expect(placeholderRenderer.renderErrorSection).toHaveBeenCalledTimes(1);
        expect(result).toContain('async failure');
      });

      it('should render all remaining sections after one fails', async () => {
        headerRenderer.renderHeaderSection.mockImplementation(() => {
          throw new Error('header failed');
        });
        sloRenderer.renderSloSection.mockResolvedValue('<div>slo-ok</div>');

        const sections = [makeSection('header', 0), makeSection('slo', 1)];
        const result = await service.renderSections(sections, null, null);

        // Error section for header
        expect(placeholderRenderer.renderErrorSection).toHaveBeenCalledTimes(1);
        // SLO still rendered
        expect(sloRenderer.renderSloSection).toHaveBeenCalledTimes(1);
        expect(result).toContain('<div>slo-ok</div>');
      });

      it('should not throw when all sections fail', async () => {
        headerRenderer.renderHeaderSection.mockImplementation(() => {
          throw new Error('fail1');
        });
        sloRenderer.renderSloSection.mockImplementation(() => {
          throw new Error('fail2');
        });

        const sections = [makeSection('header', 0), makeSection('slo', 1)];
        await expect(service.renderSections(sections, null, null)).resolves.not.toThrow();
        expect(placeholderRenderer.renderErrorSection).toHaveBeenCalledTimes(2);
      });
    });

    describe('Edge Cases', () => {
      it('should work with null testRun (preview mode)', async () => {
        const sections = [makeSection('header', 0)];
        await expect(service.renderSections(sections, null, null)).resolves.toBeDefined();
      });

      it('should work with null report', async () => {
        const sections = [makeSection('slo', 0)];
        await expect(service.renderSections(sections, null, null)).resolves.toBeDefined();
      });

      it('should default userId to empty string when omitted', async () => {
        const sections = [makeSection('apdex', 0)];
        await service.renderSections(sections, null, null);

        expect(apdexRenderer.renderApdexSection).toHaveBeenCalledWith(
          sections[0],
          null,
          '',
          [],
        );
      });

      it('should handle a large number of sections sequentially', async () => {
        const sectionTypes: ReportSectionConfig['type'][] = [
          'header', 'text_block', 'slo', 'regressions', 'awr', 'trends', 'comparisons', 'graphs',
        ];
        const sections = sectionTypes.map((type, i) => makeSection(type, i));

        const result = await service.renderSections(sections, null, null);
        expect(typeof result).toBe('string');
      });
    });
  });

  // =========================================================================
  // compilePreviewHtml
  // =========================================================================

  describe('compilePreviewHtml', () => {
    describe('Happy Path Scenarios', () => {
      it('should return a valid HTML document', () => {
        const html = service.compilePreviewHtml(
          '<div>content</div>',
          makeSection('slo', 0),
          makeStyling(),
        );

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('</html>');
        expect(html).toContain('<head>');
        expect(html).toContain('<body>');
      });

      it('should inject the sectionHtml into the body', () => {
        const sectionHtml = '<div class="my-section">Hello</div>';
        const html = service.compilePreviewHtml(
          sectionHtml,
          makeSection('slo', 0),
          makeStyling(),
        );

        expect(html).toContain(sectionHtml);
      });

      it('should set the page title using the section type', () => {
        const html = service.compilePreviewHtml(
          '<p/>',
          makeSection('slo', 0),
          makeStyling(),
        );

        // ReportUtilsService.getSectionTitle('slo') returns 'SLO Results'
        expect(html).toContain('SLO Results');
        expect(html).toContain('Section Preview:');
      });

      it('should inject primaryColor CSS variable', () => {
        const html = service.compilePreviewHtml(
          '<p/>',
          makeSection('slo', 0),
          makeStyling({ primaryColor: '#ff0000' }),
        );

        expect(html).toContain('--primary-color: #ff0000');
      });

      it('should inject secondaryColor CSS variable', () => {
        const html = service.compilePreviewHtml(
          '<p/>',
          makeSection('slo', 0),
          makeStyling({ secondaryColor: '#00ff00' }),
        );

        expect(html).toContain('--secondary-color: #00ff00');
      });

      it('should inject custom fontFamily', () => {
        const html = service.compilePreviewHtml(
          '<p/>',
          makeSection('slo', 0),
          makeStyling({ fontFamily: '"Comic Sans MS"' }),
        );

        expect(html).toContain('"Comic Sans MS"');
      });

      it('should inject customCss into the style block', () => {
        const customCss = '.my-class { color: red; }';
        const html = service.compilePreviewHtml(
          '<p/>',
          makeSection('slo', 0),
          makeStyling({ customCss }),
        );

        expect(html).toContain(customCss);
      });
    });

    describe('Default Values', () => {
      it('should use default primaryColor when not provided', () => {
        const styling: ReportStyling = {};
        const html = service.compilePreviewHtml('<p/>', makeSection('slo', 0), styling);

        expect(html).toContain('--primary-color: #1976d2');
      });

      it('should use default secondaryColor when not provided', () => {
        const styling: ReportStyling = {};
        const html = service.compilePreviewHtml('<p/>', makeSection('slo', 0), styling);

        expect(html).toContain('--secondary-color: #9c27b0');
      });

      it('should use system-ui font family when fontFamily not provided', () => {
        const styling: ReportStyling = {};
        const html = service.compilePreviewHtml('<p/>', makeSection('slo', 0), styling);

        expect(html).toContain('system-ui');
      });

      it('should not include extra CSS when customCss is empty string', () => {
        const html = service.compilePreviewHtml(
          '<p/>',
          makeSection('slo', 0),
          makeStyling({ customCss: '' }),
        );

        // Should still produce valid output
        expect(html).toContain('</style>');
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty sectionHtml', () => {
        const html = service.compilePreviewHtml('', makeSection('header', 0), makeStyling());

        expect(html).toContain('<!DOCTYPE html>');
      });

      it('should include standard CSS custom property declarations', () => {
        const html = service.compilePreviewHtml('<p/>', makeSection('slo', 0), makeStyling());

        expect(html).toContain('--success-color: #4caf50');
        expect(html).toContain('--warning-color: #ff9800');
        expect(html).toContain('--error-color: #f44336');
        expect(html).toContain('--info-color: #2196f3');
        expect(html).toContain('--border-color: #e0e0e0');
      });

      it('should include badge CSS classes', () => {
        const html = service.compilePreviewHtml('<p/>', makeSection('slo', 0), makeStyling());

        expect(html).toContain('.badge-success');
        expect(html).toContain('.badge-warning');
        expect(html).toContain('.badge-error');
        expect(html).toContain('.badge-info');
      });

      it('should not include the interactivity script', () => {
        // The editor preview renders in a fully locked (sandbox="") iframe and
        // is a single section — nothing to sort or filter across.
        const html = service.compilePreviewHtml('<p/>', makeSection('slo', 0), makeStyling());

        expect(html).not.toContain('<script>');
        expect(html).not.toContain('report-table-tools');
      });

      it('should produce different titles for different section types', () => {
        const sloHtml = service.compilePreviewHtml('<p/>', makeSection('slo', 0), makeStyling());
        const headerHtml = service.compilePreviewHtml(
          '<p/>',
          makeSection('header', 0),
          makeStyling(),
        );

        expect(sloHtml).toContain('SLO Results');
        expect(headerHtml).toContain('Report Header');
      });
    });
  });

  // =========================================================================
  // compileHtml
  // =========================================================================

  describe('compileHtml', () => {
    describe('Happy Path Scenarios', () => {
      it('should return a valid HTML document', () => {
        const html = service.compileHtml('My Report', '<section>body</section>', makeStyling());

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('</html>');
      });

      it('should include the report name in the title tag', () => {
        const html = service.compileHtml('Perf Report 2025', '<section/>', makeStyling());

        expect(html).toContain('Perf Report 2025 - Perfana Performance Report');
      });

      it('should embed the sectionsHtml in the body', () => {
        const sectionsHtml = '<section class="slo-section">data</section>';
        const html = service.compileHtml('My Report', sectionsHtml, makeStyling());

        expect(html).toContain(sectionsHtml);
      });

      it('should include a Perfana footer', () => {
        const html = service.compileHtml('My Report', '<p/>', makeStyling());

        expect(html).toContain('Perfana Performance Analysis Platform');
        expect(html).toContain('Continuous Performance Testing & Analysis');
        expect(html).toContain('<footer>');
      });

      it('should include a page-header div', () => {
        const html = service.compileHtml('My Report', '<p/>', makeStyling());

        expect(html).toContain('class="page-header"');
      });

      it('should include the report name in the page-header span', () => {
        const html = service.compileHtml('My Report', '<p/>', makeStyling());

        // The report name appears twice: title tag + page-header
        const occurrences = (html.match(/My Report/g) ?? []).length;
        expect(occurrences).toBeGreaterThanOrEqual(2);
      });

      it('should include a generated date in the footer', () => {
        const html = service.compileHtml('My Report', '<p/>', makeStyling());

        expect(html).toContain('Generated:');
      });

      it('should include the table interactivity script and its styles', () => {
        const html = service.compileHtml('My Report', '<p/>', makeStyling());

        expect(html).toContain('.report-table-tools');
        expect(html).toContain('<script>');
        // The controls are injected by the script, never emitted as markup —
        // that is what keeps the script-blocked iframe viewers unchanged.
        expect(html).not.toContain('class="report-table-tools"');
        // The script sits inside <body>, before the closing tag.
        expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('<footer>'));
        expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</body>'));
      });

      it('should let customCss override the interactivity styles', () => {
        const html = service.compileHtml(
          'My Report',
          '<p/>',
          makeStyling({ customCss: '.report-table-tools { display: none; }' }),
        );

        expect(html.lastIndexOf('.report-table-tools { display: none; }')).toBeGreaterThan(
          html.indexOf('.report-table-count'),
        );
      });

      it('should inject primaryColor CSS variable', () => {
        const html = service.compileHtml(
          'Report',
          '<p/>',
          makeStyling({ primaryColor: '#abcdef' }),
        );

        expect(html).toContain('--primary-color: #abcdef');
      });

      it('should inject secondaryColor CSS variable', () => {
        const html = service.compileHtml(
          'Report',
          '<p/>',
          makeStyling({ secondaryColor: '#fedcba' }),
        );

        expect(html).toContain('--secondary-color: #fedcba');
      });

      it('should inject custom fontFamily', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling({ fontFamily: 'Georgia' }));

        expect(html).toContain('Georgia');
      });

      it('should inject customCss into the style block', () => {
        const css = '.custom { display: none; }';
        const html = service.compileHtml('Report', '<p/>', makeStyling({ customCss: css }));

        expect(html).toContain(css);
      });
    });

    describe('HTML Escaping', () => {
      it('should escape angle brackets in the report name within the title tag', () => {
        const html = service.compileHtml('<script>evil</script>', '<p/>', makeStyling());

        expect(html).not.toContain('<script>evil</script>');
        expect(html).toContain('&lt;script&gt;evil&lt;/script&gt;');
      });

      it('should escape ampersands in the report name', () => {
        const html = service.compileHtml('A & B Report', '<p/>', makeStyling());

        // Inside title/page-header the utils.escapeHtml is called
        expect(html).toContain('A &amp; B Report');
      });

      it('should escape double-quotes in the report name', () => {
        const html = service.compileHtml('"Quoted" Report', '<p/>', makeStyling());

        expect(html).toContain('&quot;Quoted&quot; Report');
      });
    });

    describe('Default Values', () => {
      it('should use default primaryColor when styling is empty', () => {
        const html = service.compileHtml('Report', '<p/>', {});

        expect(html).toContain('--primary-color: #1976d2');
      });

      it('should use default secondaryColor when styling is empty', () => {
        const html = service.compileHtml('Report', '<p/>', {});

        expect(html).toContain('--secondary-color: #9c27b0');
      });

      it('should fall back to system-ui font when fontFamily is not provided', () => {
        const html = service.compileHtml('Report', '<p/>', {});

        expect(html).toContain('system-ui');
      });

      it('should produce empty customCss block when customCss is not provided', () => {
        // Should not throw; valid output expected
        const html = service.compileHtml('Report', '<p/>', {});

        expect(html).toContain('</style>');
      });
    });

    describe('CSS Structure', () => {
      it('should declare comprehensive CSS custom properties', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling());

        expect(html).toContain('--success-color: #4caf50');
        expect(html).toContain('--error-color: #f44336');
        expect(html).toContain('--warning-color: #ff9800');
        expect(html).toContain('--info-color: #2196f3');
        expect(html).toContain('--border-color: #e0e0e0');
      });

      it('should include badge CSS classes for all severity levels', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling());

        expect(html).toContain('.badge-success');
        expect(html).toContain('.badge-error');
        expect(html).toContain('.badge-warning');
        expect(html).toContain('.badge-info');
      });

      it('should include print media query', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling());

        expect(html).toContain('@media print');
      });

      it('should include cover-page styles', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling());

        expect(html).toContain('.cover-page');
      });

      it('should include data-table styles', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling());

        expect(html).toContain('.data-table');
      });

      it('should use primaryColor in gradient for cover-page h1', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling({ primaryColor: '#aabbcc' }));

        expect(html).toContain('#aabbcc');
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty sectionsHtml', () => {
        const html = service.compileHtml('Report', '', makeStyling());

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('Perfana Performance Analysis Platform');
      });

      it('should handle empty report name', () => {
        // Empty string: escapeHtml('') returns ''
        const html = service.compileHtml('', '<p/>', makeStyling());

        expect(html).toContain('<!DOCTYPE html>');
      });

      it('should handle very long report names without truncation', () => {
        const longName = 'A'.repeat(500);
        const html = service.compileHtml(longName, '<p/>', makeStyling());

        // Should appear escaped in the title
        expect(html).toContain(longName);
      });

      it('should include charset UTF-8 meta tag', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling());

        expect(html).toContain('charset="UTF-8"');
      });

      it('should include viewport meta tag', () => {
        const html = service.compileHtml('Report', '<p/>', makeStyling());

        expect(html).toContain('name="viewport"');
      });
    });
  });

  // =========================================================================
  // Integration: renderSections -> compileHtml end-to-end
  // =========================================================================

  describe('End-to-End: renderSections into compileHtml', () => {
    it('should produce a complete HTML document from multiple sections', async () => {
      headerRenderer.renderHeaderSection.mockResolvedValue(
        '<div class="cover-page"><h1>Test</h1></div>',
      );
      sloRenderer.renderSloSection.mockResolvedValue(
        '<section><h2>SLO Results</h2><p>All passed</p></section>',
      );

      const sections = [makeSection('header', 0), makeSection('slo', 1)];
      const sectionsHtml = await service.renderSections(
        sections,
        makeTestRun(),
        null,
        'user-1',
        ['admin'],
      );
      const finalHtml = service.compileHtml('My Performance Report', sectionsHtml, makeStyling());

      expect(finalHtml).toContain('<!DOCTYPE html>');
      expect(finalHtml).toContain('<div class="cover-page">');
      expect(finalHtml).toContain('<section><h2>SLO Results</h2>');
      expect(finalHtml).toContain('My Performance Report');
      expect(finalHtml).toContain('Perfana Performance Analysis Platform');
    });

    it('should produce a valid preview document for a single section', async () => {
      sloRenderer.renderSloSection.mockResolvedValue('<p>SLO data here</p>');

      const section = makeSection('slo', 0);
      const sectionHtml = await service.renderSections([section], makeTestRun(), null);
      const previewHtml = service.compilePreviewHtml(sectionHtml, section, makeStyling());

      expect(previewHtml).toContain('<!DOCTYPE html>');
      expect(previewHtml).toContain('SLO data here');
      expect(previewHtml).toContain('SLO Results');
    });
  });
});

describe('ReportHtmlCompilerService screen measure', () => {
  // The report is a document. On a wide monitor it used to stretch to the full window, so lines
  // ran past any comfortable reading length.
  const html = () =>
    new ReportHtmlCompilerService(
      { getSectionTitle: (t: string) => t, escapeHtml: (v: string) => v } as never,
      { render: jest.fn() } as never,
    ).compileHtml('Report', '<section>x</section>', {} as never);

  it('holds the report to a fixed, centred measure on screen', () => {
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));

    expect(screenBlock).toMatch(/max-width:\s*340mm/);
    expect(screenBlock).toMatch(/margin-left:\s*auto/);
    expect(screenBlock).toMatch(/margin-right:\s*auto/);
  });

  it('is wider than A4, because A4 clipped the widest tables', () => {
    // The regressions table is seven columns; at 210mm it lost Diff % and Status entirely.
    // Guards against someone "restoring" A4 without re-checking that content against it.
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));

    const measure = /max-width:\s*(\d+)mm/.exec(screenBlock);
    expect(Number(measure?.[1])).toBeGreaterThanOrEqual(320);
  });

  it('keeps a side margin, so text does not run to the very edge', () => {
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));

    expect(screenBlock).toMatch(/padding:\s*20mm\s+15mm/);
  });

  it('scopes the constraint to screen, so print is not inset twice', () => {
    // Puppeteer's page box already sets the printed width, and the print block zeroes padding.
    const out = html();

    expect(out.indexOf('@media screen')).toBeGreaterThan(-1);
    // Anchor on the section marker: the screen block's own comment mentions "@media print".
    const printBlock = out.slice(out.indexOf('/* Print Styles */'));
    expect(printBlock).toMatch(/padding:\s*0/);
    expect(printBlock).not.toMatch(/max-width:\s*340mm/);
  });

  it('paints the page background so the centred column is not a grey stripe', () => {
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));

    expect(screenBlock).toMatch(/html\s*\{[^}]*background-color/);
  });
});

describe('ReportHtmlCompilerService print scale', () => {
  const html = () =>
    new ReportHtmlCompilerService(
      { getSectionTitle: (t: string) => t, escapeHtml: (v: string) => v } as never,
      { render: jest.fn() } as never,
    ).compileHtml('Report', '<section>x</section>', {} as never);

  it('scales the printed page down, so wide tables fit the 180mm column', () => {
    // Without this the regressions table runs off the right edge of the page and its Status
    // column is simply gone — and paper has no scrollbar to recover it.
    const out = html();
    const printBlock = out.slice(out.indexOf('/* Print Styles */'));

    expect(printBlock).toMatch(/zoom:\s*0\.8/);
  });

  it('scales with zoom, not transform, so pagination follows the scaled layout', () => {
    // transform: scale paints smaller without relaying out, so page breaks would still fall at
    // the unscaled positions and cut through rows.
    const out = html();

    // Scoped to the print block, and only after proving the block was actually found: an
    // unanchored slice that misses its marker is empty, and every not.toMatch over an empty
    // string passes vacuously.
    const printStart = out.indexOf('/* Print Styles */');
    expect(printStart).toBeGreaterThan(-1);
    const printBlock = out.slice(printStart);
    expect(printBlock).toMatch(/zoom:\s*0\.8/);
    expect(printBlock).not.toMatch(/transform:\s*scale\([^)]*\)\s*;/);
  });

  it('leaves the screen measure unscaled', () => {
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));

    expect(screenBlock).not.toMatch(/zoom:/);
  });
});

describe('ReportHtmlCompilerService cover page height', () => {
  const html = () =>
    new ReportHtmlCompilerService(
      { getSectionTitle: (t: string) => t, escapeHtml: (v: string) => v } as never,
      { render: jest.fn() } as never,
    ).compileHtml('Report', '<section>x</section>', {} as never);

  it('gives the cover a page height on screen, not the container height', () => {
    // 100vh means "as tall as whatever this lands in", and the report renders inside an iframe:
    // in a tall one the cover became screens of gradient with the title marooned in the middle.
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));

    expect(screenBlock).toMatch(/\.cover-page\s*\{[^}]*min-height:\s*257mm/);
  });

  it('declares the screen overrides after the rules they override', () => {
    // A media query adds no specificity, so source order decides. With the block above
    // .cover-page, its 100vh won and the override silently did nothing.
    const out = html();

    expect(out.indexOf('.cover-page {')).toBeLessThan(out.indexOf('@media screen'));
  });

  it('leaves the printed cover on 100vh, where the container is the page box', () => {
    const out = html();
    const beforeScreen = out.slice(0, out.indexOf('@media screen'));

    expect(beforeScreen).toMatch(/\.cover-page\s*\{[^}]*min-height:\s*100vh/);
  });
});

describe('ReportHtmlCompilerService wide tables', () => {
  const html = () =>
    new ReportHtmlCompilerService(
      { getSectionTitle: (t: string) => t, escapeHtml: (v: string) => v } as never,
      { render: jest.fn() } as never,
    ).compileHtml('Report', '<section>x</section>', {} as never);

  it('scrolls a too-wide table in its own container, not the whole section', () => {
    // The regressions list and per-transaction Apdex breakdown carry more columns than 180mm
    // holds. Unconstrained they ran out of their card and off the page.
    //
    // The container must be .table-scroll, not the section: on the section the scrollbar
    // landed at the bottom of the whole padded card, the card's right padding collapsed at
    // the end of the scroll, and overflow-y computed from visible to auto.
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));

    expect(screenBlock).toMatch(/\.table-scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(screenBlock).not.toMatch(/^\s*section\s*\{[^}]*overflow-x:\s*auto/m);
  });

  it('caps the prose measure without capping the tables', () => {
    // Body copy ran to 150-170 characters at the 340mm table measure.
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));

    expect(screenBlock).toMatch(/\.section-text[\s\S]*?max-width:\s*75ch/);
  });

  it('lifts screen body text to the 16px floor, leaving print at 11pt', () => {
    const out = html();
    const screenBlock = out.slice(out.indexOf('@media screen'), out.indexOf('/* Print Styles */'));
    const printBlock = out.slice(out.indexOf('/* Print Styles */'));

    expect(screenBlock).toMatch(/body\s*\{[^}]*font-size:\s*16px/);
    expect(printBlock).not.toMatch(/font-size:\s*16px/);
  });

  it('does not force columns to equal shares', () => {
    // table-layout:fixed was tried: it squashed the per-transaction tables until the text
    // overlapped, and the widest table still did not fit.
    // A declaration at the start of a line — the rejected approach is still named in a
    // comment, which is the point of the comment.
    expect(html()).not.toMatch(/^\s*table-layout:\s*fixed/m);
  });
});

describe('ReportHtmlCompilerService info grid', () => {
  const html = () =>
    new ReportHtmlCompilerService(
      { getSectionTitle: (t: string) => t, escapeHtml: (v: string) => v } as never,
      { render: jest.fn() } as never,
    ).compileHtml('Report', '<section>x</section>', {} as never);

  it('gives the summary grid columns a zero floor', () => {
    // 1fr floors a column at its content width, so one unbreakable value (a long release name)
    // widened the grid past the page and the trailing column was clipped out of the PDF.
    expect(html()).toMatch(/\.info-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('lets data cells break anywhere but leaves headers alone', () => {
    // A header that breaks anywhere lets the browser shrink the column to almost nothing —
    // "TRANSACTION NAME" came out as "TRANSACTI ON NAME" over three lines.
    const out = html();
    expect(out).toMatch(/\.data-table td\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(out).not.toMatch(/\.data-table th\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
