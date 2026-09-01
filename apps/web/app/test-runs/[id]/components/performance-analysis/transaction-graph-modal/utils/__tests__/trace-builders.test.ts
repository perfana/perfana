/**
 * Tests for buildSamplerTraces — re-gridding the sparse sampler series.
 *
 * The API stopped padding the sampler series (11.8 MB -> 734 KB on a 3 h run).
 * Padding is still required for the RENDER though: Plotly's stackgroup only
 * infers a zero at a bucket some OTHER trace in the group has. A bucket where
 * every sampler is silent is absent from the x-union, and the filled band
 * interpolates straight across it — an idle window drawn as a solid band.
 */

import { buildSamplerTraces } from '../trace-builders';
import type { TimeSeriesResponse, TimeSeriesDataPoint } from '../../types';

const point = (bucket: string, avg: number | null): TimeSeriesDataPoint => ({
  time_bucket: bucket,
  avg_response_time: avg,
  median_response_time: avg,
  min_response_time: avg,
  max_response_time: avg,
  p90_response_time: avg,
  p95_response_time: avg,
  p99_response_time: avg,
  total_count: avg === null ? 0 : 1,
  passed_count: avg === null ? 0 : 1,
  failed_count: 0,
});

const B = (n: number) => `2026-08-28T03:00:${String(n * 5).padStart(2, '0')}.000Z`;

type Trace = { x: Date[]; y: (number | null)[]; name: string };
const asTraces = (t: unknown[]) => t as Trace[];

describe('buildSamplerTraces', () => {
  it('re-grids sparse samplers onto the full transaction grid', () => {
    // Grid has 4 buckets; the sampler only has data in the 1st and 4th.
    const data: TimeSeriesResponse = {
      transaction_data: [0, 1, 2, 3].map(i => point(B(i), i === 0 || i === 3 ? 10 : null)),
      sampler_data: { 'GET /a': [point(B(0), 10), point(B(3), 20)] },
      aggregation_seconds: 5,
    };

    const [trace] = asTraces(buildSamplerTraces(data, 'avg_response_time'));
    expect(trace!.x).toHaveLength(4);
    // The two idle buckets must exist as explicit vertices, not be absent.
    expect(trace!.y).toEqual([10, null, null, 20]);
  });

  it('keeps a fully-idle bucket present so the band drops instead of interpolating', () => {
    // Bucket 1 is idle for EVERY sampler — exactly the case stackgaps cannot fix.
    const data: TimeSeriesResponse = {
      transaction_data: [0, 1, 2].map(i => point(B(i), i === 1 ? null : 10)),
      sampler_data: {
        'GET /a': [point(B(0), 10), point(B(2), 10)],
        'GET /b': [point(B(0), 5), point(B(2), 5)],
      },
      aggregation_seconds: 5,
    };

    const traces = asTraces(buildSamplerTraces(data, 'avg_response_time'));
    expect(traces).toHaveLength(2);
    for (const t of traces) {
      expect(t.x.map(d => d.toISOString())).toEqual([B(0), B(1), B(2)]);
      expect(t.y[1]).toBeNull();
    }
  });

  it('falls back to the sampler own buckets when there is no grid', () => {
    // A run with no usable end_time returns an empty transaction_data.
    const data: TimeSeriesResponse = {
      transaction_data: [],
      sampler_data: { 'GET /a': [point(B(0), 10)] },
      aggregation_seconds: 5,
    };

    const [trace] = asTraces(buildSamplerTraces(data, 'avg_response_time'));
    expect(trace!.x).toHaveLength(1);
    expect(trace!.y).toEqual([10]);
  });

  it('re-grids the selected metric, not always the average', () => {
    const data: TimeSeriesResponse = {
      transaction_data: [point(B(0), 1), point(B(1), null)],
      sampler_data: { 'GET /a': [{ ...point(B(0), 10), p95_response_time: 99 }] },
      aggregation_seconds: 5,
    };

    const [trace] = asTraces(buildSamplerTraces(data, 'p95_response_time'));
    expect(trace!.y).toEqual([99, null]);
  });
});
