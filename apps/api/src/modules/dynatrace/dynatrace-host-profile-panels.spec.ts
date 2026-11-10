/**
 * `DYNATRACE_HOST_PROFILE_PANELS` (shared) is the profile SLO form's static copy of the panels
 * every host dashboard carries, matched by grafana-sync on `dynatrace_queries.panel_title`. A
 * title that drifts from `HOST_METRICS` makes a profile SLO silently provision nothing.
 */
import {
  DYNATRACE_HOST_PROFILE_PANELS,
  DYNATRACE_HOST_DASHBOARD_UID_PATTERN_DEFAULT,
} from '@perfana/shared/constants';
import { HOST_METRICS } from './dynatrace.service';
import { DynatraceRepository, hostDashboardLabel } from './dynatrace.repository';

describe('Dynatrace host profile panels', () => {
  it('covers every HOST_METRICS panel with its title and unit', () => {
    for (const metric of HOST_METRICS) {
      expect(DYNATRACE_HOST_PROFILE_PANELS).toContainEqual(
        expect.objectContaining({ title: metric.name, yAxesFormat: metric.unit }),
      );
    }
  });

  it('lists only HOST_METRICS titles plus the legacy Disk Utilization', () => {
    const known = new Set<string>([...HOST_METRICS.map((m) => m.name), 'Disk Utilization']);
    expect(DYNATRACE_HOST_PROFILE_PANELS.filter((p) => !known.has(p.title))).toEqual([]);
  });

  it('keeps its synthetic ids unique', () => {
    const ids = DYNATRACE_HOST_PROFILE_PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches the uid the API writes for a host dashboard, and nothing else', () => {
    // generateDynatraceDashboardUid uses no instance state.
    const uidOf = (label: string): string =>
      (DynatraceRepository.prototype as any).generateDynatraceDashboardUid.call(null, label);
    const re = new RegExp(DYNATRACE_HOST_DASHBOARD_UID_PATTERN_DEFAULT);

    expect(re.test(uidOf(hostDashboardLabel('web-01.prod.example.com')))).toBe(true);
    expect(re.test(uidOf('Dynatrace DQL'))).toBe(false);
    expect(re.test('performance-test-metrics-checkout')).toBe(false);
  });
});
