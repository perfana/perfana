import {
  bucketsToDataPoints,
  aggregatedYAxisFormat,
  offerAggregatedOption,
  fetchAggregatedSeriesData,
} from '../aggregated-series';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;
const okJson = (body: unknown): Response => ({ ok: true, json: async () => body } as unknown as Response);

const aggSeries = {
  id: 's1', dashboardId: 'd', dashboardLabel: 'L', panelId: 202,
  panelTitle: 'Request RT P90', metricName: 'All aggregated — Request RT P90',
  source: 'performance-metrics' as const,
};

describe('bucketsToDataPoints', () => {
  it('maps buckets to data points with sequential timestep and the given metric name', () => {
    expect(bucketsToDataPoints(
      [{ time: '2026-07-14T10:00:00.000Z', value: 12.5 }, { time: '2026-07-14T10:01:00.000Z', value: 13 }],
      'All aggregated — Request RT P90',
    )).toEqual([
      { time: '2026-07-14T10:00:00.000Z', metric_name: 'All aggregated — Request RT P90', value: 12.5, timestep: 0 },
      { time: '2026-07-14T10:01:00.000Z', metric_name: 'All aggregated — Request RT P90', value: 13, timestep: 1 },
    ]);
  });
  it('returns [] for empty buckets', () => {
    expect(bucketsToDataPoints([], 'x')).toEqual([]);
  });
});

describe('aggregatedYAxisFormat', () => {
  it('is percent for error_percentage and ms otherwise', () => {
    expect(aggregatedYAxisFormat('error_percentage')).toBe('percent');
    expect(aggregatedYAxisFormat('request_response_time')).toBe('ms');
    expect(aggregatedYAxisFormat('transaction_response_time')).toBe('ms');
  });
});

describe('offerAggregatedOption', () => {
  it('prepends the option for an aggregatable perf panel', () => {
    expect(offerAggregatedOption('performance-metrics', 202, ['T01.a', 'T02.b']))
      .toEqual(['All aggregated', 'T01.a', 'T02.b']);
  });
  it('leaves the list untouched for a non-perf source', () => {
    expect(offerAggregatedOption('grafana', 202, ['cpu'])).toEqual(['cpu']);
  });
  it('leaves the list untouched for a non-aggregatable perf panel', () => {
    expect(offerAggregatedOption('performance-metrics', 999, ['x'])).toEqual(['x']);
  });
});

describe('fetchAggregatedSeriesData', () => {
  beforeEach(() => mockFetch.mockReset());

  it('calls the timeseries endpoint with the panel spec and maps buckets', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ bucketSizeSeconds: 60, buckets: [{ time: '2026-07-14T10:00:00.000Z', value: 42 }] }));
    const data = await fetchAggregatedSeriesData('run-1', aggSeries);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/test-runs/run-1/aggregated-metric-timeseries');
    expect(url).toContain('metric=request_response_time');
    expect(url).toContain('stat=p90');
    expect(data).toEqual([{ time: '2026-07-14T10:00:00.000Z', metric_name: 'All aggregated — Request RT P90', value: 42, timestep: 0 }]);
  });

  it('returns [] when the panel has no aggregate spec', async () => {
    const data = await fetchAggregatedSeriesData('run-1', { ...aggSeries, panelId: 999 });
    expect(data).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns [] on a non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Bad' } as unknown as Response);
    expect(await fetchAggregatedSeriesData('run-1', aggSeries)).toEqual([]);
  });
});
