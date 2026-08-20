import {
  ALL_AGGREGATED_OPTION,
  getAggregateSpec,
  isAggregatablePanel,
  shouldOfferAllAggregated,
  buildAggregatedMetricName,
  fetchAggregatedStatistics,
  collapsePerfRtPanels,
  normaliseLegacyAggregatedSeries,
} from '../aggregated-perf-series';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

describe('aggregated-perf-series', () => {
  // jest.config.js sets neither clearMocks nor resetMocks, so a persistent
  // mockResolvedValue/mockRejectedValue and the call history both leak into
  // every later test in file order without this.
  beforeEach(() => { jest.clearAllMocks(); });

  it('maps the ten supported panel ids to (metric, stat)', () => {
    expect(getAggregateSpec(102)).toEqual({ metric: 'transaction_response_time', stat: 'p90' });
    expect(getAggregateSpec(201)).toEqual({ metric: 'request_response_time', stat: 'avg' });
    expect(getAggregateSpec(205)).toEqual({ metric: 'error_percentage', stat: 'avg' });
    expect(getAggregateSpec(206)).toBeNull(); // throughput — unsupported
    expect(isAggregatablePanel(204)).toBe(true);
    expect(isAggregatablePanel(999)).toBe(false);
  });

  it('offers "All aggregated" only for the performance-metrics source', () => {
    expect(shouldOfferAllAggregated('performance-metrics', 102)).toBe(true);
    expect(shouldOfferAllAggregated('grafana', 102)).toBe(false);      // panel-id collision must not leak
    expect(shouldOfferAllAggregated('dynatrace', 202)).toBe(false);
    expect(shouldOfferAllAggregated('performance-metrics', 206)).toBe(false); // unsupported panel
  });

  it('collapses redundant RT percentile panels, relabelling the Avg keeper', () => {
    const panels = [
      { id: 101, title: 'Transaction RT Avg' },
      { id: 102, title: 'Transaction RT P90' },
      { id: 103, title: 'Transaction RT P95' },
      { id: 104, title: 'Transaction RT P99' },
      { id: 105, title: 'Transaction Error Rate' },
      { id: 201, title: 'Request RT Avg' },
      { id: 202, title: 'Request RT P90' },
      { id: 210, title: 'URL RT' }, // not aggregatable — untouched
    ];
    const out = collapsePerfRtPanels(panels);
    expect(out.map(p => p.id)).toEqual([101, 105, 201, 210]);
    expect(out.find(p => p.id === 101)?.title).toBe('Transaction RT');
    expect(out.find(p => p.id === 201)?.title).toBe('Request RT');
    expect(out.find(p => p.id === 105)?.title).toBe('Transaction Error Rate'); // error panel kept as-is
  });

  it('builds a readable, unique series name from the panel title', () => {
    expect(buildAggregatedMetricName('Request RT P90')).toBe(`${ALL_AGGREGATED_OPTION} — Request RT P90`);
  });

  it('fetches the endpoint with comma-joined ids and returns the values', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [{ testRunId: 'a', value: 12 }] } as unknown as Response);
    const res = await fetchAggregatedStatistics('a', ['a', 'b'], { metric: 'request_response_time', stat: 'p90' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/test-runs/a/aggregated-metric-statistic?metric=request_response_time&stat=p90&testRunIds=a%2Cb',
      { headers: { 'Content-Type': 'application/json' } },
    );
    expect(res).toEqual([{ testRunId: 'a', value: 12 }]);
  });

  it('returns [] on a non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const res = await fetchAggregatedStatistics('a', ['a'], { metric: 'error_percentage', stat: 'avg' });
    expect(res).toEqual([]);
  });

  it('returns [] when the transport throws', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const res = await fetchAggregatedStatistics('a', ['a'], { metric: 'request_response_time', stat: 'avg' });
    expect(res).toEqual([]);
    spy.mockRestore();
  });

  it('passes the per-stat values map through untouched', async () => {
    const payload = [{ testRunId: 'a', value: 200, values: { avg: 100, p50: 90, p90: 200, p95: 300, p99: 400, max: 900 } }];
    mockFetch.mockResolvedValue({ ok: true, json: async () => payload } as unknown as Response);
    const res = await fetchAggregatedStatistics('a', ['a', 'b'], { metric: 'request_response_time', stat: 'p90' });
    expect(res).toEqual(payload);
    expect(res[0]?.values?.p95).toBe(300);
  });
});

describe('normaliseLegacyAggregatedSeries', () => {
  // collapsePerfRtPanels only filters the panel dropdown. Preset restore rebuilds
  // series from the stored panelId, so a preset saved before the collapse still
  // holds 102/103/104/202/203/204 — rows labelled "… RT P90" that now show all
  // four statistics, and that duplicate the collapsed row if both are added.
  const agg = (panelId: number, panelTitle: string) => ({
    panelId,
    panelTitle,
    metricName: buildAggregatedMetricName(panelTitle),
    isAggregated: true,
  });

  it.each([
    [102, 101, 'Transaction RT'],
    [103, 101, 'Transaction RT'],
    [104, 101, 'Transaction RT'],
    [202, 201, 'Request RT'],
    [203, 201, 'Request RT'],
    [204, 201, 'Request RT'],
  ])('rewrites legacy panel %i onto keeper %i', (from, keeper, title) => {
    const out = normaliseLegacyAggregatedSeries(agg(from, 'Legacy RT P90'));

    expect(out.panelId).toBe(keeper);
    expect(out.panelTitle).toBe(title);
    expect(out.metricName).toBe(`${ALL_AGGREGATED_OPTION} — ${title}`);
  });

  it.each([101, 201])('leaves the keeper panel %i alone', (panelId) => {
    const input = agg(panelId, 'Transaction RT');

    expect(normaliseLegacyAggregatedSeries(input)).toEqual(input);
  });

  it.each([105, 205])('leaves the error-rate panel %i alone', (panelId) => {
    const input = agg(panelId, 'Error rate');

    expect(normaliseLegacyAggregatedSeries(input)).toEqual(input);
  });

  it('leaves a non-aggregated series alone even on a legacy panel id', () => {
    // Panel ids are not unique across sources — a Grafana panel 202 is not an RT panel.
    const input = { panelId: 202, panelTitle: 'Some Grafana panel', metricName: 'cpu', isAggregated: false };

    expect(normaliseLegacyAggregatedSeries(input)).toEqual(input);
  });

  it('leaves a panel it knows nothing about alone', () => {
    const input = agg(9999, 'Unknown');

    expect(normaliseLegacyAggregatedSeries(input)).toEqual(input);
  });
});
