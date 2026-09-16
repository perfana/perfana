import { getYAxisConfigs } from '@/app/test-runs/[id]/components/trends/utils/trends-utils';
import type { TrendsSeries } from '@/app/test-runs/[id]/components/trends/types';

const series = (metricName: string, yAxisFormat?: string) =>
  ({ id: metricName, metricName, yAxisFormat } as unknown as TrendsSeries);

describe('getYAxisConfigs', () => {
  it('keeps one axis when every series shares a unit', () => {
    const { left, right, rightSeriesIds } = getYAxisConfigs([
      series('a', 'percent'),
      series('b', 'percent'),
    ]);
    expect(left).toEqual({ title: 'Percent (0-100)', ticksuffix: '%' });
    expect(right).toBeNull();
    expect(rightSeriesIds.size).toBe(0);
  });

  it('moves a differing unit onto its own right axis', () => {
    const { left, right, rightSeriesIds } = getYAxisConfigs([
      series('Usage', 'percent'),
      series('200', 'reqps'),
    ]);
    expect(left.ticksuffix).toBe('%');
    expect(right).toEqual({ title: 'Requests per second', ticksuffix: ' req/s' });
    // the req/s series must not be drawn under the percent label
    expect(rightSeriesIds.has('200')).toBe(true);
    expect(rightSeriesIds.has('Usage')).toBe(false);
  });

  it('falls back to a plain Value axis when no unit is set', () => {
    const { left, right } = getYAxisConfigs([series('a'), series('b')]);
    expect(left).toEqual({ title: 'Value', ticksuffix: '' });
    expect(right).toBeNull();
  });

  it('groups every unit past the first onto the right axis', () => {
    const { rightSeriesIds } = getYAxisConfigs([
      series('a', 'percent'),
      series('b', 'reqps'),
      series('c', 'ms'),
    ]);
    expect(Array.from(rightSeriesIds).sort()).toEqual(['b', 'c']);
  });
});
