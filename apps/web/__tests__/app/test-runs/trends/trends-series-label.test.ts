import { trendsSeriesLabel } from '@/app/test-runs/[id]/components/trends/utils/trends-utils';
import type { TrendsSeries } from '@/app/test-runs/[id]/components/trends/types';

const series = (id: string, metricName: string, panelTitle: string, dashboardLabel = 'Perf'): TrendsSeries => ({
  id, metricName, panelTitle, dashboardId: dashboardLabel, dashboardLabel, panelId: 1, source: 'grafana',
});

describe('trendsSeriesLabel', () => {
  it('uses the bare metric name when no other added series shares it', () => {
    const all = [series('a', 'cpu', 'CPU'), series('b', 'heap', 'Memory')];
    expect(trendsSeriesLabel(all[0]!, all)).toBe('cpu');
  });

  it('appends the panel title when another added series has the same metric name', () => {
    // Every panel of the all-aggregated dashboard carries a series named "All aggregated"
    const all = [
      series('a', 'All aggregated', 'Transaction RT Avg'),
      series('b', 'All aggregated', 'Transaction Error Rate'),
      series('c', 'heap', 'Memory'),
    ];
    expect(trendsSeriesLabel(all[0]!, all)).toBe('All aggregated — Transaction RT Avg');
    expect(trendsSeriesLabel(all[1]!, all)).toBe('All aggregated — Transaction Error Rate');
    expect(trendsSeriesLabel(all[2]!, all)).toBe('heap');
  });

  it('adds the dashboard when the clashing series sits on a same-titled panel of another dashboard', () => {
    // Two hosts, same dashboard template: metric and panel title both repeat
    const all = [series('a', 'cpu', 'CPU', 'host-1'), series('b', 'cpu', 'CPU', 'host-2')];
    expect(trendsSeriesLabel(all[0]!, all)).toBe('cpu — host-1 / CPU');
    expect(trendsSeriesLabel(all[1]!, all)).toBe('cpu — host-2 / CPU');
  });

  it('does not count the series itself as a clash', () => {
    const only = series('a', 'All aggregated', 'Transaction RT Avg');
    expect(trendsSeriesLabel(only, [only])).toBe('All aggregated');
  });
});
