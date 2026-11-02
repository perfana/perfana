/**
 * A series group in the picker: its name carries a "N pods" badge listing its members, the
 * panel offers a switch to the raw pods behind it, and an ungrouped panel is drawn as before.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import MetricSeriesCascade from '../MetricSeriesCascade';
import type { ApplicationDashboard, PanelOption, SeriesOption } from '../metric-options';

jest.mock('../metric-options', () => ({
  ...jest.requireActual('../metric-options'),
  fetchPanelsForDashboards: jest.fn(),
  fetchSeriesForPanels: jest.fn(),
}));
jest.mock('@/components/HostLabelChips', () => () => null);

import { fetchPanelsForDashboards, fetchSeriesForPanels, panelKey } from '../metric-options';

const testRun = { test_run_id: 'run-1' } as never;

const k8s: ApplicationDashboard = {
  id: 'dash-k8s', dashboard_label: 'Kubernetes', dashboard_name: 'Kubernetes', dashboard_uid: 'k8s', source_type: 'grafana',
};
const jvm: ApplicationDashboard = {
  id: 'dash-jvm', dashboard_label: 'JVM', dashboard_name: 'JVM', dashboard_uid: 'jvm', source_type: 'grafana',
};

const panelOf = (dashboard: ApplicationDashboard, id: number, title: string): PanelOption => ({
  id, title, type: 'timeseries', applicationDashboardId: dashboard.id,
  dashboard, dashboardLabel: dashboard.dashboard_label, source: 'grafana',
});

const cpu = panelOf(k8s, 7, 'CPU per pod');
const heap = panelOf(jvm, 5, 'Heap');

const POD_A = 'api-7d9f8c6b5-x2k4p';
const POD_B = 'api-7d9f8c6b5-z9w2t';
const POD_C = 'api-7d9f8c6b5-q8r2m';

const grouped = (panel: PanelOption): SeriesOption[] => [
  { metricName: 'api', panel, members: [POD_A, POD_B, POD_C] },
  { metricName: 'api (pod count)', panel },
];
const raw = (panel: PanelOption): SeriesOption[] =>
  [POD_A, POD_B, POD_C].map((metricName) => ({ metricName, panel }));

function setup(props: Partial<React.ComponentProps<typeof MetricSeriesCascade>> = {}) {
  const onAddSeries = jest.fn();
  render(
    <MetricSeriesCascade
      card="graphs"
      allDashboards={[k8s, jvm]}
      dashboardsLoading={false}
      testRun={testRun}
      addedSeries={[]}
      onAddSeries={onAddSeries}
      panelListOptions={{ collapseRtPanels: false, includeUrlPanels: false }}
      {...props}
    />,
  );
  return { onAddSeries };
}

const levelButton = (level: 'Dashboards' | 'Panels' | 'Series') =>
  screen.getByLabelText(level).closest('.MuiBox-root')!.querySelector('button.MuiButton-outlined')!;

async function pickEverything() {
  fireEvent.click(levelButton('Dashboards'));
  await waitFor(() => expect(screen.getByText('CPU per pod')).toBeInTheDocument());
  fireEvent.click(levelButton('Panels'));
}

beforeEach(() => {
  jest.clearAllMocks();
  (fetchPanelsForDashboards as jest.Mock).mockImplementation(async (dashboards: ApplicationDashboard[]) =>
    dashboards.map((d) => (d.id === k8s.id ? [cpu] : [heap])));
  (fetchSeriesForPanels as jest.Mock).mockImplementation(
    async (panels: PanelOption[], _run: unknown, memberPanels?: ReadonlySet<string>) =>
      panels.map((p) => {
        if (p.id === heap.id) return [{ metricName: 'used', panel: p }];
        return memberPanels?.has(panelKey(p)) ? raw(p) : grouped(p);
      }),
  );
});

it('badges a group with its pod count and lists the pods in a tooltip', async () => {
  const user = userEvent.setup();
  setup();
  await pickEverything();

  const badge = await screen.findByTestId('series-members-badge');
  expect(badge).toHaveTextContent('3 pods');
  await user.hover(badge);
  const tooltip = await screen.findByRole('tooltip');
  expect(within(tooltip).getByText(POD_A)).toBeInTheDocument();
  expect(within(tooltip).getByText(POD_C)).toBeInTheDocument();
  // Only the group carries one; its member-count series is an ordinary series.
  expect(screen.getAllByTestId('series-members-badge')).toHaveLength(1);
});

it('switches a panel to its individual pods and back', async () => {
  const user = userEvent.setup();
  setup();
  await pickEverything();
  await screen.findByTestId('series-members-badge');

  await user.click(screen.getByRole('button', { name: 'Show individual pods' }));

  await waitFor(() => expect(screen.getByText(POD_A)).toBeInTheDocument());
  const lastCall = (fetchSeriesForPanels as jest.Mock).mock.calls.at(-1)!;
  expect([...(lastCall[2] as Set<string>)]).toEqual([panelKey(cpu)]);
  expect(screen.queryByTestId('series-members-badge')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show groups' })).toHaveAttribute('aria-pressed', 'true');

  await user.click(screen.getByRole('button', { name: 'Show groups' }));

  await waitFor(() => expect(screen.getByTestId('series-members-badge')).toBeInTheDocument());
  expect(screen.queryByText(POD_A)).not.toBeInTheDocument();
  expect((fetchSeriesForPanels as jest.Mock).mock.calls.at(-1)!).toHaveLength(2);
});

it('still marks a group name that is already on the chart as added', async () => {
  setup({
    addedSeries: [{ dashboardId: k8s.id, panelId: 7, metricName: 'api' }],
  });
  await pickEverything();

  const badge = await screen.findByTestId('series-members-badge');
  const row = badge.closest('label') ?? badge.parentElement!.parentElement!;
  expect(within(row as HTMLElement).getByText('added')).toBeInTheDocument();
});

it('draws an ungrouped panel exactly as before: no badge, no switch', async () => {
  (fetchSeriesForPanels as jest.Mock).mockImplementation(async (panels: PanelOption[]) =>
    panels.map((p) => [{ metricName: 'used', panel: p }]));
  setup();
  await pickEverything();

  await waitFor(() => expect(screen.getAllByText('used').length).toBeGreaterThan(0));
  expect(screen.queryByTestId('series-members-badge')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show individual pods' })).not.toBeInTheDocument();
  expect((fetchSeriesForPanels as jest.Mock).mock.calls.every((call) => call.length === 2)).toBe(true);
});

it('adds a group under its group name', async () => {
  const { onAddSeries } = setup();
  await pickEverything();
  await screen.findByTestId('series-members-badge');

  fireEvent.click(screen.getByText('api'));
  fireEvent.click(screen.getByRole('button', { name: /^Add/ }));

  expect(onAddSeries).toHaveBeenCalledTimes(1);
  expect(onAddSeries.mock.calls[0][0].map((p: { metricName: string }) => p.metricName)).toEqual(['api']);
});
