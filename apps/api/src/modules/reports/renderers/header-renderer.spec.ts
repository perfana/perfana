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
              conclusion: 'no_regressions',
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

    it('should use custom title and subtitle', async () => {
      const section = makeSection({
        config: { title: 'Sprint 42 Report', subtitle: 'Nightly Load Test' },
      });
      const html = await renderer.renderHeaderSection(section, makeTestRun());

      expect(html).toContain('Sprint 42 Report');
      expect(html).toContain('Nightly Load Test');
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
