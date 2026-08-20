import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrendsConfigForm } from './SectionConfigs';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}));

const cascadeFetch = () => (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
  const body = url.includes('/grafana/application-dashboards')
    // The section now defaults to performance metrics, like the comparison section
    ? [{ id: 'ad-1', dashboard_label: 'Performance test metrics Checkout', source_type: 'performance_test' }]
    : url.includes('panels-by-dashboard')
      ? [{ panel_id: 3, panel_title: 'Heap' }]
      : url.includes('distinct-names')
        ? ['used', 'committed']
        : [];
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
});

const renderForm = (config = {}, onChange = jest.fn()) => {
  render(
    <TrendsConfigForm
      config={config}
      onChange={onChange}
      onTextChange={jest.fn()}
      systemUnderTestId="sut-1"
      testEnvironment="acc"
      workload="loadTest"
    />
  );
  return onChange;
};

it('offers performance metrics as a source, like the comparison section', () => {
  renderForm();
  fireEvent.mouseDown(screen.getByLabelText(/source/i));
  expect(screen.getByRole('option', { name: /performance metrics/i })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /grafana/i })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /dynatrace/i })).toBeInTheDocument();
});

it('offers an oldest-run picker and the dashboards → panels → series cascade', () => {
  renderForm();
  expect(screen.getByLabelText(/oldest test run/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/number of runs/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/^dashboards$/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^panels$/i)).toBeDisabled();
  expect(screen.getByLabelText(/^series$/i)).toBeDisabled();
});

it('defaults the window to the most recent change point', () => {
  renderForm();
  expect(screen.getByText(/most recent change point/i)).toBeInTheDocument();
});

it('no longer offers the preset id, the sensitivity dropdown or the toggles', () => {
  renderForm();
  expect(screen.queryByLabelText(/preset id/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/sensitivity/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/show charts/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/show statistics/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('pins the window to a chosen run', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
    const body = url.includes('baseline-candidates') || url.includes('systemUnderTestId')
      ? [{ test_run_id: 'run-000', test_environment: 'acc', workload: 'loadTest', created_at: '2026-08-01T10:00:00Z' }]
      : [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  const onChange = renderForm();

  fireEvent.mouseDown(screen.getByLabelText(/oldest test run/i));
  await waitFor(() => expect(screen.getByRole('option', { name: /run-000/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('option', { name: /run-000/ }));

  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ oldestTestRunId: 'run-000' }));
});

it('selects every dashboard at once', async () => {
  cascadeFetch();
  const onChange = renderForm();
  await waitFor(() => expect(screen.getByText(/1 available/)).toBeInTheDocument());
  fireEvent.click(screen.getAllByRole('button', { name: /select all|^clear$/i })[0]!);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    dashboardLabels: ['Performance test metrics Checkout'],
  }));
});

it('clears the cascade when the source changes — the dashboards belong to one source', () => {
  const onChange = renderForm({
    source: 'grafana',
    dashboardLabels: ['JVM'],
    panels: [{ id: 3, title: 'Heap', dashboardLabel: 'JVM' }],
    series: [{ dashboardLabel: 'JVM', panelId: 3, metricName: 'used' }],
  });
  fireEvent.mouseDown(screen.getByLabelText(/source/i));
  fireEvent.click(screen.getByRole('option', { name: /dynatrace/i }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    source: 'dynatrace', dashboardLabels: undefined, panels: undefined, series: undefined,
  }));
});
