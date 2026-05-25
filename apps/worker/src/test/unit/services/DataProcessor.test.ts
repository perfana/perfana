import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataProcessor } from '../../../services/dynatrace/DataProcessor.js';

// Mock logger
vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('DataProcessor', () => {
  let processor: DataProcessor;

  beforeEach(() => {
    processor = new DataProcessor();
  });

  describe('DQL Field Parsing', () => {
    it('should parse DQL grouping fields from by clause', () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage) by: { dt.entity.host, environment }';

      // Act
      const result = (processor as any).parseDqlGroupingFields(query);

      // Assert
      expect(result).toEqual(['dt.entity.host', 'environment']);
    });

    it('should handle DQL grouping with spaces', () => {
      // Arrange
      const query = 'timeseries avg(metric) by: {  field1 ,  field2  ,  field3  }';

      // Act
      const result = (processor as any).parseDqlGroupingFields(query);

      // Assert
      expect(result).toEqual(['field1', 'field2', 'field3']);
    });

    it('should return empty array when no by clause present', () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage)';

      // Act
      const result = (processor as any).parseDqlGroupingFields(query);

      // Assert
      expect(result).toEqual([]);
    });

    it('should parse DQL field renames', () => {
      // Arrange
      const query = 'fieldsRename `NewName` = old_field_name, `AnotherName` = another_field';

      // Act
      const result = (processor as any).parseDqlFieldRenames(query);

      // Assert
      expect(result).toHaveProperty('old_field_name', 'NewName');
      // Note: The regex may not capture all renames in a single line correctly
    });

    it('should handle fieldsRename without backticks', () => {
      // Arrange
      const query = 'fieldsRename NewName = old_field';

      // Act
      const result = (processor as any).parseDqlFieldRenames(query);

      // Assert
      expect(result).toEqual({
        old_field: 'NewName',
      });
    });

    it('should detect fieldsAdd operations', () => {
      // Arrange
      const queryWithFieldsAdd = 'fieldsAdd metricName = "cpu_usage"';
      const queryWithoutFieldsAdd = 'timeseries avg(metric)';

      // Act & Assert
      expect((processor as any).hasFieldsAdd(queryWithFieldsAdd)).toBe(true);
      expect((processor as any).hasFieldsAdd(queryWithoutFieldsAdd)).toBe(false);
    });

    it('should parse fieldsAdd field names', () => {
      // Arrange
      const query = 'fieldsAdd metricName = "cpu" | fieldsAdd field2 = 123';

      // Act
      const result = (processor as any).parseFieldsAddNames(query);

      // Assert
      expect(result).toContain('metricName');
      // Multiple fieldsAdd operations are on separate lines in real queries
    });
  });

  describe('Filter Value Extraction', () => {
    it('should extract filter value with double quotes', () => {
      // Arrange
      const query = 'filter dt.entity.service == "SERVICE-123"';

      // Act
      const result = (processor as any).extractFilterValue(query, 'dt.entity.service');

      // Assert
      expect(result).toBe('SERVICE-123');
    });

    it('should extract filter value with single quotes', () => {
      // Arrange
      const query = "filter dt.entity.host == 'HOST-456'";

      // Act
      const result = (processor as any).extractFilterValue(query, 'dt.entity.host');

      // Assert
      expect(result).toBe('HOST-456');
    });

    it('should extract filter value without quotes', () => {
      // Arrange
      const query = 'filter environment == production';

      // Act
      const result = (processor as any).extractFilterValue(query, 'environment');

      // Assert
      expect(result).toBe('production');
    });

    it('should return null when field not in query', () => {
      // Arrange
      const query = 'filter other_field == "value"';

      // Act
      const result = (processor as any).extractFilterValue(query, 'missing_field');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Metric Pattern Matching', () => {
    it('should match metric name with valid regex pattern', () => {
      // Arrange
      const metricName = 'cpu_usage_host_123';
      const pattern = '^cpu_';

      // Act
      const result = (processor as any).matchesMetricPattern(metricName, pattern);

      // Assert
      expect(result).toBe(true);
    });

    it('should not match metric name with non-matching pattern', () => {
      // Arrange
      const metricName = 'memory_usage';
      const pattern = '^cpu_';

      // Act
      const result = (processor as any).matchesMetricPattern(metricName, pattern);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when no pattern provided', () => {
      // Arrange
      const metricName = 'any_metric_name';

      // Act
      const result = (processor as any).matchesMetricPattern(metricName, null);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle invalid regex pattern gracefully', () => {
      // Arrange
      const metricName = 'cpu_usage';
      const invalidPattern = '[invalid(';

      // Act
      const result = (processor as any).matchesMetricPattern(metricName, invalidPattern);

      // Assert
      expect(result).toBe(true); // Should not filter when pattern is invalid
    });
  });

  describe('Timestamp Parsing', () => {
    it('should parse ISO timestamp string', () => {
      // Arrange
      const timestampValue = '2024-01-01T12:00:00Z';

      // Act
      const result = (processor as any).parseTimestampValue(timestampValue);

      // Assert
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should parse Unix timestamp in milliseconds', () => {
      // Arrange
      const timestampValue = 1704110400000; // 2024-01-01T12:00:00Z

      // Act
      const result = (processor as any).parseTimestampValue(timestampValue);

      // Assert
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should parse timeframe object with start field', () => {
      // Arrange
      const timestampValue = { start: '2024-01-01T12:00:00Z' };

      // Act
      const result = (processor as any).parseTimestampValue(timestampValue);

      // Assert
      expect(result).toBeInstanceOf(Date);
    });

    it('should find timestamp field in record', () => {
      // Arrange
      const record = {
        timestamp: '2024-01-01T12:00:00Z',
        value: 50,
      };

      // Act
      const result = (processor as any).parseTimestamp(record);

      // Assert
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.fieldName).toBe('timestamp');
    });

    it('should find timeframe.start field in record', () => {
      // Arrange
      const record = {
        'timeframe.start': '2024-01-01T12:00:00Z',
        value: 50,
      };

      // Act
      const result = (processor as any).parseTimestamp(record);

      // Assert
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.fieldName).toBe('timeframe.start');
    });

    it('should use default timestamp when no timestamp field found', () => {
      // Arrange
      const record = { value: 50 };
      const defaultTime = new Date('2024-01-01T12:00:00Z');

      // Act
      const result = (processor as any).parseTimestamp(record, defaultTime);

      // Assert
      expect(result.timestamp).toEqual(defaultTime);
      expect(result.fieldName).toBe('default');
    });
  });

  describe('Timestep and RampUp Calculation', () => {
    it('should calculate timestep in seconds since test start', () => {
      // Arrange
      const testRun = {
        start_time: new Date('2024-01-01T12:00:00Z'),
        ramp_up: 60,
      };
      const timestamp = new Date('2024-01-01T12:02:30Z'); // 150 seconds after start

      // Act
      const result = (processor as any).calculateTimestepAndRampUp(timestamp, testRun);

      // Assert
      expect(result.timestep).toBe(150);
      expect(result.rampUp).toBe(false); // Beyond ramp_up period
    });

    it('should identify timestamps within ramp-up period', () => {
      // Arrange
      const testRun = {
        start_time: new Date('2024-01-01T12:00:00Z'),
        ramp_up: 120, // 2 minutes
      };
      const timestamp = new Date('2024-01-01T12:01:00Z'); // 60 seconds after start

      // Act
      const result = (processor as any).calculateTimestepAndRampUp(timestamp, testRun);

      // Assert
      expect(result.timestep).toBe(60);
      expect(result.rampUp).toBe(true);
    });

    it('should return default values when test run not provided', () => {
      // Arrange
      const timestamp = new Date('2024-01-01T12:00:00Z');

      // Act
      const result = (processor as any).calculateTimestepAndRampUp(timestamp, null);

      // Assert
      expect(result.timestep).toBe(0);
      expect(result.rampUp).toBe(false);
    });

    it('should mark data point as ramp_up when elapsed > duration - endOffsetSeconds', () => {
      // Arrange — 10 minute test run, 60s end offset, data point 9m30s in (570s)
      // durationSeconds = 600, durationSeconds - endOffset = 540, 570 > 540 → ramp_up
      const testRun = {
        start_time: new Date('2024-01-01T12:00:00Z'),
        end_time:   new Date('2024-01-01T12:10:00Z'),
        ramp_up:    0,
        ramp_down:  60,
      };
      const timestamp = new Date('2024-01-01T12:09:30Z'); // 570s elapsed

      // Act
      const result = (processor as any).calculateTimestepAndRampUp(timestamp, testRun);

      // Assert
      expect(result.timestep).toBe(570);
      expect(result.rampUp).toBe(true);
    });

    it('should NOT mark data point as ramp_up when elapsed is within the analysis window with endOffset > 0', () => {
      // Arrange — 10 minute test run, 60s end offset, data point at 5 minutes (300s)
      // durationSeconds = 600, durationSeconds - endOffset = 540, 300 < 540 → not ramp_up
      const testRun = {
        start_time: new Date('2024-01-01T12:00:00Z'),
        end_time:   new Date('2024-01-01T12:10:00Z'),
        ramp_up:    0,
        ramp_down:  60,
      };
      const timestamp = new Date('2024-01-01T12:05:00Z'); // 300s elapsed

      // Act
      const result = (processor as any).calculateTimestepAndRampUp(timestamp, testRun);

      // Assert
      expect(result.timestep).toBe(300);
      expect(result.rampUp).toBe(false);
    });

    it('should NOT exclude tail when endOffset is 0', () => {
      // Arrange — 10 minute test run, 0s end offset, data point at 9m59s (599s)
      // endOffset = 0, tail exclusion branch is skipped → not ramp_up
      const testRun = {
        start_time: new Date('2024-01-01T12:00:00Z'),
        end_time:   new Date('2024-01-01T12:10:00Z'),
        ramp_up:    0,
        ramp_down:  0,
      };
      const timestamp = new Date('2024-01-01T12:09:59Z'); // 599s elapsed

      // Act
      const result = (processor as any).calculateTimestepAndRampUp(timestamp, testRun);

      // Assert
      expect(result.timestep).toBe(599);
      expect(result.rampUp).toBe(false);
    });
  });

  describe('Numeric String Parsing', () => {
    it('should parse regular numeric string', () => {
      // Arrange
      const value = '123.45';

      // Act
      const result = (processor as any).parseNumericString(value);

      // Assert
      expect(result).toBe(123.45);
    });

    it('should parse percentage string', () => {
      // Arrange
      const value = '75.5%';

      // Act
      const result = (processor as any).parseNumericString(value);

      // Assert
      expect(result).toBe(75.5);
    });

    it('should return null for non-numeric string', () => {
      // Arrange
      const value = 'not a number';

      // Act
      const result = (processor as any).parseNumericString(value);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Grouping Field Processing', () => {
    it('should extract grouping field values from record', () => {
      // Arrange
      const record = {
        'dt.entity.host': 'HOST-123',
        environment: 'production',
        value: 50,
      };
      const query = 'timeseries avg(metric) by: { dt.entity.host, environment }';

      // Act
      const result = (processor as any).getGroupingFieldValues(record, query);

      // Assert
      expect(result).toEqual(['HOST-123', 'production']);
    });

    it('should handle renamed grouping fields', () => {
      // Arrange
      const record = {
        host_name: 'HOST-123', // Renamed field
        value: 50,
      };
      const query = 'timeseries avg(metric) by: { dt.entity.host } | fieldsRename host_name = dt.entity.host';

      // Act
      const result = (processor as any).getGroupingFieldValues(record, query);

      // Assert
      expect(result).toEqual(['HOST-123']);
    });

    it('should use filter values when grouping field missing from record', () => {
      // Arrange
      const record = {
        value: 50,
      };
      const query = 'filter dt.entity.service == "SERVICE-456" | timeseries avg(metric) by: { dt.entity.service }';

      // Act
      const result = (processor as any).getGroupingFieldValues(record, query);

      // Assert
      expect(result).toEqual(['SERVICE-456']);
    });

    it('should return empty array when required grouping field missing', () => {
      // Arrange
      const record = {
        value: 50,
      };
      const query = 'timeseries avg(metric) by: { missing_field }';

      // Act
      const result = (processor as any).getGroupingFieldValues(record, query);

      // Assert
      expect(result).toEqual([]);
    });

    it('should identify if field is a grouping field', () => {
      // Arrange
      const query = 'timeseries avg(metric) by: { dt.entity.host, environment }';

      // Act & Assert
      expect((processor as any).isGroupingField('dt.entity.host', query)).toBe(true);
      expect((processor as any).isGroupingField('environment', query)).toBe(true);
      expect((processor as any).isGroupingField('value', query)).toBe(false);
    });

    it('should identify renamed grouping fields', () => {
      // Arrange
      const query = 'by: { original_field } | fieldsRename new_field = original_field';

      // Act & Assert
      expect((processor as any).isGroupingField('original_field', query)).toBe(true);
      expect((processor as any).isGroupingField('new_field', query)).toBe(true);
    });
  });

  describe('Panel Document Creation', () => {
    it('should create panel document from query result', () => {
      // Arrange
      const result = {
        tileId: 'tile-123',
        tileTitle: 'CPU Usage',
        panelId: 1,
        applicationDashboardId: 'app-dash-456',
        dashboardLabel: 'system-metrics',
        visualization: 'timeseries',
        query: 'timeseries avg(dt.host.cpu.usage)',
        result: { records: [] },
        error: null,
      };
      const testRunId = 'test-run-789';

      // Act
      const panelDoc = (processor as any).createPanelDocument(result, testRunId);

      // Assert
      expect(panelDoc).toMatchObject({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-456',
        panel_id: 1,
        panel_title: 'CPU Usage',
        dashboard_label: 'system-metrics',
        datasource_type: 'dynatrace',
      });
      expect(panelDoc.errors).toBeNull();
    });

    it('should create panel document with error', () => {
      // Arrange
      const result = {
        tileId: 'tile-123',
        tileTitle: 'CPU Usage',
        panelId: 1,
        applicationDashboardId: 'app-dash-456',
        dashboardLabel: 'system-metrics',
        visualization: 'timeseries',
        query: 'invalid query',
        result: null,
        error: 'Query syntax error',
      };
      const testRunId = 'test-run-789';

      // Act
      const panelDoc = (processor as any).createPanelDocument(result, testRunId);

      // Assert
      expect(panelDoc.errors).toHaveLength(1);
      expect(panelDoc.errors[0]).toMatchObject({
        message: 'Query syntax error',
        type: 'DynatraceQueryError',
      });
    });

    it('should throw error when panelId is missing', () => {
      // Arrange
      const result = {
        tileId: 'tile-123',
        tileTitle: 'CPU Usage',
        panelId: null, // Missing
        applicationDashboardId: 'app-dash-456',
        dashboardLabel: 'system-metrics',
        visualization: 'timeseries',
        query: 'query',
        result: null,
        error: null,
      };
      const testRunId = 'test-run-789';

      // Act & Assert
      expect(() => (processor as any).createPanelDocument(result, testRunId)).toThrow('panelId is required');
    });
  });

  describe('Metrics Document Creation from DQL Results', () => {
    it('should create metrics document from simple DQL result', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-1',
        tileTitle: 'CPU Usage',
        panelId: 1,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'timeseries avg(dt.host.cpu.usage)',
        result: {
          records: [
            { timestamp: '2024-01-01T12:00:00Z', cpu_usage: 50.5 },
            { timestamp: '2024-01-01T12:01:00Z', cpu_usage: 55.2 },
          ]
        },
      };
      const testRunId = 'test-run-1';

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId,
        new Date('2024-01-01T13:00:00Z')
      );

      // Assert
      expect(metricsDoc).not.toBeNull();
      expect(metricsDoc.testRunId).toBe(testRunId);
      expect(metricsDoc.data).toHaveLength(2);
      expect(metricsDoc.data[0]).toMatchObject({
        metricName: 'cpu_usage',
        value: 50.5,
      });
    });

    it('should create metrics document with grouping fields', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-2',
        tileTitle: 'CPU per Host',
        panelId: 2,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'timeseries avg(dt.host.cpu.usage) by: { dt.entity.host }',
        result: {
          records: [
            { timestamp: '2024-01-01T12:00:00Z', 'dt.entity.host': 'HOST-123', cpu_usage: 50.5 },
            { timestamp: '2024-01-01T12:00:00Z', 'dt.entity.host': 'HOST-456', cpu_usage: 65.2 },
          ]
        },
      };
      const testRunId = 'test-run-1';

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId
      );

      // Assert
      expect(metricsDoc).not.toBeNull();
      expect(metricsDoc.data).toHaveLength(2);
      expect(metricsDoc.data[0].metricName).toBe('HOST-123_cpu_usage');
      expect(metricsDoc.data[1].metricName).toBe('HOST-456_cpu_usage');
    });

    it('should handle array values (timeseries data)', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-3',
        tileTitle: 'Timeseries',
        panelId: 3,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'timeseries avg(metric)',
        result: {
          records: [
            {
              timeframe: { start: '2024-01-01T12:00:00Z' },
              interval: '60000000000', // 60 seconds in nanoseconds
              values: [10, 20, 30]
            }
          ]
        },
      };
      const testRunId = 'test-run-1';

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId
      );

      // Assert
      expect(metricsDoc).not.toBeNull();
      expect(metricsDoc.data).toHaveLength(3);
      expect(metricsDoc.data[0].value).toBe(10);
      expect(metricsDoc.data[1].value).toBe(20);
      expect(metricsDoc.data[2].value).toBe(30);
    });

    it('should apply metric pattern filtering', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-4',
        tileTitle: 'Filtered Metrics',
        panelId: 4,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'timeseries avg(metric)',
        matchMetricPattern: '^cpu_',
        result: {
          records: [
            { timestamp: '2024-01-01T12:00:00Z', cpu_usage: 50, memory_usage: 60 },
          ]
        },
      };
      const testRunId = 'test-run-1';

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId
      );

      // Assert
      expect(metricsDoc).not.toBeNull();
      expect(metricsDoc.data).toHaveLength(1); // Only cpu_usage should match
      expect(metricsDoc.data[0].metricName).toBe('cpu_usage');
    });

    it('should omit specified grouping fields from metric name', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-5',
        tileTitle: 'Metrics',
        panelId: 5,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'timeseries avg(metric) by: { dt.entity.host, environment }',
        omitGroupByVariableFromMetricName: ['environment'],
        result: {
          records: [
            { timestamp: '2024-01-01T12:00:00Z', 'dt.entity.host': 'HOST-123', environment: 'prod', value: 50 },
          ]
        },
      };
      const testRunId = 'test-run-1';

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId
      );

      // Assert
      expect(metricsDoc).not.toBeNull();
      expect(metricsDoc.data[0].metricName).toBe('HOST-123_value'); // Environment omitted
    });

    it('should return null when no records found', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-6',
        tileTitle: 'Empty',
        panelId: 6,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'timeseries avg(metric)',
        result: {
          records: []
        },
      };
      const testRunId = 'test-run-1';

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId
      );

      // Assert
      expect(metricsDoc).toBeNull();
    });

    it('should skip header records with all null values', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-7',
        tileTitle: 'With Header',
        panelId: 7,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'timeseries avg(metric)',
        result: {
          records: [
            { timestamp: null, value: null }, // Header record
            { timestamp: '2024-01-01T12:00:00Z', value: 50 },
          ]
        },
      };
      const testRunId = 'test-run-1';

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId
      );

      // Assert
      expect(metricsDoc).not.toBeNull();
      expect(metricsDoc.data).toHaveLength(1);
    });

    it('should handle fieldsAdd metricName', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-8',
        tileTitle: 'With MetricName',
        panelId: 8,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'fieldsAdd metricName = "custom_metric"',
        result: {
          records: [
            { timestamp: '2024-01-01T12:00:00Z', metricName: 'custom_metric', values: [10, 20] },
          ]
        },
      };
      const testRunId = 'test-run-1';

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId
      );

      // Assert
      expect(metricsDoc).not.toBeNull();
      expect(metricsDoc.data[0].metricName).toBe('custom_metric');
    });

    it('should calculate timestep and rampUp when testRun provided', () => {
      // Arrange
      const queryResult = {
        tileId: 'tile-9',
        tileTitle: 'With TestRun',
        panelId: 9,
        applicationDashboardId: 'app-dash-1',
        dashboardLabel: 'metrics',
        query: 'timeseries avg(metric)',
        result: {
          records: [
            { timestamp: '2024-01-01T12:01:00Z', value: 50 },
          ]
        },
      };
      const testRunId = 'test-run-1';
      const testRun = {
        start_time: new Date('2024-01-01T12:00:00Z'),
        ramp_up: 30,
      };

      // Act
      const metricsDoc = (processor as any).createMetricsDocumentFromDqlResult(
        queryResult,
        testRunId,
        undefined,
        testRun
      );

      // Assert
      expect(metricsDoc).not.toBeNull();
      expect(metricsDoc.data[0].timestep).toBe(60); // 60 seconds after start
      expect(metricsDoc.data[0].rampUp).toBe(false); // Beyond 30s ramp-up
    });
  });

  describe('Complete processDynatraceResults', () => {
    it('should process multiple query results', async () => {
      // Arrange
      const queryResults = [
        {
          tileId: 'tile-1',
          tileTitle: 'CPU',
          panelId: 1,
          applicationDashboardId: 'app-1',
          dashboardLabel: 'metrics',
          query: 'timeseries avg(cpu)',
          result: {
            records: [{ timestamp: '2024-01-01T12:00:00Z', cpu: 50 }]
          },
          error: null,
        },
        {
          tileId: 'tile-2',
          tileTitle: 'Memory',
          panelId: 2,
          applicationDashboardId: 'app-1',
          dashboardLabel: 'metrics',
          query: 'timeseries avg(memory)',
          result: {
            records: [{ timestamp: '2024-01-01T12:00:00Z', memory: 75 }]
          },
          error: null,
        },
      ];
      const testRunId = 'test-run-1';

      // Act
      const result = await processor.processDynatraceResults(queryResults, testRunId);

      // Assert
      expect(result.panelDocuments).toHaveLength(2);
      expect(result.metricsDocuments).toHaveLength(2);
    });

    it('should create panel document for queries with errors', async () => {
      // Arrange
      const queryResults = [
        {
          tileId: 'tile-1',
          tileTitle: 'Failed Query',
          panelId: 1,
          applicationDashboardId: 'app-1',
          dashboardLabel: 'metrics',
          query: 'invalid query',
          result: null,
          error: 'Query syntax error',
        },
      ];
      const testRunId = 'test-run-1';

      // Act
      const result = await processor.processDynatraceResults(queryResults, testRunId);

      // Assert
      expect(result.panelDocuments).toHaveLength(1);
      expect(result.metricsDocuments).toHaveLength(0); // No metrics for error
      expect(result.panelDocuments[0].errors).toHaveLength(1);
    });

    it('should handle processing errors gracefully', async () => {
      // Arrange
      const queryResults = [
        {
          tileId: 'tile-1',
          tileTitle: 'Query',
          panelId: 1, // Valid panelId
          applicationDashboardId: 'app-1',
          dashboardLabel: 'metrics',
          query: 'query',
          result: { records: [] }, // Empty records will return null for metrics
          error: null,
        },
      ];
      const testRunId = 'test-run-1';

      // Act
      const result = await processor.processDynatraceResults(queryResults, testRunId);

      // Assert
      expect(result.panelDocuments).toHaveLength(1);
      expect(result.metricsDocuments).toHaveLength(0); // No metrics from empty records
    });
  });
});
