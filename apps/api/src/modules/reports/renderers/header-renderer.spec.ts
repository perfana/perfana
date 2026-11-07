import { Test, TestingModule } from '@nestjs/testing';
import { HeaderRenderer } from './header-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({
  type: 'header',
  order: 0,
  ...overrides,
});

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'my-system',
    applicationRelease: 'v2.0.0',
    startTime: new Date('2025-06-01T10:00:00Z'),
    endTime: new Date('2025-06-01T11:00:00Z'),
    duration: 3600,
    annotations: [],
    ...overrides,
  }) as TestRun;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('HeaderRenderer', () => {
  let renderer: HeaderRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeaderRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getSloSummary: jest.fn().mockResolvedValue({ passed: 5, failed: 0, total: 5 }),
            getAnomalySummary: jest.fn().mockResolvedValue({
              conclusion: 'PASSED',
              regressionCount: 0,
              improvementCount: 2,
            }),
          },
        },
      ],
    }).compile();

    renderer = module.get(HeaderRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  describe('cover page', () => {
    it('should render cover page by default', async () => {
      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).toContain('class="cover-page"');
      expect(html).toContain('Performance Test Report');
      expect(html).toContain('my-system');
      expect(html).toContain('staging');
      expect(html).toContain('load-test');
      expect(html).toContain('run-001');
    });

    it('should show the system under test name, not its UUID, when the relation is loaded', async () => {
      const testRun = makeTestRun({
        systemUnderTestId: '70e6172c-9248-42e8-81eb-a5f121b00525',
        systemUnderTest: { name: 'MyShop Webshop' },
      } as Partial<TestRun>);

      const html = await renderer.renderHeaderSection(makeSection(), testRun);

      expect(html).toContain('MyShop Webshop');
      expect(html).not.toContain('70e6172c-9248-42e8-81eb-a5f121b00525');
    });

    it('should use custom title and subtitle', async () => {
      const section = makeSection({
        config: { title: 'Sprint 42 Report', subtitle: 'Nightly Load Test' },
      });
      const html = await renderer.renderHeaderSection(section, makeTestRun());

      expect(html).toContain('Sprint 42 Report');
      expect(html).toContain('Nightly Load Test');
    });

    describe('the builder form', () => {
      // REGRESSION GUARD. The form writes `config.text` and `config.level`; this renderer read
      // `config.title` and hardcoded <h1>, so both fields were saved and shown on the card and
      // never reached a report, with nothing logged.
      it('should use Header Text as the cover title', async () => {
        const section = makeSection({ config: { text: 'Nightly regression run' } });
        const html = await renderer.renderHeaderSection(section, makeTestRun());

        expect(html).toContain('<h1>Nightly regression run</h1>');
        expect(html).not.toContain('Performance Test Report');
      });

      it('should let Header Text win over a title the form cannot see', async () => {
        const section = makeSection({ config: { title: 'From the API', text: 'From the form' } });
        const html = await renderer.renderHeaderSection(section, makeTestRun());

        expect(html).toContain('From the form');
        expect(html).not.toContain('From the API');
      });

      it('should fall back past blank text to the title and then the default', async () => {
        const titled = makeSection({ config: { title: 'From the API', text: '   ' } });
        const blank = makeSection({ config: { text: '   ' } });

        expect(await renderer.renderHeaderSection(titled, makeTestRun())).toContain('<h1>From the API</h1>');
        expect(await renderer.renderHeaderSection(blank, makeTestRun())).toContain('<h1>Performance Test Report</h1>');
      });

      it('should escape Header Text', async () => {
        const section = makeSection({ config: { text: '<img onerror=alert(1)>' } });
        const html = await renderer.renderHeaderSection(section, makeTestRun());

        expect(html).not.toContain('<img onerror');
        expect(html).toContain('&lt;img onerror');
      });

      it.each([1, 2, 3, 4, 5, 6])('should render level %i as that heading tag', async (level) => {
        const section = makeSection({ config: { text: 'Levelled', level } });
        const html = await renderer.renderHeaderSection(section, makeTestRun());

        expect(html).toContain(`<h${level}>Levelled</h${level}>`);
      });

      // `level` is unvalidated JSON that lands in a tag name, so this is an injection check too.
      it.each([[0], [7], [2.5], ['script'], ['1><script>alert(1)</script>'], [null], [undefined]])(
        'should fall back to h1 for level %p',
        async (level) => {
          const section = makeSection({ config: { text: 'Levelled', level } });
          const html = await renderer.renderHeaderSection(section, makeTestRun());

          expect(html).toContain('<h1>Levelled</h1>');
          expect(html).not.toContain('<script>');
        },
      );

      it('should use the Section Title as the summary heading', async () => {
        const html = await renderer.renderHeaderSection(makeSection({ title: 'Overview' }), makeTestRun());

        expect(html).toContain('<h2>Overview</h2>');
        expect(html).not.toContain('Test Run Summary');
      });

      it('should escape the Section Title', async () => {
        const html = await renderer.renderHeaderSection(makeSection({ title: '<b>x</b>' }), makeTestRun());

        expect(html).toContain('<h2>&lt;b&gt;x&lt;/b&gt;</h2>');
      });
    });

    it('should skip cover page when includeCoverPage is false', async () => {
      const section = makeSection({ config: { includeCoverPage: false } });
      const html = await renderer.renderHeaderSection(section, makeTestRun());

      expect(html).not.toContain('class="cover-page"');
    });
  });

  describe('summary section', () => {
    it('should render test run summary by default', async () => {
      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).toContain('Test Run Summary');
      expect(html).toContain('v2.0.0'); // applicationRelease
      expect(html).toContain('1h'); // formatted duration (3600s)
    });

    it('should skip summary when includeSummary is false', async () => {
      const section = makeSection({ config: { includeSummary: false } });
      const html = await renderer.renderHeaderSection(section, makeTestRun());

      expect(html).not.toContain('Test Run Summary');
    });

    it('should show SLO pass status with success badge', async () => {
      dataFetcher.getSloSummary.mockResolvedValue({ passed: 3, failed: 0, total: 3 });

      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).toContain('3/3 PASSED');
      expect(html).toContain('badge-success');
    });

    it('should show SLO fail status with error badge', async () => {
      dataFetcher.getSloSummary.mockResolvedValue({ passed: 2, failed: 1, total: 3 });

      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).toContain('2/3 PASSED');
      expect(html).toContain('badge-error');
    });

    it('should show regressions with warning badge', async () => {
      dataFetcher.getAnomalySummary.mockResolvedValue({
        conclusion: 'regressions_detected',
        regressionCount: 3,
        improvementCount: 0,
      });

      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).toContain('3 REGRESSIONS DETECTED');
      expect(html).toContain('badge-warning');
    });

    it('should show no regressions with success badge', async () => {
      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).toContain('NO REGRESSIONS');
      expect(html).toContain('badge-success');
    });

    it('should not pluralize a single regression', async () => {
      dataFetcher.getAnomalySummary.mockResolvedValue({
        conclusion: 'REGRESSION',
        regressionCount: 1,
        improvementCount: 0,
      });

      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).toContain('1 REGRESSION DETECTED');
    });

    // REGRESSION GUARD. A run ADAPT never compared has zero regressions for a different reason.
    // The badge keyed on the count alone, so the summary read a green NO REGRESSIONS directly
    // above an Anomaly Detection section saying N/A.
    it.each(['INSUFFICIENT_DATA', 'SKIPPED', 'NO_BASELINES_FOUND', 'no_data', 'unknown'])(
      'should not claim a pass for conclusion %s',
      async (conclusion) => {
        dataFetcher.getAnomalySummary.mockResolvedValue({ conclusion, regressionCount: 0, improvementCount: 0 });

        const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

        expect(html).toContain('NOT EVALUATED');
        expect(html).not.toContain('NO REGRESSIONS');
        // The SLO row above it is a real pass and keeps its own badge-success.
        expect(html).toContain('<span class="badge badge-info">NOT EVALUATED</span>');
      },
    );

    it('should not claim a pass when the only regressions are tracked ones', async () => {
      // buildConclusionSQL says REGRESSION on tracked_regression_count alone, and a tracked
      // regression is not in the `regressions` array the count comes from.
      dataFetcher.getAnomalySummary.mockResolvedValue({
        conclusion: 'REGRESSION',
        regressionCount: 0,
        improvementCount: 0,
      });

      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).toContain('<span class="badge badge-warning">REGRESSIONS DETECTED</span>');
      expect(html).not.toContain('NO REGRESSIONS');
    });
  });

  describe('section text', () => {
    it('should render the accompanying text under the Test Run Summary heading', async () => {
      const section = makeSection({ comment: 'Baseline re-established this sprint' });

      const html = await renderer.renderHeaderSection(section, makeTestRun());

      expect(html).toContain('section-text');
      expect(html).toContain('Baseline re-established this sprint');
      // The accompanying text renders inside the summary section, after its h2
      expect(html.indexOf('Test Run Summary')).toBeLessThan(html.indexOf('section-text'));
    });

    it('should not render the accompanying text on the cover page', async () => {
      const section = makeSection({
        comment: 'Cover pages stay clean',
        config: { includeSummary: false },
      });

      const html = await renderer.renderHeaderSection(section, makeTestRun());

      expect(html).toContain('class="cover-page"');
      expect(html).not.toContain('section-text');
      expect(html).not.toContain('Cover pages stay clean');
    });

    it('should omit the section-text block entirely when absent', async () => {
      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).not.toContain('section-text');
    });

    it('should escape HTML in the accompanying text', async () => {
      const section = makeSection({ comment: '<img onerror=alert(1)>' });

      const html = await renderer.renderHeaderSection(section, makeTestRun());

      expect(html).not.toContain('<img onerror');
      expect(html).toContain('&lt;img onerror');
    });
  });

  describe('annotations', () => {
    it('should render annotations when present', async () => {
      const testRun = makeTestRun({ annotations: ['Deploy v2.0', 'Config change'] });

      const html = await renderer.renderHeaderSection(makeSection(), testRun);

      expect(html).toContain('Annotations');
      expect(html).toContain('Deploy v2.0');
      expect(html).toContain('Config change');
    });

    it('should not render annotations box when empty', async () => {
      const html = await renderer.renderHeaderSection(makeSection(), makeTestRun());

      expect(html).not.toContain('annotations-box');
    });
  });

  describe('preview mode (null testRun)', () => {
    it('should render with placeholder data', async () => {
      const html = await renderer.renderHeaderSection(makeSection(), null);

      expect(html).toContain('sample-system');
      expect(html).toContain('sample-workload');
      expect(html).toContain('preview-test-run');
      expect(html).toContain('No SLO data');
    });

    it('should not call data fetcher for null test run', async () => {
      await renderer.renderHeaderSection(makeSection(), null);

      expect(dataFetcher.getSloSummary).not.toHaveBeenCalled();
      expect(dataFetcher.getAnomalySummary).not.toHaveBeenCalled();
    });
  });

  describe('HTML escaping', () => {
    it('should escape HTML in system ID', async () => {
      const testRun = makeTestRun({ systemUnderTestId: '<script>xss</script>' });

      const html = await renderer.renderHeaderSection(makeSection(), testRun);

      expect(html).not.toContain('<script>xss</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });
});
