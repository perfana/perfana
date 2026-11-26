/**
 * A monitoring run (additional SUT monitoring) must store its application dashboards under the
 * run's OWN system/environment, labelled with the monitored combination, while the dashboard's
 * template variables point at the monitored SUT/env.
 */
import { DashboardProcessorService } from './dashboard-processor.service';
import { asMonitoringRun } from '../additional-monitoring';

const GRAFANA_DASHBOARD = {
  id: 'gd-1',
  uid: 'k8s-uid',
  name: 'K8s payment-db',
  grafanaId: 42,
  tags: [],
  grafanaInstance: { label: 'G' },
};

function build() {
  const finder = {
    findApplicationDashboards: jest.fn().mockResolvedValue([]),
    findExistingGrafanaDashboardsByResolvedUid: jest.fn().mockResolvedValue([GRAFANA_DASHBOARD]),
    findApplicationDashboardsForSystemUnderTest: jest.fn().mockResolvedValue([]),
  };
  const updates = { insertApplicationDashboard: jest.fn().mockResolvedValue(undefined) };
  const service = new DashboardProcessorService({} as any, finder as any, updates as any);
  return { service, updates };
}

const monitoringRun = () =>
  asMonitoringRun(
    {
      testRunId: 'r',
      systemUnderTest: { name: 'shop' },
      testEnvironment: 'acc',
      organizationId: 'org-1',
    } as any,
    { systemUnderTest: 'payment-db', testEnvironment: 'prod' },
  );

describe('DashboardProcessorService.processSingleVariableSet for a monitoring run', () => {
  // Value: protects=the monitored combination's application dashboard is owned by the run's SUT/env, suffixed label, variables point at the monitored SUT/env; fails_when=createOneApplicationDashboard reverts to testRun.systemUnderTest/testEnvironment for application, drops ownerLabel (collides with the owner's copy on uq_application_dashboards_unique), or builds variables from the owner; why_new=no spec existed for this service; seam=none; no_claim=readOnly/createNewDashboard Grafana push path
  it('inserts one dashboard owned by the run SUT/env, labelled and variabled for the monitored pair', async () => {
    const { service, updates } = build();
    await service.processSingleVariableSet(
      monitoringRun(),
      { dashboardName: 'K8s', dashboardUid: 'tpl', readOnly: false } as any,
      [],
      [],
      { label: 'G' },
      { grafanaInstance: { label: 'G' }, tags: [] },
    );
    expect(updates.insertApplicationDashboard).toHaveBeenCalledTimes(1);
    const ad = updates.insertApplicationDashboard.mock.calls[0][0];
    expect(ad).toMatchObject({
      application: 'shop',
      testEnvironment: 'acc',
      dashboardLabel: 'K8s - payment-db prod',
      organizationId: 'org-1',
    });
    expect(ad.variables).toEqual(
      expect.arrayContaining([
        { name: 'system_under_test', values: ['payment-db'] },
        { name: 'test_environment', values: ['prod'] },
      ]),
    );
  });

  // Value: protects=the separate-dashboard-per-value path labels each row with ownerLabel and owns it by the run's SUT/env; fails_when=createSeparateDashboardForValue drops ownerLabel or reverts application/testEnvironment; why_new=separate path has its own insert site, untested; seam=none; no_claim=existing-value dedupe
  it('labels a separate per-value dashboard with the combination suffix under the owner', async () => {
    const { service, updates } = build();
    await service.processSingleVariableSet(
      monitoringRun(),
      {
        dashboardName: 'K8s',
        dashboardUid: 'tpl',
        readOnly: false,
        createSeparateDashboardForVariable: 'host',
      } as any,
      [{ name: 'host', values: ['h1'] } as any],
      [],
      { label: 'G' },
      { grafanaInstance: { label: 'G' }, tags: [] },
    );
    expect(updates.insertApplicationDashboard).toHaveBeenCalledTimes(1);
    expect(updates.insertApplicationDashboard.mock.calls[0][0]).toMatchObject({
      application: 'shop',
      testEnvironment: 'acc',
      dashboardLabel: 'K8s h1 - payment-db prod',
    });
  });
});
