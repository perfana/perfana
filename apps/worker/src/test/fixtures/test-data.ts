/**
 * Test Data Fixtures
 *
 * Provides realistic test data for use in unit and integration tests
 */

import { TestRun, PanelDocument, MetricsRecord } from '../../types/pipeline.js';

/**
 * Sample test run data
 */
export const testRunFixtures = {
  basic: (): TestRun => ({
    test_run_id: 'test-run-001',
    system_under_test_id: 'ecommerce-api',
    workload: 'load-test',
    test_environment: 'staging',
    start_time: new Date('2024-01-01T10:00:00Z'),
    end_time: new Date('2024-01-01T11:00:00Z')
  }),

  longRunning: (): TestRun => ({
    test_run_id: 'test-run-002',
    system_under_test_id: 'payment-service',
    workload: 'stress-test',
    test_environment: 'production',
    start_time: new Date('2024-01-01T08:00:00Z'),
    end_time: new Date('2024-01-01T16:00:00Z')
  }),

  microservice: (): TestRun => ({
    test_run_id: 'test-run-003',
    system_under_test_id: 'user-service',
    workload: 'spike-test',
    test_environment: 'staging',
    start_time: new Date('2024-01-01T14:00:00Z'),
    end_time: new Date('2024-01-01T14:30:00Z')
  })
};

/**
 * Sample application dashboard data
 */
export const applicationDashboardFixtures = {
  ecommerce: () => ({
    id: 'app-dash-ecommerce',
    name: 'E-commerce API Dashboard',
    system_under_test_id: 'ecommerce-api',
    test_environment: 'staging',
    workload: 'load-test'
  }),

  payment: () => ({
    id: 'app-dash-payment',
    name: 'Payment Service Dashboard',
    system_under_test_id: 'payment-service',
    test_environment: 'production',
    workload: null
  }),

  userService: () => ({
    id: 'app-dash-user',
    name: 'User Service Metrics',
    system_under_test_id: 'user-service',
    test_environment: 'staging',
    workload: 'spike-test'
  })
};

/**
 * Sample Grafana dashboard data with realistic panel configurations
 */
export const grafanaDashboardFixtures = {
  performanceOverview: () => ({
    id: 'grafana-perf-001',
    uid: 'perf-overview-abc123',
    title: 'Performance Overview',
    application_dashboard_id: 'app-dash-ecommerce',
    dashboard: {
      id: 1,
      uid: 'perf-overview-abc123',
      title: 'Performance Overview',
      tags: ['performance', 'api'],
      timezone: 'UTC',
      panels: [
        {
          id: 1,
          title: 'Response Time (95th percentile)',
          type: 'stat',
          gridPos: { h: 8, w: 12, x: 0, y: 0 },
          datasource: { type: 'prometheus', uid: 'prometheus-main' },
          targets: [
            {
              refId: 'A',
              expr: 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="ecommerce-api"}[5m]))',
              legendFormat: 'P95 Response Time',
              interval: '30s'
            }
          ],
          fieldConfig: {
            defaults: {
              unit: 'seconds',
              thresholds: {
                steps: [
                  { color: 'green', value: null },
                  { color: 'yellow', value: 0.5 },
                  { color: 'red', value: 1.0 }
                ]
              }
            }
          }
        },
        {
          id: 2,
          title: 'Request Rate',
          type: 'graph',
          gridPos: { h: 8, w: 12, x: 12, y: 0 },
          datasource: { type: 'prometheus', uid: 'prometheus-main' },
          targets: [
            {
              refId: 'A',
              expr: 'rate(http_requests_total{job="ecommerce-api"}[5m])',
              legendFormat: '{{method}} {{route}}',
              interval: '30s'
            }
          ]
        },
        {
          id: 3,
          title: 'Error Rate',
          type: 'singlestat',
          gridPos: { h: 8, w: 6, x: 0, y: 8 },
          datasource: { type: 'prometheus', uid: 'prometheus-main' },
          targets: [
            {
              refId: 'A',
              expr: 'rate(http_requests_total{job="ecommerce-api",status=~"5.."}[5m]) / rate(http_requests_total{job="ecommerce-api"}[5m]) * 100',
              legendFormat: 'Error Rate %'
            }
          ]
        }
      ],
      templating: {
        list: [
          {
            name: 'instance',
            type: 'query',
            query: 'label_values(http_requests_total{job="ecommerce-api"}, instance)',
            refresh: 'on_time_range_changed'
          },
          {
            name: 'environment',
            type: 'custom',
            options: ['staging', 'production'],
            current: { value: 'staging' }
          }
        ]
      },
      time: {
        from: 'now-1h',
        to: 'now'
      },
      refresh: '30s'
    }
  }),

  systemMetrics: () => ({
    id: 'grafana-sys-001',
    uid: 'system-metrics-def456',
    title: 'System Metrics',
    application_dashboard_id: 'app-dash-payment',
    dashboard: {
      id: 2,
      uid: 'system-metrics-def456',
      title: 'System Metrics',
      panels: [
        {
          id: 1,
          title: 'CPU Usage',
          type: 'graph',
          datasource: { type: 'prometheus', uid: 'prometheus-main' },
          targets: [
            {
              refId: 'A',
              expr: 'rate(cpu_usage_seconds_total[5m]) * 100',
              legendFormat: 'CPU %'
            }
          ]
        },
        {
          id: 2,
          title: 'Memory Usage',
          type: 'graph',
          datasource: { type: 'prometheus', uid: 'prometheus-main' },
          targets: [
            {
              refId: 'A',
              expr: 'memory_usage_bytes / memory_total_bytes * 100',
              legendFormat: 'Memory %'
            }
          ]
        }
      ]
    }
  })
};

/**
 * Sample benchmark data
 */
export const benchmarkFixtures = {
  performanceBaseline: () => ({
    id: 'benchmark-perf-001',
    name: 'E-commerce Performance Baseline',
    system_under_test_id: 'ecommerce-api',
    test_environment: 'staging',
    workload: 'load-test',
    requirements: {
      response_time_p95: 500, // milliseconds
      response_time_p99: 1000,
      throughput_min: 100, // requests per second
      error_rate_max: 0.1 // 0.1%
    }
  }),

  scalabilityTarget: () => ({
    id: 'benchmark-scale-001',
    name: 'Scalability Target',
    system_under_test_id: 'payment-service',
    test_environment: 'production',
    workload: null,
    requirements: {
      concurrent_users_max: 10000,
      response_time_p95: 200,
      memory_usage_max: 80 // percentage
    }
  })
};

/**
 * Sample panel document data
 */
export const panelDocumentFixtures = {
  responseTimePanel: (): PanelDocument => ({
    test_run_id: 'test-run-001',
    application_dashboard_id: 'app-dash-ecommerce',
    dashboard_uid: 'perf-overview-abc123',
    panel_id: 1,
    panel_title: 'Response Time (95th percentile)',
    dashboard_label: 'Performance Overview',
    benchmark_ids: ['benchmark-perf-001'],
    panel: {
      id: 1,
      title: 'Response Time (95th percentile)',
      type: 'stat',
      targets: [
        {
          refId: 'A',
          expr: 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="ecommerce-api"}[5m]))'
        }
      ]
    },
    query_variables: {
      instance: 'app-001',
      environment: 'staging'
    },
    datasource_type: 'prometheus',
    requests: [],
    errors: null,
    warnings: null
  }),

  requestRatePanel: (): PanelDocument => ({
    test_run_id: 'test-run-001',
    application_dashboard_id: 'app-dash-ecommerce',
    dashboard_uid: 'perf-overview-abc123',
    panel_id: 2,
    panel_title: 'Request Rate',
    dashboard_label: 'Performance Overview',
    benchmark_ids: ['benchmark-perf-001'],
    panel: {
      id: 2,
      title: 'Request Rate',
      type: 'graph',
      targets: [
        {
          refId: 'A',
          expr: 'rate(http_requests_total{job="ecommerce-api"}[5m])'
        }
      ]
    },
    query_variables: {
      instance: 'app-001',
      environment: 'staging'
    },
    datasource_type: 'prometheus',
    requests: [],
    errors: null,
    warnings: null
  })
};

/**
 * Sample metrics data
 */
export const metricsDataFixtures = {
  responseTimeMetrics: (): MetricsRecord[] => {
    const baseTime = new Date('2024-01-01T10:00:00Z').getTime();
    const metrics: MetricsRecord[] = [];

    // Generate 60 data points (1 per minute for 1 hour)
    for (let i = 0; i < 60; i++) {
      const timestamp = new Date(baseTime + i * 60000); // 1 minute intervals
      const baseValue = 0.120; // 120ms base response time
      const variation = Math.random() * 0.040 - 0.020; // ±20ms variation
      const value = Math.max(0.050, baseValue + variation); // Minimum 50ms

      metrics.push({
        metric_name: 'http_request_duration_seconds_p95',
        time: timestamp,
        timestep: i * 60, // seconds since start
        ramp_up: i < 5, // First 5 minutes are ramp-up
        value: Number(value.toFixed(3))
      });
    }

    return metrics;
  },

  requestRateMetrics: (): MetricsRecord[] => {
    const baseTime = new Date('2024-01-01T10:00:00Z').getTime();
    const metrics: MetricsRecord[] = [];

    for (let i = 0; i < 60; i++) {
      const timestamp = new Date(baseTime + i * 60000);
      const baseRate = 150; // 150 requests per second
      const variation = Math.random() * 40 - 20; // ±20 rps variation
      const value = Math.max(10, baseRate + variation); // Minimum 10 rps

      metrics.push({
        metric_name: 'http_requests_per_second',
        time: timestamp,
        timestep: i * 60,
        ramp_up: i < 5,
        value: Number(value.toFixed(2))
      });
    }

    return metrics;
  },

  errorRateMetrics: (): MetricsRecord[] => {
    const baseTime = new Date('2024-01-01T10:00:00Z').getTime();
    const metrics: MetricsRecord[] = [];

    for (let i = 0; i < 60; i++) {
      const timestamp = new Date(baseTime + i * 60000);
      const baseErrorRate = 0.05; // 0.05% base error rate
      const variation = Math.random() * 0.02 - 0.01; // ±0.01% variation
      const value = Math.max(0, baseErrorRate + variation);

      metrics.push({
        metric_name: 'http_error_rate_percent',
        time: timestamp,
        timestep: i * 60,
        ramp_up: i < 5,
        value: Number(value.toFixed(4))
      });
    }

    return metrics;
  }
};

/**
 * Complete test scenario combining all fixtures
 */
export function createCompleteTestScenario() {
  const testRun = testRunFixtures.basic();
  const appDashboard = applicationDashboardFixtures.ecommerce();
  const grafanaDashboard = grafanaDashboardFixtures.performanceOverview();
  const benchmark = benchmarkFixtures.performanceBaseline();
  const panelDocs = [
    panelDocumentFixtures.responseTimePanel(),
    panelDocumentFixtures.requestRatePanel()
  ];

  return {
    testRun,
    appDashboard,
    grafanaDashboard,
    benchmark,
    panelDocs,
    metrics: {
      responseTime: metricsDataFixtures.responseTimeMetrics(),
      requestRate: metricsDataFixtures.requestRateMetrics(),
      errorRate: metricsDataFixtures.errorRateMetrics()
    }
  };
}