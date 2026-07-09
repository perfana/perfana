import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComparisonsConfigForm } from './SectionConfigs';

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

it('reveals baseline_run fields when mode is baseline_run', () => {
  const onChange = jest.fn();
  render(
    <ComparisonsConfigForm
      config={{ comparisonMode: 'baseline_run', thresholds: { good: 10, warning: 50 } }}
      onChange={onChange}
    />
  );
  expect(screen.getByLabelText(/good/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/warning/i)).toBeInTheDocument();
});

it('hides baseline_run fields in control_group mode', () => {
  render(
    <ComparisonsConfigForm
      config={{ comparisonMode: 'control_group' }}
      onChange={jest.fn()}
    />
  );
  expect(screen.queryByLabelText(/good/i)).not.toBeInTheDocument();
});

it('renders the baseline dropdown as a rich Autocomplete (compare-card style)', async () => {
  render(
    <ComparisonsConfigForm
      config={{ comparisonMode: 'baseline_run' }}
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

it('shows the dashboard → panels cascade for grafana source, panels disabled until a dashboard is chosen', () => {
  render(
    <ComparisonsConfigForm
      config={{ comparisonMode: 'baseline_run', source: 'grafana' }}
      onChange={jest.fn()}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );
  expect(screen.getByLabelText(/dashboard/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/panels/i)).toBeDisabled();
  expect(screen.getByText(/select a dashboard to see its panels/i)).toBeInTheDocument();
});

it('hides the dashboard cascade for performance-metrics source', () => {
  render(
    <ComparisonsConfigForm
      config={{ comparisonMode: 'baseline_run', source: 'performance-metrics' }}
      onChange={jest.fn()}
    />
  );
  expect(screen.queryByLabelText(/dashboard/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/panels/i)).not.toBeInTheDocument();
});

it('adds a host mapping row for dynatrace source', () => {
  const onChange = jest.fn();
  render(<ComparisonsConfigForm config={{ comparisonMode: 'baseline_run', source: 'dynatrace', hostMap: [] }} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /add host mapping/i }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    hostMap: [{ current: '', baseline: '' }],
  }));
});
