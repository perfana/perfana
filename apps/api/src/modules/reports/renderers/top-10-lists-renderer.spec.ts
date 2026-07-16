import { Top10ListsRenderer } from './top-10-lists-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, Top10Row } from '../services/report-data-fetcher.service';
import { TestRun, ReportSectionConfig } from '@perfana/shared';

const utils = new ReportUtilsService();

const makeRows = (): Top10Row[] => [
  { label: 'GET /a', secondaryLabel: '/a', scenarioName: 'Browse', avgResponseTime: 300, callCount: 100, errorCount: 10, errorRate: 10, throughput: 2, impact: 30000 },
  { label: 'GET /b', secondaryLabel: '/b', scenarioName: 'Browse', avgResponseTime: 100, callCount: 500, errorCount: 0, errorRate: 0, throughput: 10, impact: 50000 },
];

const testRun = { testRunId: 'tr-1', duration: 50 } as TestRun;

function makeRenderer(rows: Top10Row[]) {
  const fetcher = {
    getTop10TransactionRows: jest.fn().mockResolvedValue(rows),
    getTop10SamplerRows: jest.fn().mockResolvedValue(rows),
  } as unknown as ReportDataFetcherService;
  return { renderer: new Top10ListsRenderer(utils, fetcher), fetcher };
}

describe('Top10ListsRenderer', () => {
  it('renders all four lists by default for the transactions scope', async () => {
    const { renderer, fetcher } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: {} } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(fetcher.getTop10TransactionRows).toHaveBeenCalled();
    expect(html).toContain('Slowest Average Response Times');
    expect(html).toContain('Highest Throughput');
    expect(html).toContain('Highest Performance Impact');
    expect(html).toContain('Highest Error Rate');
  });

  it('ranks the impact list by descending impact', async () => {
    const { renderer } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['impact'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    // /b impact 50000 > /a impact 30000
    expect(html.indexOf('GET /b')).toBeLessThan(html.indexOf('GET /a'));
  });

  it('renders only the selected lists', async () => {
    const { renderer } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['slowest'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html).toContain('Slowest Average Response Times');
    expect(html).not.toContain('Highest Throughput');
  });

  it('uses the sampler fetcher for the requests scope and shows the url line when includeUrl is on', async () => {
    const { renderer, fetcher } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { scope: 'requests', includeUrl: true, lists: ['slowest'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(fetcher.getTop10SamplerRows).toHaveBeenCalledWith(testRun, [], true, false, '', []);
    expect(html).toContain('/a'); // secondary url line rendered
  });

  it('passes groupByUrl=true for the urls scope', async () => {
    const { renderer, fetcher } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { scope: 'urls', lists: ['slowest'] } } as ReportSectionConfig;
    await renderer.renderTop10ListsSection(section, testRun);
    expect(fetcher.getTop10SamplerRows).toHaveBeenCalledWith(testRun, [], true, true, '', []);
  });

  it('renders an empty state when there are no rows', async () => {
    const { renderer } = makeRenderer([]);
    const section = { type: 'top_10_lists', order: 0, config: {} } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html.toLowerCase()).toContain('no transactions data');
  });

  it('escapes labels', async () => {
    const { renderer } = makeRenderer([
      { label: '<script>', scenarioName: 'S', avgResponseTime: 1, callCount: 1, errorCount: 0, errorRate: 0, throughput: 1, impact: 1 },
    ]);
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['slowest'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
