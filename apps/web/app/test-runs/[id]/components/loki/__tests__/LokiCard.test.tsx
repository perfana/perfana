import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'run-1' }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/loki', () => ({
  ...jest.requireActual('@/lib/loki'),
  fetchLokiRunSummary: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  authenticatedFetch: jest.fn(async () => ({ ok: true, json: async () => [
    { test_run_id: 'run-0', created_at: '2026-11-26T10:00:00Z', start_time: '2026-11-26T10:00:00Z', completed: true },
  ] })),
}));
jest.mock('@/lib/control-group-baseline', () => ({
  ...jest.requireActual('@/lib/control-group-baseline'),
  fetchControlGroup: jest.fn(async () => ({ control_group_id: 'g', test_runs: ['run-a', 'run-b'], n_test_runs: 2, first_datetime: null, last_datetime: null })),
}));

import { fetchLokiRunSummary, LokiRunSummary } from '@/lib/loki';
import LokiCard, { errorRateTrend, formatPct, isErrorName, scopeOf } from '../LokiCard';

const mockSummary = fetchLokiRunSummary as jest.MockedFunction<typeof fetchLokiRunSummary>;
const testRun = { test_run_id: 'run-1' };

const configured: LokiRunSummary = {
  configured: true,
  connection: { id: 'c1', label: 'Loki prod', levelLabel: 'detected_level', serviceLabel: 'service_name' },
  sources: [{ id: 'm1', level: 'environment', selector: '{namespace="perf"}', labels: [], exploreUrl: 'https://grafana/explore?x=1' }],
  window: { from: '2026-11-27T10:00:00Z', to: '2026-11-27T11:00:00Z' },
  errorRate: { totalLines: 10000, errorLines: 250, errorRatePct: 2.5, baseline: { errorRatePct: 0.5, runs: 4 } },
  panels: [{
    panelId: 1, dashboardLabel: 'Loki logs', title: 'Log lines by level', aggregation: 'count', splitBy: 'detected_level', unit: 'short',
    isLevelPanel: true, link: 'https://grafana/explore?panel=1',
    series: [{ name: 'info', mean: 162, peak: 300, total: 9750 }, { name: 'error', mean: 4, peak: 40, total: 250 }],
  }],
  patterns: [
    { pattern: '<_> level=error msg="db timeout after <_>"', level: 'error', count: 200, firstSeen: '2026-11-27T10:05:00Z', lastSeen: '2026-11-27T10:50:00Z', source: 'patterns', isNew: true, exploreUrl: 'https://grafana/explore?p=1', service: null },
    { pattern: '<_> level=info msg="GET /health"', level: 'info', count: 9000, firstSeen: null, lastSeen: null, source: 'patterns', isNew: false, exploreUrl: null, service: null },
    { pattern: '<_> level=error msg="card declined <_>"', level: 'error', count: 40, firstSeen: null, lastSeen: null, source: 'patterns', isNew: true, exploreUrl: null, service: 'payments' },
  ],
  patternsSource: 'patterns',
  newPatterns: 1,
  baselineRunCount: 4,
  samples: [
    { time: '2026-11-27T10:50:00Z', level: 'error', line: 'db timeout after 3000ms', labels: { service_name: 'checkout' }, service: null },
    { time: '2026-11-27T10:51:00Z', level: 'error', line: 'card declined 4242', labels: { service_name: 'payments' }, service: 'payments' },
  ],
  services: [
    { service: 'checkout', totalLines: 6000, errorLines: 210, warnLines: 10, errorRatePct: 3.5, baseline: { errorRatePct: 0.4, runs: 4 }, isNew: false, newPatterns: 0, exploreUrl: 'https://grafana/explore?svc=checkout' },
    { service: 'payments', totalLines: 4000, errorLines: 40, warnLines: 0, errorRatePct: 1, baseline: null, isNew: true, newPatterns: 1, exploreUrl: null },
    { service: '(none)', totalLines: 0, errorLines: 0, warnLines: 0, errorRatePct: 0, baseline: null, isNew: null, newPatterns: null, exploreUrl: null },
  ],
};

it('renders nothing when the workload has no Loki panels', async () => {
  mockSummary.mockResolvedValue({ configured: false });
  const { container } = render(<LokiCard testRun={testRun} expanded={false} onExpand={() => {}} />);
  await waitFor(() => expect(mockSummary).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it('leads with the error rate and its baseline when collapsed', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<LokiCard testRun={testRun} expanded={false} onExpand={() => {}} />);
  expect((await screen.findAllByText('2.50%'))[0]).toBeInTheDocument();
  expect(screen.getAllByText(/baseline 0\.50%/)[0]).toBeInTheDocument();
  expect(screen.getAllByText(/new pattern/)[0]).toBeInTheDocument();
});

it('shows error patterns first, flags the new one, and links to Explore', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<LokiCard testRun={testRun} expanded onExpand={() => {}} />);
  expect(await screen.findByText('Top log patterns')).toBeInTheDocument();
  const row = screen.getByText(/db timeout after <_>/).closest('tr')!;
  expect(within(row).getByText('NEW')).toBeInTheDocument();
  // The default filter hides the info pattern.
  expect(screen.queryByText(/GET \/health/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(screen.getByText(/GET \/health/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open pattern in Grafana Explore' })).toHaveAttribute('href', 'https://grafana/explore?p=1');
});

it('expands a sample line to show its labels', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<LokiCard testRun={testRun} expanded onExpand={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /db timeout after 3000ms/ }));
  expect(screen.getByText('service_name=checkout')).toBeInTheDocument();
});

it('opens a panel in Graphs, Compare and Trends', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<LokiCard testRun={testRun} expanded onExpand={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Log lines by level' }));
  expect(await screen.findByRole('menuitem', { name: 'Open in Graphs' }))
    .toHaveAttribute('href', '/test-runs/run-1?card=graphs&dashboard=Loki+logs&panel=1');
});

it('judges the error rate against the baseline as a ratio, ignoring sub-0.1-point noise', () => {
  const r = (now: number, was: number | null) => ({ totalLines: 1, errorLines: 0, errorRatePct: now, baseline: was === null ? null : { errorRatePct: was, runs: 3 } });
  expect(errorRateTrend(r(2.5, 0.5))).toBe('worse');
  expect(errorRateTrend(r(0.2, 1))).toBe('better');
  expect(errorRateTrend(r(0.05, 0.01))).toBe('same');
  expect(errorRateTrend(r(1, null))).toBeNull();
  expect(formatPct(0.004)).toBe('<0.01%');
  expect(isErrorName('FATAL')).toBe(true);
  expect(isErrorName('warn')).toBe(false);
});

it('lists the applications, worst first, and flags the one whose error rate rose', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<LokiCard testRun={testRun} expanded onExpand={() => {}} />);
  expect(await screen.findByText('Applications')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show checkout' })).toBeInTheDocument();
  // Every application with lines gets a tab, after All.
  expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label') ?? t.textContent)).toEqual(['All applications (2)', 'checkout', 'payments']);
  expect(screen.getByRole('tab', { name: /All applications/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('link', { name: 'Open checkout in Grafana Explore' })).toHaveAttribute('href', 'https://grafana/explore?svc=checkout');
  // An application with no lines in the run is left out.
  expect(screen.queryByText(/no service_name/)).not.toBeInTheDocument();
});

it('narrows patterns and lines to the selected application, and clears back to all', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<LokiCard testRun={testRun} expanded onExpand={() => {}} />);
  expect(await screen.findByText(/db timeout after <_>/)).toBeInTheDocument();
  expect(screen.queryByText(/card declined <_>/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'payments' }));
  expect(screen.getByRole('tab', { name: 'payments' })).toHaveAttribute('aria-selected', 'true');
  // The overview table belongs to the All tab only.
  expect(screen.queryByText('Applications')).not.toBeInTheDocument();
  expect(screen.getByText(/card declined <_>/)).toBeInTheDocument();
  expect(screen.queryByText(/db timeout after <_>/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /card declined 4242/ })).toBeInTheDocument();
  // The level panel is not split by service_name, so it keeps every series.
  expect(screen.getByText('Panels not split by service_name show all applications.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: /All applications/ }));
  expect(screen.getByText(/db timeout after <_>/)).toBeInTheDocument();
  // A row of the All table opens that application's tab too.
  fireEvent.click(screen.getByRole('button', { name: 'Show checkout' }));
  expect(screen.getByRole('tab', { name: 'checkout' })).toHaveAttribute('aria-selected', 'true');
});

it('scopes the KPIs to an application, falling back to all-streams lines carrying its label', () => {
  if (!configured.configured) throw new Error('fixture');
  const checkout = scopeOf(configured, 'checkout', 'service_name');
  expect(checkout.rate).toMatchObject({ totalLines: 6000, errorLines: 210, errorRatePct: 3.5 });
  expect(checkout.samples.map((x) => x.line)).toEqual(['db timeout after 3000ms']);
  expect(checkout.patterns).toEqual([]);
  const all = scopeOf(configured, null, 'service_name');
  expect(all.patterns.every((p) => p.service === null)).toBe(true);
  expect(all.newPatterns).toBe(1);
});

it('opens the system config on the Loki tab, scoped to the run', async () => {
  mockSummary.mockResolvedValue(configured);
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  render(<LokiCard testRun={{ test_run_id: 'run-1', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load' }} expanded onExpand={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Configure loki logs' }));
  expect(open).toHaveBeenCalledWith('/systems/sut-1/config?tab=loki&environment=acc&workload=load&fromTestRun=run-1', '_blank');
  open.mockRestore();
});

it('warns that the level label is on no line instead of showing an error rate', async () => {
  mockSummary.mockResolvedValue({ ...configured, errorRate: null, levelLabelMissing: true });
  render(<LokiCard testRun={testRun} expanded onExpand={() => {}} />);
  expect(await screen.findByText(/No line of this run carries the level label/)).toBeInTheDocument();
});

it('flags the missing level label on the collapsed card', async () => {
  mockSummary.mockResolvedValue({ ...configured, errorRate: null, levelLabelMissing: true });
  render(<LokiCard testRun={testRun} expanded={false} onExpand={() => {}} />);
  expect(await screen.findByText('No log level on these lines')).toBeInTheDocument();
});

it('counts lines but no error rate in every scope when the level label is missing', () => {
  if (!configured.configured) throw new Error('fixture');
  const missing = { ...configured, errorRate: null, levelLabelMissing: true };
  expect(scopeOf(missing, null, 'service_name')).toMatchObject({ rate: null, totalLines: 6000 + (configured.services ?? [])[1]!.totalLines, levelMissing: true });
  expect(scopeOf(missing, 'checkout', 'service_name')).toMatchObject({ rate: null, totalLines: 6000, levelMissing: true });
});

describe('baseline picker', () => {
  // Value: protects=the Loki card names its baseline and refetches against a picked one; fails_when=the pick is not sent, or the default control group is not shown as selected; why_new=the picker is new; seam=none; no_claim=the API's resolution (mocked summary)
  it('shows the control group as the baseline and refetches with a picked run', async () => {
    mockSummary.mockReset();
    mockSummary.mockResolvedValue({ ...configured, baseline: { kind: 'control-group', testRunIds: ['run-a', 'run-b'] } } as LokiRunSummary);
    render(<LokiCard testRun={testRun} expanded onExpand={() => {}} />);
    const input = await screen.findByLabelText('Baseline');
    await waitFor(() => expect(input).toHaveValue('Control group (2 runs)'));
    expect(screen.getByText(/new patterns and applications its newest 2 runs \(run-a, run-b\)/)).toBeInTheDocument();

    fireEvent.mouseDown(input);
    fireEvent.click(await screen.findByText('run-0'));
    await waitFor(() => expect(mockSummary).toHaveBeenLastCalledWith('run-1', 'run-0'));
    expect(mockSummary).toHaveBeenNthCalledWith(1, 'run-1', null);
  });

  it('says what it compared with when there is no control group', async () => {
    mockSummary.mockReset();
    mockSummary.mockResolvedValue({ ...configured, baseline: { kind: 'previous-runs', testRunIds: ['p1', 'p2'] } } as LokiRunSummary);
    render(<LokiCard testRun={testRun} expanded onExpand={() => {}} />);
    expect(await screen.findByText(/comparing with the 2 previous runs \(p1, p2\)/)).toBeInTheDocument();
  });
});
