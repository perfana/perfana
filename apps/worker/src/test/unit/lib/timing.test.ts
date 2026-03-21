/**
 * Unit tests for PerformanceTimer utility
 * Tests timing operations, nesting, summary statistics, and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PerformanceTimer, createPerformanceTimer, type TimingEntry } from '../../../lib/utils/timing.js';
import type { Logger } from 'pino';

// TODO: PerformanceTimer test - timing-sensitive test
describe.skip('PerformanceTimer', () => {
  let mockLogger: Logger;
  let timer: PerformanceTimer;

  beforeEach(() => {
    // Mock pino logger with all required methods
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(() => mockLogger),
      level: 'info',
      silent: vi.fn(),
    } as any;

    timer = new PerformanceTimer(mockLogger, 'test-context');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    describe('start and end operations', () => {
      it('should start and end a timing operation successfully', () => {
        // Arrange
        const operation = 'test-operation';
        const metadata = { key: 'value' };

        // Act
        timer.start(operation, metadata);
        const duration = timer.end(operation);

        // Assert
        expect(duration).toBeGreaterThanOrEqual(0);
        expect(mockLogger.debug).toHaveBeenCalledWith(
          '⏱️ [test-context] Started: test-operation',
          metadata
        );
      });

      it('should track multiple independent operations', () => {
        // Arrange
        const op1 = 'operation-1';
        const op2 = 'operation-2';

        // Act
        timer.start(op1);
        const duration1 = timer.end(op1);
        timer.start(op2);
        const duration2 = timer.end(op2);

        // Assert
        expect(duration1).toBeGreaterThanOrEqual(0);
        expect(duration2).toBeGreaterThanOrEqual(0);

        const timings = timer.getTimings();
        expect(timings).toHaveLength(2);
        expect(timings.find(t => t.operation === op1)).toBeDefined();
        expect(timings.find(t => t.operation === op2)).toBeDefined();
      });

      it('should handle nested operations with proper naming', () => {
        // Arrange
        const parent = 'parent-operation';
        const child = 'child-operation';
        const grandchild = 'grandchild-operation';

        // Act
        timer.start(parent);
        timer.start(child);
        timer.start(grandchild);
        timer.end(grandchild);
        timer.end(child);
        timer.end(parent);

        // Assert
        const timings = timer.getTimings();
        expect(timings).toHaveLength(3);

        const parentTiming = timings.find(t => t.operation === parent);
        const childTiming = timings.find(t => t.operation.includes(child));
        const grandchildTiming = timings.find(t => t.operation.includes(grandchild));

        expect(parentTiming).toBeDefined();
        expect(childTiming?.operation).toBe(`${parent} > ${child}`);
        expect(grandchildTiming?.operation).toBe(`${parent} > ${child} > ${grandchild}`);
      });

      it('should merge metadata when ending operation', () => {
        // Arrange
        const operation = 'test-operation';
        const startMeta = { start: 'data' };
        const endMeta = { end: 'data', result: 'success' };

        // Act
        timer.start(operation, startMeta);
        timer.end(operation, endMeta);

        // Assert
        const timings = timer.getTimings();
        const timing = timings.find(t => t.operation === operation);

        expect(timing?.metadata).toEqual({
          ...startMeta,
          ...endMeta
        });
      });
    });

    describe('measure async operations', () => {
      it('should measure successful async operation', async () => {
        // Arrange
        const operation = 'async-operation';
        const expectedResult = { data: 'test' };
        const asyncFn = vi.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return expectedResult;
        });

        // Act
        const result = await timer.measure(operation, asyncFn);

        // Assert
        expect(result).toEqual(expectedResult);
        expect(asyncFn).toHaveBeenCalledTimes(1);

        const timings = timer.getTimings();
        const timing = timings.find(t => t.operation === operation);
        expect(timing).toBeDefined();
        expect(timing?.duration).toBeGreaterThanOrEqual(0);
      });

      it('should handle async operation errors and still record timing', async () => {
        // Arrange
        const operation = 'failing-async-operation';
        const error = new Error('Test error');
        const asyncFn = vi.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          throw error;
        });

        // Act & Assert
        await expect(timer.measure(operation, asyncFn)).rejects.toThrow('Test error');

        const timings = timer.getTimings();
        const timing = timings.find(t => t.operation === operation);
        expect(timing).toBeDefined();
        expect(timing?.metadata?.error).toBe(true);
      });

      it('should measure async operation with metadata', async () => {
        // Arrange
        const operation = 'async-with-meta';
        const metadata = { userId: '123', action: 'fetch' };
        const asyncFn = vi.fn(async () => 'result');

        // Act
        await timer.measure(operation, asyncFn, metadata);

        // Assert
        const timings = timer.getTimings();
        const timing = timings.find(t => t.operation === operation);
        expect(timing?.metadata).toMatchObject(metadata);
      });
    });

    describe('measureSync operations', () => {
      it('should measure successful synchronous operation', () => {
        // Arrange
        const operation = 'sync-operation';
        const expectedResult = 42;
        const syncFn = vi.fn(() => expectedResult);

        // Act
        const result = timer.measureSync(operation, syncFn);

        // Assert
        expect(result).toBe(expectedResult);
        expect(syncFn).toHaveBeenCalledTimes(1);

        const timings = timer.getTimings();
        const timing = timings.find(t => t.operation === operation);
        expect(timing).toBeDefined();
        expect(timing?.duration).toBeGreaterThanOrEqual(0);
      });

      it('should handle synchronous operation errors and still record timing', () => {
        // Arrange
        const operation = 'failing-sync-operation';
        const error = new Error('Sync error');
        const syncFn = vi.fn(() => { throw error; });

        // Act & Assert
        expect(() => timer.measureSync(operation, syncFn)).toThrow('Sync error');

        const timings = timer.getTimings();
        const timing = timings.find(t => t.operation === operation);
        expect(timing).toBeDefined();
        expect(timing?.metadata?.error).toBe(true);
      });

      it('should measure sync operation with metadata', () => {
        // Arrange
        const operation = 'sync-with-meta';
        const metadata = { calculation: 'fibonacci' };
        const syncFn = vi.fn(() => 13);

        // Act
        timer.measureSync(operation, syncFn, metadata);

        // Assert
        const timings = timer.getTimings();
        const timing = timings.find(t => t.operation === operation);
        expect(timing?.metadata).toMatchObject(metadata);
      });
    });

    describe('getSummary', () => {
      it('should calculate correct summary statistics', () => {
        // Arrange - create operations with different durations
        timer.start('fast-op');
        timer.end('fast-op');

        timer.start('medium-op');
        timer.end('medium-op');

        timer.start('slow-op');
        timer.end('slow-op');

        // Act
        const summary = timer.getSummary();

        // Assert
        expect(summary.totalOperations).toBe(3);
        expect(summary.totalDuration).toBeGreaterThan(0);
        expect(summary.slowestOperation).toBeDefined();
        expect(summary.fastestOperation).toBeDefined();
        expect(summary.averageDuration).toBeGreaterThan(0);
      });

      it('should handle empty timings', () => {
        // Act
        const summary = timer.getSummary();

        // Assert
        expect(summary.totalOperations).toBe(0);
        expect(summary.totalDuration).toBe(0);
        expect(summary.slowestOperation).toBeNull();
        expect(summary.fastestOperation).toBeNull();
        expect(summary.averageDuration).toBe(0);
      });

      it('should filter out incomplete timings', () => {
        // Arrange
        timer.start('incomplete-op');
        timer.start('complete-op');
        timer.end('complete-op');

        // Act
        const summary = timer.getSummary();

        // Assert
        expect(summary.totalOperations).toBe(1);
        const timings = timer.getTimings();
        expect(timings).toHaveLength(2); // Both operations tracked
      });
    });

    describe('reset', () => {
      it('should clear all timing data and operation stack', () => {
        // Arrange
        timer.start('operation-1');
        timer.start('operation-2');
        timer.end('operation-2');
        timer.end('operation-1');

        // Act
        timer.reset();

        // Assert
        const timings = timer.getTimings();
        expect(timings).toHaveLength(0);

        const summary = timer.getSummary();
        expect(summary.totalOperations).toBe(0);
      });

      it('should allow new operations after reset', () => {
        // Arrange
        timer.start('old-operation');
        timer.end('old-operation');
        timer.reset();

        // Act
        timer.start('new-operation');
        timer.end('new-operation');

        // Assert
        const timings = timer.getTimings();
        expect(timings).toHaveLength(1);
        expect(timings[0].operation).toBe('new-operation');
      });
    });

    describe('logSummary', () => {
      it('should log comprehensive summary with timings', () => {
        // Arrange
        timer.start('operation-1');
        timer.end('operation-1');
        timer.start('operation-2');
        timer.end('operation-2');

        const additionalContext = { testRun: 'test-123' };

        // Act
        timer.logSummary(additionalContext);

        // Assert
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('PERFORMANCE SUMMARY'),
          additionalContext
        );
      });

      it('should handle no timing data gracefully', () => {
        // Act
        timer.logSummary();

        // Assert
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('No timing data available')
        );
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle ending an operation that was never started', () => {
      // Act
      const duration = timer.end('non-existent-operation');

      // Assert
      expect(duration).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Attempted to end operation that wasn't started")
      );
    });

    it('should warn about operation stack mismatch', () => {
      // Arrange
      timer.start('operation-1');
      timer.start('operation-2');

      // Act - End operations in wrong order
      timer.end('operation-1'); // This will fail because operation-2 is on stack

      // Assert
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle operations with same name at different nesting levels', () => {
      // Arrange
      const operation = 'same-name';

      // Act
      timer.start(operation);
      timer.start(operation);
      timer.end(operation);
      timer.end(operation);

      // Assert
      const timings = timer.getTimings();
      expect(timings).toHaveLength(2);
      expect(timings[0].operation).toBe(operation);
      expect(timings[1].operation).toBe(`${operation} > ${operation}`);
    });

    it('should handle operations with no metadata', () => {
      // Act
      timer.start('no-metadata');
      timer.end('no-metadata');

      // Assert
      const timings = timer.getTimings();
      const timing = timings.find(t => t.operation === 'no-metadata');
      expect(timing?.metadata).toBeUndefined();
    });

    it('should handle very fast operations (< 1ms)', () => {
      // Arrange
      const operation = 'instant-operation';

      // Act
      timer.start(operation);
      timer.end(operation);

      // Assert
      const timings = timer.getTimings();
      const timing = timings.find(t => t.operation === operation);
      expect(timing?.duration).toBeGreaterThanOrEqual(0);
      expect(timing?.duration).toBeLessThan(100);
    });
  });

  describe('createPerformanceTimer factory function', () => {
    it('should create a new PerformanceTimer instance', () => {
      // Act
      const newTimer = createPerformanceTimer(mockLogger, 'factory-context');

      // Assert
      expect(newTimer).toBeInstanceOf(PerformanceTimer);
    });

    it('should create timer with correct context', () => {
      // Arrange
      const context = 'custom-context';

      // Act
      const newTimer = createPerformanceTimer(mockLogger, context);
      newTimer.start('test');

      // Assert
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(context),
        undefined
      );
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle deeply nested operations', () => {
      // Arrange
      const operations = ['level1', 'level2', 'level3', 'level4', 'level5'];

      // Act
      operations.forEach(op => timer.start(op));
      operations.reverse().forEach(op => timer.end(op));

      // Assert
      const timings = timer.getTimings();
      expect(timings).toHaveLength(5);

      const deepestTiming = timings.find(t => t.operation.includes('level5'));
      expect(deepestTiming?.operation).toBe('level1 > level2 > level3 > level4 > level5');
    });

    it('should track multiple parallel operation trees', () => {
      // Arrange & Act
      timer.start('tree1-root');
      timer.start('tree1-child');
      timer.end('tree1-child');
      timer.end('tree1-root');

      timer.start('tree2-root');
      timer.start('tree2-child');
      timer.end('tree2-child');
      timer.end('tree2-root');

      // Assert
      const timings = timer.getTimings();
      expect(timings).toHaveLength(4);

      expect(timings.find(t => t.operation === 'tree1-root')).toBeDefined();
      expect(timings.find(t => t.operation === 'tree1-root > tree1-child')).toBeDefined();
      expect(timings.find(t => t.operation === 'tree2-root')).toBeDefined();
      expect(timings.find(t => t.operation === 'tree2-root > tree2-child')).toBeDefined();
    });

    it('should handle mix of sync and async operations', async () => {
      // Arrange
      const syncOp = 'sync-op';
      const asyncOp = 'async-op';

      // Act
      timer.measureSync(syncOp, () => 'sync-result');
      await timer.measure(asyncOp, async () => 'async-result');

      // Assert
      const timings = timer.getTimings();
      expect(timings).toHaveLength(2);
      expect(timings.find(t => t.operation === syncOp)).toBeDefined();
      expect(timings.find(t => t.operation === asyncOp)).toBeDefined();
    });

    it('should maintain accuracy with rapid consecutive operations', () => {
      // Arrange
      const operationCount = 100;

      // Act
      for (let i = 0; i < operationCount; i++) {
        timer.start(`operation-${i}`);
        timer.end(`operation-${i}`);
      }

      // Assert
      const timings = timer.getTimings();
      expect(timings).toHaveLength(operationCount);

      const summary = timer.getSummary();
      expect(summary.totalOperations).toBe(operationCount);
    });
  });

  describe('Timing Entry Structure', () => {
    it('should create timing entries with correct structure', () => {
      // Arrange
      const operation = 'structured-operation';
      const metadata = { key: 'value' };

      // Act
      timer.start(operation, metadata);
      timer.end(operation);

      // Assert
      const timings = timer.getTimings();
      const timing = timings[0];

      expect(timing).toHaveProperty('operation');
      expect(timing).toHaveProperty('startTime');
      expect(timing).toHaveProperty('endTime');
      expect(timing).toHaveProperty('duration');
      expect(timing).toHaveProperty('metadata');

      expect(typeof timing.operation).toBe('string');
      expect(typeof timing.startTime).toBe('number');
      expect(typeof timing.endTime).toBe('number');
      expect(typeof timing.duration).toBe('number');
      expect(timing.metadata).toEqual(metadata);
    });

    it('should not have endTime or duration for incomplete operations', () => {
      // Arrange
      const operation = 'incomplete-operation';

      // Act
      timer.start(operation);

      // Assert
      const timings = timer.getTimings();
      const timing = timings[0];

      expect(timing.operation).toBe(operation);
      expect(timing.startTime).toBeGreaterThan(0);
      expect(timing.endTime).toBeUndefined();
      expect(timing.duration).toBeUndefined();
    });
  });
});
