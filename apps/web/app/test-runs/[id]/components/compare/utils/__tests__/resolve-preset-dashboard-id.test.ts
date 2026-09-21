import { resolvePresetDashboardId } from '../compare-utils';

const UUID = 'e761e70b-ebbe-56e0-9685-944ad90de4de';

describe('resolvePresetDashboardId', () => {
  it('uses the picked Grafana dashboard id', () => {
    expect(resolvePresetDashboardId({ selectedDashboard: { id: UUID } })).toBe(UUID);
  });

  it('prefers the metric applicationDashboardId over the dashboard id', () => {
    expect(
      resolvePresetDashboardId({ selectedDashboard: { id: 'dynatrace-61' }, selectedMetric: { applicationDashboardId: UUID } }),
    ).toBe(UUID);
  });

  it('never returns the synthetic dynatrace-<n> id; falls back to the added series', () => {
    expect(
      resolvePresetDashboardId({
        selectedDashboard: { id: 'dynatrace-61' },
        selectedMetric: { applicationDashboardId: undefined },
        addedSeries: [{ dashboardId: UUID }],
      }),
    ).toBe(UUID);
  });

  it('returns undefined when only a synthetic id is known', () => {
    expect(resolvePresetDashboardId({ selectedDashboard: { id: 'dynatrace-0' } })).toBeUndefined();
  });
});
