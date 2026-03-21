import { SeriesConfig } from '../types';
import { SeriesConfig as APISeriesConfig } from '@/lib/graph-presets';

/**
 * Known Grafana unit mappings for performance-test-metrics panels.
 * These synthetic panels don't have Grafana panel JSON with unit metadata,
 * so we map panel IDs to their known units for proper Y-axis formatting.
 */
export const PERFORMANCE_METRICS_PANEL_UNITS: Record<number, string> = {
  // Transaction-level (v2 architecture)
  101: 'ms',       // TXN_RT_AVG
  102: 'ms',       // TXN_RT_P90
  103: 'ms',       // TXN_RT_P95
  104: 'ms',       // TXN_RT_P99
  105: 'percent',  // TXN_ERROR_RATE
  106: 'short',    // TXN_APDEX (0-1 score)
  107: 'reqps',    // TXN_THROUGHPUT

  // Request-level (v2 architecture)
  201: 'ms',       // REQ_RT_AVG
  202: 'ms',       // REQ_RT_P90
  203: 'ms',       // REQ_RT_P95
  204: 'ms',       // REQ_RT_P99
  205: 'percent',  // REQ_ERROR_RATE
  206: 'reqps',    // REQ_THROUGHPUT
  207: 'short',    // REQ_APDEX
  208: 'ms',       // REQ_LATENCY
  209: 'ms',       // REQ_CONNECT_TIME

  // Scenario-level (v2 architecture)
  301: 'short',    // SCENARIO_ERROR_COUNT
  302: 'short',    // SCENARIO_AVG_THREADS
  303: 'short',    // SCENARIO_MAX_THREADS

  // Legacy panel IDs (v1 architecture)
  1: 'ms',         // RESPONSE_TIME
  7: 'ms',         // RESPONSE_LATENCY
  8: 'ms',         // RESPONSE_CONNECT_TIME
  9: 'percent',    // ERROR_RATE
  10: 'reqps',     // THROUGHPUT
  11: 'short',     // APDEX_SCORE_REQUESTS
  12: 'short',     // ERROR_COUNT
  13: 'ms',        // TRANSACTION_RESPONSE_TIME
  14: 'short',     // AVG_ACTIVE_THREADS
  15: 'short',     // MAX_ACTIVE_THREADS
  16: 'percent',   // TRANSACTION_ERROR_RATE
  17: 'short',     // APDEX_SCORE_TRANSACTIONS
};

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

/**
 * Extract yAxisFormat from Grafana panel structure
 */
export function extractYAxisFormat(panel: {
  type: string;
  fieldConfig?: { defaults?: { unit?: string } };
  yaxes?: Array<{ format?: string }>;
}): string | undefined {
  // For newer timeseries panels: check fieldConfig.defaults.unit
  if (panel.type === 'timeseries' && panel.fieldConfig?.defaults?.unit) {
    return panel.fieldConfig.defaults.unit;
  }
  // For older graph panels: check yaxes[0].format
  if (panel.type === 'graph' && panel.yaxes?.[0]?.format) {
    return panel.yaxes[0].format;
  }
  // For stat/singlestat panels: check fieldConfig.defaults.unit
  if ((panel.type === 'stat' || panel.type === 'singlestat') && panel.fieldConfig?.defaults?.unit) {
    return panel.fieldConfig.defaults.unit;
  }
  return undefined;
}
