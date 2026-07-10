import { Test, TestingModule } from '@nestjs/testing';
import { AwrRenderer } from './awr-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({ type: 'awr', order: 0, ...overrides });

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'system-1',
    ...overrides,
  }) as TestRun;

const makeAwrData = (overrides?: Record<string, unknown>) => ({
  reports: [
    {
      id: 'awr-1',
      dbName: 'ORCL',
      instanceName: 'orcl1',
      dbEdition: 'Enterprise',
      dbRelease: '19.0.0.0',
      hostName: 'db-host-01',
      platform: 'Linux x86-64',
      cpus: 16,
      cores: 8,
      memoryGb: 64,
      beginTime: '2025-01-01T10:00:00Z',
      endTime: '2025-01-01T11:00:00Z',
      elapsedMinutes: 60,
      dbTimeMinutes: 45.5,
      parsedData: null,
    },
  ],
  insights: [
    {
      severity: 'critical',
      category: 'sql_performance',
      title: 'High SQL elapsed time',
      description: 'SQL abc123 consuming excessive CPU',
      recommendation: 'Add index on table X',
      value: 95.5,
      unit: '%',
    },
    {
      severity: 'warning',
      category: 'wait_events',
      title: 'Log file sync waits',
      description: 'Redo log sync causing delays',
      recommendation: null,
      value: null,
      unit: null,
    },
  ],
  severitySummary: { critical: 1, warning: 1, info: 0, total: 2 },
  ...overrides,
});

describe('AwrRenderer', () => {
  let renderer: AwrRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AwrRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getAwrData: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    renderer = module.get(AwrRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  it('should render placeholder when testRun is null', async () => {
    const html = await renderer.renderAwrSection(makeSection(), null);

    expect(html).toContain('awr-section');
    expect(html).toContain('No AWR report data available');
    expect(dataFetcher.getAwrData).not.toHaveBeenCalled();
  });

  it('should render placeholder when no data returned', async () => {
    dataFetcher.getAwrData.mockResolvedValue(null);

    const html = await renderer.renderAwrSection(makeSection(), makeTestRun());

    expect(html).toContain('No AWR report data available');
  });

  it('should render severity badges with counts', async () => {
    dataFetcher.getAwrData.mockResolvedValue(makeAwrData() as any);

    const html = await renderer.renderAwrSection(makeSection(), makeTestRun());

    expect(html).toContain('1'); // critical count
    expect(html).toContain('Critical');
    expect(html).toContain('Warning');
    expect(html).toContain('2'); // total
  });

  it('should render database info', async () => {
    dataFetcher.getAwrData.mockResolvedValue(makeAwrData() as any);

    const html = await renderer.renderAwrSection(makeSection(), makeTestRun());

    expect(html).toContain('ORCL');
    expect(html).toContain('orcl1');
    expect(html).toContain('db-host-01');
    expect(html).toContain('Enterprise');
    expect(html).toContain('16 CPUs');
    expect(html).toContain('64 GB RAM');
    expect(html).toContain('60 min elapsed');
    expect(html).toContain('45.5 min DB time');
  });

  it('should render insights table', async () => {
    dataFetcher.getAwrData.mockResolvedValue(makeAwrData() as any);

    const html = await renderer.renderAwrSection(makeSection(), makeTestRun());

    expect(html).toContain('High SQL elapsed time');
    expect(html).toContain('SQL abc123 consuming excessive CPU');
    expect(html).toContain('Add index on table X');
    expect(html).toContain('Log file sync waits');
    expect(html).toContain('sql performance'); // category with underscore replaced
  });

  it('should filter insights by categories config', async () => {
    dataFetcher.getAwrData.mockResolvedValue(makeAwrData() as any);

    const html = await renderer.renderAwrSection(
      makeSection({ config: { categories: ['sql_performance'] } }),
      makeTestRun(),
    );

    expect(html).toContain('High SQL elapsed time');
    expect(html).not.toContain('Log file sync waits');
  });

  it('should render custom title and comment', async () => {
    dataFetcher.getAwrData.mockResolvedValue(makeAwrData() as any);

    const html = await renderer.renderAwrSection(
      makeSection({ title: 'Database Analysis', comment: 'Review these findings' }),
      makeTestRun(),
    );

    expect(html).toContain('Database Analysis');
    expect(html).toContain('Review these findings');
  });

  it('should render top SQL from parsedData', async () => {
    const data = makeAwrData({
      reports: [
        {
          ...makeAwrData().reports[0],
          parsedData: {
            topSql: {
              byElapsedTime: [
                { sqlId: 'abc123', elapsedTimeSec: 120.5, executions: 5000, elapsedPerExecSec: 0.0241 },
                { sqlId: 'def456', elapsedTimeSec: 80.2, executions: 3000, elapsedPerExecSec: 0.0267 },
              ],
            },
          },
        },
      ],
    });

    dataFetcher.getAwrData.mockResolvedValue(data as any);

    const html = await renderer.renderAwrSection(makeSection(), makeTestRun());

    expect(html).toContain('Top SQL by Elapsed Time');
    expect(html).toContain('abc123');
    expect(html).toContain('def456');
    expect(html).toContain('120.5s');
    expect(html).toContain('5,000');
  });

  it('should hide top SQL when showTopSql is false', async () => {
    const data = makeAwrData({
      reports: [
        {
          ...makeAwrData().reports[0],
          parsedData: {
            topSql: {
              byElapsedTime: [
                { sqlId: 'xyz789_hidden', elapsedTimeSec: 120.5, executions: 5000, elapsedPerExecSec: 0.0241 },
              ],
            },
          },
        },
      ],
    });

    dataFetcher.getAwrData.mockResolvedValue(data as any);

    const html = await renderer.renderAwrSection(
      makeSection({ config: { showTopSql: false } }),
      makeTestRun(),
    );

    expect(html).not.toContain('Top SQL by Elapsed Time');
    expect(html).not.toContain('xyz789_hidden');
  });

  it('should limit insights by maxInsights config', async () => {
    const manyInsights = Array.from({ length: 10 }, (_, i) => ({
      severity: 'info' as const,
      category: 'configuration',
      title: `Insight ${i}`,
      description: `Description ${i}`,
      recommendation: null,
      value: null,
      unit: null,
    }));

    dataFetcher.getAwrData.mockResolvedValue(
      makeAwrData({ insights: manyInsights, severitySummary: { critical: 0, warning: 0, info: 10, total: 10 } }) as any,
    );

    const html = await renderer.renderAwrSection(
      makeSection({ config: { maxInsights: 3 } }),
      makeTestRun(),
    );

    expect(html).toContain('Insight 0');
    expect(html).toContain('Insight 2');
    expect(html).not.toContain('Insight 3');
  });
});
