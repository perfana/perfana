import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { adaptWorker } from '../../../workers/adapt.js';
import { AdaptPipeline } from '../../../pipelines/AdaptPipeline.js';
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

// Mock the AdaptPipeline
vi.mock('../../../pipelines/AdaptPipeline.js');

describe('adaptWorker', () => {
  let mockPipeline: any;
  let worker: (job: { data: unknown }) => Promise<JobResult>;

  beforeEach(() => {
    // Create a fresh mock pipeline instance
    mockPipeline = {
      execute: vi.fn(),
    };

    // Mock the AdaptPipeline constructor
    vi.mocked(AdaptPipeline).mockImplementation(() => mockPipeline);

    // Create the worker function
    worker = adaptWorker();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    it('should process ADAPT job successfully with valid data', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1', 'test-run-2'],
        updateControlGroup: true,
        updateControlStatistics: true,
      };

      const mockPipelineResult = {
        success: true,
        duration: 1500,
        data: {
          processedRows: 25,
          testRunIds: 2,
        },
      };

      mockPipeline.execute.mockResolvedValue(mockPipelineResult);

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toBe('ADAPT completed');
      expect(result.data).toEqual(mockPipelineResult.data);
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
      expect(mockPipeline.execute).toHaveBeenCalledTimes(1);
    });

    it('should process ADAPT job with single test run', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
        updateControlGroup: true,
        updateControlStatistics: true,
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 800,
        data: { processedRows: 10, testRunIds: 1 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toBe('ADAPT completed');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });

    it('should process ADAPT job with optional metric filter', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
        updateControlGroup: true,
        updateControlStatistics: true,
        applicationDashboardId: '123e4567-e89b-12d3-a456-426614174000', // Valid UUID
        panelId: 5,
        metricName: 'response_time',
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 500,
        data: { processedRows: 1, testRunIds: 1 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
    });

    it('should process ADAPT job with minimal configuration', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
        // Optional fields use defaults
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 600,
        data: { processedRows: 8, testRunIds: 1 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toBe('ADAPT completed');
    });
  });

  describe('Input Validation', () => {
    it('should reject job with invalid data structure', async () => {
      // Arrange
      const invalidData = {
        testRunIds: 'not-an-array', // Invalid: should be array
      };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with empty testRunIds array', async () => {
      // Arrange
      const invalidData = {
        testRunIds: [], // Invalid: empty array
      };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with null testRunIds', async () => {
      // Arrange
      const invalidData = {
        testRunIds: null,
      };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with non-string testRunIds', async () => {
      // Arrange
      const invalidData = {
        testRunIds: [123, 456], // Invalid: should be strings
      };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with missing required fields', async () => {
      // Arrange
      const invalidData = {}; // Missing testRunIds

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with invalid applicationDashboardId format', async () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-run-1'],
        applicationDashboardId: 'not-a-uuid', // Invalid: should be UUID
      };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });

    it('should reject job with invalid panelId type', async () => {
      // Arrange
      const invalidData = {
        testRunIds: ['test-run-1'],
        panelId: -5, // Invalid: should be positive integer
      };

      // Act & Assert
      await expect(worker({ data: invalidData })).rejects.toThrow();
    });
  });

  describe('Pipeline Failure Scenarios', () => {
    it('should throw error when pipeline fails', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: 'Database connection failed',
      });

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow(
        'ADAPT pipeline failed: Database connection failed'
      );
    });

    it('should throw error when pipeline fails without error message', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: false,
        duration: 1000,
      });

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow(
        'ADAPT pipeline failed: Unknown error'
      );
    });

    it('should propagate pipeline exception', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      const expectedError = new Error('Pipeline execution error');
      mockPipeline.execute.mockRejectedValue(expectedError);

      // Act & Assert
      await expect(worker({ data: jobData })).rejects.toThrow('Pipeline execution error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle pipeline with no processed rows', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 200,
        data: { processedRows: 0, testRunIds: 1 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.data).toEqual({ processedRows: 0, testRunIds: 1 });
    });

    it('should handle pipeline with large number of test runs', async () => {
      // Arrange
      const largeTestRunList = Array.from({ length: 100 }, (_, i) => `test-run-${i}`);
      const jobData = {
        testRunIds: largeTestRunList,
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 30000,
        data: { processedRows: 500, testRunIds: 100 },
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockPipeline.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunIds: largeTestRunList,
        })
      );
    });

    it('should handle pipeline with undefined data field', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 500,
        data: undefined, // No data returned
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toBe('ADAPT completed');
      expect(result.data).toBeUndefined();
    });

    it('should handle boolean flags correctly', async () => {
      // Arrange - test with all boolean combinations
      const testCases = [
        { updateControlGroup: true, updateControlStatistics: true },
        { updateControlGroup: false, updateControlStatistics: false },
        { updateControlGroup: true, updateControlStatistics: false },
        { updateControlGroup: false, updateControlStatistics: true },
      ];

      for (const boolFlags of testCases) {
        const jobData = {
          testRunIds: ['test-run-1'],
          ...boolFlags,
        };

        mockPipeline.execute.mockResolvedValue({
          success: true,
          duration: 500,
          data: { processedRows: 5, testRunIds: 1 },
        });

        // Act
        const result = await worker({ data: jobData });

        // Assert
        expect(result.status).toBe('success');
        expect(mockPipeline.execute).toHaveBeenCalledWith(jobData);
      }
    });
  });

  describe('Job Data Transformation', () => {
    it('should pass job data unchanged to pipeline', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1', 'test-run-2'],
        updateControlGroup: true,
        updateControlStatistics: false,
        applicationDashboardId: '123e4567-e89b-12d3-a456-426614174000',
        panelId: 42,
        metricName: 'cpu_usage',
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 1000,
        data: { processedRows: 10 },
      });

      // Act
      await worker({ data: jobData });

      // Assert
      expect(mockPipeline.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunIds: jobData.testRunIds,
          updateControlGroup: jobData.updateControlGroup,
          updateControlStatistics: jobData.updateControlStatistics,
          applicationDashboardId: jobData.applicationDashboardId,
          panelId: jobData.panelId,
          metricName: jobData.metricName,
        })
      );
    });
  });

  describe('Pipeline Instance Creation', () => {
    it('should create new AdaptPipeline instance with logger', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 500,
        data: {},
      });

      // Act
      await worker({ data: jobData });

      // Assert
      expect(AdaptPipeline).toHaveBeenCalledTimes(1);
      expect(AdaptPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          debug: expect.any(Function),
          trace: expect.any(Function),
        })
      );
    });
  });

  describe('Result Data Structure', () => {
    it('should return correct JobResult structure', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      const mockData = {
        processedRows: 15,
        testRunIds: 1,
        additionalInfo: 'test',
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 1000,
        data: mockData,
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result).toMatchObject({
        status: 'success',
        message: 'ADAPT completed',
        data: mockData,
      });
      expect(result).not.toHaveProperty('errors');
    });

    it('should handle pipeline result with nested data structure', async () => {
      // Arrange
      const jobData = {
        testRunIds: ['test-run-1'],
      };

      const complexData = {
        processedRows: 10,
        testRunIds: 1,
        nestedObject: {
          key1: 'value1',
          key2: 123,
          array: [1, 2, 3],
        },
      };

      mockPipeline.execute.mockResolvedValue({
        success: true,
        duration: 1000,
        data: complexData,
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.data).toEqual(complexData);
    });
  });
});
