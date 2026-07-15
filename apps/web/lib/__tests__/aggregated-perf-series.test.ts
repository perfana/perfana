import {
  ALL_AGGREGATED_OPTION,
  getAggregateSpec,
  isAggregatablePanel,
  shouldOfferAllAggregated,
  buildAggregatedMetricName,
  fetchAggregatedStatistics,
  collapsePerfRtPanels,
} from '../aggregated-perf-series';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

describe('aggregated-perf-series', () => {
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
});
