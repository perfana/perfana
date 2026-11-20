// What this guards: the report's Comments section (test-run comments, PR3). Comment text is
// author content served unauthenticated through share links, so it must render as text; a
// soft-deleted root must never print its body; a Graphs marker thread is headed by its
// recorded view drawn through the real SVG chart builder, with the numbered callout; and a
// marker whose series no longer resolve keeps its thread and says why there is no chart.
import { CommentsRenderer, markerGlyph, selectedCards } from './comments-renderer';
import { ChartSvgService } from './chart-svg.service';
import { ReportUtilsService } from '../services/report-utils.service';
import type { GraphsRenderer } from './graphs-renderer';
import type {
  ReportDataFetcherService,
  ReportCommentRow,
  MetricsTimeSeriesPanel,
} from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

const testRun = { id: 'run-uuid', testRunId: 'App-acc-load-00001', organizationId: 'org-1' } as TestRun;
const section = (config: Record<string, unknown> = {}): ReportSectionConfig => ({ type: 'comments', order: 1, config });

let seq = 0;
const row = (over: Partial<ReportCommentRow> = {}): ReportCommentRow => ({
  id: `c${++seq}`,
  cardKey: 'performance',
  parentId: null,
  body: 'looks fine',
  authorName: 'Ada',
  itemLabel: null,
  markerSeq: null,
  markerTime: null,
  chartContext: null,
  createdAt: new Date('2026-11-20T10:00:00Z'),
  editedAt: null,
  deletedAt: null,
  ...over,
});

const panel = (): MetricsTimeSeriesPanel => ({
  dashboardLabel: 'JVM',
  panelTitle: 'Heap',
  metricName: 'heap_used',
  unit: 'bytes',
  dataPoints: [
    { time: new Date('2026-11-20T09:00:00Z'), value: 1 },
    { time: new Date('2026-11-20T10:00:00Z'), value: 2 },
    { time: new Date('2026-11-20T10:30:00Z'), value: 3 },
    { time: new Date('2026-11-20T11:00:00Z'), value: 4 },
    { time: new Date('2026-11-20T12:00:00Z'), value: 5 },
  ],
});

function setup(rows: ReportCommentRow[], series: MetricsTimeSeriesPanel[] = []) {
  const dataFetcher = { getTestRunComments: jest.fn().mockResolvedValue(rows) };
  const graphs = {
    fetchPresetSeries: jest.fn().mockResolvedValue(series),
    analysisWindow: jest.fn().mockReturnValue({ from: null, to: null, only: false }),
  };
  const renderer = new CommentsRenderer(
    dataFetcher as unknown as ReportDataFetcherService,
    new ChartSvgService(new ReportUtilsService()),
    graphs as unknown as GraphsRenderer,
  );
  return { renderer, dataFetcher, graphs };
}

const graphsMarker = (over: Partial<ReportCommentRow> = {}) => row({
  cardKey: 'graphs',
  markerSeq: 3,
  markerTime: new Date('2026-11-20T10:30:00Z'),
  chartContext: {
    kind: 'graphs',
    title: 'Heap under load',
    series: [{ dashboardId: 'd1', dashboardLabel: 'JVM', panelId: 7, panelTitle: 'Heap', metricName: 'heap_used', source: 'grafana' }],
    xRange: ['2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z'],
  },
  ...over,
});

describe('CommentsRenderer', () => {
  it('renders an HTML payload in a body, an author name and an item label as text', async () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { renderer } = setup([
      row({ body: payload, authorName: '<b>Mallory</b>', itemLabel: '<i>checkout</i>' }),
    ]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Mallory');
    expect(html).not.toContain('<i>checkout');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Mallory&lt;/b&gt;');
  });

  it('groups threads by card in page order with replies under their root, and marks edits', async () => {
    const root = row({ cardKey: 'slo', body: 'SLO root' });
    const { renderer } = setup([
      row({ cardKey: 'graphs', body: 'graphs note' }),
      root,
      row({ cardKey: 'slo', parentId: root.id, body: 'a reply', authorName: 'Bob', editedAt: new Date() }),
    ]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    // slo comes before graphs on the run page
    expect(html.indexOf('Service level objectives')).toBeLessThan(html.indexOf('>Graphs<'));
    expect(html.indexOf('SLO root')).toBeLessThan(html.indexOf('a reply'));
    expect(html).toContain('(edited)');
    expect(html).toContain('2 threads');
  });

  it('never prints the body of a soft-deleted root, and keeps its replies', async () => {
    const root = row({ body: 'secret left behind', deletedAt: new Date(), markerSeq: 2, cardKey: 'graphs' });
    const { renderer } = setup([root, row({ parentId: root.id, cardKey: 'graphs', body: 'reply stays' })]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(html).not.toContain('secret left behind');
    expect(html).toContain('Comment deleted');
    expect(html).toContain('reply stays');
    expect(html).toContain(`Marker ${markerGlyph(2)}`);
  });

  it('heads a Graphs marker thread with its recorded view, trimmed to the recorded range, with the numbered callout', async () => {
    const { renderer, graphs } = setup([graphsMarker()], [panel()]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(graphs.fetchPresetSeries).toHaveBeenCalledWith(
      [expect.objectContaining({ dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'heap_used' })],
      'App-acc-load-00001', false, '', [],
    );
    expect(html).toContain('<svg');
    expect(html).toContain('Heap under load');
    expect(html).toMatch(/<g class="chart-callout">.*>3<\/text><\/g>/s);
    // 09:00 and 12:00 lie outside the recorded window: three points drawn, not five
    expect(html).toContain('3 data points');
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('looks fine'));
  });

  it('keeps a marker thread whose series no longer resolve, with a note instead of a chart', async () => {
    const { renderer } = setup([graphsMarker()], []);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(html).not.toContain('<svg');
    expect(html).toContain('series no longer resolve');
    expect(html).toContain('looks fine');
  });

  it('draws no chart for a Trends or Compare view, or for a plain Graphs comment', async () => {
    const { renderer, graphs } = setup([
      row({ cardKey: 'trends', chartContext: { kind: 'trends', series: [{}] } }),
      row({ cardKey: 'graphs', chartContext: { kind: 'graphs', series: [{}] } }),
    ], [panel()]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(graphs.fetchPresetSeries).not.toHaveBeenCalled();
    expect(html).not.toContain('<svg');
  });

  it('passes only known card keys as the filter, and none as "all cards"', async () => {
    const { renderer, dataFetcher } = setup([]);
    const html = await renderer.renderCommentsSection(section({ cards: ['slo', 'bogus', 7] }), testRun, 'u1', ['r']);
    expect(dataFetcher.getTestRunComments).toHaveBeenCalledWith(testRun, ['slo'], 'u1', ['r']);
    expect(html).toContain('No comments on the selected cards');
    expect(selectedCards({ cards: ['bogus'] })).toBeNull();
    expect(selectedCards({})).toBeNull();
  });

  it('renders an empty state without a test run (preview)', async () => {
    const { renderer, dataFetcher } = setup([]);
    const html = await renderer.renderCommentsSection(section(), null);
    expect(dataFetcher.getTestRunComments).not.toHaveBeenCalled();
    expect(html).toContain('No test run data available');
  });
});
