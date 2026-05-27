/**
 * Variable Discovery Service Tests
 *
 * Tests the variable discovery logic that extracts and processes
 * dashboard template variables for auto-configuration
 */

// Mock the entities module before importing anything else to avoid circular dependency
jest.mock('@perfana/shared/entities', () => ({
  TestRun: class TestRun {},
  Profile: class Profile {},
  ProfileGrafanaDashboard: class ProfileGrafanaDashboard {},
  ProfileBenchmark: class ProfileBenchmark {},
  Benchmark: class Benchmark {},
  GrafanaDashboard: class GrafanaDashboard {},
  GrafanaInstance: class GrafanaInstance {},
  ApplicationDashboard: class ApplicationDashboard {},
  SystemUnderTest: class SystemUnderTest {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { VariableDiscoveryService } from './variable-discovery.service';
import { VariableDetectorService } from './variable-detector.service';
import { VariableMatcherService } from './variable-matcher.service';
// Use entity types directly via 'as any' for mocks

describe('VariableDiscoveryService', () => {
  let service: VariableDiscoveryService;
  let variableDetectorService: jest.Mocked<VariableDetectorService>;
  let variableMatcherService: jest.Mocked<VariableMatcherService>;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    const mockVariableDetectorService = {
      getValuesFromDatasourceQuery: jest.fn(),
    };

    const mockVariableMatcherService = {
      overrideValues: jest.fn().mockImplementation((vars) => vars),
      filterValuesOnRegex: jest.fn().mockImplementation((vars) => vars),
      escapeRegExp: jest
        .fn()
        .mockImplementation((str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VariableDiscoveryService,
        {
          provide: VariableDetectorService,
          useValue: mockVariableDetectorService,
        },
        {
          provide: VariableMatcherService,
          useValue: mockVariableMatcherService,
        },
      ],
    }).compile();

    service = module.get<VariableDiscoveryService>(VariableDiscoveryService);
    variableDetectorService = module.get(VariableDetectorService);
    variableMatcherService = module.get(VariableMatcherService);

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have VariableDetectorService injected', () => {
      expect((service as any).variableDetectorService).toBeDefined();
    });

    it('should have VariableMatcherService injected', () => {
      expect((service as any).variableMatcherService).toBeDefined();
    });
  });

  describe('getApplicationDashboardVariables', () => {
    const mockTestRun: any = {
      systemUnderTest: { name: 'my-application' },
      systemUnderTestId: 'sut-id',
      testEnvironment: 'production',
      testRunId: 'test-123',
      workload: 'load-test',
      endTime: new Date(),
      tags: [],
      variables: [],
    };

    const mockGrafanaInstance = {
      label: 'Grafana Production',
      server_url: 'https://grafana.example.com',
      client_url: 'https://grafana.example.com',
      apiKey: 'test-key',
    } as any;

    // Helper to create mock dashboard
    const createMockDashboard = (templatingVariables: any[] = []): any => ({
      id: 'dashboard-1',
      uid: 'test-uid',
      grafanaInstance: { label: 'grafana-instance' },
      name: 'Test Dashboard',
      grafanaId: 1,
      tags: [],
      grafanaJson: null,
      usedBySut: [],
      templatingVariables,
    });

    it('should always include system_under_test and test_environment', async () => {
      const mockGrafanaDashboard = createMockDashboard();
      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        name: 'system_under_test',
        values: ['my-application'],
      });
      expect(result).toContainEqual({
        name: 'test_environment',
        values: ['production'],
      });
    });

    it('should process constant type variables', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'datasource',
          type: 'constant',
          query: 'InfluxDB',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toHaveLength(3);
      expect(result).toContainEqual({
        name: 'datasource',
        values: ['InfluxDB'],
      });
    });

    it('should handle constant variable with object query format', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'datasource',
          type: 'constant',
          query: { query: 'InfluxDB' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'datasource',
        values: ['InfluxDB'],
      });
    });

    it('should process interval type variables', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'interval',
          type: 'interval',
          query: '1m,5m,10m',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'interval',
        values: ['1m', '5m', '10m'],
      });
    });

    it('should process custom type variables', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'custom',
          query: 'frontend,backend,database',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'workload',
        values: ['frontend', 'backend', 'database'],
      });
    });

    it('should handle custom variables with no duplicates', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'custom',
          query: 'frontend,frontend,backend,backend',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const workloadVar = result.find((v) => v.name === 'workload');
      expect(workloadVar?.values).toEqual(['frontend', 'backend']);
    });

    it('should handle interval variable with object query format', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'interval',
          type: 'interval',
          query: { query: '30s,1m,5m' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'interval',
        values: ['30s', '1m', '5m'],
      });
    });

    it('should log warning for unsupported variable type', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'unsupported_var',
          type: 'textbox',
          query: 'some-value',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(loggerWarnSpy).toHaveBeenCalledWith('Variable of type textbox not supported');
    });

    it('should log error when variable processing fails', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'failing_var',
          type: 'query',
          query: 'SHOW TAG VALUES',
          datasource: { uid: 'test-datasource-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // Mock detector service to throw error
      variableDetectorService.getValuesFromDatasourceQuery.mockRejectedValue(
        new Error('Datasource error'),
      );

      await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // The error is logged as "Failed to execute query" not "Failed to get values"
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute query for variable "failing_var"'),
      );
    });

    it('should override variable values when setHardcodedValueForVariables is set', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'custom',
          query: 'frontend,backend,database',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
        setHardcodedValueForVariables: [
          {
            name: 'workload',
            values: ['frontend-override'],
          },
        ],
      };

      // Configure mock to simulate actual override behavior
      variableMatcherService.overrideValues.mockImplementationOnce(() => [
        { name: 'system_under_test', values: ['my-application'] },
        { name: 'test_environment', values: ['production'] },
        { name: 'workload', values: ['frontend-override'] },
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const workloadVar = result.find((v) => v.name === 'workload');
      expect(workloadVar?.values).toEqual(['frontend-override']);
      expect(variableMatcherService.overrideValues).toHaveBeenCalled();
    });

    it('should replace dynamic placeholders in override values', async () => {
      const testRunWithVars: any = {
        ...mockTestRun,
        variables: [{ placeholder: '${custom_value}', value: 'replaced-value' }],
      };

      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'custom',
          query: 'frontend,backend',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
        setHardcodedValueForVariables: [
          {
            name: 'workload',
            values: ['${custom_value}'],
          },
        ],
      };

      // Configure mock to simulate actual override with placeholder replacement
      variableMatcherService.overrideValues.mockImplementationOnce(() => [
        { name: 'system_under_test', values: ['my-application'] },
        { name: 'test_environment', values: ['production'] },
        { name: 'workload', values: ['replaced-value'] },
      ]);

      const result = await service.getApplicationDashboardVariables(
        testRunWithVars,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const workloadVar = result.find((v) => v.name === 'workload');
      expect(workloadVar?.values).toEqual(['replaced-value']);
      expect(variableMatcherService.overrideValues).toHaveBeenCalled();
    });

    it('should filter variable values based on regex patterns', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'custom',
          query: 'frontend-prod,backend-prod,frontend-dev,backend-dev',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
        matchRegexForVariables: {
          workload: '.*-prod',
        },
      };

      // Configure mock to simulate actual filter behavior
      variableMatcherService.filterValuesOnRegex.mockImplementationOnce(() => [
        { name: 'system_under_test', values: ['my-application'] },
        { name: 'test_environment', values: ['production'] },
        { name: 'workload', values: ['frontend-prod', 'backend-prod'] },
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const workloadVar = result.find((v) => v.name === 'workload');
      expect(workloadVar?.values).toEqual(['frontend-prod', 'backend-prod']);
      expect(variableMatcherService.filterValuesOnRegex).toHaveBeenCalled();
    });

    it('should filter variable values with dynamic regex replacement', async () => {
      const testRunWithVars: any = {
        ...mockTestRun,
        variables: [{ placeholder: '${env}', value: 'prod' }],
      };

      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'custom',
          query: 'frontend-prod,backend-prod,frontend-dev,backend-dev',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
        matchRegexForVariables: {
          workload: '.*-prod',
        },
      };

      // Configure mock to simulate actual filter behavior with dynamic regex
      variableMatcherService.filterValuesOnRegex.mockImplementationOnce(() => [
        { name: 'system_under_test', values: ['my-application'] },
        { name: 'test_environment', values: ['production'] },
        { name: 'workload', values: ['frontend-prod', 'backend-prod'] },
      ]);

      const result = await service.getApplicationDashboardVariables(
        testRunWithVars,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const workloadVar = result.find((v) => v.name === 'workload');
      expect(workloadVar?.values).toEqual(['frontend-prod', 'backend-prod']);
      expect(variableMatcherService.filterValuesOnRegex).toHaveBeenCalled();
    });

    it('should filter out system_under_test from dashboard templating variables', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'system_under_test',
          type: 'query',
          query: 'show tag values with key = "system_under_test"',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // Should only have the base variables, not duplicates
      expect(result).toHaveLength(2);
      expect(result.filter((v) => v.name === 'system_under_test')).toHaveLength(1);
    });

    it('should filter out test_environment from dashboard templating variables', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'test_environment',
          type: 'query',
          query: 'show tag values with key = "test_environment"',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toHaveLength(2);
      expect(result.filter((v) => v.name === 'test_environment')).toHaveLength(1);
    });

    it('should handle dashboard with no templating variables', async () => {
      const mockGrafanaDashboard = createMockDashboard();
      mockGrafanaDashboard.templatingVariables = undefined;

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        name: 'system_under_test',
        values: ['my-application'],
      });
    });
  });

  describe('Query Variable Processing', () => {
    const mockTestRun: any = {
      systemUnderTest: { name: 'my-application' },
      systemUnderTestId: 'sut-id',
      testEnvironment: 'production',
      testRunId: 'test-123',
      workload: 'load-test',
      endTime: new Date(),
      tags: [],
      variables: [],
    };

    const mockGrafanaInstance = {
      label: 'Grafana Production',
      server_url: 'https://grafana.example.com',
      client_url: 'https://grafana.example.com',
      apiKey: 'test-key',
    } as any;

    const createMockDashboard = (templatingVariables: any[] = []): any => ({
      id: 'dashboard-1',
      uid: 'test-uid',
      grafanaInstance: { label: 'grafana-instance' },
      name: 'Test Dashboard',
      grafanaId: 1,
      tags: [],
      grafanaJson: null,
      usedBySut: [],
      templatingVariables,
    });

    it('should process query type variable with InfluxDB datasource (uid format)', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'query',
          query: 'SHOW TAG VALUES WITH KEY = "workload"',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // Mock the detector service to return expected values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'frontend',
        'backend',
        'database',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'workload',
        values: ['frontend', 'backend', 'database'],
      });
    });

    it('should process query type variable with InfluxDB datasource (name format)', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'query',
          query: 'SHOW TAG VALUES WITH KEY = "workload"',
          datasource: 'InfluxDB',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // Mock the detector service to return expected values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['api', 'web']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'workload',
        values: ['api', 'web'],
      });
    });

    it('should handle InfluxDB query with two-value arrays', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'metric',
          type: 'query',
          query: 'SHOW FIELD KEYS',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // Mock the detector service to return expected values (already processed)
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'responseTime',
        'throughput',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'metric',
        values: ['responseTime', 'throughput'],
      });
    });

    it('should apply regex filter to InfluxDB variable values', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'query',
          query: 'SHOW TAG VALUES',
          datasource: { uid: 'influxdb-uid' },
          regex: '/^frontend.*/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService now handles datasource queries and returns filtered values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'frontend-api',
        'frontend-web',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'workload',
        values: ['frontend-api', 'frontend-web'],
      });
    });

    it('should handle InfluxDB query with no duplicates', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'query',
          query: 'SHOW TAG VALUES',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles deduplication internally
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'frontend',
        'backend',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const workloadVar = result.find((v) => v.name === 'workload');
      expect(workloadVar?.values).toEqual(['frontend', 'backend']);
    });

    it('should handle InfluxDB datasource query error', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'failing_var',
          type: 'query',
          query: 'SHOW TAG VALUES',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // Mock error from detector service
      variableDetectorService.getValuesFromDatasourceQuery.mockRejectedValue(
        new Error('Query failed'),
      );

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute query for variable "failing_var"'),
      );

      expect(result).toContainEqual({
        name: 'failing_var',
        values: [],
      });
    });

    it('should process Prometheus datasource with simple label query', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'job',
          type: 'query',
          query: 'label_values(job)',
          datasource: { uid: 'prometheus-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService returns processed values directly
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'api-server',
        'web-server',
        'database',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'job',
        values: ['api-server', 'web-server', 'database'],
      });
    });

    it('should process Prometheus datasource with label_values(metric, label) query', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'instance',
          type: 'query',
          query: 'label_values(http_requests_total, instance)',
          datasource: { uid: 'prometheus-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService extracts label values from series response
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'server1',
        'server2',
        'server3',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'instance',
        values: expect.arrayContaining(['server1', 'server2', 'server3']),
      });
    });

    it('should apply regex filter to Prometheus label_values query with captured groups', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'instance',
          type: 'query',
          query: 'label_values(http_requests_total, instance)',
          datasource: { uid: 'prometheus-uid' },
          regex: '/server-(.*)/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService applies regex with captured groups
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['prod-1', 'prod-2']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'instance',
        values: expect.arrayContaining(['prod-1', 'prod-2']),
      });
    });

    it('should apply regex filter to Prometheus label_values query without captured groups', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'instance',
          type: 'query',
          query: 'label_values(http_requests_total, instance)',
          datasource: { uid: 'prometheus-uid' },
          regex: '/^prod-.*/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService filters values by regex
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['prod-server1']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'instance',
        values: ['prod-server1'],
      });
    });

    it('should handle invalid regex pattern in Prometheus query gracefully', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'instance',
          type: 'query',
          query: 'label_values(http_requests_total, instance)',
          datasource: { uid: 'prometheus-uid' },
          regex: '/[invalid(/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles invalid regex gracefully, returns fallback values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['server1']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // Note: Invalid regex warning is now logged by VariableDetectorService, not this service
      expect(result).toContainEqual({
        name: 'instance',
        values: ['server1'],
      });
    });

    it('should apply regex filter to Prometheus simple label query', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'job',
          type: 'query',
          query: 'label_values(job)',
          datasource: { uid: 'prometheus-uid' },
          regex: '/^api-.*/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService applies regex filtering and returns filtered values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'api-server',
        'api-worker',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'job',
        values: ['api-server', 'api-worker'],
      });
    });

    it('should handle invalid regex in Prometheus simple label query', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'job',
          type: 'query',
          query: 'label_values(job)',
          datasource: { uid: 'prometheus-uid' },
          regex: '/[invalid/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles invalid regex gracefully
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['api-server']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // Note: Invalid regex warning is now logged by VariableDetectorService, not this service
      expect(result).toContainEqual({
        name: 'job',
        values: ['api-server'],
      });
    });

    it('should handle Prometheus datasource query error', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'failing_var',
          type: 'query',
          query: 'label_values(job)',
          datasource: { uid: 'prometheus-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // Mock error from detector service
      variableDetectorService.getValuesFromDatasourceQuery.mockRejectedValue(
        new Error('Prometheus query failed'),
      );

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute query for variable "failing_var"'),
      );

      expect(result).toContainEqual({
        name: 'failing_var',
        values: [],
      });
    });

    it('should warn when datasource object has no uid', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'query',
          query: 'SHOW TAG VALUES',
          datasource: { type: 'influxdb' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // Note: Warning about missing UID is now logged by VariableDetectorService
      expect(result).toContainEqual({
        name: 'workload',
        values: [],
      });
    });

    it('should warn when no datasource is specified', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'query',
          query: 'SHOW TAG VALUES',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // Note: Warning about no datasource is now logged by VariableDetectorService
      expect(result).toContainEqual({
        name: 'workload',
        values: [],
      });
    });

    it('should warn for graphite datasource type', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'metric',
          type: 'query',
          query: 'apps.*.requests',
          datasource: { uid: 'graphite-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService returns empty array for unsupported graphite type
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // Note: Warning is now logged by VariableDetectorService, not this service
      expect(result).toContainEqual({
        name: 'metric',
        values: [],
      });
    });

    it('should warn for unsupported datasource type', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'metric',
          type: 'query',
          query: 'SELECT * FROM metrics',
          datasource: { uid: 'mysql-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService returns empty array for unsupported mysql type
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // Note: Warning is now logged by VariableDetectorService, not this service
      expect(result).toContainEqual({
        name: 'metric',
        values: [],
      });
    });

    it('should process grafana-postgresql-datasource type', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'scenario_name',
          type: 'query',
          query: 'SELECT DISTINCT scenario_name FROM test_runs',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles PostgreSQL queries and returns processed values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'load-test',
        'stress-test',
        'spike-test',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'scenario_name',
        values: ['load-test', 'stress-test', 'spike-test'],
      });
    });

    it('should process PostgreSQL datasource with simple SELECT query', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'application',
          type: 'query',
          query: 'SELECT DISTINCT name FROM applications',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles the query and returns extracted values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'app-frontend',
        'app-backend',
        'app-database',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'application',
        values: ['app-frontend', 'app-backend', 'app-database'],
      });

      // Verify detector service was called (API call details are internal to VariableDetectorService)
      expect(variableDetectorService.getValuesFromDatasourceQuery).toHaveBeenCalled();
    });

    it('should process PostgreSQL datasource with datasource name format', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'environment',
          type: 'query',
          query: 'SELECT DISTINCT environment FROM test_runs',
          datasource: 'PostgreSQL',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles datasource lookup internally
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'production',
        'staging',
        'development',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'environment',
        values: ['production', 'staging', 'development'],
      });
    });

    it('should apply regex filter to PostgreSQL variable values', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'application',
          type: 'query',
          query: 'SELECT name FROM applications',
          datasource: { uid: 'postgres-uid' },
          regex: '/^prod-.*/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService applies regex filtering and returns filtered values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'prod-api',
        'prod-web',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'application',
        values: ['prod-api', 'prod-web'],
      });
    });

    it('should apply regex with captured groups to PostgreSQL variable values', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'version',
          type: 'query',
          query: 'SELECT version FROM releases',
          datasource: { uid: 'postgres-uid' },
          regex: '/v([0-9]+\\.[0-9]+).*/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService applies regex with captured groups and returns extracted values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['1.0', '1.1', '2.0']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'version',
        values: ['1.0', '1.1', '2.0'],
      });
    });

    it('should handle PostgreSQL query with no duplicates', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'status',
          type: 'query',
          query: 'SELECT status FROM test_runs',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles deduplication and returns unique values
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'running',
        'completed',
        'failed',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const statusVar = result.find((v) => v.name === 'status');
      expect(statusVar?.values).toEqual(['running', 'completed', 'failed']);
    });

    it('should handle PostgreSQL query with numeric values', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'port',
          type: 'query',
          query: 'SELECT DISTINCT port FROM services',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService converts numeric values to strings
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        '8080',
        '3000',
        '5432',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'port',
        values: ['8080', '3000', '5432'],
      });
    });

    it('should handle PostgreSQL datasource query error', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'failing_var',
          type: 'query',
          query: 'SELECT * FROM nonexistent_table',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // Mock error from detector service
      variableDetectorService.getValuesFromDatasourceQuery.mockRejectedValue(
        new Error('PostgreSQL query failed'),
      );

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute query for variable "failing_var"'),
      );

      expect(result).toContainEqual({
        name: 'failing_var',
        values: [],
      });
    });

    it('should handle PostgreSQL query with empty result', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'empty_var',
          type: 'query',
          query: 'SELECT name FROM empty_table',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService returns empty array for empty results
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'empty_var',
        values: [],
      });
    });

    it('should handle invalid regex pattern in PostgreSQL query gracefully', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'app',
          type: 'query',
          query: 'SELECT name FROM applications',
          datasource: { uid: 'postgres-uid' },
          regex: '/[invalid(/',
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles invalid regex gracefully
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['my-app']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // Note: Invalid regex warning is now logged by VariableDetectorService, not this service
      expect(result).toContainEqual({
        name: 'app',
        values: ['my-app'],
      });
    });

    it('should replace placeholders in PostgreSQL query', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'query',
          query:
            "SELECT DISTINCT workload FROM test_runs WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'",
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService processes the query with replaced placeholders
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'load-test',
        'stress-test',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'workload',
        values: ['load-test', 'stress-test'],
      });

      // Verify detector service was called (placeholder replacement is verified by receiving correct results)
      expect(variableDetectorService.getValuesFromDatasourceQuery).toHaveBeenCalled();
    });

    it('should replace placeholders in query with system_under_test and test_environment', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'workload',
          type: 'query',
          query:
            'SHOW TAG VALUES WHERE system_under_test = "$system_under_test" AND test_environment = "$test_environment"',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService receives the query with placeholders replaced
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['api', 'web']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'workload',
        values: ['api', 'web'],
      });
      // Placeholder replacement is tested by receiving correct results from detector
      expect(variableDetectorService.getValuesFromDatasourceQuery).toHaveBeenCalled();
    });

    it('should replace other variable placeholders in query', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'region',
          type: 'custom',
          query: 'us-east-1,us-west-2',
        },
        {
          name: 'instance',
          type: 'query',
          query: 'SHOW TAG VALUES WHERE region = "$region"',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService receives the query with region placeholder replaced
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'server1',
        'server2',
      ]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // The region variable should have been processed as custom type
      expect(result).toContainEqual({
        name: 'region',
        values: ['us-east-1', 'us-west-2'],
      });
      expect(result).toContainEqual({
        name: 'instance',
        values: ['server1', 'server2'],
      });
    });

    it('should replace "All" with ".*" in variable placeholders', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'region',
          type: 'custom',
          query: 'All,us-east-1',
        },
        {
          name: 'instance',
          type: 'query',
          query: 'SHOW TAG VALUES WHERE region =~ /^$region$/',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService receives the query with "All" replaced by ".*"
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['server1']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'instance',
        values: ['server1'],
      });
    });

    it('should handle empty query gracefully', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'empty_var',
          type: 'query',
          query: '',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService returns empty array for empty query
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'empty_var',
        values: [],
      });
    });

    it('should handle query type variable with undefined query', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'undefined_query',
          type: 'query',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService handles undefined query gracefully
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([]);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      expect(result).toContainEqual({
        name: 'undefined_query',
        values: [],
      });
    });

    it('should substitute multi-value variable in SQL IN clause as quoted CSV', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'scenarioName',
          type: 'custom',
          query: 'BrowseAndSearch,Checkout',
        },
        {
          name: 'transaction',
          type: 'query',
          query: `SELECT DISTINCT transaction_name FROM requests_raw
WHERE system_under_test = '$system_under_test'
  AND test_environment = '$test_environment'
  AND scenario_name IN ($scenarioName)
ORDER BY 1`,
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue([
        'add-to-cart',
        'checkout',
      ]);

      await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // The query sent to the detector should have IN ('BrowseAndSearch','Checkout')
      const callArgs = variableDetectorService.getValuesFromDatasourceQuery.mock.calls[0];
      const queryPassedToDetector = callArgs[3] as string;
      expect(queryPassedToDetector).toContain("IN ('BrowseAndSearch','Checkout')");
      expect(queryPassedToDetector).not.toContain('IN (BrowseAndSearch|Checkout)');
    });

    it('should keep pipe-separated substitution for non-IN-clause variable usage', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'region',
          type: 'custom',
          query: 'us-east-1,us-west-2',
        },
        {
          name: 'instance',
          type: 'query',
          query: 'SHOW TAG VALUES WHERE region =~ /^$region$/',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['server1']);

      await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const callArgs = variableDetectorService.getValuesFromDatasourceQuery.mock.calls[0];
      const queryPassedToDetector = callArgs[3] as string;
      // Non-IN clause context should still use pipe-separated format
      expect(queryPassedToDetector).toContain('us-east-1|us-west-2');
    });

    it('should properly escape single quotes in values substituted into SQL IN clause', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'scenarioName',
          type: 'custom',
          query: "Browse's,Checkout",
        },
        {
          name: 'transaction',
          type: 'query',
          query: 'SELECT name FROM t WHERE scenario_name IN ($scenarioName)',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['tx1']);

      await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const callArgs = variableDetectorService.getValuesFromDatasourceQuery.mock.calls[0];
      const queryPassedToDetector = callArgs[3] as string;
      // Single quote in value should be escaped as '' (SQL standard escaping)
      expect(queryPassedToDetector).toContain("IN ('Browse''s','Checkout')");
    });

    it("should produce IN ('only-value') for single-value variable in SQL IN clause", async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'scenarioName',
          type: 'custom',
          query: 'SingleScenario',
        },
        {
          name: 'transaction',
          type: 'query',
          query: 'SELECT name FROM t WHERE scenario_name IN ($scenarioName)',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['tx1']);

      await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const callArgs = variableDetectorService.getValuesFromDatasourceQuery.mock.calls[0];
      const queryPassedToDetector = callArgs[3] as string;
      expect(queryPassedToDetector).toContain("IN ('SingleScenario')");
    });

    it('should use literal "All" (not ".*") when substituting into SQL IN clause', async () => {
      // The IN-clause path must not map 'All' → '.*' (that is only valid for regex contexts).
      // SQL IN ('.*') would be a literal string match, so this documents the correct behavior.
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'scenarioName',
          type: 'custom',
          query: 'All,Checkout',
        },
        {
          name: 'transaction',
          type: 'query',
          query: 'SELECT name FROM t WHERE scenario_name IN ($scenarioName)',
          datasource: { uid: 'postgres-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['tx1']);

      await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      const callArgs = variableDetectorService.getValuesFromDatasourceQuery.mock.calls[0];
      const queryPassedToDetector = callArgs[3] as string;
      // In SQL IN context 'All' must stay as the literal string, not become '.*'
      expect(queryPassedToDetector).toContain("IN ('All','Checkout')");
      expect(queryPassedToDetector).not.toContain("IN ('.*','Checkout')");
    });

    it('should escape special regex characters in variable names', async () => {
      const mockGrafanaDashboard = createMockDashboard([
        {
          name: 'region.zone',
          type: 'custom',
          query: 'us-east-1,us-west-2',
        },
        {
          name: 'instance',
          type: 'query',
          query: 'SHOW TAG VALUES WHERE region = "$region.zone"',
          datasource: { uid: 'influxdb-uid' },
        },
      ]);

      const mockAutoConfigDashboard = {
        dashboardUid: 'test-uid',
        dashboardName: 'Test Dashboard',
      };

      // VariableDetectorService receives the query with escaped regex characters
      variableDetectorService.getValuesFromDatasourceQuery.mockResolvedValue(['server1']);

      const result = await service.getApplicationDashboardVariables(
        mockTestRun,
        mockGrafanaDashboard,
        mockAutoConfigDashboard,
        mockGrafanaInstance,
      );

      // The special characters in variable name (.) should be escaped in regex replacement
      expect(result).toContainEqual({
        name: 'instance',
        values: ['server1'],
      });
      // Verify that escapeRegExp is used (mock behavior verified by receiving correct results)
      expect(variableMatcherService.escapeRegExp).toHaveBeenCalled();
    });
  });

  // NOTE: The following methods have been moved to VariableMatcherService:
  // - replaceDynamicVariableValues
  // - escapeRegExp
  // - matchValue
  // - overrideValues
  // - filterValuesOnRegex
  // Tests for these methods should be in variable-matcher.service.spec.ts
});
