// What this guards: the report's Loki Logs section. It reads the Loki card's summary through
// LokiService.reportSummary (with the report's empty system userId passed through, not dropped),
// escapes log text (lines and patterns are untrusted and reports are shared unauthenticated), honours
// the section settings, and survives the Confluence converter as tables, status lozenges and links.
import { LokiLogsRenderer, errorRateTrend, lokiSettings } from './loki-logs-renderer';
import { htmlToStorage } from '../../confluence/storage-format';
import type { LokiService } from '../../loki/loki.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

const testRun = { testRunId: 'App-acc-load-00001' } as TestRun;
const section = (config: Record<string, unknown> = {}): ReportSectionConfig => ({ type: 'loki_logs', order: 1, config });

const summary = () => ({
  configured: true as const,
  connection: { id: 'c', label: 'Loki', levelLabel: 'level', levelParser: 'none', serviceLabel: 'service_name' },
  levelLabelMissing: false,
  baseline: { kind: 'control-group', testRunIds: ['r1', 'r2', 'r3'] },
  sources: [],
  exploreUrl: 'https://grafana.example/explore?x=1',
  window: { from: '2026-11-20T10:00:00.000Z', to: '2026-11-20T11:00:00.000Z' },
  errorRate: { totalLines: 10000, errorLines: 300, errorRatePct: 3, baseline: { errorRatePct: 1, runs: 3 } },
  panels: [{ panelId: 1, dashboardLabel: 'Loki', title: 'Lines by level', aggregation: 'count', splitBy: 'level', unit: 'short', isLevelPanel: true, series: [{ name: 'error', mean: 5, peak: 20, total: 300 }], link: null }],
  patterns: [
    { pattern: '<_> Timeout <script>alert(1)</script>', level: 'error', count: 120, firstSeen: null, lastSeen: null, source: 'patterns', service: null, isNew: true, exploreUrl: 'https://grafana.example/p1' },
    { pattern: 'GC pause <_>', level: 'warn', count: 80, firstSeen: null, lastSeen: null, source: 'patterns', service: null, isNew: false, exploreUrl: null },
    { pattern: 'request served', level: 'info', count: 9000, firstSeen: null, lastSeen: null, source: 'patterns', service: null, isNew: false, exploreUrl: null },
    { pattern: 'checkout only', level: 'error', count: 50, firstSeen: null, lastSeen: null, source: 'patterns', service: 'checkout', isNew: true, exploreUrl: null },
  ],
  patternsSource: 'patterns',
  newPatterns: 1,
  baselineRunCount: 3,
  // The worker samples each line twice: for all streams (service null) and for its application.
  samples: [
    { time: '2026-11-20T10:30:00.123Z', level: 'error', line: 'boom & <b>bang</b>', labels: {}, service: null },
    { time: '2026-11-20T10:30:00.123Z', level: 'error', line: 'boom & <b>bang</b>', labels: {}, service: 'checkout' },
  ],
  services: [
    { service: 'checkout', totalLines: 4000, errorLines: 250, warnLines: 10, levels: null, errorRatePct: 6.25, baseline: { errorRatePct: 1, runs: 3 }, isNew: false, newPatterns: 1, exploreUrl: 'https://grafana.example/s1' },
    { service: 'cart', totalLines: 6000, errorLines: 50, warnLines: 5, levels: null, errorRatePct: 0.83, baseline: null, isNew: true, newPatterns: 0, exploreUrl: null },
  ],
});

function setup(result: unknown = summary()) {
  const loki = { reportSummary: jest.fn().mockResolvedValue(result) };
  return { loki, renderer: new LokiLogsRenderer(loki as unknown as LokiService) };
}

describe('LokiLogsRenderer', () => {
  it('reads the summary with the report caller passed through, including the empty system userId', async () => {
    const { loki, renderer } = setup();
    await renderer.renderLokiLogsSection(section(), testRun);
    expect(loki.reportSummary).toHaveBeenCalledWith('App-acc-load-00001', '', []);
  });

  it('shows the error rate against the baseline, applications and error/warn patterns by default', async () => {
    const { renderer } = setup();
    const html = await renderer.renderLokiLogsSection(section(), testRun);
    expect(html).toContain('vs control group (3 runs)');
    expect(html).toContain('3.00%');
    expect(html).toContain('baseline 1.00%');
    expect(html).toContain('>Higher<');
    expect(html).toContain('checkout');
    expect(html).toContain('GC pause');
    expect(html).not.toContain('request served'); // info left out by default
    expect(html).not.toContain('checkout only'); // per-application scope not in the whole-run list
    expect(html).not.toContain('Latest error and warning lines'); // off by default
  });

  it('escapes patterns and log lines', async () => {
    const { renderer } = setup();
    const html = await renderer.renderLokiLogsSection(section({ includeSamples: true }), testRun);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('boom &amp; &lt;b&gt;bang&lt;/b&gt;');
    expect(html.split('boom &amp;').length - 1).toBe(1); // the all-streams copy only, not its per-application twin
    expect(html).toContain('Latest error and warning lines');
  });

  it('narrows everything to the chosen applications', async () => {
    const { renderer } = setup();
    const html = await renderer.renderLokiLogsSection(section({ services: ['checkout'], includeSamples: true }), testRun);
    expect(html).toContain('6.25%');
    expect(html).toContain('checkout only');
    expect(html).not.toContain('GC pause');
    expect(html).not.toContain('>cart<');
  });

  it('lists only new patterns when asked', async () => {
    const { renderer } = setup();
    const html = await renderer.renderLokiLogsSection(section({ onlyNewPatterns: true }), testRun);
    expect(html).toContain('Timeout');
    expect(html).not.toContain('GC pause');
  });

  it('says so when the workload has no Loki panels, and warns when the summary fails', async () => {
    expect(await setup({ configured: false }).renderer.renderLokiLogsSection(section(), testRun)).toContain('No Loki panels are configured');
    const failing = new LokiLogsRenderer({ reportSummary: jest.fn().mockRejectedValue(new Error('x')) } as unknown as LokiService);
    expect(await failing.renderLokiLogsSection(section(), testRun)).toContain('could not be loaded');
  });

  it('converts to Confluence storage format as tables, status lozenges and links', async () => {
    const { renderer } = setup();
    const html = await renderer.renderLokiLogsSection(section({ includeSamples: true, includePanels: true }), testRun);
    const { storage } = htmlToStorage(`<html><body>${html}</body></html>`);
    expect(storage).toContain('<table>');
    expect(storage).toContain('<ac:parameter ac:name="title">New</ac:parameter>');
    expect(storage).toContain('<ac:parameter ac:name="colour">Red</ac:parameter>');
    expect(storage).toContain('<a href="https://grafana.example/s1">checkout</a>');
    expect(storage).toContain('<th>Error rate</th>'); // the KPI tiles become one header row
    expect(storage).not.toContain('<script>');
    expect(storage).toContain('&lt;script&gt;');
  });
});

describe('lokiSettings / errorRateTrend', () => {
  it('defaults and clamps untrusted config', () => {
    expect(lokiSettings(undefined)).toMatchObject({ applications: true, patterns: true, onlyNew: false, levels: 'warn', samples: false, panels: false, maxRows: 10, services: [] });
    expect(lokiSettings({ maxRows: 999, patternLevels: 'bogus', services: ['a', 3, ''] })).toMatchObject({ maxRows: 50, levels: 'warn', services: ['a'] });
  });

  it('matches the Loki card rule', () => {
    expect(errorRateTrend(3, 1)).toBe('worse');
    expect(errorRateTrend(1.05, 1)).toBe('same');
    expect(errorRateTrend(0.5, 1)).toBe('better');
    expect(errorRateTrend(0.05, 0)).toBe('same');
    expect(errorRateTrend(1, null)).toBeNull();
  });
});

describe('LokiLogsRenderer edge cases', () => {
  // Added by the /ship pre-landing review.
  // Value: protects=a filtered section shows no error rate when the level label is missing, and a free-text
  // level that names an Object member renders as a neutral pill; fails_when=the levelLabelMissing guard is
  // dropped from the pooled rate (0.00% under its own warning) or the level lookup reads inherited members
  // (pill() throws and the section becomes an error placeholder); why_new=no case combined services with
  // levelLabelMissing or used an unknown level; seam=none; no_claim=what the worker stores as a level.
  it('shows no pooled rate without a level label and survives a level named after an Object member', async () => {
    const s = summary();
    const noLevel = { ...s, levelLabelMissing: true, services: s.services.map((x) => ({ ...x, errorLines: 0, errorRatePct: 0 })) };
    const filtered = await setup(noLevel).renderer.renderLokiLogsSection(section({ services: ['checkout'] }), testRun);
    expect(filtered).not.toContain('0.00%');
    expect(filtered).toContain('4,000'); // the log line count stays

    const odd = { ...s, patterns: [{ ...s.patterns[0]!, level: 'constructor' }] };
    const html = await setup(odd).renderer.renderLokiLogsSection(section({ patternLevels: 'all' }), testRun);
    expect(html).toContain('data-pill="neutral"');
    expect(html).not.toContain('Section incomplete');
  });

  // Added by the /ship test coverage audit.
  // Value: protects=a stored, unauthenticated-shareable report never carries a non-http(s) link from
  // snapshot data, warns when the level label is missing, and renders without a run; fails_when=the
  // https?:// scheme guard in link() is loosened (a javascript: href ships in the report), the
  // levelLabelMissing warning is dropped, or a null run reaches reportSummary; why_new=existing cases
  // use only https URLs and a fully labelled summary; seam=none; no_claim=Confluence's own URL handling.
  it('drops non-http(s) links, warns on a missing level label, and handles a missing run', async () => {
    const s = summary();
    const bad = {
      ...s,
      levelLabelMissing: true,
      exploreUrl: 'javascript:alert(1)',
      services: [{ ...s.services[0], exploreUrl: 'javascript:alert(2)' }],
    };
    const { loki, renderer } = setup(bad);
    const html = await renderer.renderLokiLogsSection(section(), testRun);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('Open all streams');
    expect(html).toContain('checkout'); // the name stays, as plain text
    expect(html).toContain('carries the level label &quot;level&quot;');

    const none = await renderer.renderLokiLogsSection(section(), null);
    expect(none).toContain('No test run data available');
    expect(loki.reportSummary).toHaveBeenCalledTimes(1);
  });

  // Added by the /ship test coverage audit.
  // Value: protects=maxRows truncates tables and says so, the baseline chip words each baseline kind,
  // and a panel with no series reads "no data"; fails_when=maxRows stops slicing or the "top N of M"
  // caption is lost (a truncated table reads as complete), a baseline kind is mislabelled, or an empty
  // panel is dropped silently; why_new=existing cases cover only the default row count, the
  // control-group chip and a panel with data; seam=none; no_claim=the ordering LokiService returns.
  it('truncates with a caption, words each baseline kind, and marks an empty panel', async () => {
    const s = summary();
    const prev = { ...s, baseline: { kind: 'previous-runs', testRunIds: ['r1'] }, panels: [{ ...s.panels[0], series: [] }] };
    const html = await setup(prev).renderer.renderLokiLogsSection(section({ maxRows: 1, includePanels: true }), testRun);
    expect(html).toContain('Applications (top 1 of 2 by errors)');
    expect(html).not.toContain('>cart<');
    expect(html).toContain('Top log patterns (errors and warnings), top 1 of 2');
    expect(html).toContain('vs 1 previous run<');
    expect(html).toContain('no data');

    const noBaseline = await setup({ ...s, baseline: { kind: 'none', testRunIds: [] } }).renderer.renderLokiLogsSection(section(), testRun);
    expect(noBaseline).toContain('no baseline');
  });
});
