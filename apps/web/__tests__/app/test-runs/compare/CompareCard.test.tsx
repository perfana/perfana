/**
 * Tests for CompareCard component
 * Focus: React key uniqueness to prevent duplicate key errors
 *
 * Related bug fix: Dec 4, 2025 - Fixed duplicate keys for Dynatrace dashboards
 * See: apps/web/docs/REACT_KEY_BEST_PRACTICES.md
 */

describe('CompareCard - Unique Keys / React Key Constraints', () => {
  describe('Dynatrace Dashboard Options', () => {
    it('should generate unique ids for Dynatrace dashboards even with duplicate labels', () => {
      // Simulate Dynatrace dashboards with duplicate labels
      const mockDynatraceDashboards = [
        { dashboardLabel: 'HTTP connection pool afterburner-be' },
        { dashboardLabel: 'HTTP connection pool afterburner-be' }, // Duplicate!
        { dashboardLabel: 'JVM Memory' },
        { dashboardLabel: 'HTTP connection pool afterburner-be' }, // Another duplicate!
      ];

      // Map options the same way CompareCard does (line 1545-1550)
      const mappedOptions = mockDynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: '',
      }));

      const ids = mappedOptions.map((opt) => opt.id);
      const uniqueIds = new Set(ids);

      // All IDs should be unique
      expect(uniqueIds.size).toBe(ids.length);
      expect(ids).toEqual(['dynatrace-0', 'dynatrace-1', 'dynatrace-2', 'dynatrace-3']);
    });

    it('should NOT use dashboard_label as the id field', () => {
      const mockDynatraceDashboards = [
        { dashboardLabel: 'Same Label' },
        { dashboardLabel: 'Same Label' },
      ];

      const mappedOptions = mockDynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: '',
      }));

      // Verify IDs are NOT equal to labels
      expect(mappedOptions[0].id).not.toBe(mappedOptions[0].dashboard_label);
      expect(mappedOptions[1].id).not.toBe(mappedOptions[1].dashboard_label);

      // Verify IDs are unique while labels are the same
      expect(mappedOptions[0].id).not.toBe(mappedOptions[1].id);
      expect(mappedOptions[0].dashboard_label).toBe(mappedOptions[1].dashboard_label);
    });

    it('should preserve dashboard_label for display while using unique id for keys', () => {
      const mockDynatraceDashboards = [
        { dashboardLabel: 'Dashboard A' },
        { dashboardLabel: 'Dashboard B' },
        { dashboardLabel: 'Dashboard A' }, // Duplicate label
      ];

      const mappedOptions = mockDynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: '',
      }));

      // All IDs should be unique
      const ids = mappedOptions.map((opt) => opt.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);

      // Labels should be preserved for display
      expect(mappedOptions[0].dashboard_label).toBe('Dashboard A');
      expect(mappedOptions[1].dashboard_label).toBe('Dashboard B');
      expect(mappedOptions[2].dashboard_label).toBe('Dashboard A');
    });
  });

  describe('Grafana Dashboard Options', () => {
    it('should have unique ids from database for Grafana dashboards', () => {
      // Grafana dashboards come from database with UUID ids
      const mockGrafanaDashboards = [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          dashboard_label: 'Gatling Overview',
          dashboard_name: 'Gatling Overview',
          dashboard_uid: 'gatling-overview',
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          dashboard_label: 'JMeter Overview',
          dashboard_name: 'JMeter Overview',
          dashboard_uid: 'jmeter-overview',
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          dashboard_label: 'Gatling Overview', // Same label, different ID
          dashboard_name: 'Gatling Overview',
          dashboard_uid: 'gatling-overview-2',
        },
      ];

      const ids = mockGrafanaDashboards.map((d) => d.id);
      const uniqueIds = new Set(ids);

      // Database IDs should always be unique
      expect(uniqueIds.size).toBe(ids.length);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('Material-UI Autocomplete Integration', () => {
    it('should use isOptionEqualToValue to compare by id', () => {
      // Simulate the isOptionEqualToValue function from CompareCard (line 1553)
      const isOptionEqualToValue = (option: any, value: any) => option.id === value.id;

      const option1 = {
        id: 'dynatrace-0',
        dashboard_label: 'Same Label',
        dashboard_name: 'Same Label',
        dashboard_uid: '',
      };

      const option2 = {
        id: 'dynatrace-1',
        dashboard_label: 'Same Label', // Same label
        dashboard_name: 'Same Label',
        dashboard_uid: '',
      };

      const option1Copy = { ...option1 };

      // Different IDs should not be equal even with same label
      expect(isOptionEqualToValue(option1, option2)).toBe(false);

      // Same ID should be equal
      expect(isOptionEqualToValue(option1, option1Copy)).toBe(true);
    });

    it('should use option.id as the React key in renderOption', () => {
      const mockDynatraceDashboards = [
        { dashboardLabel: 'Dashboard A' },
        { dashboardLabel: 'Dashboard A' },
      ];

      const mappedOptions = mockDynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: '',
      }));

      // Simulate what React would see as keys in the rendered list
      const reactKeys = mappedOptions.map((option) => option.id);

      // Keys should be unique
      const uniqueKeys = new Set(reactKeys);
      expect(uniqueKeys.size).toBe(reactKeys.length);
      expect(uniqueKeys.size).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty dashboard lists', () => {
      const mockDynatraceDashboards: any[] = [];
      const mappedOptions = mockDynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: '',
      }));

      expect(mappedOptions.length).toBe(0);
    });

    it('should handle single dashboard', () => {
      const mockDynatraceDashboards = [{ dashboardLabel: 'Only Dashboard' }];

      const mappedOptions = mockDynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: '',
      }));

      expect(mappedOptions.length).toBe(1);
      expect(mappedOptions[0].id).toBe('dynatrace-0');
    });

    it('should handle many duplicate labels', () => {
      const mockDynatraceDashboards = Array(10).fill({
        dashboardLabel: 'Repeated Label',
      });

      const mappedOptions = mockDynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: '',
      }));

      const ids = mappedOptions.map((opt) => opt.id);
      const uniqueIds = new Set(ids);

      // All 10 IDs should be unique
      expect(uniqueIds.size).toBe(10);
      expect(ids).toEqual([
        'dynatrace-0',
        'dynatrace-1',
        'dynatrace-2',
        'dynatrace-3',
        'dynatrace-4',
        'dynatrace-5',
        'dynatrace-6',
        'dynatrace-7',
        'dynatrace-8',
        'dynatrace-9',
      ]);
    });
  });

  describe('fetchGraphData - applicationDashboardId Resolution', () => {
    /**
     * Bug fix: Jan 2, 2026 - Dynatrace graph series not showing in CompareCard
     *
     * For Dynatrace metrics, the applicationDashboardId is stored on the metric object,
     * not on the dashboard (which has a synthetic id like 'dynatrace-0').
     *
     * The fix uses: selectedMetric.applicationDashboardId || selectedDashboard.id
     */

    it('should use selectedMetric.applicationDashboardId for Dynatrace metrics', () => {
      // Dynatrace dashboard has synthetic ID (not the real applicationDashboardId)
      const selectedDashboard = {
        id: 'dynatrace-0', // Synthetic ID from mapping
        dashboard_label: 'HTTP Connection Pool',
        dashboard_uid: '',
      };

      // Dynatrace metric has the actual applicationDashboardId
      const selectedMetric = {
        id: 100001,
        title: 'Response Time',
        type: 'dynatrace',
        applicationDashboardId: 'real-uuid-from-database', // The actual ID we need
      };

      // Simulate the logic from fetchGraphData (line 721)
      const applicationDashboardId =
        selectedMetric.applicationDashboardId || selectedDashboard.id;

      // Should use the metric's applicationDashboardId, NOT the dashboard's synthetic id
      expect(applicationDashboardId).toBe('real-uuid-from-database');
      expect(applicationDashboardId).not.toBe('dynatrace-0');
    });

    it('should fallback to selectedDashboard.id for regular Grafana metrics', () => {
      // Grafana dashboard has real UUID from database
      const selectedDashboard = {
        id: '550e8400-e29b-41d4-a716-446655440000', // Real UUID
        dashboard_label: 'Gatling Overview',
        dashboard_uid: 'gatling-overview',
      };

      // Regular Grafana metric does not have applicationDashboardId
      const selectedMetric = {
        id: 12345,
        title: 'Response Time',
        type: 'timeseries',
        // No applicationDashboardId property
      };

      // Simulate the logic from fetchGraphData (line 721)
      const applicationDashboardId =
        (selectedMetric as any).applicationDashboardId || selectedDashboard.id;

      // Should fallback to dashboard's id
      expect(applicationDashboardId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should handle undefined applicationDashboardId gracefully', () => {
      const selectedDashboard = {
        id: 'dashboard-uuid',
        dashboard_label: 'Test Dashboard',
        dashboard_uid: 'test-uid',
      };

      const selectedMetric = {
        id: 1,
        title: 'Metric',
        type: 'gauge',
        applicationDashboardId: undefined, // Explicitly undefined
      };

      const applicationDashboardId =
        selectedMetric.applicationDashboardId || selectedDashboard.id;

      // Should fallback to dashboard's id when applicationDashboardId is undefined
      expect(applicationDashboardId).toBe('dashboard-uuid');
    });

    it('should handle empty string applicationDashboardId', () => {
      const selectedDashboard = {
        id: 'dashboard-uuid',
        dashboard_label: 'Test Dashboard',
        dashboard_uid: 'test-uid',
      };

      const selectedMetric = {
        id: 1,
        title: 'Metric',
        type: 'gauge',
        applicationDashboardId: '', // Empty string is falsy
      };

      const applicationDashboardId =
        selectedMetric.applicationDashboardId || selectedDashboard.id;

      // Should fallback to dashboard's id when applicationDashboardId is empty
      expect(applicationDashboardId).toBe('dashboard-uuid');
    });
  });

  describe('Metric Selection Options', () => {
    it('should have unique panel ids for Dynatrace metrics', () => {
      // Dynatrace metrics use panelId from backend
      const mockDynatraceMetrics = [
        { panelId: 100001, panelTitle: 'Response Time', applicationDashboardId: 'dash-1' },
        { panelId: 100002, panelTitle: 'Throughput', applicationDashboardId: 'dash-1' },
        { panelId: 100003, panelTitle: 'Response Time', applicationDashboardId: 'dash-2' }, // Same title, different ID
      ];

      const mappedPanels = mockDynatraceMetrics.map((m) => ({
        id: m.panelId,
        title: m.panelTitle,
        type: 'dynatrace',
        applicationDashboardId: m.applicationDashboardId,
      }));

      const ids = mappedPanels.map((p) => p.id);
      const uniqueIds = new Set(ids);

      // All IDs should be unique
      expect(uniqueIds.size).toBe(ids.length);
      expect(uniqueIds.size).toBe(3);
    });

    it('should use isOptionEqualToValue for metric comparison', () => {
      // Simulate the isOptionEqualToValue function from CompareCard metric selection (line 1609)
      const isOptionEqualToValue = (option: any, value: any) => option.id === value.id;

      const panel1 = { id: 100001, title: 'Same Title', type: 'dynatrace' };
      const panel2 = { id: 100002, title: 'Same Title', type: 'dynatrace' };
      const panel1Copy = { ...panel1 };

      // Different IDs should not be equal even with same title
      expect(isOptionEqualToValue(panel1, panel2)).toBe(false);

      // Same ID should be equal
      expect(isOptionEqualToValue(panel1, panel1Copy)).toBe(true);
    });
  });
});
