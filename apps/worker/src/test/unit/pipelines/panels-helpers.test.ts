/**
 * Panels Helper Functions Unit Tests
 *
 * Tests the helper functions used by the PanelsPipeline:
 * - getApplicationDashboardsForTestRun
 * - getGrafanaDashboardsForApplicationDashboards
 * - getBenchmarksForTestRun
 * - createPanelDocuments
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import {
  getApplicationDashboardsForTestRun,
  getGrafanaDashboardsForApplicationDashboards,
  getBenchmarksForTestRun,
  createPanelDocuments
} from '../../../pipelines/panels/helpers.js';
import { testRunFixtures, applicationDashboardFixtures, grafanaDashboardFixtures, benchmarkFixtures } from '../../fixtures/test-data.js';

// Mock the Grafana config module
vi.mock('../../../config/grafana-config-cache.js', () => ({
  getGrafanaConfig: vi.fn(async () => ({
    grafanaUrl: 'http://localhost:3000',
    grafanaApiKey: 'test-api-key'
  }))
}));

// Mock the GrafanaClient
vi.mock('@perfana/shared/services/grafana', () => ({
  GrafanaClient: vi.fn().mockImplementation(() => ({
    getDatasourceByUid: vi.fn().mockResolvedValue({
      id: 1,
      uid: 'prometheus-main',
      name: 'Prometheus',
      type: 'prometheus'
    })
  }))
}));

describe('Panels Helper Functions', () => {
  let mockPool: Partial<Pool>;

  beforeEach(() => {
    // Create a mock Pool that supports the query method
    mockPool = {
      query: vi.fn()
    };
  });

  describe('getApplicationDashboardsForTestRun', () => {
    test('should find matching application dashboards', async () => {
      const testRun = testRunFixtures.basic();
      const appDash1 = applicationDashboardFixtures.ecommerce();
      const appDash2 = { ...applicationDashboardFixtures.payment(), system_under_test_id: 'ecommerce-api' };

      // Mock the query response
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [appDash1, appDash2]
      });

      const results = await getApplicationDashboardsForTestRun(mockPool as Pool, testRun);

      expect(results).toHaveLength(2);
      expect(results.every(dash => dash.system_under_test_id === testRun.system_under_test_id)).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT ad.id'),
        [testRun.system_under_test_id, testRun.test_environment]
      );
    });

    test('should filter by test environment when specified', async () => {
      const testRun = testRunFixtures.basic();
      const stagingDash = applicationDashboardFixtures.ecommerce();

      // Mock the query to return only staging dashboard
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [stagingDash]
      });

      const results = await getApplicationDashboardsForTestRun(mockPool as Pool, testRun);

      expect(results).toHaveLength(1);
      expect(results[0].test_environment).toBe(testRun.test_environment);
    });

    test('should include dashboards with null environment', async () => {
      const testRun = testRunFixtures.basic();
      const nullEnvDash = { ...applicationDashboardFixtures.ecommerce(), test_environment: null };

      // Mock the query response
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [nullEnvDash]
      });

      const results = await getApplicationDashboardsForTestRun(mockPool as Pool, testRun);

      expect(results).toHaveLength(1);
    });

    test('should return empty array when no matches found', async () => {
      const testRun = testRunFixtures.basic();

      // Mock empty query response
      (mockPool.query as any).mockResolvedValueOnce({
        rows: []
      });

      const results = await getApplicationDashboardsForTestRun(mockPool as Pool, testRun);

      expect(results).toHaveLength(0);
    });
  });

  describe('getGrafanaDashboardsForApplicationDashboards', () => {
    test('should find Grafana dashboards for application dashboards', async () => {
      const appDash = {
        ...applicationDashboardFixtures.ecommerce(),
        dashboard_uid: 'perf-overview-abc123'
      };
      const grafanaDash = grafanaDashboardFixtures.performanceOverview();

      // Mock the query response
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [{
          id: grafanaDash.id,
          uid: grafanaDash.uid,
          title: grafanaDash.title,
          dashboard: grafanaDash.dashboard
        }]
      });

      const results = await getGrafanaDashboardsForApplicationDashboards(mockPool as Pool, [appDash]);

      expect(results).toHaveLength(1);
      expect(results[0].application_dashboard_id).toBe(appDash.id);
      expect(results[0].dashboard).toBeDefined();
    });

    test('should handle multiple application dashboards', async () => {
      const appDash1 = {
        ...applicationDashboardFixtures.ecommerce(),
        dashboard_uid: 'perf-overview-abc123'
      };
      const appDash2 = {
        ...applicationDashboardFixtures.payment(),
        dashboard_uid: 'system-metrics-def456'
      };
      const grafanaDash1 = grafanaDashboardFixtures.performanceOverview();
      const grafanaDash2 = grafanaDashboardFixtures.systemMetrics();

      // Mock the query response
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            id: grafanaDash1.id,
            uid: grafanaDash1.uid,
            title: grafanaDash1.title,
            dashboard: grafanaDash1.dashboard
          },
          {
            id: grafanaDash2.id,
            uid: grafanaDash2.uid,
            title: grafanaDash2.title,
            dashboard: grafanaDash2.dashboard
          }
        ]
      });

      const results = await getGrafanaDashboardsForApplicationDashboards(mockPool as Pool, [appDash1, appDash2]);

      expect(results).toHaveLength(2);
      expect(results.map(r => r.application_dashboard_id).sort()).toEqual([appDash1.id, appDash2.id].sort());
    });

    test('should return empty array for empty input', async () => {
      const results = await getGrafanaDashboardsForApplicationDashboards(mockPool as Pool, []);

      expect(results).toHaveLength(0);
    });
  });

  describe('getBenchmarksForTestRun', () => {
    test('should find matching benchmarks', async () => {
      const testRun = testRunFixtures.basic();
      const benchmark = benchmarkFixtures.performanceBaseline();

      // Mock the query response
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [benchmark]
      });

      const results = await getBenchmarksForTestRun(mockPool as Pool, testRun);

      expect(results).toHaveLength(1);
      expect(results[0].system_under_test_id).toBe(testRun.system_under_test_id);
      expect(results[0].requirements).toBeDefined();
    });

    test('should handle null environment and workload in benchmarks', async () => {
      const testRun = testRunFixtures.basic();
      const benchmark = { ...benchmarkFixtures.performanceBaseline(), test_environment: null, workload: null };

      // Mock the query response
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [benchmark]
      });

      const results = await getBenchmarksForTestRun(mockPool as Pool, testRun);

      expect(results).toHaveLength(1);
    });
  });

  describe('createPanelDocuments', () => {
    test('should create panel documents from dashboard data', async () => {
      const testRun = testRunFixtures.basic();
      const appDash = {
        ...applicationDashboardFixtures.ecommerce(),
        dashboard_uid: 'perf-overview-abc123',
        dashboard_label: 'Performance Overview'
      };
      const baseDash = grafanaDashboardFixtures.performanceOverview();
      // Wrap the dashboard in the expected structure
      const grafanaDash = {
        ...baseDash,
        dashboard: {
          dashboard: baseDash.dashboard
        }
      };
      const benchmark = benchmarkFixtures.performanceBaseline();

      const perfanaData = {
        test_run_id: testRun.test_run_id,
        test_run: testRun,
        application_dashboards: [appDash],
        benchmarks: [benchmark],
        dashboards: [grafanaDash]
      };

      const results = await createPanelDocuments(perfanaData, 'ecommerce-api');

      expect(results.length).toBeGreaterThan(0);

      const panelDoc = results[0];
      expect(panelDoc.test_run_id).toBe(testRun.test_run_id);
      expect(panelDoc.application_dashboard_id).toBe(appDash.id);
      expect(panelDoc.dashboard_uid).toBe(grafanaDash.uid);
      expect(panelDoc.panel_id).toBeTypeOf('number');
      expect(panelDoc.panel_title).toBeTypeOf('string');
      expect(panelDoc.dashboard_label).toBe(appDash.dashboard_label);
      expect(panelDoc.panel).toBeDefined();
      expect(panelDoc.updated_at).toBeInstanceOf(Date);
    });

    test('should handle dashboard without panels', async () => {
      const testRun = testRunFixtures.basic();
      const appDash = {
        ...applicationDashboardFixtures.ecommerce(),
        dashboard_uid: 'perf-overview-abc123',
        dashboard_label: 'Performance Overview'
      };
      const baseDash = grafanaDashboardFixtures.performanceOverview();
      const grafanaDash = {
        ...baseDash,
        dashboard: {
          dashboard: {
            ...baseDash.dashboard,
            panels: []
          }
        }
      };

      const perfanaData = {
        test_run_id: testRun.test_run_id,
        test_run: testRun,
        application_dashboards: [appDash],
        benchmarks: [],
        dashboards: [grafanaDash]
      };

      const results = await createPanelDocuments(perfanaData, 'ecommerce-api');

      expect(results).toHaveLength(0);
    });

    test('should handle panels without required fields', async () => {
      const testRun = testRunFixtures.basic();
      const appDash = {
        ...applicationDashboardFixtures.ecommerce(),
        dashboard_uid: 'perf-overview-abc123',
        dashboard_label: 'Performance Overview'
      };
      const baseDash = grafanaDashboardFixtures.performanceOverview();
      const grafanaDash = {
        ...baseDash,
        dashboard: {
          dashboard: {
            ...baseDash.dashboard,
            panels: [
              { id: null, title: 'Valid Panel', type: 'graph' }, // Missing id
              { id: 1, title: null, type: 'graph' }, // Missing title
              { id: 2, title: 'Valid Panel 2', type: 'graph' } // Valid panel
            ]
          }
        }
      };

      const perfanaData = {
        test_run_id: testRun.test_run_id,
        test_run: testRun,
        application_dashboards: [appDash],
        benchmarks: [],
        dashboards: [grafanaDash]
      };

      const results = await createPanelDocuments(perfanaData, 'ecommerce-api');

      // Should only include the valid panel
      expect(results).toHaveLength(1);
      expect(results[0].panel_id).toBe(2);
      expect(results[0].panel_title).toBe('Valid Panel 2');
    });

    test('should assign benchmark IDs correctly', async () => {
      const testRun = testRunFixtures.basic();
      const appDash = {
        ...applicationDashboardFixtures.ecommerce(),
        dashboard_uid: 'perf-overview-abc123',
        dashboard_label: 'Performance Overview'
      };
      const baseDash = grafanaDashboardFixtures.performanceOverview();
      const grafanaDash = {
        ...baseDash,
        dashboard: {
          dashboard: baseDash.dashboard
        }
      };
      const benchmark1 = benchmarkFixtures.performanceBaseline();
      const benchmark2 = { ...benchmarkFixtures.scalabilityTarget(), id: 'bench-2' };

      const perfanaData = {
        test_run_id: testRun.test_run_id,
        test_run: testRun,
        application_dashboards: [appDash],
        benchmarks: [benchmark1, benchmark2],
        dashboards: [grafanaDash]
      };

      const results = await createPanelDocuments(perfanaData, 'ecommerce-api');

      expect(results.length).toBeGreaterThan(0);

      const panelDoc = results[0];
      expect(panelDoc.benchmark_ids).toBeInstanceOf(Array);
      expect(panelDoc.benchmark_ids).toContain(benchmark1.id);
      expect(panelDoc.benchmark_ids).toContain(benchmark2.id);
    });

    test('should handle missing application dashboard', async () => {
      const testRun = testRunFixtures.basic();
      const ecommerceAppDash = {
        ...applicationDashboardFixtures.ecommerce(),
        dashboard_uid: 'different-uid-xyz',
        dashboard_label: 'Different Dashboard'
      };
      const baseDash = grafanaDashboardFixtures.performanceOverview();
      const grafanaDash = {
        ...baseDash,
        dashboard: {
          dashboard: baseDash.dashboard
        }
      };

      const perfanaData = {
        test_run_id: testRun.test_run_id,
        test_run: testRun,
        application_dashboards: [ecommerceAppDash], // Has different dashboard_uid
        benchmarks: [],
        dashboards: [grafanaDash]
      };

      const results = await createPanelDocuments(perfanaData, 'ecommerce-api');

      // Should skip dashboards without matching application dashboard
      expect(results).toHaveLength(0);
    });
  });
});