import { SeriesConfig } from '../types';
import { SeriesConfig as APISeriesConfig } from '@/lib/graph-presets';

export { extractYAxisFormat } from '../../shared/metric-options';

/**
 * Generate chart name based on added series
 */
export function generateChartName(seriesList: SeriesConfig[]): string {
  if (seriesList.length === 0) {
    return '';
  }

  if (seriesList.length === 1) {
    return seriesList[0].metricName || seriesList[0].panelTitle;
  }

  if (seriesList.length === 2) {
    const name1 = seriesList[0].metricName || seriesList[0].panelTitle;
    const name2 = seriesList[1].metricName || seriesList[1].panelTitle;
    return `${name1} vs ${name2}`;
  }

  // For 3+ series, use first two + indicator of more
  const name1 = seriesList[0].metricName || seriesList[0].panelTitle;
  const name2 = seriesList[1].metricName || seriesList[1].panelTitle;
  return `${name1} vs ${name2} (+${seriesList.length - 2} more)`;
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
    yAxisFormat: series.yAxisFormat
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
    yAxisFormat: apiSeries.yAxisFormat
  };
}
