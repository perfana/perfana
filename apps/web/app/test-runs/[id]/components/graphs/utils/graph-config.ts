import { ApplicationDashboard, DataSource } from '../types';
import { DynatraceDashboard } from '@/lib/dynatrace';
import { isPerformanceTest, isGrafana } from '@/lib/metrics-source-utils';

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
