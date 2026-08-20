import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ComparisonsConfigForm } from './SectionConfigs';
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

it('keeps the preview button disabled when the run has no earlier runs to compare against', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));

  render(
    <ComparisonsConfigForm
      config={{ baselineTestRunId: 'previous' }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testRunId="run-1"
    />
  );

  await waitFor(() => expect(screen.getByRole('button', { name: /preview/i })).toBeDisabled());
});

it('keeps the dashboards and panels popups open while picking several', async () => {
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

  const dashboardsInput = screen.getByLabelText(/^dashboards$/i);
  fireEvent.mouseDown(dashboardsInput);
  fireEvent.click(await screen.findByText('JVM'));
  expect(screen.queryByRole('listbox')).toBeInTheDocument();   // still open after the first pick
  fireEvent.click(screen.getByText('Docker'));
  expect(screen.queryByRole('listbox')).toBeInTheDocument();
  fireEvent.keyDown(dashboardsInput, { key: 'Escape' });

  await waitFor(() => expect(screen.getByLabelText(/^panels$/i)).toBeEnabled());
  fireEvent.mouseDown(screen.getByLabelText(/^panels$/i));
  // Both dashboards carry a "Heap" panel — that is the point of grouping them
  fireEvent.click((await screen.findAllByText('Heap'))[0]!);
  expect(screen.queryByRole('listbox')).toBeInTheDocument();
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
const cascadeButtons = () => screen.getAllByRole('button', { name: /select all|^clear$/i });

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
  await waitFor(() => expect(screen.getByText(/2 available — leave empty to include every series/)).toBeInTheDocument());
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
  expect(screen.getByLabelText(/dashboards/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/panels/i)).toBeDisabled();
  expect(screen.getByLabelText(/series/i)).toBeDisabled();
  expect(screen.getByText(/select a dashboard to see its panels/i)).toBeInTheDocument();
  expect(screen.getByText(/select a panel to see its series/i)).toBeInTheDocument();
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
  await waitFor(() => expect(screen.getByText(/7 available — leave empty to include every panel/)).toBeInTheDocument());

  fireEvent.mouseDown(screen.getByLabelText(/panels/i));
  await waitFor(() => {
    expect(screen.getByText('Transaction RT')).toBeInTheDocument();      // relabelled keeper
    expect(screen.getByText('Transaction Error Rate')).toBeInTheDocument();
    expect(screen.queryByText('Transaction RT P95')).not.toBeInTheDocument();
  });
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
  await waitFor(() => expect(screen.getByText(/3 available — leave empty to include every series/)).toBeInTheDocument());
  fireEvent.mouseDown(screen.getByLabelText(/series/i));
  await waitFor(() => expect(screen.getByText('All aggregated')).toBeInTheDocument());

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
  await waitFor(() => expect(screen.getByText(/6 available — leave empty to include every panel/)).toBeInTheDocument());
  // ...and the selected URL panel's series are the run's URLs
  await waitFor(() => expect(screen.getByText(/2 available — leave empty to include every series/)).toBeInTheDocument());

  fireEvent.mouseDown(screen.getByLabelText(/series/i));
  await waitFor(() => expect(screen.getByText('/checkout')).toBeInTheDocument());
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
  expect(screen.getByLabelText(/dashboards/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/panels/i)).toBeDisabled();
  expect(screen.getByLabelText(/series/i)).toBeDisabled();
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
