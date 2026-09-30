/**
 * The unified dashboard picker is where the Grafana instance is KNOWN — every
 * application-dashboard row it lists under "Grafana Dashboards" carries
 * `grafana_instance_id`. The hook below it cannot invent one, so if this onChange drops
 * it the scoped fetcher is scoped by nothing and the uid lookup goes back to guessing
 * between two Grafanas' copies of the same dashboard — and the SLO is saved against
 * whichever panel ids came back.
 *
 * Note the hook's declared return type still says `(dashboardUid: string)`; the
 * two-argument implementation is passed through by reference, which is what makes this
 * hand-off worth pinning rather than trusting to the compiler.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SLOFormFields } from '../SLOFormFields';
import { initialSLOFormData } from '../../types';

const dashboards = [
  {
    id: 'app-dash-1',
    dashboard_uid: 'jvm-uid',
    dashboard_label: 'JVM Overview',
    dashboard_name: 'JVM Overview',
    grafana_instance_id: 'gi-prod',
  },
] as never;

const noop = jest.fn().mockResolvedValue(undefined);

it('hands the picked dashboard’s Grafana instance to the panel fetch', () => {
  const fetchDashboardPanels = jest.fn().mockResolvedValue(undefined);

  render(
    <SLOFormFields
      sloFormData={initialSLOFormData}
      setSloFormData={jest.fn()}
      validationErrors={{}}
      setValidationErrors={jest.fn()}
      dashboardsLoading={false}
      panelsLoading={false}
      availableDashboards={dashboards}
      availablePanels={[]}
      availableDynatraceDashboards={[]}
      availableDynatraceMetrics={[]}
      availablePerfMetricsDashboards={[]}
      availablePerfMetricsPanels={[]}
      dataSourceAvailability={{ hasDynatraceData: false, hasPerfMetricsData: false }}
      systemName="SONAR"
      environment="acc"
      workload="load"
      handleSourceChange={jest.fn()}
      fetchDashboardPanels={fetchDashboardPanels}
      fetchPerfMetricsPanels={noop}
      fetchDynatraceMetricsForSlo={noop}
    />,
  );

  const dashboardInput = screen.getByRole('combobox', { name: /dashboard/i });
  fireEvent.mouseDown(dashboardInput);
  fireEvent.keyDown(dashboardInput, { key: 'ArrowDown' });
  fireEvent.click(within(screen.getByRole('listbox')).getByText('JVM Overview'));

  expect(fetchDashboardPanels).toHaveBeenCalledWith('jvm-uid', 'gi-prod');
});
