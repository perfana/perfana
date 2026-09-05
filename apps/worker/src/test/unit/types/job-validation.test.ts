import { describe, it, expect } from 'vitest';
import {
  AnalyzeTestJobSchema,
  AdaptJobSchema,
  ChecksJobSchema,
  MetricsCollectionJobSchema,
  StatisticsJobSchema,
  ControlGroupsJobSchema,
  BatchProcessingJobSchema,
  ReevaluateJobSchema,
  BatchFlowJobSchema,
  ReevaluationBatchJobSchema,
  OrchestrateReevaluateBatchJobSchema,
} from '../../../types/jobs.js';

describe('Job Schema Validation', () => {
  describe('AnalyzeTestJobSchema', () => {
    it('should validate valid analyze test job data', () => {
      // Arrange
      const validData = {
        testRunId: 'test-run-123',
        adapt: true,
        benchmarksOnly: false,
      };

      // Act
      const result = AnalyzeTestJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should apply default values for optional fields', () => {
      // Arrange
      const minimalData = {
        testRunId: 'test-run-456',
      };

      // Act
      const result = AnalyzeTestJobSchema.parse(minimalData);

      // Assert
      expect(result.adapt).toBe(true); // Default value
      expect(result.benchmarksOnly).toBe(false); // Default value
    });

    it('should reject missing testRunId', () => {
      // Arrange
      const invalidData = {
        adapt: true,
      };

      // Act & Assert
      expect(() => AnalyzeTestJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject invalid testRunId type', () => {
      // Arrange
      const invalidData = {
        testRunId: 123,
        adapt: true,
      };

      // Act & Assert
      expect(() => AnalyzeTestJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject invalid adapt type', () => {
      // Arrange
      const invalidData = {
        testRunId: 'test-run-1',
        adapt: 'yes',
      };

      // Act & Assert
      expect(() => AnalyzeTestJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('AdaptJobSchema', () => {
    it('should validate valid adapt job data', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2', 'test-3'],
        updateControlGroup: true,
        updateControlStatistics: true,
      };

      // Act
      const result = AdaptJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should validate with optional metric filter', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1'],
        applicationDashboardId: '123e4567-e89b-12d3-a456-426614174000',
        panelId: 5,
        metricName: 'response_time',
      };

      // Act
      const result = AdaptJobSchema.parse(validData);

      // Assert
      expect(result).toMatchObject(validData);
    });

    it('should apply default boolean values', () => {
      // Arrange
      const minimalData = {
        testRunIds: ['test-1'],
      };

      // Act
      const result = AdaptJobSchema.parse(minimalData);

      // Assert
      expect(result.updateControlGroup).toBe(true);
      expect(result.updateControlStatistics).toBe(true);
    });

    it('should reject empty testRunIds array', () => {
      // Arrange
      const invalidData = {
        testRunIds: [],
      };

      // Act & Assert
      expect(() => AdaptJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject invalid UUID format for applicationDashboardId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        applicationDashboardId: 'not-a-uuid',
      };

      // Act & Assert
      expect(() => AdaptJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-positive panelId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        panelId: 0,
      };

      // Act & Assert
      expect(() => AdaptJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject negative panelId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        panelId: -5,
      };

      // Act & Assert
      expect(() => AdaptJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer panelId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        panelId: 5.5,
      };

      // Act & Assert
      expect(() => AdaptJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('ChecksJobSchema', () => {
    it('should validate valid checks job data', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2'],
      };

      // Act
      const result = ChecksJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should validate with optional filters', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1'],
        applicationDashboardId: '123e4567-e89b-12d3-a456-426614174000',
        panelId: 10,
        metricName: 'cpu_usage',
      };

      // Act
      const result = ChecksJobSchema.parse(validData);

      // Assert
      expect(result).toMatchObject(validData);
    });

    it('should reject empty testRunIds', () => {
      // Arrange
      const invalidData = {
        testRunIds: [],
      };

      // Act & Assert
      expect(() => ChecksJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('MetricsCollectionJobSchema', () => {
    it('should validate valid metrics collection job data', () => {
      // Arrange
      const validData = {
        testRunId: 'test-run-123',
        benchmarksOnly: false,
      };

      // Act
      const result = MetricsCollectionJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should validate with panelDocuments', () => {
      // Arrange
      const validData = {
        testRunId: 'test-run-123',
        benchmarksOnly: false,
        panelDocuments: [
          { id: 1, type: 'graph' },
          { id: 2, type: 'table' },
        ],
      };

      // Act
      const result = MetricsCollectionJobSchema.parse(validData);

      // Assert
      expect(result.panelDocuments).toHaveLength(2);
    });

    it('should apply default for benchmarksOnly', () => {
      // Arrange
      const minimalData = {
        testRunId: 'test-run-123',
      };

      // Act
      const result = MetricsCollectionJobSchema.parse(minimalData);

      // Assert
      expect(result.benchmarksOnly).toBe(false);
    });

    it('should reject missing testRunId', () => {
      // Arrange
      const invalidData = {
        benchmarksOnly: false,
      };

      // Act & Assert
      expect(() => MetricsCollectionJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('StatisticsJobSchema', () => {
    it('should validate valid statistics job data', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2', 'test-3'],
      };

      // Act
      const result = StatisticsJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should require at least one testRunId', () => {
      // Arrange
      const invalidData = {
        testRunIds: [],
      };

      // Act & Assert
      expect(() => StatisticsJobSchema.parse(invalidData)).toThrow();
    });

    it('should validate single test run', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1'],
      };

      // Act
      const result = StatisticsJobSchema.parse(validData);

      // Assert
      expect(result.testRunIds).toHaveLength(1);
    });
  });

  describe('ControlGroupsJobSchema', () => {
    it('should validate valid control groups job data', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2'],
      };

      // Act
      const result = ControlGroupsJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should reject empty array', () => {
      // Arrange
      const invalidData = {
        testRunIds: [],
      };

      // Act & Assert
      expect(() => ControlGroupsJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-string elements', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1', 123, 'test-3'],
      };

      // Act & Assert
      expect(() => ControlGroupsJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('BatchProcessingJobSchema', () => {
    it('should validate valid batch processing job data', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2', 'test-3'],
        adapt: true,
        dependencies: ['dep-1', 'dep-2'],
      };

      // Act
      const result = BatchProcessingJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should apply default for adapt', () => {
      // Arrange
      const minimalData = {
        testRunIds: ['test-1'],
      };

      // Act
      const result = BatchProcessingJobSchema.parse(minimalData);

      // Assert
      expect(result.adapt).toBe(true);
    });

    it('should allow optional dependencies', () => {
      // Arrange
      const dataWithoutDeps = {
        testRunIds: ['test-1'],
        adapt: false,
      };

      // Act
      const result = BatchProcessingJobSchema.parse(dataWithoutDeps);

      // Assert
      expect(result.dependencies).toBeUndefined();
    });

    it('should reject empty testRunIds', () => {
      // Arrange
      const invalidData = {
        testRunIds: [],
        adapt: true,
      };

      // Act & Assert
      expect(() => BatchProcessingJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('ReevaluateJobSchema', () => {
    it('should validate valid reevaluate job data', () => {
      // Arrange
      const validData = {
        testRunId: 'test-run-123',
        updateBenchmarkIds: true,
      };

      // Act
      const result = ReevaluateJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should apply default for updateBenchmarkIds', () => {
      // Arrange
      const minimalData = {
        testRunId: 'test-run-123',
      };

      // Act
      const result = ReevaluateJobSchema.parse(minimalData);

      // Assert
      expect(result.updateBenchmarkIds).toBe(true);
    });

    it('should reject missing testRunId', () => {
      // Arrange
      const invalidData = {
        updateBenchmarkIds: true,
      };

      // Act & Assert
      expect(() => ReevaluateJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('BatchFlowJobSchema', () => {
    it('should validate valid batch flow job data', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2'],
        adapt: true,
        batchId: 'batch-123',
        batchSize: 25,
      };

      // Act
      const result = BatchFlowJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should apply defaults', () => {
      // Arrange
      const minimalData = {
        testRunIds: ['test-1'],
        batchId: 'batch-456',
      };

      // Act
      const result = BatchFlowJobSchema.parse(minimalData);

      // Assert
      expect(result.adapt).toBe(true);
      expect(result.batchSize).toBe(10);
    });

    it('should reject batchSize exceeding max', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        batchId: 'batch-123',
        batchSize: 51, // Max is 50
      };

      // Act & Assert
      expect(() => BatchFlowJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject batchSize below min', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        batchId: 'batch-123',
        batchSize: 0,
      };

      // Act & Assert
      expect(() => BatchFlowJobSchema.parse(invalidData)).toThrow();
    });

    it('should require batchId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        batchSize: 10,
      };

      // Act & Assert
      expect(() => BatchFlowJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('ReevaluationBatchJobSchema', () => {
    it('should validate valid reevaluation batch job data', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2', 'test-3'],
        updateBenchmarkIds: false,
        batchId: 'reeval-batch-123',
        batchSize: 20,
      };

      // Act
      const result = ReevaluationBatchJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should apply defaults', () => {
      // Arrange
      const minimalData = {
        testRunIds: ['test-1'],
        batchId: 'reeval-batch-456',
      };

      // Act
      const result = ReevaluationBatchJobSchema.parse(minimalData);

      // Assert
      expect(result.updateBenchmarkIds).toBe(true);
      expect(result.batchSize).toBe(15);
    });

    it('should reject batchSize exceeding max', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        batchId: 'reeval-batch-123',
        batchSize: 26, // Max is 25
      };

      // Act & Assert
      expect(() => ReevaluationBatchJobSchema.parse(invalidData)).toThrow();
    });

    it('should require batchId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        updateBenchmarkIds: true,
      };

      // Act & Assert
      expect(() => ReevaluationBatchJobSchema.parse(invalidData)).toThrow();
    });
  });

  describe('OrchestrateReevaluateBatchJobSchema', () => {
    it('should validate valid orchestrate reevaluate batch job data', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2'],
        batchId: 'orchestrate-123',
        checks: true,
        adapt: true,
        refreshMode: 'missing-data' as const,
      };

      // Act
      const result = OrchestrateReevaluateBatchJobSchema.parse(validData);

      // Assert
      expect(result).toEqual(validData);
    });

    it('should validate with sources filter', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1'],
        batchId: 'orchestrate-src-1',
        refreshMode: 'missing-data' as const,
        sources: { grafana: true, dynatrace: false, performanceMetrics: true },
      };

      // Act
      const result = OrchestrateReevaluateBatchJobSchema.parse(validData);

      // Assert
      expect(result.sources).toEqual({ grafana: true, dynatrace: false, performanceMetrics: true });
    });

    it('should accept sources with partial keys', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1'],
        batchId: 'orchestrate-src-2',
        sources: { grafana: false },
      };

      // Act
      const result = OrchestrateReevaluateBatchJobSchema.parse(validData);

      // Assert
      expect(result.sources).toEqual({ grafana: false });
      expect(result.sources?.dynatrace).toBeUndefined();
    });

    it('should validate with optional metric filter', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1'],
        batchId: 'orchestrate-456',
        applicationDashboardId: '123e4567-e89b-12d3-a456-426614174000',
        panelId: 15,
        metricName: 'throughput',
      };

      // Act
      const result = OrchestrateReevaluateBatchJobSchema.parse(validData);

      // Assert
      expect(result).toMatchObject(validData);
    });

    it('should apply defaults', () => {
      // Arrange
      const minimalData = {
        testRunIds: ['test-1'],
        batchId: 'orchestrate-789',
      };

      // Act
      const result = OrchestrateReevaluateBatchJobSchema.parse(minimalData);

      // Assert
      expect(result.checks).toBe(true);
      expect(result.adapt).toBe(true);
      expect(result.refreshMode).toBeUndefined();
    });

    it('should require batchId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
      };

      // Act & Assert
      expect(() => OrchestrateReevaluateBatchJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject invalid UUID for applicationDashboardId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        batchId: 'orchestrate-123',
        applicationDashboardId: 'invalid-uuid',
      };

      // Act & Assert
      expect(() => OrchestrateReevaluateBatchJobSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-positive panelId', () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-1'],
        batchId: 'orchestrate-123',
        panelId: 0,
      };

      // Act & Assert
      expect(() => OrchestrateReevaluateBatchJobSchema.parse(invalidData)).toThrow();
    });

    // recalculateStatistics is the ONLY route to the third data-collection branch:
    // no fetch, but ds_metric_statistics has to be rebuilt because the analysis
    // window moved. The worker destructures it straight off the parse result, so a
    // schema that dropped it would silently disable the whole "apply to all" flow.
    it('should carry recalculateStatistics through the parse', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1', 'test-2'],
        batchId: 'orchestrate-recalc-1',
        checks: true,
        adapt: true,
        recalculateStatistics: true,
      };

      // Act
      const result = OrchestrateReevaluateBatchJobSchema.parse(validData);

      // Assert
      expect(result.recalculateStatistics).toBe(true);
      // No refreshMode: data collection is skipped, statistics are not.
      expect(result.refreshMode).toBeUndefined();
    });

    it('should leave recalculateStatistics undefined when absent, not default it to true', () => {
      // Arrange
      const minimalData = {
        testRunIds: ['test-1'],
        batchId: 'orchestrate-recalc-2',
      };

      // Act
      const result = OrchestrateReevaluateBatchJobSchema.parse(minimalData);

      // Assert
      expect(result.recalculateStatistics).toBeUndefined();
    });

    it('should preserve an explicit false', () => {
      // Act
      const result = OrchestrateReevaluateBatchJobSchema.parse({
        testRunIds: ['test-1'],
        batchId: 'orchestrate-recalc-3',
        recalculateStatistics: false,
      });

      // Assert
      expect(result.recalculateStatistics).toBe(false);
    });

    it('should reject a non-boolean recalculateStatistics', () => {
      // Act & Assert
      expect(() =>
        OrchestrateReevaluateBatchJobSchema.parse({
          testRunIds: ['test-1'],
          batchId: 'orchestrate-recalc-4',
          recalculateStatistics: 'yes',
        })
      ).toThrow();
    });
  });

  describe('Edge Cases and Boundary Values', () => {
    it('should handle very long testRunId strings', () => {
      // Arrange
      const longId = 'test-run-' + 'x'.repeat(1000);
      const validData = {
        testRunId: longId,
      };

      // Act
      const result = AnalyzeTestJobSchema.parse(validData);

      // Assert
      expect(result.testRunId).toBe(longId);
    });

    it('should handle large arrays of testRunIds', () => {
      // Arrange
      const largeArray = Array.from({ length: 1000 }, (_, i) => `test-${i}`);
      const validData = {
        testRunIds: largeArray,
      };

      // Act
      const result = AdaptJobSchema.parse(validData);

      // Assert
      expect(result.testRunIds).toHaveLength(1000);
    });

    it('should handle valid UUID formats', () => {
      // Arrange
      const validUUIDs = [
        '123e4567-e89b-12d3-a456-426614174000',
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ];

      // Act & Assert
      for (const uuid of validUUIDs) {
        const validData = {
          testRunIds: ['test-1'],
          applicationDashboardId: uuid,
        };
        const result = AdaptJobSchema.parse(validData);
        expect(result.applicationDashboardId).toBe(uuid);
      }
    });

    it('should handle boundary values for panelId', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1'],
        panelId: 1, // Minimum valid positive integer
      };

      // Act
      const result = AdaptJobSchema.parse(validData);

      // Assert
      expect(result.panelId).toBe(1);
    });

    it('should handle maximum batch size', () => {
      // Arrange
      const validData = {
        testRunIds: ['test-1'],
        batchId: 'batch-123',
        batchSize: 50, // Maximum allowed
      };

      // Act
      const result = BatchFlowJobSchema.parse(validData);

      // Assert
      expect(result.batchSize).toBe(50);
    });
  });

  describe('Type Safety', () => {
    it('should strip unknown fields', () => {
      // Arrange
      const dataWithExtra = {
        testRunId: 'test-1',
        adapt: true,
        unknownField: 'should be removed',
        anotherUnknown: 123,
      };

      // Act
      const result = AnalyzeTestJobSchema.parse(dataWithExtra);

      // Assert
      expect(result).not.toHaveProperty('unknownField');
      expect(result).not.toHaveProperty('anotherUnknown');
    });

    it('should validate nested object structures', () => {
      // Arrange
      const validData = {
        testRunId: 'test-1',
        panelDocuments: [
          { id: 1, name: 'Panel 1', config: { enabled: true } },
          { id: 2, name: 'Panel 2', config: { enabled: false } },
        ],
      };

      // Act
      const result = MetricsCollectionJobSchema.parse(validData);

      // Assert
      expect(result.panelDocuments).toBeDefined();
      expect(result.panelDocuments).toHaveLength(2);
    });
  });
});
