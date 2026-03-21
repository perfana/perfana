/**
 * MetricsPipeline Integration Test with Real Grafana Mock Data
 *
 * This test uses authentic Grafana responses captured from production
 * to validate the complete MetricsPipeline functionality.
 */

import { Pool } from 'pg';
import { MetricsPipeline } from '../../pipelines/MetricsPipeline.js';
import { loadConfig } from '../../config/environment.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';

// Mock the GrafanaClient to return our captured data
vi.mock('../../lib/grafana/client.js', () => {
  return {
    GrafanaClient: vi.fn().mockImplementation(() => {
      return {
        queryPanelData: vi.fn()
      };
    })
  };
});

// TODO: Grafana mock data test - requires mock data setup
describe.skip('MetricsPipeline with Real Grafana Mock Data', () => {
  let db: Pool;
  let pipeline: MetricsPipeline;
  let influxdbMockData: any;
  let prometheusMockData: any;

  beforeAll(async () => {
    await loadConfig();

    // Load our mock data
    const fixturesDir = join(process.cwd(), 'src/test/fixtures/real-world');

    influxdbMockData = JSON.parse(
      readFileSync(join(fixturesDir, 'influxdb-mock-data.json'), 'utf-8')
    );

    prometheusMockData = JSON.parse(
      readFileSync(join(fixturesDir, 'prometheus-mock-data.json'), 'utf-8')
    );

    console.log('📊 Loaded mock data:');
    console.log(`  InfluxDB: ${Object.keys(influxdbMockData.results).length} queries`);
    console.log(`  Prometheus: ${Object.keys(prometheusMockData.results).length} queries`);
  });

  beforeEach(async () => {
    // Create test database connection
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5
    });

    pipeline = new MetricsPipeline(db, console);
  });

  afterEach(async () => {
    if (db) {
      await db.end();
    }
  });

  describe('InfluxDB Data Processing', () => {
    test('should process InfluxDB Grafana responses correctly', async () => {
      // Setup mock GrafanaClient to return InfluxDB data
      const { GrafanaClient } = await vi.importMock('../../lib/grafana/client.js') as any;
      const mockInstance = new GrafanaClient();

      // Convert mock data to MetricsPipeline format
      const mockPanelMetrics = Object.values(influxdbMockData.results)
        .filter((result: any) => !result.error && result.grafana_response)
        .map((result: any) => createMockPanelMetricsDocument(result, 'influxdb'));

      mockInstance.queryPanelData.mockResolvedValue(mockPanelMetrics);

      // Mock the pipeline's grafanaClient
      (pipeline as any).grafanaClient = mockInstance;

      // Create test panels for InfluxDB (Gatling dashboard)
      const testPanels = [
        {
          test_run_id: 'MyAfterburner-acc-loadTest-00002',
          application_dashboard_id: 'test-app-dashboard-1',
          dashboard_uid: 'gatling-overview-influxdb',
          panel_id: 3,
          panel_title: 'Active users',
          dashboard_label: 'Gatling AfterburnerBasicSimulation',
          benchmark_ids: null,
          errors: null,
          requests: [{ request_body: { queries: [{ refId: 'A' }] } }]
        }
      ];

      // Execute pipeline
      const result = await (pipeline as any).getPanelMetrics({
        start_time: new Date('2025-09-18T07:18:23.359Z'),
        end_time: new Date('2025-09-18T07:24:31.916Z')
      }, testPanels);

      // Assertions
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(mockInstance.queryPanelData).toHaveBeenCalledWith(testPanels);

      // Verify data structure
      const firstResult = result[0];
      expect(firstResult).toHaveProperty('test_run_id');
      expect(firstResult).toHaveProperty('data');
      expect(firstResult.data).toBeInstanceOf(Array);

      console.log('✅ InfluxDB data processing test passed');
      console.log(`📊 Processed ${result.length} panel metrics`);
    });

    test('should handle InfluxDB time-series data correctly', async () => {
      // Get a specific InfluxDB response with time-series data
      const sampleResult = Object.values(influxdbMockData.results)
        .find((result: any) =>
          !result.error &&
          result.grafana_response?.results?.A?.frames?.[0]?.data?.values
        ) as any;

      expect(sampleResult).toBeDefined();

      const frameData = sampleResult.grafana_response.results.A.frames[0].data;
      expect(frameData.values).toBeDefined();
      expect(frameData.values.length).toBe(2); // Time and value arrays
      expect(frameData.values[0].length).toBeGreaterThan(0); // Should have time points
      expect(frameData.values[1].length).toBeGreaterThan(0); // Should have value points

      console.log('✅ InfluxDB time-series structure validated');
      console.log(`📊 Found ${frameData.values[0].length} data points`);
    });
  });

  describe('Prometheus Data Processing', () => {
    test('should process Prometheus Grafana responses correctly', async () => {
      // Setup mock GrafanaClient to return Prometheus data
      const { GrafanaClient } = await vi.importMock('../../lib/grafana/client.js') as any;
      const mockInstance = new GrafanaClient();

      // Convert mock data to MetricsPipeline format
      const mockPanelMetrics = Object.values(prometheusMockData.results)
        .filter((result: any) => !result.error && result.grafana_response)
        .map((result: any) => createMockPanelMetricsDocument(result, 'prometheus'));

      mockInstance.queryPanelData.mockResolvedValue(mockPanelMetrics);

      // Mock the pipeline's grafanaClient
      (pipeline as any).grafanaClient = mockInstance;

      // Create test panels for Prometheus (JVM dashboard)
      const testPanels = [
        {
          test_run_id: 'MyAfterburner-acc-loadTest-00002',
          application_dashboard_id: 'test-app-dashboard-2',
          dashboard_uid: 'spring-boot-kubernetes-jvm-mimir',
          panel_id: 32,
          panel_title: 'Threads',
          dashboard_label: 'JVM afterburner-be',
          benchmark_ids: null,
          errors: null,
          requests: [{ request_body: { queries: [{ refId: 'A' }] } }]
        }
      ];

      // Execute pipeline
      const result = await (pipeline as any).getPanelMetrics({
        start_time: new Date('2025-09-18T07:18:23.359Z'),
        end_time: new Date('2025-09-18T07:24:31.916Z')
      }, testPanels);

      // Assertions
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(mockInstance.queryPanelData).toHaveBeenCalledWith(testPanels);

      console.log('✅ Prometheus data processing test passed');
      console.log(`📊 Processed ${result.length} panel metrics`);
    });

    test('should validate Prometheus query structure', async () => {
      // Check that Prometheus queries have the correct structure
      const sampleResult = Object.values(prometheusMockData.results)
        .find((result: any) =>
          !result.error &&
          result.substituted_request?.queries?.[0]?.expr
        ) as any;

      expect(sampleResult).toBeDefined();

      const query = sampleResult.substituted_request.queries[0];
      expect(query.expr).toBeDefined();
      expect(query.datasource.type).toBe('prometheus');
      expect(query.format).toBe('time_series');

      // Verify variable substitution worked
      expect(query.expr).toContain('MyAfterburner');
      expect(query.expr).toContain('acc');
      expect(query.expr).toContain('afterburner-');

      console.log('✅ Prometheus query structure validated');
      console.log(`🔍 Sample query: ${query.expr}`);
    });
  });

  describe('Mixed Datasource Processing', () => {
    test('should handle both InfluxDB and Prometheus data in same test run', async () => {
      const { GrafanaClient } = await vi.importMock('../../lib/grafana/client.js') as any;
      const mockInstance = new GrafanaClient();

      // Combine both datasource results
      const combinedMockData = [
        ...Object.values(influxdbMockData.results)
          .filter((result: any) => !result.error)
          .slice(0, 2)
          .map((result: any) => createMockPanelMetricsDocument(result, 'influxdb')),
        ...Object.values(prometheusMockData.results)
          .filter((result: any) => !result.error)
          .slice(0, 2)
          .map((result: any) => createMockPanelMetricsDocument(result, 'prometheus'))
      ];

      mockInstance.queryPanelData.mockResolvedValue(combinedMockData);
      (pipeline as any).grafanaClient = mockInstance;

      // Mixed panels from both dashboards
      const mixedPanels = [
        {
          test_run_id: 'MyAfterburner-acc-loadTest-00002',
          application_dashboard_id: 'test-app-dashboard-1',
          dashboard_uid: 'gatling-overview-influxdb',
          panel_id: 3,
          panel_title: 'Active users',
          dashboard_label: 'Gatling AfterburnerBasicSimulation',
          benchmark_ids: null,
          errors: null,
          requests: [{ request_body: { queries: [{ refId: 'A' }] } }]
        },
        {
          test_run_id: 'MyAfterburner-acc-loadTest-00002',
          application_dashboard_id: 'test-app-dashboard-2',
          dashboard_uid: 'spring-boot-kubernetes-jvm-mimir',
          panel_id: 32,
          panel_title: 'Threads',
          dashboard_label: 'JVM afterburner-be',
          benchmark_ids: null,
          errors: null,
          requests: [{ request_body: { queries: [{ refId: 'A' }] } }]
        }
      ];

      const result = await (pipeline as any).getPanelMetrics({
        start_time: new Date('2025-09-18T07:18:23.359Z'),
        end_time: new Date('2025-09-18T07:24:31.916Z')
      }, mixedPanels);

      expect(result.length).toBe(combinedMockData.length);

      console.log('✅ Mixed datasource processing test passed');
      console.log(`📊 Processed ${result.length} mixed panel metrics`);
    });
  });

  describe('Error Handling', () => {
    test('should handle failed Grafana queries correctly', async () => {
      // Find error cases in our mock data
      const errorResults = Object.values(prometheusMockData.results)
        .filter((result: any) => result.error) as any[];

      expect(errorResults.length).toBeGreaterThan(0);

      const errorResult = errorResults[0];
      expect(errorResult.error).toBeDefined();
      expect(errorResult.error_status).toBe(400);

      console.log('✅ Error handling structure validated');
      console.log(`❌ Found ${errorResults.length} error cases in mock data`);
    });
  });
});

/**
 * Helper function to convert mock data to PanelMetricsDocument format
 */
function createMockPanelMetricsDocument(mockResult: any, datasourceType: string): any {
  const panelInfo = mockResult.panel_info;
  const grafanaResponse = mockResult.grafana_response;

  // Convert Grafana response to metrics data format
  const data: any[] = [];

  if (grafanaResponse?.results) {
    Object.entries(grafanaResponse.results).forEach(([refId, result]: [string, any]) => {
      if (result.frames && result.frames.length > 0) {
        const frame = result.frames[0];
        if (frame.data?.values && frame.data.values.length >= 2) {
          const times = frame.data.values[0]; // First array is timestamps
          const values = frame.data.values[1]; // Second array is values

          for (let i = 0; i < times.length && i < values.length; i++) {
            data.push({
              metric_name: panelInfo.panel_title,
              time: new Date(times[i]),
              timestep: i,
              ramp_up: false,
              value: values[i]
            });
          }
        }
      }
    });
  }

  return {
    test_run_id: panelInfo.test_run_id || 'MyAfterburner-acc-loadTest-00002',
    application_dashboard_id: panelInfo.application_dashboard_id || 'test-app-dashboard',
    dashboard_uid: panelInfo.dashboard_uid,
    panel_id: panelInfo.panel_id,
    panel_title: panelInfo.panel_title,
    dashboard_label: panelInfo.dashboard_label,
    benchmark_ids: panelInfo.benchmark_ids || null,
    errors: mockResult.error ? [{
      target_index: 0,
      message: mockResult.error,
      type: 'mock_error',
      status_code: mockResult.error_status
    }] : null,
    data: data,
    updated_at: new Date()
  };
}