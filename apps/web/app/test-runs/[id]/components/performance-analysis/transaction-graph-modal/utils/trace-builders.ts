/**
 * Plotly trace builders for TransactionGraphModal
 */

import type { TimeSeriesResponse, MetricType } from '../types';
import { SAMPLER_COLORS } from './chart-config';

export function buildTransactionTrace(
  data: TimeSeriesResponse,
  transactionName: string,
  selectedMetric: MetricType
): Record<string, unknown> {
  return {
    x: data.transaction_data.map(d => new Date(d.time_bucket)),
    y: data.transaction_data.map(d => d[selectedMetric]),
    name: `${transactionName} (Total)`,
    type: 'scatter',
    mode: 'lines+markers',
    line: {
      width: 2,
      color: 'rgb(20, 20, 20)',
      dash: 'dash',
    },
    marker: {
      size: 4,
      color: 'rgb(20, 20, 20)',
    },
    connectgaps: false,
    hovertemplate:
      `<b>${transactionName} (Total)</b><br>` +
      '<span style="font-size: 13px; font-weight: 600;">%{y:.2f} ms</span><br>' +
      '<extra></extra>',
    yaxis: 'y',
  };
}

export function buildPassedTrace(
  data: TimeSeriesResponse,
  aggregationSeconds: number
): Record<string, unknown> {
  return {
    x: data.transaction_data.map(d => new Date(d.time_bucket)),
    y: data.transaction_data.map(d => d.passed_count / aggregationSeconds),
    name: 'Passed (tx/s)',
    type: 'scatter',
    mode: 'lines',
    line: {
      width: 2,
      color: 'rgb(76, 175, 80)', // Green
    },
    hovertemplate:
      '<b>Passed</b><br>' +
      '<span style="font-size: 13px; font-weight: 600;">%{y:.2f} tx/s</span><br>' +
      '<extra></extra>',
    yaxis: 'y2',
  };
}

export function buildFailedTrace(
  data: TimeSeriesResponse,
  aggregationSeconds: number
): Record<string, unknown> {
  return {
    x: data.transaction_data.map(d => new Date(d.time_bucket)),
    y: data.transaction_data.map(d => d.failed_count / aggregationSeconds),
    name: 'Failed (tx/s)',
    type: 'scatter',
    mode: 'lines',
    line: {
      width: 2,
      color: 'rgb(244, 67, 54)', // Red
    },
    hovertemplate:
      '<b>Failed</b><br>' +
      '<span style="font-size: 13px; font-weight: 600;">%{y:.2f} tx/s</span><br>' +
      '<extra></extra>',
    yaxis: 'y2',
  };
}

export function buildSamplerTraces(
  data: TimeSeriesResponse,
  selectedMetric: MetricType
): unknown[] {
  const traces: unknown[] = [];
  let colorIndex = 0;

  // Re-grid the sampler series onto the full bucket grid before plotting.
  //
  // The API sends only the buckets a sampler actually has data in — padding
  // every sampler across the whole grid server-side made a 3 h / 19-sampler
  // response 11.8 MB for 560 rows of data. But the padding is not decorative
  // here: Plotly's `stackgaps: 'infer zero'` only fills a bucket that some
  // OTHER trace in the stackgroup has. A bucket where EVERY sampler was silent
  // is absent from the group's x-union entirely, so the filled band
  // interpolates straight across an idle window instead of dropping to zero —
  // a real outage would render as a solid coloured band. `transaction_data` is
  // still sent padded, so it is the grid, and rebuilding here costs nothing on
  // the wire.
  const grid = data.transaction_data.map(d => d.time_bucket);
  const gridX = grid.map(t => new Date(t));

  Object.entries(data.sampler_data).forEach(([samplerName, samplerData]) => {
    const colors = SAMPLER_COLORS[colorIndex % SAMPLER_COLORS.length];
    colorIndex++;

    // Defensive: with no grid (a run with no usable end_time returns both
    // arrays empty) fall back to the sampler's own buckets.
    const byBucket = new Map(samplerData.map(d => [d.time_bucket, d[selectedMetric]]));
    const x = grid.length > 0 ? gridX : samplerData.map(d => new Date(d.time_bucket));
    const y =
      grid.length > 0
        ? grid.map(t => (byBucket.has(t) ? byBucket.get(t)! : null))
        : samplerData.map(d => d[selectedMetric]);

    traces.push({
      x,
      y,
      name: samplerName,
      type: 'scatter',
      mode: 'lines',
      fill: 'tonexty',
      stackgroup: 'one',
      line: {
        width: 1,
        color: colors.border,
      },
      fillcolor: colors.fill,
      hovertemplate:
        `<b>${samplerName}</b><br>` +
        '<span style="font-size: 13px; font-weight: 500;">%{y:.2f} ms</span><br>' +
        '<span style="font-size: 11px; color: #666;">%{x|%H:%M:%S}</span><br>' +
        '<extra></extra>',
      yaxis: 'y',
    });
  });

  return traces;
}

export function generatePlotlyData(
  data: TimeSeriesResponse | null,
  transactionName: string,
  selectedMetric: MetricType,
  aggregationSeconds: number
): unknown[] {
  if (!data) return [];

  const traces: unknown[] = [];

  // Transaction-level traces
  if (data.transaction_data && data.transaction_data.length > 0) {
    traces.push(buildTransactionTrace(data, transactionName, selectedMetric));
    traces.push(buildPassedTrace(data, aggregationSeconds));
    traces.push(buildFailedTrace(data, aggregationSeconds));
  }

  // Sampler-level traces (stacked area chart)
  if (data.sampler_data && Object.keys(data.sampler_data).length > 0) {
    traces.push(...buildSamplerTraces(data, selectedMetric));
  }

  return traces;
}
