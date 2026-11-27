// Value: protects=a real Grafana dashboard with a loki- uid (the Loki mixin's loki-reads) stays a Grafana source in the auto-config dual-write; fails_when=the bare loki- prefix is classified as Loki again; why_new=nothing tested the uid inference; seam=none; no_claim=grafana-sync's upsert itself
import { inferSourceTypeFromDashboardUid } from '../metrics-source-upsert';

describe('inferSourceTypeFromDashboardUid', () => {
  it.each([
    ['perfana-loki-loki-logs', 'loki'],
    ['loki-reads', 'grafana'],
    ['loki-logs', 'grafana'],
    ['splunk-checkout', 'splunk'],
    ['dynatrace-hosts', 'dynatrace'],
    ['performance-test-metrics-x', 'performance_test'],
    ['abc123', 'grafana'],
  ])('%s → %s', (uid, type) => {
    expect(inferSourceTypeFromDashboardUid(uid)).toBe(type);
  });
});
