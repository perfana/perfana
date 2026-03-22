export type SourceType = 'grafana' | 'dynatrace' | 'performance_test' | 'prometheus' | 'influxdb' | 'unknown';

/**
 * Get the source type for a dashboard. Uses source_type from the linked MetricsSource
 * when available, falls back to dashboard_uid prefix detection for backward compatibility.
 */
export function getSourceType(dashboard: {
  dashboard_uid?: string;
  metrics_source_id?: string;
  source_type?: string;
}): SourceType {
  // Prefer explicit source_type from MetricsSource
  if (dashboard.source_type) {
    return dashboard.source_type as SourceType;
  }

  // Fallback: prefix detection for legacy data without MetricsSource
  const uid = dashboard.dashboard_uid || '';
  if (uid.startsWith('dynatrace-')) return 'dynatrace';
  if (uid.startsWith('performance-test-metrics-')) return 'performance_test';
  return 'grafana';
}

export function isDynatrace(dashboard: Parameters<typeof getSourceType>[0]): boolean {
  return getSourceType(dashboard) === 'dynatrace';
}

export function isPerformanceTest(dashboard: Parameters<typeof getSourceType>[0]): boolean {
  return getSourceType(dashboard) === 'performance_test';
}

export function isGrafana(dashboard: Parameters<typeof getSourceType>[0]): boolean {
  return getSourceType(dashboard) === 'grafana';
}

export function isArtificialDashboard(dashboard: Parameters<typeof getSourceType>[0]): boolean {
  const type = getSourceType(dashboard);
  return type === 'dynatrace' || type === 'performance_test';
}

/**
 * Display metadata for each source type.
 * Brand-aligned colors for instant recognition.
 */
export const SOURCE_DISPLAY: Record<SourceType, { label: string; color: string; groupLabel: string }> = {
  grafana:          { label: 'Grafana',          color: '#FF6600', groupLabel: 'Grafana Dashboards' },
  dynatrace:        { label: 'Dynatrace',        color: '#6F2DA8', groupLabel: 'Dynatrace Metrics' },
  performance_test: { label: 'Performance Test',  color: '#1976D2', groupLabel: 'Performance Test Metrics' },
  prometheus:       { label: 'Prometheus',         color: '#E6522C', groupLabel: 'Prometheus Metrics' },
  influxdb:         { label: 'InfluxDB',           color: '#22ADF6', groupLabel: 'InfluxDB Metrics' },
  unknown:          { label: 'Unknown',            color: '#9E9E9E', groupLabel: 'Other' },
};

/**
 * Get display info for a dashboard's source type.
 */
export function getSourceDisplayInfo(dashboard: Parameters<typeof getSourceType>[0]) {
  const type = getSourceType(dashboard);
  return { ...SOURCE_DISPLAY[type], sourceType: type };
}
