import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrendsConfigForm } from './SectionConfigs';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}));

const cascadeFetch = () => (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
  const body = url.includes('/grafana/application-dashboards')
    ? [{ id: 'ad-1', dashboard_label: 'JVM', source_type: 'grafana' }]
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

it('offers the run count and the dashboards → panels → series cascade', () => {
  renderForm();
  expect(screen.getByLabelText(/number of runs/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/dashboards/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/panels/i)).toBeDisabled();
  expect(screen.getByLabelText(/series/i)).toBeDisabled();
});

it('no longer offers the preset id, the sensitivity dropdown or the toggles', () => {
  renderForm();
  expect(screen.queryByLabelText(/preset id/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/sensitivity/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/show charts/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/show statistics/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('writes the run count where the renderer reads it', () => {
  const onChange = renderForm({ timeRange: { runCount: 10 } });
  fireEvent.change(screen.getByLabelText(/number of runs/i), { target: { value: '20' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ timeRange: { runCount: 20 } }));
});

it('selects every dashboard at once', async () => {
  cascadeFetch();
  const onChange = renderForm();
  await waitFor(() => expect(screen.getByText(/1 available/)).toBeInTheDocument());
  fireEvent.click(screen.getAllByRole('button', { name: /select all|^clear$/i })[0]!);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dashboardLabels: ['JVM'] }));
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
