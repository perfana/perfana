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
    expect(html).toContain('Performance Impact Ranking');
    expect(html).toContain('Highest Error Rate');
  });

  it('scores impact as a share of the total, not the raw avg x count product', async () => {
    const { renderer } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['impact'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);

    // 50000 and 30000 of an 80000 total → 62.5 and 37.5, summing to 100.
    expect(html).toContain('62.5');
    expect(html).toContain('37.5');
    expect(html).not.toContain('50,000');
    expect(html).toContain('Impact score');
  });

  it('names every value column after its own metric, not a generic "Value"', async () => {
    const { renderer } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: {} } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html).toContain('Avg response time');
    expect(html).toContain('Throughput');
    expect(html).toContain('Impact score');
    expect(html).toContain('Error rate');
    expect(html).not.toContain('>Value<');
  });

  it('scores against ALL rows, not just the ten it displays', async () => {
    // With <=10 rows "top ten" and "all rows" are the same set, so the denominator
    // only becomes observable past the slice. 12 rows of 1000 each: every score is
    // 1/12 of the total (8.3), NOT 1/10 of the displayed ten (10.0).
    const many = Array.from({ length: 12 }, (_, i) => ({
      label: `T${i}`, secondaryLabel: undefined, scenarioName: 'Browse',
      avgResponseTime: 100, callCount: 10, errorCount: 0, errorRate: 0,
      throughput: 1, impact: 1000,
    }));
    const { renderer } = makeRenderer(many);
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['impact'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html).toContain('8.3');
    expect(html).not.toContain('10.0');
  });

  it('scores every row 0 when nothing consumed time, instead of dividing by zero', async () => {
    const zeroed = makeRows().map((r) => ({ ...r, impact: 0 }));
    const { renderer } = makeRenderer(zeroed);
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['impact'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html).toContain('Impact score');
    expect(html).not.toContain('NaN');
  });

  it('ranks the impact list by descending impact', async () => {
    const { renderer } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['impact'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    // /b impact 50000 > /a impact 30000
    expect(html.indexOf('GET /b')).toBeLessThan(html.indexOf('GET /a'));
  });

  describe('scopes', () => {
    it('still honours a legacy single scope, so old templates keep rendering', async () => {
      const { renderer, fetcher } = makeRenderer(makeRows());
      const section = { type: 'top_10_lists', order: 0, config: { scope: 'requests' } } as ReportSectionConfig;
      const html = await renderer.renderTop10ListsSection(section, testRun);
      expect(fetcher.getTop10SamplerRows).toHaveBeenCalled();
      // One scope reads exactly as before — no scope name in the headings.
      expect(html).toContain('Slowest Average Response Times');
      expect(html).not.toContain('Requests · Slowest');
    });

    it('renders every selected scope, each list naming which scope it belongs to', async () => {
      const { renderer, fetcher } = makeRenderer(makeRows());
      const section = {
        type: 'top_10_lists',
        order: 0,
        config: { scopes: ['transactions', 'requests'], lists: ['slowest'] },
      } as ReportSectionConfig;
      const html = await renderer.renderTop10ListsSection(section, testRun);

      expect(fetcher.getTop10TransactionRows).toHaveBeenCalled();
      expect(fetcher.getTop10SamplerRows).toHaveBeenCalled();
      expect(html).toContain('Transactions · Slowest Average Response Times');
      expect(html).toContain('Requests · Slowest Average Response Times');
    });

    it('renders scopes in a canonical order, not the order they were ticked', async () => {
      const { renderer } = makeRenderer(makeRows());
      const section = {
        type: 'top_10_lists',
        order: 0,
        config: { scopes: ['urls', 'transactions'], lists: ['slowest'] },
      } as ReportSectionConfig;
      const html = await renderer.renderTop10ListsSection(section, testRun);
      expect(html.indexOf('Transactions · Slowest')).toBeLessThan(html.indexOf('URLs · Slowest'));
    });

    it('ignores an unknown scope and falls back when nothing valid is left', async () => {
      const { renderer, fetcher } = makeRenderer(makeRows());
      const section = {
        type: 'top_10_lists',
        order: 0,
        config: { scopes: ['nonsense'], lists: ['slowest'] },
      } as unknown as ReportSectionConfig;
      const html = await renderer.renderTop10ListsSection(section, testRun);
      expect(fetcher.getTop10TransactionRows).toHaveBeenCalled();
      expect(html).toContain('Slowest Average Response Times');
    });

    it('de-duplicates a scope listed twice', async () => {
      const { renderer } = makeRenderer(makeRows());
      const section = {
        type: 'top_10_lists',
        order: 0,
        config: { scopes: ['requests', 'requests'], lists: ['slowest'] },
      } as ReportSectionConfig;
      const html = await renderer.renderTop10ListsSection(section, testRun);
      expect(html.match(/Slowest Average Response Times/g)).toHaveLength(1);
    });

    it('notes an empty scope beside a sibling that has data, rather than dropping it', async () => {
      const fetcher = {
        getTop10TransactionRows: jest.fn().mockResolvedValue(makeRows()),
        getTop10SamplerRows: jest.fn().mockResolvedValue([]),
      } as unknown as ReportDataFetcherService;
      const renderer = new Top10ListsRenderer(utils, fetcher);
      const section = {
        type: 'top_10_lists',
        order: 0,
        config: { scopes: ['transactions', 'requests'], lists: ['slowest'] },
      } as ReportSectionConfig;
      const html = await renderer.renderTop10ListsSection(section, testRun);

      expect(html).toContain('Transactions · Slowest Average Response Times');
      expect(html).toContain('No requests data available for this test run.');
    });

    it('renders one empty state naming every scope when none has data', async () => {
      const { renderer } = makeRenderer([]);
      const section = {
        type: 'top_10_lists',
        order: 0,
        config: { scopes: ['transactions', 'urls'] },
      } as ReportSectionConfig;
      const html = await renderer.renderTop10ListsSection(section, testRun);
      expect(html).toContain('No transactions, URLs data available for this test run.');
    });

    it('shows the request URL line only for the requests scope', async () => {
      const { renderer } = makeRenderer(makeRows());
      const section = {
        type: 'top_10_lists',
        order: 0,
        config: { scopes: ['transactions', 'requests'], includeUrl: true, lists: ['slowest'] },
      } as ReportSectionConfig;
      const html = await renderer.renderTop10ListsSection(section, testRun);
      // The fixture's secondaryLabel appears once — under requests, not transactions.
      expect(html.match(/\/a<\/div>/g) ?? []).toHaveLength(1);
    });
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
