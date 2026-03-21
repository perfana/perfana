import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { checksWorker } from '../../../workers/checks.js';
import { metricsCollectionWorker } from '../../../workers/metrics.js';
import { controlGroupsWorker } from '../../../workers/control-groups.js';
import { statisticsWorker } from '../../../workers/statistics.js';
import { ChecksPipeline } from '../../../pipelines/ChecksPipeline.js';
import { MetricsPipeline } from '../../../pipelines/MetricsPipeline.js';
import { ControlGroupsPipeline } from '../../../pipelines/ControlGroupsPipeline.js';
import { StatisticsPipeline } from '../../../pipelines/StatisticsPipeline.js';
import type { JobResult } from '../../../types/jobs.js';

// Mock the logger
vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  })),
}));

// Mock all pipelines
vi.mock('../../../pipelines/ChecksPipeline.js');
vi.mock('../../../pipelines/MetricsPipeline.js');
vi.mock('../../../pipelines/ControlGroupsPipeline.js');
vi.mock('../../../pipelines/StatisticsPipeline.js');

describe('checksWorker', () => {
  let mockPipeline: any;
  let worker: (job: { data: unknown }) => Promise<JobResult>;

  beforeEach(() => {
    mockPipeline = { execute: vi.fn() };
    vi.mocked(ChecksPipeline).mockImplementation(() => mockPipeline);
    worker = checksWorker();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    it('should process checks job successfully', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1', 'test-run-2'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 2000,
        data: { checksEvaluated: 25, checksPassed: 20, checksFailed: 5 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toBe('Checks completed');
      expect(result.data).toEqual({ checksEvaluated: 25, checksPassed: 20, checksFailed: 5 });
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });

    it('should process checks job with optional filters', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
        applicationDashboardId: '123e4567-e89b-12d3-a456-426614174000',
        panelId: 42,
        metricName: 'response_time',
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 1500,
        data: { checksEvaluated: 1 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });
  });

  describe('Input Validation', () => {
    it('should reject job with empty testRunIds array', async () => {
      // Arrange
      const invalidData = { testRunIds: [] };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with non-string testRunIds', async () => {
      // Arrange
      const invalidData = { testRunIds: [123, 456] };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with invalid UUID format', async () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-run-1'],
        applicationDashboardId: 'not-a-uuid',
      };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with invalid panelId', async () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-run-1'],
        panelId: -5,
      };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });
  });

  describe('Pipeline Failure Scenarios', () => {
    it('should throw error when pipeline fails', async () => {
      // Arrange
      const jobData = { testRunIds: ['test-run-1'] };

      mockPipeline.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Database error', code: 'DB_ERROR' },
      });

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow(
        'Checks pipeline failed: [object Object]'
      );
    });

    it('should propagate pipeline exception', async () => {
      // Arrange
      const jobData = { testRunIds: ['test-run-1'] };
      mockPipeline.execute.mockRejectedValue(new Error('Pipeline crash'));

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow('Pipeline crash');
    });
  });
});

describe('metricsCollectionWorker', () => {
  let mockPipeline: any;
  let worker: (job: { data: unknown }) => Promise<JobResult>;

  beforeEach(() => {
    mockPipeline = { execute: vi.fn() };
    vi.mocked(MetricsPipeline).mockImplementation(() => mockPipeline);
    worker = metricsCollectionWorker();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    it('should process metrics collection job successfully', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-123',
        benchmarksOnly: false,
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 8000,
        data: { metricsCollected: 150, panelsProcessed: 12 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toBe('Metrics collection completed for test run test-run-123');
      expect(result.data).toEqual({ metricsCollected: 150, panelsProcessed: 12 });
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });

    it('should process benchmarks only job', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-456',
        benchmarksOnly: true,
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 3000,
        data: { metricsCollected: 25 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });

    it('should process job with panel documents', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-789',
        benchmarksOnly: false,
        panelDocuments: [{ id: 1, type: 'graph' }, { id: 2, type: 'table' }],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 5000,
        data: { metricsCollected: 50 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });
  });

  describe('Input Validation', () => {
    it('should reject job with missing testRunId', async () => {
      // Arrange
      const invalidData = { benchmarksOnly: false };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with invalid testRunId type', async () => {
      // Arrange
      const invalidData = { testRunId: 123, benchmarksOnly: false };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with invalid benchmarksOnly type', async () => {
      // Arrange
      const invalidData = { testRunId: 'test-1', benchmarksOnly: 'yes' };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });
  });

  describe('Pipeline Failure Scenarios', () => {
    it('should throw error when pipeline fails', async () => {
      // Arrange
      const jobData = { testRunId: 'test-run-1', benchmarksOnly: false };

      mockPipeline.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Grafana API error', code: 'API_ERROR' },
      });

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow('Metrics collection failed');
    });

    it('should propagate pipeline exception', async () => {
      // Arrange
      const jobData = { testRunId: 'test-run-1', benchmarksOnly: false };
      mockPipeline.execute.mockRejectedValue(new Error('Connection timeout'));

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow('Connection timeout');
    });
  });

  describe('Default Values', () => {
    it('should use default for benchmarksOnly when not provided', async () => {
      // Arrange
      const jobData = { testRunId: 'test-run-1' };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 5000,
        data: {},
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      // Schema provides default: false
      expect(mockPipeline.execute).toHaveBeenCalledWith(
        expect.objectContaining({ testRunId: 'test-run-1', benchmarksOnly: false })
      );
    });
  });
});

describe('controlGroupsWorker', () => {
  let mockPipeline: any;
  let worker: (job: { data: unknown }) => Promise<JobResult>;

  beforeEach(() => {
    mockPipeline = { execute: vi.fn() };
    vi.mocked(ControlGroupsPipeline).mockImplementation(() => mockPipeline);
    worker = controlGroupsWorker();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    it('should process control groups job successfully', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1', 'test-run-2', 'test-run-3'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 4000,
        data: { controlGroupsCreated: 15, testRunsProcessed: 3 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toBe('Control groups completed');
      expect(result.data).toEqual({ controlGroupsCreated: 15, testRunsProcessed: 3 });
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });

    it('should process single test run', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 2000,
        data: { controlGroupsCreated: 5 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });
  });

  describe('Input Validation', () => {
    it('should reject job with empty testRunIds array', async () => {
      // Arrange
      const invalidData = { testRunIds: [] };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with non-array testRunIds', async () => {
      // Arrange
      const invalidData = { testRunIds: 'test-run-1' };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with null testRunIds', async () => {
      // Arrange
      const invalidData = { testRunIds: null };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });
  });

  describe('Pipeline Failure Scenarios', () => {
    it('should throw error when pipeline fails', async () => {
      // Arrange
      const jobData = { testRunIds: ['test-run-1'] };

      mockPipeline.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Control group selection failed', code: 'SELECTION_ERROR' },
      });

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow('Control groups pipeline failed');
    });

    it('should propagate pipeline exception', async () => {
      // Arrange
      const jobData = { testRunIds: ['test-run-1'] };
      mockPipeline.execute.mockRejectedValue(new Error('Database transaction failed'));

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow('Database transaction failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle large batch of test runs', async () => {
      // Arrange
      const largeTestRunList = Array.from({ length: 100 }, (_, i) => `test-run-${i}`);
      const jobData = {
        testRunIds: largeTestRunList,
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 20000,
        data: { controlGroupsCreated: 500 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });
  });
});

describe('statisticsWorker', () => {
  let mockPipeline: any;
  let worker: (job: { data: unknown }) => Promise<JobResult>;

  beforeEach(() => {
    mockPipeline = { execute: vi.fn() };
    vi.mocked(StatisticsPipeline).mockImplementation(() => mockPipeline);
    worker = statisticsWorker();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    it('should process statistics job successfully', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1', 'test-run-2'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 5000,
        data: {
          statisticsCalculated: 300,
          metricsProcessed: 150,
          aggregations: ['mean', 'median', 'q95', 'q99'],
        },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toBe('Statistics completed');
      expect(result.data).toEqual({
        statisticsCalculated: 300,
        metricsProcessed: 150,
        aggregations: ['mean', 'median', 'q95', 'q99'],
      });
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });

    it('should process single test run statistics', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 3000,
        data: { statisticsCalculated: 150 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });
  });

  describe('Input Validation', () => {
    it('should reject job with empty testRunIds array', async () => {
      // Arrange
      const invalidData = { testRunIds: [] };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with missing testRunIds', async () => {
      // Arrange
      const invalidData = {};

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with non-string testRunIds elements', async () => {
      // Arrange
      const invalidData = { testRunIds: ['test-run-1', 123, 'test-run-3'] };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });
  });

  describe('Pipeline Failure Scenarios', () => {
    it('should throw error when pipeline fails', async () => {
      // Arrange
      const jobData = { testRunIds: ['test-run-1'] };

      mockPipeline.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Calculation error', code: 'CALC_ERROR' },
      });

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow('Statistics pipeline failed');
    });

    it('should propagate pipeline exception', async () => {
      // Arrange
      const jobData = { testRunIds: ['test-run-1'] };
      mockPipeline.execute.mockRejectedValue(new Error('Insufficient data'));

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow('Insufficient data');
    });
  });

  describe('Performance Tests', () => {
    it('should handle statistics calculation for large datasets', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-large'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 15000,
        data: { statisticsCalculated: 10000, metricsProcessed: 5000 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.data.statisticsCalculated).toBe(10000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle pipeline with no data returned', async () => {
      // Arrange
      const jobData = { testRunIds: ['test-run-1'] };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 1000,
        data: undefined,
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.data).toBeUndefined();
    });

    it('should handle batch processing', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-1', 'test-2', 'test-3', 'test-4', 'test-5'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 8000,
        data: { statisticsCalculated: 750, testRunsProcessed: 5 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });
  });
});

describe('Worker Pattern Consistency', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  it('all workers should follow the same error handling pattern', async () => {
    // This test ensures consistency across all simple workers
    const workers = [
      { name: 'checks', fn: checksWorker(), data: { testRunIds: ['test-1'] } },
      { name: 'metrics', fn: metricsCollectionWorker(), data: { testRunId: 'test-1' } },
      { name: 'control-groups', fn: controlGroupsWorker(), data: { testRunIds: ['test-1'] } },
      { name: 'statistics', fn: statisticsWorker(), data: { testRunIds: ['test-1'] } },
    ];

    for (const worker of workers) {
      // Each worker should reject invalid data
      await expect(worker.fn({ data: null })).rejects.toThrow();
      await expect(worker.fn({ data: {} })).rejects.toThrow();
    }
  });
});
