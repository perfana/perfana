/**
 * Unit tests for Dynatrace QueryConstructor service
 * Tests query construction, template variable replacement, and time range cleaning
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryConstructor, type TestRun } from '../../../services/dynatrace/QueryConstructor.js';
import { DynatraceRepository } from '../../../services/dynatrace/DynatraceRepository.js';
import type { DynatraceQueryConfigFromDb } from '../../../types/dynatrace/index.js';

describe('QueryConstructor', () => {
  let mockRepository: DynatraceRepository;
  let queryConstructor: QueryConstructor;

  const createMockTestRun = (overrides?: Partial<TestRun>): TestRun => ({
    testRunId: 'test-run-123',
    systemUnderTestId: 'my-app',
    testEnvironment: 'production',
    workload: 'loadTest',
    start: new Date('2025-01-01T10:00:00Z'),
    end: new Date('2025-01-01T11:00:00Z'),
    ...overrides
  });

  const createMockQueryConfig = (overrides?: Partial<DynatraceQueryConfigFromDb>): DynatraceQueryConfigFromDb => ({
    id: 'config-1',
    systemUnderTestId: 'my-app',
    testEnvironment: 'production',
    workload: 'loadTest',
    dashboardLabel: 'Test Dashboard',
    panelTitle: 'CPU Usage',
    query: 'timeseries avg(dt.host.cpu.usage)',
    matchMetricPattern: 'cpu.*',
    omitGroupByVariableFromMetricName: [],
    templateVariables: {},
    applicationDashboardId: 'app-dash-1',
    panelId: 1,
    metricUnit: 'percent',
    dynatraceConfigId: 'dt-config-1',
    ...overrides
  });

  beforeEach(() => {
    mockRepository = {
      getQueriesForTestRun: vi.fn(),
      getDynatraceConfigById: vi.fn(),
      getDynatraceConfig: vi.fn(),
      getAllDynatraceConfigs: vi.fn()
    } as any;

    queryConstructor = new QueryConstructor(mockRepository);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    describe('constructQueriesFromDatabase', () => {
      it('should construct queries successfully from database configs', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfigs = [
          createMockQueryConfig(),
          createMockQueryConfig({
            id: 'config-2',
            panelTitle: 'Memory Usage',
            query: 'timeseries avg(dt.host.memory.usage)',
            matchMetricPattern: 'memory.*'
          })
        ];

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue(dbConfigs);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result).toHaveLength(2);
        expect(result[0].tileTitle).toBe('CPU Usage');
        expect(result[0].query).toBe('timeseries avg(dt.host.cpu.usage)');
        expect(result[0].matchMetricPattern).toBe('cpu.*');
        expect(result[0].dynatraceConfigId).toBe('dt-config-1');

        expect(result[1].tileTitle).toBe('Memory Usage');
        expect(result[1].matchMetricPattern).toBe('memory.*');

        expect(mockRepository.getQueriesForTestRun).toHaveBeenCalledWith(
          'my-app',
          'production',
          'loadTest',
          undefined
        );
      });

      it('should filter queries by dashboard label when provided', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dashboardLabel = 'Performance Dashboard';
        const dbConfigs = [createMockQueryConfig({ dashboardLabel })];

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue(dbConfigs);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun, dashboardLabel);

        // Assert
        expect(result).toHaveLength(1);
        expect(mockRepository.getQueriesForTestRun).toHaveBeenCalledWith(
          'my-app',
          'production',
          'loadTest',
          dashboardLabel
        );
      });

      it('should return empty array when no query configs found', async () => {
        // Arrange
        const testRun = createMockTestRun();
        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result).toEqual([]);
      });

      it('should include all query configuration fields', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          tileId: '5',
          visualization: 'graph',
          omitGroupByVariableFromMetricName: ['cluster', 'node']
        } as any);

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0]).toMatchObject({
          tileId: '1',
          tileTitle: 'CPU Usage',
          query: expect.any(String),
          visualization: 'timeseries',
          dashboardLabel: 'Test Dashboard',
          applicationDashboardId: 'app-dash-1',
          panelId: 1,
          dynatraceConfigId: 'dt-config-1',
          omitGroupByVariableFromMetricName: ['cluster', 'node']
        });
      });
    });

    describe('template variable replacement', () => {
      it('should replace single template variable in query', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.kubernetes.cluster.cpu) | filter k8s.cluster.name == $Cluster',
          templateVariables: { Cluster: 'production-cluster' }
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toContain('"production-cluster"');
        expect(result[0].query).not.toContain('$Cluster');
      });

      it('should replace multiple template variables in query', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.kubernetes.pod.cpu) | filter k8s.cluster.name == $Cluster AND k8s.namespace.name == $Namespace',
          templateVariables: {
            Cluster: 'prod-cluster',
            Namespace: 'my-namespace'
          }
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toContain('"prod-cluster"');
        expect(result[0].query).toContain('"my-namespace"');
        expect(result[0].query).not.toContain('$Cluster');
        expect(result[0].query).not.toContain('$Namespace');
      });

      it('should replace all occurrences of template variable', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.host.cpu) | filter host.name == $Host OR host.ip == $Host',
          templateVariables: { Host: 'server-01' }
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        const matches = result[0].query.match(/"server-01"/g);
        expect(matches).toHaveLength(2);
      });

      it('should handle numeric template variables', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.host.cpu) | filter value > $Threshold',
          templateVariables: { Threshold: 80 }
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toContain('80');
        expect(result[0].query).not.toContain('$Threshold');
      });

      it('should not replace variables when no template variables provided', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const originalQuery = 'timeseries avg(dt.host.cpu.usage)';
        const dbConfig = createMockQueryConfig({
          query: originalQuery,
          templateVariables: {}
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toBe(originalQuery);
      });
    });

    describe('time range cleaning', () => {
      it('should remove from: clause from limit command', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.host.cpu) | limit 20, from: now()-1h'
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toContain('| limit 20');
        expect(result[0].query).not.toContain('from:');
      });

      it('should remove to: clause from limit command', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.host.cpu) | limit 20, to: now()'
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toContain('| limit 20');
        expect(result[0].query).not.toContain('to:');
      });

      it('should remove both from: and to: clauses', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.host.cpu) | limit 20, from: now()-1h, to: now()'
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toContain('| limit 20');
        expect(result[0].query).not.toContain('from:');
        expect(result[0].query).not.toContain('to:');
      });

      it('should remove from:/to: from timeseries blocks with quoted values', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.host.cpu), from: "2025-01-01", to: "2025-01-02"'
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toBe('timeseries avg(dt.host.cpu)');
      });

      it('should remove from:/to: with relative time values', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.host.cpu), from: -1h, to: -30m'
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toBe('timeseries avg(dt.host.cpu)');
      });

      it('should preserve query without time range clauses', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const originalQuery = 'timeseries avg(dt.host.cpu) | filter value > 50';
        const dbConfig = createMockQueryConfig({ query: originalQuery });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toBe(originalQuery);
      });
    });

    describe('combined transformations', () => {
      it('should apply both template replacement and time cleaning', async () => {
        // Arrange
        const testRun = createMockTestRun();
        const dbConfig = createMockQueryConfig({
          query: 'timeseries avg(dt.kubernetes.pod.cpu) | filter k8s.cluster.name == $Cluster | limit 20, from: now()-1h',
          templateVariables: { Cluster: 'prod-cluster' }
        });

        vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

        // Act
        const result = await queryConstructor.constructQueriesFromDatabase(testRun);

        // Assert
        expect(result[0].query).toContain('"prod-cluster"');
        expect(result[0].query).toContain('| limit 20');
        expect(result[0].query).not.toContain('$Cluster');
        expect(result[0].query).not.toContain('from:');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle query config with null template variables', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({
        query: 'timeseries avg(dt.host.cpu)',
        templateVariables: null as any
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].query).toBe('timeseries avg(dt.host.cpu)');
    });

    it('should handle empty query string', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({ query: '' });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].query).toBe('');
    });

    it('should handle template variable not present in query', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({
        query: 'timeseries avg(dt.host.cpu)',
        templateVariables: { UnusedVar: 'value' }
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result[0].query).toBe('timeseries avg(dt.host.cpu)');
    });

    it('should handle template variable with special characters', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({
        query: 'timeseries avg(dt.host.cpu) | filter host == $Host',
        templateVariables: { Host: 'server-01.example.com' }
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result[0].query).toContain('"server-01.example.com"');
    });

    it('should handle missing panelId', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({ panelId: null as any });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result[0].panelId).toBeNull();
    });

    it('should handle very long queries', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const longQuery = 'timeseries avg(dt.host.cpu)'.repeat(100);
      const dbConfig = createMockQueryConfig({ query: longQuery });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].query.length).toBeGreaterThan(1000);
    });

    it('should handle omitGroupByVariableFromMetricName as empty array', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({
        omitGroupByVariableFromMetricName: []
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result[0].omitGroupByVariableFromMetricName).toEqual([]);
    });

    it('should handle omitGroupByVariableFromMetricName with multiple values', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({
        omitGroupByVariableFromMetricName: ['cluster', 'namespace', 'pod']
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result[0].omitGroupByVariableFromMetricName).toEqual(['cluster', 'namespace', 'pod']);
    });
  });

  describe('Error Scenarios', () => {
    it('should skip query config that fails processing', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const validConfig = createMockQueryConfig({ id: 'valid-1' });
      const invalidConfig = createMockQueryConfig({
        id: 'invalid-1',
        panelTitle: undefined as any // This might cause issues
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([
        validConfig,
        invalidConfig,
        createMockQueryConfig({ id: 'valid-2' })
      ]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      // Should still process valid configs even if one fails
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle repository errors gracefully', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const error = new Error('Database connection failed');
      vi.mocked(mockRepository.getQueriesForTestRun).mockRejectedValue(error);

      // Act & Assert
      await expect(
        queryConstructor.constructQueriesFromDatabase(testRun)
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle malformed template variables object', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({
        query: 'timeseries avg(dt.host.cpu) | filter host == $Host',
        templateVariables: { Host: undefined as any }
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result).toHaveLength(1);
      // Should handle undefined gracefully
    });
  });

  describe('Complex Query Scenarios', () => {
    it('should handle multiline queries with template variables', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({
        query: `timeseries avg(dt.kubernetes.pod.cpu)
| filter k8s.cluster.name == $Cluster
  AND k8s.namespace.name == $Namespace
| limit 100`,
        templateVariables: {
          Cluster: 'prod-cluster',
          Namespace: 'backend'
        }
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result[0].query).toContain('"prod-cluster"');
      expect(result[0].query).toContain('"backend"');
      expect(result[0].query).not.toContain('$Cluster');
      expect(result[0].query).not.toContain('$Namespace');
    });

    it('should handle queries with multiple limit and filter clauses', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfig = createMockQueryConfig({
        query: 'timeseries avg(dt.host.cpu) | filter value > 50 | limit 10, from: now()-1h | filter host.type == "production"'
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([dbConfig]);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result[0].query).toContain('| limit 10');
      expect(result[0].query).toContain('filter value > 50');
      expect(result[0].query).toContain('filter host.type == "production"');
      expect(result[0].query).not.toContain('from:');
    });

    it('should process multiple query configs with different settings', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const dbConfigs = [
        createMockQueryConfig({
          id: 'config-1',
          panelTitle: 'CPU',
          query: 'timeseries avg(dt.host.cpu) | filter host == $Host',
          templateVariables: { Host: 'server-1' }
        }),
        createMockQueryConfig({
          id: 'config-2',
          panelTitle: 'Memory',
          query: 'timeseries avg(dt.host.memory) | limit 20, from: now()-30m',
          templateVariables: {}
        }),
        createMockQueryConfig({
          id: 'config-3',
          panelTitle: 'Network',
          query: 'timeseries sum(dt.host.network.io)',
          templateVariables: null as any
        })
      ];

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue(dbConfigs);

      // Act
      const result = await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].query).toContain('"server-1"');
      expect(result[1].query).toContain('| limit 20');
      expect(result[1].query).not.toContain('from:');
      expect(result[2].query).toBe('timeseries sum(dt.host.network.io)');
    });
  });

  describe('TestRun Parameter Handling', () => {
    it('should use correct test run attributes for query lookup', async () => {
      // Arrange
      const testRun = createMockTestRun({
        systemUnderTestId: 'custom-app',
        testEnvironment: 'staging',
        workload: 'smokeTest'
      });

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([]);

      // Act
      await queryConstructor.constructQueriesFromDatabase(testRun);

      // Assert
      expect(mockRepository.getQueriesForTestRun).toHaveBeenCalledWith(
        'custom-app',
        'staging',
        'smokeTest',
        undefined
      );
    });

    it('should handle different dashboard labels', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const labels = ['Dashboard A', 'Dashboard B', 'Dashboard C'];

      vi.mocked(mockRepository.getQueriesForTestRun).mockResolvedValue([]);

      // Act
      for (const label of labels) {
        await queryConstructor.constructQueriesFromDatabase(testRun, label);
      }

      // Assert
      expect(mockRepository.getQueriesForTestRun).toHaveBeenCalledTimes(3);
      expect(mockRepository.getQueriesForTestRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'Dashboard A'
      );
      expect(mockRepository.getQueriesForTestRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'Dashboard B'
      );
    });
  });
});
