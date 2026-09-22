import { buildCardLink, perfTestSeriesRef, readCardLinkPreselect } from '../metric-card-links';

describe('metric-card-links', () => {
  it('round-trips a series through the URL, encoding the awkward characters', () => {
    const ref = { dashboardLabel: 'Performance test metrics Løgin & pay', panelId: 201, metricName: 'Checkout.POST /pay?x=1' };
    const url = buildCardLink('WERKNL-00011', 'compare', ref);
    const params = new URL(url, 'http://x').searchParams;
    expect(url.startsWith('/test-runs/WERKNL-00011?')).toBe(true);
    expect(readCardLinkPreselect(params, 'compare')).toEqual(ref);
    // The link is for one card only.
    expect(readCardLinkPreselect(params, 'graphs')).toBeNull();
  });

  it('rejects an incomplete link', () => {
    const p = new URLSearchParams({ card: 'graphs', dashboard: 'd', panel: 'abc', metric: 'm' });
    expect(readCardLinkPreselect(p, 'graphs')).toBeNull();
  });

  it('answers null for a plain page load and for each param that is missing, empty or malformed', () => {
    const full = { card: 'graphs', dashboard: 'd', panel: '101', metric: 'm' };
    const without = (key: keyof typeof full, value?: string) => {
      const p = new URLSearchParams(full);
      if (value === undefined) p.delete(key); else p.set(key, value);
      return p;
    };

    // No ?card= at all — every cascade on an ordinary visit takes this branch.
    expect(readCardLinkPreselect(new URLSearchParams(), 'graphs')).toBeNull();
    expect(readCardLinkPreselect(without('dashboard'), 'graphs')).toBeNull();
    expect(readCardLinkPreselect(without('dashboard', ''), 'graphs')).toBeNull();
    expect(readCardLinkPreselect(without('metric'), 'graphs')).toBeNull();
    expect(readCardLinkPreselect(without('metric', ''), 'graphs')).toBeNull();
    expect(readCardLinkPreselect(without('panel', '101.5'), 'graphs')).toBeNull();
    // Number(null) and Number('') are 0 — an integer — so these need their own guard.
    expect(readCardLinkPreselect(without('panel'), 'graphs')).toBeNull();
    expect(readCardLinkPreselect(without('panel', ''), 'graphs')).toBeNull();
    // The full link still works, so the rejections above are not a broken fixture.
    expect(readCardLinkPreselect(new URLSearchParams(full), 'graphs')).toEqual({ dashboardLabel: 'd', panelId: 101, metricName: 'm' });
  });

  it('names perf-test series the way the worker stores them', () => {
    expect(perfTestSeriesRef({ scenario: 'S', transaction: 'T' }))
      .toEqual({ dashboardLabel: 'Performance test metrics S', panelId: 101, metricName: 'T' });
    expect(perfTestSeriesRef({ transaction: 'T', sampler: 'R' }))
      .toEqual({ dashboardLabel: 'Performance test metrics default', panelId: 201, metricName: 'T.R' });
    // samplerMetricNameSql drops the prefix when the transaction is empty, 'overall' or the sampler itself.
    expect(perfTestSeriesRef({ scenario: 'S', transaction: 'overall', sampler: 'R' }).metricName).toBe('R');
    expect(perfTestSeriesRef({ scenario: 'S', transaction: 'R', sampler: 'R' }).metricName).toBe('R');
    expect(perfTestSeriesRef({ scenario: 'S', transaction: '', sampler: 'R' }).metricName).toBe('R');
  });
});
