import { render, screen, waitFor } from '@testing-library/react';

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
      panelId: 1, title: 'Log events by level', aggregation: 'count', splitBy: 'log_level', unit: 'short',
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
