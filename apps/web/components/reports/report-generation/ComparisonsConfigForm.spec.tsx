import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { ComparisonsConfigForm } from './SectionConfigs';
// The sentinel by name, not the literal 'previous' — a rename becomes a compile error here
// rather than a test that silently stops exercising the resolved-per-report path.
import { PREVIOUS_RUN_BASELINE } from './BaselineRunSelect';
import { authenticatedFetch } from '@/lib/api';

const CANDIDATES = [
  {
    test_run_id: 'PerfanaWebshop-acc-loadTest-00003',
    test_environment: 'acc',
    workload: 'loadTest',
    start_time: '2026-07-01T10:00:00Z',
    created_at: '2026-07-01T10:00:00Z',
    application_release: '2.4.3',
    annotations: ['good baseline'],
  },
];

// Mock authenticatedFetch so the useEffect doesn't blow up in tests
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(CANDIDATES) })),
}));

/** `2 available` reads the same in two columns, so every count assertion is scoped. */
const column = (name: 'Dashboards' | 'Panels' | 'Series') =>
  within(screen.getByRole('group', { name }));

// Tests below re-point the fetch mock; reset it so each starts from the default answer.
beforeEach(() => {
  (authenticatedFetch as jest.Mock).mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(CANDIDATES) }));
});

it('disables the preview button until a baseline run is chosen', async () => {
  const { rerender } = render(
    <ComparisonsConfigForm config={{}} onChange={jest.fn()} systemUnderTestId="sut-1" testRunId="run-1" />
  );
  const button = () => screen.getByRole('button', { name: /preview/i });
  await waitFor(() => expect(button()).toBeDisabled());

  rerender(
    <ComparisonsConfigForm
      config={{ baselineTestRunId: CANDIDATES[0]!.test_run_id }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testRunId="run-1"
    />
  );
  await waitFor(() => expect(button()).toBeEnabled());
});

// An empty candidate list means "nothing to PIN", which is not the same as "no baseline
// possible": the sentinels resolve per report, and the fetch also yields [] when it fails.
// Gating preview on the list would disable a perfectly good baseline on a transient error.
it('still allows preview on a resolved-per-report baseline when there is no run to pin', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));

  render(
    <ComparisonsConfigForm
      config={{ baselineTestRunId: PREVIOUS_RUN_BASELINE }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testRunId="run-1"
    />
  );

  await waitFor(() => expect(screen.getByRole('button', { name: /preview/i })).toBeEnabled());
});

it('keeps the preview button disabled when no baseline is chosen at all', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));

  render(
    <ComparisonsConfigForm config={{}} onChange={jest.fn()} systemUnderTestId="sut-1" testRunId="run-1" />
  );

  await waitFor(() => expect(screen.getByRole('button', { name: /preview/i })).toBeDisabled());
});

it('picks several dashboards and panels without a popup to reopen', async () => {
  cascadeFetch();
  // Mirrors how the dialog owns the config: every pick re-renders the form with a new object.
  const Harness = () => {
    const [config, setConfig] = useState<Record<string, unknown>>({ source: 'grafana' });
    return (
      <ComparisonsConfigForm
        config={config as never}
        onChange={setConfig as never}
        onTextChange={jest.fn()}
        systemUnderTestId="sut-1"
        testRunId="run-1"
        testEnvironment="acc"
        workload="loadTest"
      />
    );
  };

  render(<Harness />);
  await waitFor(() => expect(screen.getByText(/2 available/)).toBeInTheDocument());

  // The rows are on screen, so picking six is six clicks and no popup — which is the
  // whole reason the Autocompletes went. Nothing should open a listbox at all.
  fireEvent.click(await screen.findByRole('checkbox', { name: 'JVM' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Docker' }));
  expect(screen.getByRole('checkbox', { name: 'JVM' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Docker' })).toBeChecked();

  // Both dashboards carry a "Heap" panel — that is the point of grouping them by dashboard.
  await waitFor(() => expect(screen.getAllByRole('checkbox', { name: 'Heap' })).toHaveLength(2));
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Heap' })[0]!);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('renders the threshold fields', () => {
  const onChange = jest.fn();
  render(
    <ComparisonsConfigForm
      config={{ thresholds: { good: 10, warning: 50 } }}
      onChange={onChange}
    />
  );
  expect(screen.getByLabelText(/good/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/warning/i)).toBeInTheDocument();
});

it('renders the comparison fields for an empty config — there is no mode to pick', () => {
  render(<ComparisonsConfigForm config={{}} onChange={jest.fn()} />);
  expect(screen.getByLabelText(/good/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/comparison mode/i)).not.toBeInTheDocument();
});

it('renders the baseline dropdown as a rich Autocomplete (compare-card style)', async () => {
  render(
    <ComparisonsConfigForm
      config={{}}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testRunId="PerfanaWebshop-acc-loadTest-00004"
    />
  );
  const input = screen.getByLabelText(/baseline test run/i);
  fireEvent.mouseDown(input);
  fireEvent.change(input, { target: { value: 'PerfanaWebshop' } });
  await waitFor(() => {
    // Rich option: bold run id + env/workload + version + annotations
    expect(screen.getByText('PerfanaWebshop-acc-loadTest-00003')).toBeInTheDocument();
    expect(screen.getByText(/acc \/ loadTest • Version: 2\.4\.3 • Annotations: good baseline/)).toBeInTheDocument();
  });
});

// The three cascade buttons in order: dashboards, panels, series. Each reads
// "Select all" or "Clear" depending on whether everything is already selected.
// By accessible name, which CascadeColumns sets per column ("Select all panels" /
// "Clear panels"). Anchored to the three level names so the per-column "Clear <level>
// filter" buttons are not picked up as well.
const cascadeButtons = () =>
  screen.getAllByRole('button', { name: /^(select all|clear) (dashboards|panels|series)$/i });

// A fetch mock that answers each cascade endpoint with its own shape.
const cascadeFetch = () => (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
  const body = url.includes('/grafana/application-dashboards')
    ? [
        { id: 'ad-1', dashboard_label: 'JVM', source_type: 'grafana' },
        { id: 'ad-2', dashboard_label: 'Docker', source_type: 'grafana' },
      ]
    : url.includes('panels-by-dashboard')
      ? [{ panel_id: 3, panel_title: 'Heap' }, { panel_id: 7, panel_title: 'GC Pause' }]
      : url.includes('distinct-names')
        ? ['used', 'committed']
        : CANDIDATES;
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
});

it('selects every dashboard at once', async () => {
  cascadeFetch();
  const onChange = jest.fn();
  render(
    <ComparisonsConfigForm
      config={{ source: 'grafana' }}
      onChange={onChange}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );
  await waitFor(() => expect(screen.getByText(/2 available/)).toBeInTheDocument());
  fireEvent.click(cascadeButtons()[0]!);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dashboardLabels: ['JVM', 'Docker'] }));
});

it('selects every panel across every selected dashboard at once', async () => {
  cascadeFetch();
  const onChange = jest.fn();
  render(
    <ComparisonsConfigForm
      config={{ source: 'grafana', dashboardLabels: ['JVM', 'Docker'] }}
      onChange={onChange}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );
  // Two dashboards x two panels each
  await waitFor(() => expect(screen.getByText(/4 available/)).toBeInTheDocument());
  fireEvent.click(cascadeButtons()[1]!);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    panels: [
      { id: 3, title: 'Heap', dashboardLabel: 'JVM' },
      { id: 7, title: 'GC Pause', dashboardLabel: 'JVM' },
      { id: 3, title: 'Heap', dashboardLabel: 'Docker' },
      { id: 7, title: 'GC Pause', dashboardLabel: 'Docker' },
    ],
  }));
});

it('selects every series of every selected panel at once', async () => {
  cascadeFetch();
  const onChange = jest.fn();
  render(
    <ComparisonsConfigForm
      config={{ source: 'grafana', dashboardLabels: ['JVM'], panels: [{ id: 3, title: 'Heap', dashboardLabel: 'JVM' }] }}
      onChange={onChange}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );
  await waitFor(() => expect(column('Series').getByText('2 available')).toBeInTheDocument());
  // The scope rule itself is now one sentence in the footer, not three helper texts.
  expect(screen.getByText(/Every series of the picked panels is included/)).toBeInTheDocument();
  fireEvent.click(cascadeButtons()[2]!);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    series: [
      { dashboardLabel: 'JVM', panelId: 3, metricName: 'used' },
      { dashboardLabel: 'JVM', panelId: 3, metricName: 'committed' },
    ],
  }));
});

it('drops the panels and series of a dashboard that is deselected', async () => {
  cascadeFetch();
  const onChange = jest.fn();
  render(
    <ComparisonsConfigForm
      config={{
        source: 'grafana',
        dashboardLabels: ['JVM', 'Docker'],
        panels: [{ id: 3, title: 'Heap', dashboardLabel: 'JVM' }],
        series: [{ dashboardLabel: 'JVM', panelId: 3, metricName: 'used' }],
      }}
      onChange={onChange}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );
  await waitFor(() => expect(screen.getByText(/2 available$/)).toBeInTheDocument());
  // Everything selected → the button clears the selection
  fireEvent.click(cascadeButtons()[0]!);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    dashboardLabels: [], panels: [], series: [],
  }));
});

it('shows the dashboard → panels cascade for grafana source, panels disabled until a dashboard is chosen', () => {
  render(
    <ComparisonsConfigForm
      config={{ source: 'grafana' }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );
  // Three inline columns, so "not available yet" is an empty column with a caption
  // saying what to do, not a disabled input.
  expect(screen.getByRole('group', { name: 'Dashboards' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Panels' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Series' })).toBeInTheDocument();
  expect(screen.getByText(/select a dashboard to see its panels/i)).toBeInTheDocument();
  expect(screen.getByText(/select a panel to see its series/i)).toBeInTheDocument();
});

it('names the dashboards and panels that a partial selection leaves out', async () => {
  // The renderer treats each level as all-or-explicit: a dashboard with no panel picked, and a
  // panel with no series picked, drop out. The form has to say so, or the section silently
  // reports on less than the picker shows selected.
  (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
    const body = url.includes('/grafana/application-dashboards')
      ? [
          { id: 'ad-1', dashboard_label: 'JVM', source_type: 'grafana' },
          { id: 'ad-2', dashboard_label: 'Docker', source_type: 'grafana' },
        ]
      : url.includes('panels-by-dashboard')
        ? [{ panel_id: 3, panel_title: 'Heap' }, { panel_id: 7, panel_title: 'GC Pause' }]
        : ['used'];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });

  render(
    <ComparisonsConfigForm
      config={{
        source: 'grafana',
        dashboardLabels: ['JVM', 'Docker'],
        panels: [
          { id: 3, title: 'Heap', dashboardLabel: 'JVM' },
          { id: 7, title: 'GC Pause', dashboardLabel: 'JVM' },
        ],
        series: [{ dashboardLabel: 'JVM', panelId: 3, metricName: 'used' }],
      }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );

  // One sentence, from `metricSelectionScopeNote`, so both warnings cannot drift apart.
  await waitFor(() =>
    expect(screen.getByText(/No panel picked on Docker, so it is left out\./)).toBeInTheDocument());
  expect(screen.getByText(/No series picked on GC Pause, so it is left out\./)).toBeInTheDocument();
});

it('collapses the redundant per-percentile RT panels, like the compare card does', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
    const body = url.includes('/grafana/application-dashboards')
      ? [{ id: 'ad-1', dashboard_label: 'Performance test metrics Checkout', source_type: 'performance_test' }]
      : url.includes('panels-by-dashboard')
        ? [
            { panel_id: 101, panel_title: 'Transaction RT Avg' },
            { panel_id: 102, panel_title: 'Transaction RT P90' },
            { panel_id: 103, panel_title: 'Transaction RT P95' },
            { panel_id: 104, panel_title: 'Transaction RT P99' },
            { panel_id: 105, panel_title: 'Transaction Error Rate' },
          ]
        : [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });

  render(
    <ComparisonsConfigForm
      config={{ source: 'performance-metrics', dashboardLabels: ['Performance test metrics Checkout'] }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );

  // 5 panels in, 2 out: the three percentile duplicates of 101 are dropped.
  // The five virtual URL panels are injected alongside them.
  await waitFor(() => expect(column('Panels').getByText('7 available')).toBeInTheDocument());

  expect(column('Panels').getByText('Transaction RT')).toBeInTheDocument();   // relabelled keeper
  expect(column('Panels').getByText('Transaction Error Rate')).toBeInTheDocument();
  expect(column('Panels').queryByText('Transaction RT P95')).not.toBeInTheDocument();
});

it('offers "All aggregated" as a series of a response-time panel, and no toggle for it', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
    const body = url.includes('/grafana/application-dashboards')
      ? [{ id: 'ad-1', dashboard_label: 'Performance test metrics Checkout', source_type: 'performance_test' }]
      : url.includes('panels-by-dashboard')
        ? [{ panel_id: 101, panel_title: 'Transaction RT Avg' }]
        : url.includes('distinct-names')
          ? ['T01_Homepage_Load', 'T02_Browse_Category']
          : [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });

  render(
    <ComparisonsConfigForm
      config={{
        source: 'performance-metrics',
        dashboardLabels: ['Performance test metrics Checkout'],
        panels: [{ id: 101, title: 'Transaction RT', dashboardLabel: 'Performance test metrics Checkout' }],
      }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testRunId="PerfanaWebshop-acc-loadTest-00018"
      testEnvironment="acc"
      workload="loadTest"
    />
  );

  // Two stored series plus the run-wide aggregate
  await waitFor(() => expect(column('Series').getByText('3 available')).toBeInTheDocument());
  expect(column('Series').getByText('All aggregated')).toBeInTheDocument();

  // The section-level toggle it replaces is gone
  expect(screen.queryByLabelText(/include 'all aggregated' row/i)).not.toBeInTheDocument();
});

it('offers the URL panels and lists a run\'s URLs as their series', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
    const body = url.includes('/grafana/application-dashboards')
      ? [{ id: 'ad-1', dashboard_label: 'Performance test metrics Checkout', source_type: 'performance_test' }]
      : url.includes('panels-by-dashboard')
        ? [{ panel_id: 101, panel_title: 'Transaction RT Avg' }]
        : url.includes('url-distinct-names')
          ? ['/checkout', '/cart']
          : [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });

  render(
    <ComparisonsConfigForm
      config={{
        source: 'performance-metrics',
        dashboardLabels: ['Performance test metrics Checkout'],
        panels: [{ id: 210, title: 'URL RT', dashboardLabel: 'Performance test metrics Checkout' }],
      }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testRunId="PerfanaWebshop-acc-loadTest-00018"
      testEnvironment="acc"
      workload="loadTest"
    />
  );

  // The five virtual URL panels join the dashboard's own panel
  await waitFor(() => expect(column('Panels').getByText('6 available')).toBeInTheDocument());
  // ...and the selected URL panel's series are the run's URLs
  await waitFor(() => expect(column('Series').getByText('2 available')).toBeInTheDocument());
  expect(column('Series').getByText('/checkout')).toBeInTheDocument();
});

it('offers the same cascade for performance-metrics — its metrics live in dashboards too', () => {
  render(
    <ComparisonsConfigForm
      config={{ source: 'performance-metrics' }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );
  // Three inline columns, so "not available yet" is an empty column with a caption
  // saying what to do, not a disabled input.
  expect(screen.getByRole('group', { name: 'Dashboards' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Panels' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Series' })).toBeInTheDocument();
});

it('adds a dashboard mapping row for grafana source (dropdown-based, not dynatrace-only)', () => {
  const onChange = jest.fn();
  render(<ComparisonsConfigForm config={{ source: 'grafana', dashboardMap: [] }} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /add dashboard mapping/i }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    dashboardMap: [{ current: '', baseline: '' }],
  }));
});

it('renders mapping rows as dropdowns (current + baseline dashboard autocompletes)', () => {
  render(
    <ComparisonsConfigForm
      config={{ source: 'dynatrace', dashboardMap: [{ current: '', baseline: '' }] }}
      onChange={jest.fn()}
    />
  );
  expect(screen.getByLabelText(/current dashboard/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/baseline dashboard/i)).toBeInTheDocument();
});

/**
 * The per-row graphs toggle. Off is the shipped default and has to stay so: on, the
 * section renders one inline SVG per changed row into a document that is stored in
 * Postgres, served over share links and turned into a PDF.
 */
it('offers the row-graphs toggle, off by default, and writes the flag', () => {
  const onChange = jest.fn();
  render(<ComparisonsConfigForm config={{}} onChange={onChange} />);

  const toggle = screen.getByRole('switch', { name: /show a graph per changed row/i });
  expect(toggle).not.toBeChecked();
  expect(screen.getByText(/the section is the comparison table only/i)).toBeInTheDocument();

  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showRowGraphs: true }));
});

it('says what the graphs will be, and that a PDF prints them open', () => {
  render(<ComparisonsConfigForm config={{ showRowGraphs: true }} onChange={jest.fn()} />);
  expect(screen.getByRole('switch', { name: /show a graph per changed row/i })).toBeChecked();
  // The three things a reader cannot see from the toggle: where the graph goes, which rows
  // get one, and the print behaviour.
  expect(screen.getByText(/expandable row under each changed row/i)).toBeInTheDocument();
  expect(screen.getByText(/outside the good band, worst first, at most 20/i)).toBeInTheDocument();
  expect(screen.getByText(/a PDF prints them all open/i)).toBeInTheDocument();
});
