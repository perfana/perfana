import { ApplicationDashboard, DataSource } from '../types';
import { DynatraceDashboard } from '@/lib/dynatrace';
import { isDynatrace, isPerformanceTest, isGrafana } from '@/lib/metrics-source-utils';

/**
 * Filter dashboards by source type
 * - grafana: Real Grafana dashboards (no artificial prefix)
 * - dynatrace: From Dynatrace API
 * - performance-metrics: Artificial dashboards with 'performance-test-metrics-' prefix
 */
export function getFilteredDashboards(
  selectedSource: DataSource,
  dashboards: ApplicationDashboard[],
  dynatraceDashboards: DynatraceDashboard[]
): ApplicationDashboard[] {
  if (selectedSource === 'grafana') {
    // Filter out artificial dashboards
    return dashboards.filter(d => isGrafana(d));
  } else if (selectedSource === 'performance-metrics') {
    // Only performance-test-metrics dashboards
    return dashboards.filter(d => isPerformanceTest(d));
  } else {
    // Dynatrace - use dynatraceDashboards
    return dynatraceDashboards.map((d, index) => ({
      id: `dynatrace-${index}`,
      dashboard_label: d.dashboardLabel,
      dashboard_name: d.dashboardLabel,
      dashboard_uid: ''
    } as ApplicationDashboard));
  }
}

/**
 * Determine the data source based on panel type and dashboard UID
 */
export function determineSource(
  panelType: string | undefined,
  dashboardUid: string | undefined
): DataSource {
  if (panelType === 'dynatrace') return 'dynatrace';
  if (isDynatrace({ dashboard_uid: dashboardUid })) return 'dynatrace';
  if (isPerformanceTest({ dashboard_uid: dashboardUid })) return 'performance-metrics';
  return 'grafana';
}

/**
 * Compute available sources based on loaded dashboards
 */
export function computeAvailableSources(
  dashboards: ApplicationDashboard[],
  dynatraceDashboards: DynatraceDashboard[]
): DataSource[] {
  const sources: DataSource[] = [];

  // Check for real Grafana dashboards (not artificial)
  const grafanaDashboards = dashboards.filter(d => isGrafana(d));
  if (grafanaDashboards.length > 0) {
    sources.push('grafana');
  }

  // Check for Dynatrace dashboards
  if (dynatraceDashboards.length > 0) {
    sources.push('dynatrace');
  }

  // Check for performance-test-metrics dashboards
  const perfMetricsDashboards = dashboards.filter(d => isPerformanceTest(d));
  if (perfMetricsDashboards.length > 0) {
    sources.push('performance-metrics');
  }

  return sources;
}
