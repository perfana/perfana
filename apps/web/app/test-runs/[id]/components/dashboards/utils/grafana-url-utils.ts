import { TestRun } from '@/types/test-runs';
import { Dashboard, ARTIFICIAL_DASHBOARD_UID_PREFIXES } from '../types';

/**
 * Check if a dashboard is "artificial" (synthetic entry for metrics)
 * These dashboards don't actually exist in Grafana
 */
export function isArtificialDashboard(dashboard: { dashboard_uid?: string }): boolean {
  const uid = dashboard.dashboard_uid;
  if (!uid) return false;
  return ARTIFICIAL_DASHBOARD_UID_PREFIXES.some(prefix => uid.startsWith(prefix));
}

/**
 * Create a URL slug from dashboard name
 */
export function createDashboardSlug(dashboardName: string): string {
  return dashboardName.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * Calculate end time for Grafana URL based on test run status
 */
export function calculateEndTime(testRun: TestRun): number | 'now' {
  if (testRun.completed) {
    // Test is completed, use actual end time
    return testRun.end_time ? new Date(testRun.end_time).getTime() : 'now';
  }

  // Test is not completed — use 'now' so Grafana shows live data
  return 'now';
}

/**
 * Build variables query string for Grafana URL
 */
export function buildVariablesQueryString(dashboard: Dashboard, testRun: TestRun): string {
  let variables = '';

  // Check if dashboard has configured variables
  if (dashboard.variables && Array.isArray(dashboard.variables) && dashboard.variables.length > 0) {
    dashboard.variables.forEach((variable) => {
      if (variable.name && variable.values && variable.values.length > 0) {
        // Add all values for the variable
        variable.values.forEach((value: string) => {
          variables += `&var-${variable.name}=${encodeURIComponent(value)}`;
        });
      }
    });
  } else {
    // Fallback to test run values if no dashboard variables configured
    variables = `&var-system_under_test=${testRun.systems_under_test?.name || 'unknown'}&var-test_environment=${testRun.test_environment}`;
  }

  return variables;
}

/**
 * Build the complete Grafana iframe URL for a dashboard
 */
export function buildGrafanaIframeUrl(dashboard: Dashboard, testRun: TestRun, grafanaTheme: 'light' | 'dark' = 'light'): string {
  if (!testRun || !dashboard.grafana_instance) return '';

  const grafanaUrl = dashboard.grafana_instance.client_url || 'http://localhost:3000';
  const orgId = '1'; // Default org ID, could be made configurable

  // Create slug from dashboard name
  const slug = createDashboardSlug(dashboard.dashboard_name);

  // Build time range
  const start = testRun.start_time
    ? new Date(testRun.start_time).getTime()
    : new Date().getTime() - 3600000; // Default to 1 hour ago

  const end = calculateEndTime(testRun);

  // Build variables
  const variables = buildVariablesQueryString(dashboard, testRun);

  // Build final URL following the renderGrafanaUrl pattern
  const url = `${grafanaUrl}/d/${dashboard.dashboard_uid}/${slug}?orgId=${orgId}&from=${start}&to=${end}${variables}&theme=${grafanaTheme}&kiosk`;

  return url;
}

/**
 * Build URL for opening dashboard in new tab (without kiosk mode)
 */
export function buildGrafanaNewTabUrl(dashboard: Dashboard, testRun: TestRun, grafanaTheme: 'light' | 'dark' = 'light'): string {
  const url = buildGrafanaIframeUrl(dashboard, testRun, grafanaTheme);
  return url.replace('&kiosk', '');
}
