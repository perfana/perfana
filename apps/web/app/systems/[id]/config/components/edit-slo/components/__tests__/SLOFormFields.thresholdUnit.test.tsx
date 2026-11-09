/**
 * Duplicate (`allowMetricChange`) can re-point a clone at another metric. The clone's record unit
 * belongs to the old one, so picking a metric must make ITS unit the form's thresholdUnit: a
 * bare "90" on a percentunit panel is then saved as 0.9 under a percentunit label, never as 90.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SLOFormFields } from '../SLOFormFields';
import { initialSLOFormData, SLOFormData } from '../../types';

const noop = jest.fn().mockResolvedValue(undefined);

function renderPicker(sloFormData: SLOFormData, setSloFormData: jest.Mock, extra: Record<string, unknown>) {
  render(
    <SLOFormFields
      allowMetricChange
      sloFormData={sloFormData}
      setSloFormData={setSloFormData}
      validationErrors={{}}
      setValidationErrors={jest.fn()}
      dashboardsLoading={false}
      panelsLoading={false}
      availableDashboards={[]}
      availablePanels={[]}
      availableDynatraceDashboards={[]}
      availableDynatraceMetrics={[]}
      fetchSloApplicationDashboards={noop}
      fetchDynatraceDashboardsForSlo={noop}
      fetchDashboardPanels={noop}
      fetchPerfMetricsPanels={noop}
      fetchDynatraceMetricsForSlo={noop}
      {...extra}
    />,
  );
}

function pick(name: RegExp, option: string) {
  const input = screen.getByRole('combobox', { name });
  fireEvent.mouseDown(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option));
}

const lastState = (set: jest.Mock, prev: SLOFormData) => set.mock.calls.at(-1)[0](prev) as SLOFormData;

it("takes the picked Grafana panel's unit as thresholdUnit", () => {
  const prev: SLOFormData = {
    ...initialSLOFormData,
    source: 'grafana',
    selectedDashboard: { id: 'ad-1', dashboard_uid: 'uid-1', dashboard_label: 'Board' },
    selectedPanel: { id: 1, title: 'Latency', yAxesFormat: 'ms' },
    thresholdUnit: 'ms',
  };
  const set = jest.fn();
  renderPicker(prev, set, {
    availablePanels: [
      { id: 1, title: 'Latency', type: 'timeseries', yAxesFormat: 'ms' },
      { id: 2, title: 'Pool in use', type: 'timeseries', yAxesFormat: 'percentunit' },
    ],
  });
  pick(/metric/i, 'Pool in use');
  expect(lastState(set, prev).thresholdUnit).toBe('percentunit');
});

it("takes the picked Dynatrace metric's unit, or none", () => {
  const prev: SLOFormData = {
    ...initialSLOFormData,
    source: 'dynatrace',
    selectedDashboard: { dashboardLabel: 'DT board' },
    selectedPanel: { panelTitle: 'Response time' },
    thresholdUnit: 'ms',
  };
  const set = jest.fn();
  renderPicker(prev, set, {
    availableDynatraceMetrics: [
      { panelTitle: 'Response time', panelId: 1, applicationDashboardId: 'ad-1' },
      { panelTitle: 'Failure rate', panelId: 2, applicationDashboardId: 'ad-1' },
    ],
  });
  pick(/metric/i, 'Failure rate');
  expect(lastState(set, prev).thresholdUnit).toBeUndefined();
});
