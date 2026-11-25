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
  ReportStory,
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
  tag: null,
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

function setup(rows: ReportCommentRow[], series: MetricsTimeSeriesPanel[] = [], stories: ReportStory[] = []) {
  const dataFetcher = {
    getTestRunComments: jest.fn().mockResolvedValue(rows),
    getPublishedStories: jest.fn().mockResolvedValue(stories),
  };
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

  it('marks an agent author with an AI chip, escaped like any author name, and a person without one', async () => {
    const { renderer } = setup([
      row({ id: 'a1', authorName: '<b>Claude</b> agent', authorKind: 'agent', body: 'root cause' }),
      row({ id: 'p1', authorName: 'Ada', authorKind: 'user', body: 'agreed' }),
    ]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(html).toContain('&lt;b&gt;Claude&lt;/b&gt; agent');
    expect(html).not.toContain('<b>Claude');
    const agentPart = html.slice(html.indexOf('Claude'), html.indexOf('root cause'));
    const personPart = html.slice(html.indexOf('Ada'), html.indexOf('agreed'));
    expect(agentPart).toMatch(/>AI</);
    expect(personPart).not.toMatch(/>AI</);
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

  // Tags design (PR2): a root's tag leads its meta line, also when the root was deleted; a reply
  // never shows one; a key this build does not know is printed as stored, escaped.
  it('prints a root\'s tag label before it, keeps it on a deleted root, and escapes an unknown key', async () => {
    const tagged = row({ body: 'heap.max halved', tag: 'root-cause' });
    const { renderer } = setup([
      tagged,
      row({ parentId: tagged.id, body: 'agreed', tag: 'evidence' }),
      row({ body: 'gone', tag: 'ruled-out', deletedAt: new Date(), markerSeq: 4, cardKey: 'graphs' }),
      row({ body: 'future', tag: '<b>x</b>' }),
    ]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(html).toContain('>Root cause</span>');
    expect(html.indexOf('>Root cause</span>')).toBeLessThan(html.indexOf('heap.max halved'));
    expect(html).not.toContain('>Evidence</span>');
    expect(html).toContain('>Ruled out</span>');
    expect(html.indexOf('>Ruled out</span>')).toBeLessThan(html.indexOf(`Marker ${markerGlyph(4)}`));
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
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

  // Value: protects=a Configuration item comment prints the comparison it was written against,
  // escaped, under the comment, and only for a live config view; fails_when=renderConfigView is
  // dropped, stops escaping config values, or prints for a deleted root or another card;
  // why_new=PR1 of test-run-analysis-stories.md; seam=none; no_claim=the API's DTO checks.
  it('prints a Configuration comment’s comparison under it, as text', async () => {
    const view = { kind: 'config', comparedToTestRunId: 'App-00006', status: 'changed', previousValue: '2g', currentValue: '<b>512m</b>' };
    const { renderer } = setup([
      row({ cardKey: 'config', itemLabel: 'heap.max', body: 'heap shrank', chartContext: view }),
      row({ cardKey: 'config', itemLabel: 'gone', body: null, deletedAt: new Date(), chartContext: { ...view, currentValue: 'secret' } }),
      row({ cardKey: 'performance', chartContext: { ...view, currentValue: 'wrong-card' } }),
    ]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(html).toContain('Compared with run App-00006: 2g → &lt;b&gt;512m&lt;/b&gt; (changed)');
    expect(html).not.toContain('<b>512m</b>');
    expect(html.indexOf('heap shrank')).toBeLessThan(html.indexOf('Compared with run'));
    expect(html).not.toContain('secret');
    expect(html).not.toContain('wrong-card');
  });

  // Value: protects=a Distributed tracing / Pyroscope comment written on the diff tab prints its
  // baseline and trace result, escaped, and only on its own card; fails_when=renderConfigView stops
  // handling diff views or matches a view stored under another card.
  it('prints a diff-tab comment’s baseline and Compare Traces result under it', async () => {
    const { renderer } = setup([
      row({ cardKey: 'distributed-tracing', body: 'slower db', chartContext: { kind: 'distributed-tracing', view: 'diff', baselineTestRunId: 'App-00005', resultSummary: 'Traces: 3 current / <4> baseline' } }),
      row({ cardKey: 'pyroscope', body: 'more gc', chartContext: { kind: 'pyroscope', view: 'diff', baselineTestRunId: 'App-00004' } }),
      row({ cardKey: 'performance', chartContext: { kind: 'pyroscope', view: 'diff', baselineTestRunId: 'wrong-card' } }),
    ]);
    const html = await renderer.renderCommentsSection(section(), testRun);
    expect(html).toContain('Diff view vs run App-00005\nTraces: 3 current / &lt;4&gt; baseline');
    expect(html).toContain('Diff view vs run App-00004');
    expect(html).not.toContain('wrong-card');
  });
});

// Value: protects=the Comments section's `stories` layout (analysis stories, PR5): published
// stories only, in the fetcher's order, each step numbered with tag, card · item, body, note, the
// marker chart and config snapshot; deleted steps keep tag and note; everything escaped; the
// default layout is untouched; fails_when=the layout switch reads the wrong key, a story or step
// field is printed raw, a deleted body leaks, or by-card templates start reading stories;
// seam=the data fetcher (mocked; its SQL is in report-data-fetcher.comments.spec.ts).
describe('CommentsRenderer stories layout', () => {
  const story = (over: Partial<ReportStory> = {}): ReportStory => ({
    id: 's1',
    title: 'Checkout latency after deploy',
    summary: 'The heap was halved.',
    authorName: 'Daniel',
    authorKind: 'user',
    publishedByName: 'Daniel',
    publishedAt: new Date('2026-11-20T12:00:00Z'),
    steps: [],
    ...over,
  });

  it('keeps the by-card layout for a section with no layout, and never reads stories there', async () => {
    const { renderer, dataFetcher } = setup([row({ body: 'card thread' })], [], [story()]);
    for (const config of [{}, { layout: 'by-card' }, { layout: 'bogus' }]) {
      const html = await renderer.renderCommentsSection(section(config), testRun);
      expect(html).toContain('card thread');
      expect(html).not.toContain('Checkout latency');
    }
    expect(dataFetcher.getPublishedStories).not.toHaveBeenCalled();
  });

  it('renders each story with its steps in order, omitting comments in no story', async () => {
    const { renderer, dataFetcher } = setup([row({ body: 'not in a story' })], [], [
      story({
        steps: [
          { position: 1, note: 'first the spike', comment: row({ cardKey: 'performance', itemLabel: 'checkout', body: 'p95 doubled', tag: 'symptom' }) },
          { position: 2, note: null, comment: row({ cardKey: 'config', itemLabel: 'heap.max', body: 'heap halved', tag: 'root-cause' }) },
        ],
      }),
      story({ id: 's2', title: 'Second analysis', summary: null, authorName: 'Ada', steps: [
        { position: 1, note: null, comment: row({ body: 'only step' }) },
      ] }),
    ]);
    const html = await renderer.renderCommentsSection(section({ layout: 'stories', cards: ['slo'] }), testRun, 'u1', ['r']);
    expect(dataFetcher.getPublishedStories).toHaveBeenCalledWith(testRun, 'u1', ['r']);
    expect(dataFetcher.getTestRunComments).not.toHaveBeenCalled();
    expect(html).not.toContain('not in a story');
    expect(html).toContain('2 investigations');
    // Untitled, the stories layout is headed with the app's name for it (PR7).
    expect(html).toMatch(/>Investigations</);
    expect(html).toContain('>Checkout latency after deploy</h3>');
    expect(html).toContain('2 steps');
    expect(html).toContain('>Daniel</strong>');
    expect(html).toContain('published 2026-11-20 12:00 UTC');
    expect(html).toContain('The heap was halved.');
    const order = ['Step 1', '>Symptom</span>', 'Performance analysis · checkout', 'p95 doubled', 'first the spike', 'Step 2', '>Root cause</span>', 'heap halved', 'Second analysis', 'only step'];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('1 step<');
  });

  // Value: protects=an AI agent's published investigation never reads as a person's work in a
  // stored report: it names the publisher, marks the agent with an AI chip, and chips agent-written
  // steps; fails_when=the fetcher stops selecting author_kind / published_by_name or the renderer
  // prints "by <agent>" bare; why_new=only the by-card layout's AI chip was covered; seam=none;
  // no_claim=the fetcher's SQL (mocked here).
  it('marks an agent investigation and its agent-written steps as AI, and names who published it', async () => {
    const { renderer } = setup([], [], [
      story({
        id: 'ag', title: 'Agent analysis', authorName: 'Analysis agent', authorKind: 'agent', publishedByName: 'Ada',
        steps: [
          { position: 1, note: null, comment: row({ id: 'c1', authorName: 'Analysis agent', authorKind: 'agent', body: 'agent step' }) },
          { position: 2, note: null, comment: row({ id: 'c2', authorName: 'Bob', authorKind: 'user', body: 'person step' }) },
        ],
      }),
      story({ id: 'pp', title: 'Person analysis', authorName: 'Carol', steps: [] }),
    ]);
    const html = await renderer.renderCommentsSection(section({ layout: 'stories' }), testRun);
    const agentStory = html.slice(html.indexOf('Agent analysis'), html.indexOf('agent step'));
    expect(agentStory).toContain('>Ada</strong> published · proposed by <strong');
    expect(agentStory).toContain('>Analysis agent</strong>');
    expect(agentStory).toMatch(/>AI</);
    expect(agentStory).not.toMatch(/10px;">by </);
    const agentStep = html.slice(html.indexOf('Step 1'), html.indexOf('agent step'));
    const personStep = html.slice(html.indexOf('Step 2'), html.indexOf('person step'));
    expect(agentStep).toMatch(/>AI</);
    expect(personStep).not.toMatch(/>AI</);
    const personStory = html.slice(html.indexOf('Person analysis'));
    expect(personStory).toMatch(/10px;">by <strong/);
    expect(personStory).not.toMatch(/>AI</);
  });

  it('escapes every story and step field', async () => {
    const x = '<img src=x onerror="alert(1)">';
    const { renderer } = setup([], [], [story({
      title: x, summary: x, authorName: x,
      steps: [{ position: 1, note: x, comment: row({ body: x, authorName: x, itemLabel: x, tag: x }) }],
    })]);
    const html = await renderer.renderCommentsSection(section({ layout: 'stories' }), testRun);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('draws the Graphs marker chart for a marker step, and the config snapshot for a config step', async () => {
    const view = { kind: 'config', comparedToTestRunId: 'App-00006', status: 'changed', previousValue: '2g', currentValue: '512m' };
    const { renderer, graphs } = setup([], [panel()], [story({ steps: [
      { position: 1, note: null, comment: graphsMarker() },
      { position: 2, note: null, comment: row({ cardKey: 'config', itemLabel: 'heap.max', body: 'heap', chartContext: view }) },
    ] })]);
    const html = await renderer.renderCommentsSection(section({ layout: 'stories' }), testRun);
    expect(graphs.fetchPresetSeries).toHaveBeenCalledTimes(1);
    expect(html).toContain('<svg');
    expect(html).toMatch(/<g class="chart-callout">.*>3<\/text><\/g>/s);
    expect(html).toContain(`Marker ${markerGlyph(3)}`);
    expect(html).toContain('Compared with run App-00006: 2g → 512m (changed)');
  });

  it('prints a deleted step as "Comment deleted" with its tag and note, and never its body or chart', async () => {
    const { renderer, graphs } = setup([], [panel()], [story({ steps: [
      { position: 1, note: 'we ruled this out', comment: graphsMarker({ body: 'secret left behind', deletedAt: new Date(), tag: 'ruled-out' }) },
      { position: 2, note: 'kept', comment: null },
    ] })]);
    const html = await renderer.renderCommentsSection(section({ layout: 'stories' }), testRun);
    expect(html).not.toContain('secret left behind');
    expect(html).toContain('Comment deleted');
    expect(html).toContain('>Ruled out</span>');
    expect(html).toContain('we ruled this out');
    expect(html).toContain('Comment not available');
    expect(graphs.fetchPresetSeries).not.toHaveBeenCalled();
  });

  it('says so when the run has no published story', async () => {
    const { renderer } = setup([row()], [], []);
    const html = await renderer.renderCommentsSection(section({ layout: 'stories' }), testRun);
    expect(html).toContain('No published investigations for this run.');
  });
});
