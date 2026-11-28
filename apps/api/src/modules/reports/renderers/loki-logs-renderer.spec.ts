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
  samples: [{ time: '2026-11-20T10:30:00.123Z', level: 'error', line: 'boom & <b>bang</b>', labels: {}, service: 'checkout' }],
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
    expect(html).not.toContain('Latest error lines'); // off by default
  });

  it('escapes patterns and log lines', async () => {
    const { renderer } = setup();
    const html = await renderer.renderLokiLogsSection(section({ includeSamples: true }), testRun);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('boom &amp; &lt;b&gt;bang&lt;/b&gt;');
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
