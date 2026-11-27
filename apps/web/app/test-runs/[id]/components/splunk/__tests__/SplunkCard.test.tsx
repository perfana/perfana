import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'run-1' }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/splunk', () => ({
  ...jest.requireActual('@/lib/splunk'),
  fetchSplunkRunSummary: jest.fn(),
}));

import { fetchSplunkRunSummary } from '@/lib/splunk';
import SplunkCard, { errorEvents } from '../SplunkCard';

const mockSummary = fetchSplunkRunSummary as jest.MockedFunction<typeof fetchSplunkRunSummary>;
const testRun = { test_run_id: 'run-1' };

const configured = {
  configured: true as const,
  connection: { id: 'c1', label: 'Splunk mock' },
  sources: [{ id: 'm1', level: 'environment' as const, indexName: 'app', sourcetype: 'log4j', hostPattern: 'be-*', labels: [] }],
  openInSplunk: 'http://splunk.web/en-US/app/search/search?q=x',
  window: { from: '2026-11-17T10:00:00Z', to: '2026-11-17T10:10:00Z' },
  panels: [
    {
      panelId: 1, dashboardLabel: 'Splunk logs', title: 'Log events by level', aggregation: 'count', splitBy: 'log_level', unit: 'short',
      link: 'http://splunk.web/en-US/app/search/search?q=y',
      series: [
        { name: 'INFO', mean: 32, peak: 77, total: 3200 },
        { name: 'ERROR', mean: 1.5, peak: 7, total: 150 },
      ],
    },
  ],
};

it('renders nothing when the workload has no Splunk panels', async () => {
  mockSummary.mockResolvedValue({ configured: false });
  const { container } = render(<SplunkCard testRun={testRun} expanded={false} onExpand={() => {}} />);
  await waitFor(() => expect(mockSummary).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it('shows the run\'s error events when collapsed', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<SplunkCard testRun={testRun} expanded={false} onExpand={() => {}} />);
  expect(await screen.findByText('Error events')).toBeInTheDocument();
  // The KPI; the closed Collapse also keeps the expanded table (with the same 150) mounted.
  expect(screen.getAllByText('150')[0]).toBeInTheDocument();
});

it('lists each panel with totals and Splunk links when expanded', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<SplunkCard testRun={testRun} expanded onExpand={() => {}} />);
  expect(await screen.findByText('Log events by level')).toBeInTheDocument();
  expect(screen.getByText('3,200')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open in Splunk/ })).toHaveAttribute('href', configured.openInSplunk);
  expect(screen.getByRole('link', { name: 'Open Log events by level in Splunk' })).toHaveAttribute('href', configured.panels[0]!.link);
});

it('counts error events only when the logs have an error series', () => {
  expect(errorEvents(configured.panels)).toBe(150);
  expect(errorEvents([{ ...configured.panels[0]!, series: [{ name: 'host-a', mean: 1, peak: 2, total: 9 }] }])).toBeNull();
});

it('opens a panel in Graphs, Compare and Trends', async () => {
  mockSummary.mockResolvedValue(configured);
  render(<SplunkCard testRun={testRun} expanded onExpand={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Log events by level' }));
  expect(await screen.findByRole('menuitem', { name: 'Open in Graphs' }))
    .toHaveAttribute('href', '/test-runs/run-1?card=graphs&dashboard=Splunk+logs&panel=1');
  expect(screen.getByRole('menuitem', { name: 'Open in Compare' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Open in Trends' })).toBeInTheDocument();
});

it('offers no Open-in menu for a panel with no series', async () => {
  // protects: the panel actions menu appears only when the panel holds data to chart
  // fails_when: the series.length guard is dropped and an empty panel links to a blank Graphs chart
  // seam: none
  // kind: component
  mockSummary.mockResolvedValue({ ...configured, panels: [{ ...configured.panels[0]!, series: [] }] });
  render(<SplunkCard testRun={testRun} expanded onExpand={() => {}} />);
  expect(await screen.findByText('No data for this run.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Actions for Log events by level' })).not.toBeInTheDocument();
});

it('opens the system config on the Splunk tab, scoped to the run', async () => {
  mockSummary.mockResolvedValue(configured);
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  render(<SplunkCard testRun={{ test_run_id: 'run-1', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load' }} expanded={false} onExpand={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Configure splunk logs' }));
  expect(open).toHaveBeenCalledWith('/systems/sut-1/config?tab=splunk&environment=acc&workload=load&fromTestRun=run-1', '_blank');
  open.mockRestore();
});
