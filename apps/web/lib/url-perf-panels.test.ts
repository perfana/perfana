import { isUrlPanel, getUrlPanelMetric, buildUrlPanels, URL_PANEL_ID_MIN } from './url-perf-panels';

describe('url-perf-panels', () => {
  it('recognises URL panel ids', () => {
    expect(isUrlPanel(210)).toBe(true);
    expect(isUrlPanel(218)).toBe(true);
    expect(isUrlPanel(202)).toBe(false); // request panel
    expect(isUrlPanel(216)).toBe(false); // apdex is intentionally absent
  });

  it('maps panel ids to the endpoint metric', () => {
    expect(getUrlPanelMetric(210)).toBe('response_time');
    expect(getUrlPanelMetric(213)).toBe('response_time');
    expect(getUrlPanelMetric(214)).toBe('error_percentage');
    expect(getUrlPanelMetric(215)).toBe('throughput');
    expect(getUrlPanelMetric(217)).toBe('latency');
    expect(getUrlPanelMetric(218)).toBe('connect_time');
    expect(getUrlPanelMetric(999)).toBeNull();
  });

  it('builds dropdown panels tagged with the dashboard id', () => {
    const panels = buildUrlPanels('dash-1');
    expect(panels.every(p => p.applicationDashboardId === 'dash-1')).toBe(true);
    expect(panels.map(p => p.id)).toContain(URL_PANEL_ID_MIN);
    expect(panels.find(p => p.id === 211)?.title).toMatch(/P90/i);
    expect(panels.find(p => p.id === 216)).toBeUndefined(); // no apdex
  });
});
