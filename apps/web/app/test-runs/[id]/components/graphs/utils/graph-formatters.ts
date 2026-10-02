import { SeriesConfig } from '../types';
import { composeSeriesName } from '@/lib/series-name';
import { SeriesConfig as APISeriesConfig } from '@/lib/graph-presets';

export { extractYAxisFormat } from '../../shared/metric-options';

/**
 * The chart's name, and — because `GraphsCard` passes it to the save dialog as
 * `defaultName` — the suggested preset name with it.
 *
 * `composeSeriesName` is shared with the Compare card so the two name a selection the
 * same way. It replaces a first-two-then-"(+N more)" rule that named a chart after
 * whichever two series happened to be added first and said nothing about where they came
 * from.
 */
export function generateChartName(seriesList: SeriesConfig[]): string {
  return composeSeriesName(seriesList);
}

/**
 * Convert internal SeriesConfig to DTO format (camelCase for API)
 */
export function convertToSeriesConfigDto(series: SeriesConfig): APISeriesConfig {
  return {
    dashboardId: series.dashboardId,
    panelId: series.panelId,
    panelTitle: series.panelTitle,
    metricName: series.metricName,
    source: series.source,
    dashboardLabel: series.dashboardLabel,
    yAxisFormat: series.yAxisFormat,
    colorSlot: series.colorSlot,
    hidden: series.hidden
  };
}

/**
 * Convert API SeriesConfig to internal format
 * Note: API now returns camelCase fields directly
 */
export function convertFromAPISeriesConfig(apiSeries: APISeriesConfig): SeriesConfig {
  return {
    id: `${apiSeries.dashboardId}-${apiSeries.panelId}-${apiSeries.metricName}-${Date.now()}-${Math.random()}`,
    dashboardId: apiSeries.dashboardId,
    dashboardLabel: apiSeries.dashboardLabel || '',
    panelId: apiSeries.panelId,
    panelTitle: apiSeries.panelTitle,
    metricName: apiSeries.metricName || '',
    source: apiSeries.source || 'grafana',
    yAxisFormat: apiSeries.yAxisFormat,
    // `panelYAxisFormat` is deliberately NOT set here: the panel's own unit is not stored,
    // a preset records only the unit the user chose. With nothing to compare against, a
    // loaded series shows no override dot until the panel is re-picked, which is better
    // than claiming an override that may not exist.
    colorSlot: apiSeries.colorSlot,
    hidden: apiSeries.hidden
  };
}
