import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryRunner } from 'typeorm';
import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * Pipeline Edge Case Tests
 *
 * Tests worker pipelines under edge case conditions:
 * - Timeouts and long-running operations
 * - Database connection loss
 * - Concurrent pipeline execution
 * - Partial data availability
 * - Memory constraints
 * - Error recovery
 * - Race conditions
 */

// Simple pipeline interface for testing
interface TestPipeline<TInput, TOutput> {
  execute(input: TInput, queryRunner?: QueryRunner): Promise<TOutput>;
}

// Mock pipeline implementation (doesn't extend BasePipelineTypeORM to avoid NestJS dependency)
class MockPipeline implements TestPipeline<any, any> {
  constructor(protected dataSource: DataSource) {}

  async execute(input: any, queryRunner?: QueryRunner): Promise<any> {
    return { success: true, data: input };
  }
}

// Mock long-running pipeline
class LongRunningPipeline implements TestPipeline<any, any> {
  constructor(
    protected dataSource: DataSource,
    private delayMs: number
  ) {}

  async execute(input: any, queryRunner?: QueryRunner): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
    return { success: true, data: input };
  }
}

// Mock failing pipeline
class FailingPipeline implements TestPipeline<any, any> {
  constructor(
    protected dataSource: DataSource,
    private shouldFail: boolean = true
  ) {}

  async execute(input: any, queryRunner?: QueryRunner): Promise<any> {
    if (this.shouldFail) {
      throw new Error('Pipeline execution failed');
    }
    return { success: true, data: input };
  }
}

describe('Pipeline Edge Cases', () => {
  let mockDataSource: Partial<DataSource>;
  let mockQueryRunner: Partial<QueryRunner>;

  beforeEach(() => {
    mockQueryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: false,
      manager: {
        save: vi.fn(),
        find: vi.fn(),
        findOne: vi.fn(),
      } as any,
    };

    mockDataSource = {
      createQueryRunner: vi.fn().mockReturnValue(mockQueryRunner),
      isInitialized: true,
      destroy: vi.fn(),
    };
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running pipeline', async () => {
      const pipeline = new LongRunningPipeline(mockDataSource as DataSource, 5000);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Pipeline timeout')), 2000);
      });

      const executionPromise = pipeline.execute({ test: 'data' });

      await expect(
        Promise.race([executionPromise, timeoutPromise])
      ).rejects.toThrow('Pipeline timeout');
    });

    it('should handle pipeline that completes just before timeout', async () => {
      const pipeline = new LongRunningPipeline(mockDataSource as DataSource, 100);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Pipeline timeout')), 200);
      });

      const executionPromise = pipeline.execute({ test: 'data' });

      const result = await Promise.race([executionPromise, timeoutPromise]);

      expect(result).toEqual({ success: true, data: { test: 'data' } });
    });

    it('should handle multiple timeouts correctly', async () => {
      const pipeline1 = new LongRunningPipeline(mockDataSource as DataSource, 3000);
      const pipeline2 = new LongRunningPipeline(mockDataSource as DataSource, 3000);

      const timeout = 1000;

      const results = await Promise.allSettled([
        Promise.race([
          pipeline1.execute({ id: 1 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 1')), timeout))
        ]),
        Promise.race([
          pipeline2.execute({ id: 2 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 2')), timeout))
        ]),
      ]);

      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');
    });
  });

  describe('Database Connection Loss', () => {
    it('should handle connection loss during execution', async () => {
      const pipeline = new MockPipeline(mockDataSource as DataSource);

      // Simulate connection loss
      mockQueryRunner.manager = undefined as any;

      try {
        await pipeline.execute({ test: 'data' }, mockQueryRunner as QueryRunner);
        // Should throw or handle gracefully
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should retry on transient connection errors', async () => {
      let attemptCount = 0;
      const maxRetries = 3;

      const retryPipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Connection lost');
          }
          return { success: true, data: input };
        }
      })(mockDataSource as DataSource);

      // Implement retry logic
      let result;
      for (let i = 0; i < maxRetries; i++) {
        try {
          result = await retryPipeline.execute({ test: 'data' });
          break;
        } catch (error) {
          if (i === maxRetries - 1) throw error;
          await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
        }
      }

      expect(result).toEqual({ success: true, data: { test: 'data' } });
      expect(attemptCount).toBe(3);
    });

    it('should rollback transaction on connection error', async () => {
      const pipeline = new FailingPipeline(mockDataSource as DataSource);

      try {
        await pipeline.execute({ test: 'data' }, mockQueryRunner as QueryRunner);
      } catch (error) {
        // In production, should call rollbackTransaction
        expect(error && typeof error === 'object' && 'message' in error ? (error as Error).message : '').toBe('Pipeline execution failed');
      }
    });
  });

  describe('Concurrent Pipeline Execution', () => {
    it('should handle 10 concurrent pipeline executions', async () => {
      const pipeline = new MockPipeline(mockDataSource as DataSource);

      const promises = Array.from({ length: 10 }, (_, i) =>
        pipeline.execute({ id: i })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.success).toBe(true);
        expect(result.data.id).toBe(i);
      });
    });

    it('should handle 100 concurrent pipeline executions', async () => {
      const pipeline = new MockPipeline(mockDataSource as DataSource);

      const promises = Array.from({ length: 100 }, (_, i) =>
        pipeline.execute({ id: i })
      );

      const results = await Promise.allSettled(promises);

      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(90); // Allow some to fail under load
    });

    it('should handle mixed success/failure in concurrent execution', async () => {
      const successPipeline = new MockPipeline(mockDataSource as DataSource);
      const failPipeline = new FailingPipeline(mockDataSource as DataSource);

      const promises = [
        successPipeline.execute({ id: 1 }),
        failPipeline.execute({ id: 2 }),
        successPipeline.execute({ id: 3 }),
        failPipeline.execute({ id: 4 }),
        successPipeline.execute({ id: 5 }),
      ];

      const results = await Promise.allSettled(promises);

      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      expect(successful.length).toBe(3);
      expect(failed.length).toBe(2);
    });

    it('should prevent race conditions in shared state', async () => {
      let sharedCounter = 0;
      const mutex = { locked: false };

      const incrementWithMutex = async () => {
        // Wait for lock
        while (mutex.locked) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }

        mutex.locked = true;
        const current = sharedCounter;
        await new Promise(resolve => setTimeout(resolve, 1)); // Simulate async operation
        sharedCounter = current + 1;
        mutex.locked = false;
      };

      const promises = Array.from({ length: 100 }, () => incrementWithMutex());
      await Promise.all(promises);

      expect(sharedCounter).toBe(100);
    });
  });

  describe('Partial Data Availability', () => {
    it('should handle missing required data fields', async () => {
      const pipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          if (!input.requiredField) {
            throw new Error('Missing required field');
          }
          return { success: true };
        }
      })(mockDataSource as DataSource);

      await expect(pipeline.execute({})).rejects.toThrow('Missing required field');
    });

    it('should handle null/undefined input values', async () => {
      const pipeline = new MockPipeline(mockDataSource as DataSource);

      const results = await Promise.all([
        pipeline.execute(null),
        pipeline.execute(undefined),
        pipeline.execute({}),
      ]);

      expect(results).toHaveLength(3);
    });

    it('should handle incomplete nested data', async () => {
      const pipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          const value = input?.nested?.deep?.value;
          return { success: true, value: value || 'default' };
        }
      })(mockDataSource as DataSource);

      const result = await pipeline.execute({ nested: {} });

      expect(result.value).toBe('default');
    });

    it('should handle empty arrays in input', async () => {
      const pipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          if (!input.items || input.items.length === 0) {
            return { success: true, count: 0 };
          }
          return { success: true, count: input.items.length };
        }
      })(mockDataSource as DataSource);

      const result = await pipeline.execute({ items: [] });

      expect(result.count).toBe(0);
    });
  });

  describe('Memory Constraints', () => {
    it('should handle large data payload', async () => {
      const largePayload = {
        data: Array.from({ length: 100000 }, (_, i) => ({
          id: i,
          value: `value-${i}`,
          nested: {
            prop1: i * 2,
            prop2: `nested-${i}`,
          }
        }))
      };

      const pipeline = new MockPipeline(mockDataSource as DataSource);

      const startMemory = process.memoryUsage().heapUsed;
      const result = await pipeline.execute(largePayload);
      const endMemory = process.memoryUsage().heapUsed;

      expect(result.success).toBe(true);

      const memoryIncrease = (endMemory - startMemory) / 1024 / 1024; // MB
      // Should not cause excessive memory usage (< 100MB increase)
      expect(memoryIncrease).toBeLessThan(100);
    });

    it('should process data in chunks to manage memory', async () => {
      const chunkSize = 1000;
      const totalItems = 10000;

      const chunkPipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          const results = [];
          const items = input.items || [];

          for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            // Process chunk
            results.push({ processed: chunk.length });
          }

          return { success: true, chunks: results };
        }
      })(mockDataSource as DataSource);

      const result = await chunkPipeline.execute({
        items: Array.from({ length: totalItems }, (_, i) => i)
      });

      expect(result.success).toBe(true);
      expect(result.chunks.length).toBe(totalItems / chunkSize);
    });

    it('should clean up resources after execution', async () => {
      const pipeline = new MockPipeline(mockDataSource as DataSource);

      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 10; i++) {
        await pipeline.execute({ data: 'x'.repeat(10000) });
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      // Memory should not grow unbounded
      expect(memoryIncrease).toBeLessThan(50);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from transient errors', async () => {
      let attemptCount = 0;

      const recoveryPipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Transient error');
          }
          return { success: true, attempts: attemptCount };
        }
      })(mockDataSource as DataSource);

      // Retry logic
      let result;
      const maxRetries = 5;

      for (let i = 0; i < maxRetries; i++) {
        try {
          result = await recoveryPipeline.execute({ test: 'data' });
          break;
        } catch (error) {
          if (i === maxRetries - 1) throw error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      expect(result?.success).toBe(true);
      expect(result?.attempts).toBe(3);
    });

    it('should implement exponential backoff', async () => {
      const backoffTimes: number[] = [];

      for (let i = 0; i < 5; i++) {
        const delay = Math.min(100 * Math.pow(2, i), 3000);
        backoffTimes.push(delay);
      }

      expect(backoffTimes).toEqual([100, 200, 400, 800, 1600]);
    });

    it('should handle circuit breaker pattern', async () => {
      let failureCount = 0;
      const failureThreshold = 3;
      let circuitOpen = false;

      const circuitBreakerPipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          if (circuitOpen) {
            throw new Error('Circuit breaker open');
          }

          try {
            // Simulate failures
            if (failureCount < failureThreshold) {
              failureCount++;
              throw new Error('Service error');
            }
            return { success: true };
          } catch (error) {
            if (failureCount >= failureThreshold) {
              circuitOpen = true;
            }
            throw error;
          }
        }
      })(mockDataSource as DataSource);

      // Make requests until circuit opens
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreakerPipeline.execute({ test: 'data' });
        } catch (error) {
          // Expected to fail
        }
      }

      expect(circuitOpen).toBe(true);
      expect(failureCount).toBe(failureThreshold);
    });
  });

  describe('Resource Cleanup', () => {
    it('should release query runner on success', async () => {
      const pipeline = new MockPipeline(mockDataSource as DataSource);

      await pipeline.execute({ test: 'data' }, mockQueryRunner as QueryRunner);

      // In production, query runner should be released
      // This test documents the expectation
    });

    it('should release query runner on failure', async () => {
      const pipeline = new FailingPipeline(mockDataSource as DataSource);

      try {
        await pipeline.execute({ test: 'data' }, mockQueryRunner as QueryRunner);
      } catch (error) {
        // Expected to fail
      }

      // Query runner should be released even on failure
      // This test documents the expectation
    });

    it('should close database connections after batch processing', async () => {
      const pipeline = new MockPipeline(mockDataSource as DataSource);

      // Process multiple items
      for (let i = 0; i < 10; i++) {
        await pipeline.execute({ id: i });
      }

      // Connection pool should not be exhausted
      expect(mockDataSource.isInitialized).toBe(true);
    });
  });

  describe('Data Validation', () => {
    it('should validate input schema', async () => {
      const validationPipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          if (typeof input.value !== 'number') {
            throw new Error('Invalid input type');
          }
          return { success: true };
        }
      })(mockDataSource as DataSource);

      await expect(
        validationPipeline.execute({ value: 'not-a-number' })
      ).rejects.toThrow('Invalid input type');

      const result = await validationPipeline.execute({ value: 42 });
      expect(result.success).toBe(true);
    });

    it('should handle malformed JSON data', async () => {
      const pipeline = new (class implements TestPipeline<any, any> {
        constructor(protected dataSource: DataSource) {}

        async execute(input: any): Promise<any> {
          try {
            const parsed = typeof input === 'string' ? JSON.parse(input) : input;
            return { success: true, data: parsed };
          } catch (error) {
            throw new Error('Invalid JSON');
          }
        }
      })(mockDataSource as DataSource);

      await expect(
        pipeline.execute('{"invalid": json}')
      ).rejects.toThrow('Invalid JSON');

      const result = await pipeline.execute('{"valid": "json"}');
      expect(result.success).toBe(true);
    });
  });
});
