import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  await waitFor(() => expect(screen.getByText(/2 available — leave empty to compare every series/)).toBeInTheDocument());
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

it('hides the dashboard cascade for performance-metrics source', () => {
  render(
    <ComparisonsConfigForm
      config={{ source: 'performance-metrics' }}
      onChange={jest.fn()}
    />
  );
  expect(screen.queryByLabelText(/dashboards/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/panels/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/series/i)).not.toBeInTheDocument();
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
