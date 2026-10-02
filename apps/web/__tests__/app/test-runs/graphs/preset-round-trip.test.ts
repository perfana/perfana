/**
 * What survives a saved graph preset.
 *
 * `colorSlot` and `hidden` are the two fields the chart standard added to the persisted
 * shape, and they cross four sites: out through `convertToSeriesConfigDto`, back in
 * through `convertFromAPISeriesConfig`, and the Trends equivalent in `useTrendsPresets`.
 * Dropping either at either end fails SILENTLY — `GraphsChart` falls back to
 * `seriesConfig.indexOf(series)` so every line recolours on load, and a hidden series
 * comes back visible. No error, no toast, and nothing a type-check would catch, because
 * both fields are optional by design.
 *
 * The legacy case is the other half: a preset saved before the standard has neither key,
 * and `colorSlot` must stay `undefined` rather than becoming `0` — slot 0 is a real slot,
 * so a coerced default would silently repaint the first series and collide with it.
 */
import {
  convertToSeriesConfigDto,
  convertFromAPISeriesConfig,
} from '@/app/test-runs/[id]/components/graphs/utils/graph-formatters';
import type { SeriesConfig } from '@/app/test-runs/[id]/components/graphs/types';
import type { SeriesConfig as APISeriesConfig } from '@/lib/graph-presets';

const series = (over: Partial<SeriesConfig> = {}): SeriesConfig => ({
  id: 'local-id',
  dashboardId: 'dash-1',
  dashboardLabel: 'JVM',
  panelId: 7,
  panelTitle: 'Heap',
  metricName: 'used',
  source: 'grafana',
  yAxisFormat: 'bytes',
  ...over,
} as SeriesConfig);

describe('a graph preset round trip', () => {
  it('carries the colour slot and the hidden flag out and back', () => {
    const back = convertFromAPISeriesConfig(
      convertToSeriesConfigDto(series({ colorSlot: 3, hidden: true })),
    );
    expect(back).toMatchObject({ colorSlot: 3, hidden: true });
  });

  it('keeps slot 0 and hidden:false, which are values and not absences', () => {
    const dto = convertToSeriesConfigDto(series({ colorSlot: 0, hidden: false }));
    expect(dto.colorSlot).toBe(0);
    expect(dto.hidden).toBe(false);
    expect(convertFromAPISeriesConfig(dto)).toMatchObject({ colorSlot: 0, hidden: false });
  });

  it('leaves a pre-standard preset with no slot rather than defaulting it to 0', () => {
    const legacy = {
      dashboardId: 'dash-1',
      panelId: 7,
      panelTitle: 'Heap',
      metricName: 'used',
    } as APISeriesConfig;
    const back = convertFromAPISeriesConfig(legacy);
    expect(back.colorSlot).toBeUndefined();
    expect(back.hidden).toBeUndefined();
  });

  it('still carries the fields the preset always had', () => {
    const dto = convertToSeriesConfigDto(series());
    expect(dto).toMatchObject({
      dashboardId: 'dash-1',
      dashboardLabel: 'JVM',
      panelId: 7,
      panelTitle: 'Heap',
      metricName: 'used',
      source: 'grafana',
      yAxisFormat: 'bytes',
    });
    // The local id is regenerated on load, never persisted — two cards must not share one.
    expect('id' in dto).toBe(false);
  });
});
