/**
 * `seriesRowName` — the name a chart's series table and its exported legend both show.
 *
 * The regression this guards: the `Performance test metrics all aggregated` dashboard holds a
 * REAL series named exactly `All aggregated` on every one of its panels, and the old
 * `startsWith(ALL_AGGREGATED_OPTION)` test dropped the panel title from all of them. Adding
 * Transaction RT Avg/P90/P95/P99 off that dashboard produced four rows reading
 * "All aggregated", four identically-named traces in an exported PNG legend, and no way to
 * tell which line was the p99.
 */

import {
  ALL_AGGREGATED_OPTION,
  buildAggregatedMetricName,
  seriesRowName,
} from '@/lib/aggregated-perf-series';

describe('seriesRowName', () => {
  it('composes panel and metric for an ordinary series', () => {
    expect(seriesRowName('CPU usage', 'container_cpu')).toBe('CPU usage · container_cpu');
  });

  it('keeps the synthetic aggregate bare — its name already carries the panel', () => {
    // `buildAggregatedMetricName` is the only producer of this form.
    const name = buildAggregatedMetricName('Transaction RT');
    expect(seriesRowName('Transaction RT', name)).toBe('All aggregated — Transaction RT');
  });

  it('keeps the four real "All aggregated" series apart by panel', () => {
    const panels = ['Transaction RT Avg', 'Transaction RT P90', 'Transaction RT P95', 'Transaction RT P99'];
    const names = panels.map((panel) => seriesRowName(panel, ALL_AGGREGATED_OPTION));

    expect(names).toEqual([
      'Transaction RT Avg · All aggregated',
      'Transaction RT P90 · All aggregated',
      'Transaction RT P95 · All aggregated',
      'Transaction RT P99 · All aggregated',
    ]);
    // The property that actually matters: four panels, four distinguishable rows.
    expect(new Set(names).size).toBe(4);
  });

  it('does not treat a metric that merely starts with the words as the composed form', () => {
    // No em-dash separator, so this is a stored series name, not the synthetic one.
    expect(seriesRowName('Checkout', 'All aggregated requests')).toBe('Checkout · All aggregated requests');
  });
});
