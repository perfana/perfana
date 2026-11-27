// Value: protects=a real loki-* Grafana dashboard stays visible and Grafana-typed in the web (picker, Dashboards card); fails_when=the bare loki- prefix is classified as an artificial Loki placeholder again; why_new=nothing tested the prefix fallback; seam=none; no_claim=the API response shape
import { getSourceType, isArtificialDashboard } from '@/lib/metrics-source-utils';

describe('getSourceType prefix fallback', () => {
  it('reads only Perfana\'s own placeholder prefix as Loki', () => {
    expect(getSourceType({ dashboard_uid: 'perfana-loki-loki-logs' })).toBe('loki');
    expect(isArtificialDashboard({ dashboard_uid: 'perfana-loki-loki-logs' })).toBe(true);
  });

  it('keeps a real loki-* Grafana dashboard as Grafana', () => {
    expect(getSourceType({ dashboard_uid: 'loki-reads' })).toBe('grafana');
    expect(isArtificialDashboard({ dashboard_uid: 'loki-reads' })).toBe(false);
  });
});
