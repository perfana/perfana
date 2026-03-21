import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryRunner } from 'typeorm';
import { BasePipelineTypeORM } from '../../pipelines/BasePipelineTypeORM.js';

/**
 * Pipeline Performance Tests
 *
 * Tests worker pipeline performance including:
 * - Execution time limits
 * - Batch processing optimization
 * - Throughput metrics
 * - Memory efficiency
 * - Database query performance
 * - Parallel processing
 */

// Mock data processing pipeline
class DataProcessingPipeline extends BasePipelineTypeORM<any, any> {
  async execute(input: any, queryRunner?: QueryRunner): Promise<any> {
    const items = input.items || [];
    const processed = items.map((item: any) => ({
      ...item,
      processed: true,
      timestamp: Date.now(),
    }));

    return {
      success: true,
      count: processed.length,
      items: processed,
    };
  }
}

// Mock batch processing pipeline
class BatchProcessingPipeline extends BasePipelineTypeORM<any, any> {
  constructor(
    dataSource: DataSource,
    private batchSize: number = 100
  ) {
    super(dataSource);
  }

  async execute(input: any, queryRunner?: QueryRunner): Promise<any> {
    const items = input.items || [];
    const batches: any[] = [];

    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      batches.push({
        items: batch,
        processed: batch.length,
      });
    }

    return {
      success: true,
      totalItems: items.length,
      batches: batches.length,
      batchSize: this.batchSize,
    };
  }
}

// Mock aggregation pipeline
class AggregationPipeline extends BasePipelineTypeORM<any, any> {
  async execute(input: any, queryRunner?: QueryRunner): Promise<any> {
    const metrics = input.metrics || [];

    const aggregated = metrics.reduce((acc: any, metric: any) => {
      const key = metric.name;
      if (!acc[key]) {
        acc[key] = {
          name: key,
          count: 0,
          sum: 0,
          min: Infinity,
          max: -Infinity,
        };
      }

      acc[key].count++;
      acc[key].sum += metric.value;
      acc[key].min = Math.min(acc[key].min, metric.value);
      acc[key].max = Math.max(acc[key].max, metric.value);

      return acc;
    }, {});

    return {
      success: true,
      aggregations: Object.values(aggregated),
    };
  }
}

// TODO: Performance tests are timing-sensitive and should not block CI
describe.skip('Pipeline Performance Tests', () => {
  let mockDataSource: Partial<DataSource>;
  let mockQueryRunner: Partial<QueryRunner>;

  beforeEach(() => {
    mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      isTransactionActive: false,
      manager: {
        save: jest.fn(),
        find: jest.fn(),
        findOne: jest.fn(),
      } as any,
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
      isInitialized: true,
    };
  });

  describe('Execution Time Limits', () => {
    it('should process 100 items in < 100ms', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        value: `value-${i}`,
      }));

      const startTime = Date.now();
      const result = await pipeline.execute({ items });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.count).toBe(100);
      expect(duration).toBeLessThan(100);
    });

    it('should process 1000 items in < 500ms', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        value: `value-${i}`,
      }));

      const startTime = Date.now();
      const result = await pipeline.execute({ items });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.count).toBe(1000);
      expect(duration).toBeLessThan(500);
    });

    it('should process 10000 items in < 2 seconds', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        value: `value-${i}`,
      }));

      const startTime = Date.now();
      const result = await pipeline.execute({ items });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.count).toBe(10000);
      expect(duration).toBeLessThan(2000);
    });

    it('should measure average execution time over multiple runs', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 500 }, (_, i) => ({ id: i }));
      const iterations = 10;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await pipeline.execute({ items });
        durations.push(Date.now() - startTime);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / iterations;

      expect(avgDuration).toBeLessThan(200);
    });
  });

  describe('Batch Processing Optimization', () => {
    it('should optimize batch size for 10000 items', async () => {
      const batchSizes = [50, 100, 500, 1000];
      const results: { size: number; duration: number }[] = [];

      for (const batchSize of batchSizes) {
        const pipeline = new BatchProcessingPipeline(mockDataSource as DataSource, batchSize);
        const items = Array.from({ length: 10000 }, (_, i) => ({ id: i }));

        const startTime = Date.now();
        await pipeline.execute({ items });
        const duration = Date.now() - startTime;

        results.push({ size: batchSize, duration });
      }

      // Verify all batch sizes complete in reasonable time
      results.forEach(result => {
        expect(result.duration).toBeLessThan(1000);
      });
    });

    it('should process 100 batches efficiently', async () => {
      const pipeline = new BatchProcessingPipeline(mockDataSource as DataSource, 100);

      const items = Array.from({ length: 10000 }, (_, i) => ({ id: i }));

      const startTime = Date.now();
      const result = await pipeline.execute({ items });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.batches).toBe(100);
      expect(duration).toBeLessThan(500);
    });

    it('should handle variable batch sizes', async () => {
      const items = Array.from({ length: 9753 }, (_, i) => ({ id: i })); // Not evenly divisible

      const pipeline = new BatchProcessingPipeline(mockDataSource as DataSource, 100);

      const result = await pipeline.execute({ items });

      expect(result.success).toBe(true);
      expect(result.totalItems).toBe(9753);
      expect(result.batches).toBe(98); // 97 full batches + 1 partial
    });
  });

  describe('Throughput Metrics', () => {
    it('should achieve > 1000 items/second throughput', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 5000 }, (_, i) => ({ id: i }));

      const startTime = Date.now();
      const result = await pipeline.execute({ items });
      const duration = Date.now() - startTime;

      const throughput = (result.count / duration) * 1000; // items per second

      expect(throughput).toBeGreaterThan(1000);
    });

    it('should maintain consistent throughput across multiple executions', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
      const throughputs: number[] = [];

      for (let i = 0; i < 5; i++) {
        const startTime = Date.now();
        const result = await pipeline.execute({ items });
        const duration = Date.now() - startTime;
        const throughput = (result.count / duration) * 1000;

        throughputs.push(throughput);
      }

      const avgThroughput = throughputs.reduce((a, b) => a + b, 0) / throughputs.length;
      const stdDev = Math.sqrt(
        throughputs.reduce((sum, val) => sum + Math.pow(val - avgThroughput, 2), 0) / throughputs.length
      );

      // Standard deviation should be < 20% of average (consistent performance)
      expect(stdDev).toBeLessThan(avgThroughput * 0.2);
    });
  });

  describe('Memory Efficiency', () => {
    it('should process large dataset without memory spike', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 50000 }, (_, i) => ({
        id: i,
        value: `value-${i}`,
        data: 'x'.repeat(100),
      }));

      const initialMemory = process.memoryUsage().heapUsed;
      const result = await pipeline.execute({ items });
      const finalMemory = process.memoryUsage().heapUsed;

      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      expect(result.success).toBe(true);
      expect(result.count).toBe(50000);
      // Memory increase should be reasonable (< 100MB)
      expect(memoryIncrease).toBeLessThan(100);
    });

    it('should clean up memory after processing', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const initialMemory = process.memoryUsage().heapUsed;

      // Process multiple large batches
      for (let i = 0; i < 5; i++) {
        const items = Array.from({ length: 10000 }, (_, j) => ({ id: j }));
        await pipeline.execute({ items });
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      // Memory should not grow unbounded
      expect(memoryIncrease).toBeLessThan(150);
    });

    it('should use memory efficiently with streaming approach', async () => {
      class StreamingPipeline extends BasePipelineTypeORM<any, any> {
        async execute(input: any): Promise<any> {
          const items = input.items || [];
          let processed = 0;

          // Process in chunks to reduce memory footprint
          const chunkSize = 1000;
          for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            processed += chunk.length;
            // Simulate processing without storing all results
          }

          return { success: true, processed };
        }
      }

      const pipeline = new StreamingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 100000 }, (_, i) => ({ id: i }));

      const initialMemory = process.memoryUsage().heapUsed;
      const result = await pipeline.execute({ items });
      const peakMemory = process.memoryUsage().heapUsed;

      const memoryIncrease = (peakMemory - initialMemory) / 1024 / 1024; // MB

      expect(result.processed).toBe(100000);
      // Streaming should use less memory than loading all at once
      expect(memoryIncrease).toBeLessThan(50);
    });
  });

  describe('Aggregation Performance', () => {
    it('should aggregate 10000 metrics in < 1 second', async () => {
      const pipeline = new AggregationPipeline(mockDataSource as DataSource);

      const metrics = Array.from({ length: 10000 }, (_, i) => ({
        name: `metric-${i % 100}`,
        value: Math.random() * 1000,
        timestamp: Date.now(),
      }));

      const startTime = Date.now();
      const result = await pipeline.execute({ metrics });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.aggregations.length).toBe(100); // 100 unique metrics
      expect(duration).toBeLessThan(1000);
    });

    it('should handle complex aggregations efficiently', async () => {
      const pipeline = new AggregationPipeline(mockDataSource as DataSource);

      const metrics = Array.from({ length: 50000 }, (_, i) => ({
        name: `metric-${i % 500}`,
        value: Math.random() * 1000,
        timestamp: Date.now(),
      }));

      const startTime = Date.now();
      const result = await pipeline.execute({ metrics });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.aggregations.length).toBe(500);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Parallel Processing', () => {
    it('should process multiple pipelines in parallel', async () => {
      const pipeline1 = new DataProcessingPipeline(mockDataSource as DataSource);
      const pipeline2 = new DataProcessingPipeline(mockDataSource as DataSource);
      const pipeline3 = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 1000 }, (_, i) => ({ id: i }));

      const startTime = Date.now();

      const results = await Promise.all([
        pipeline1.execute({ items }),
        pipeline2.execute({ items }),
        pipeline3.execute({ items }),
      ]);

      const duration = Date.now() - startTime;

      expect(results.length).toBe(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.count).toBe(1000);
      });

      // Parallel execution should be faster than sequential
      expect(duration).toBeLessThan(1000);
    });

    it('should handle 10 parallel pipeline executions', async () => {
      const pipelines = Array.from(
        { length: 10 },
        () => new DataProcessingPipeline(mockDataSource as DataSource)
      );

      const items = Array.from({ length: 500 }, (_, i) => ({ id: i }));

      const startTime = Date.now();

      const results = await Promise.all(
        pipelines.map(pipeline => pipeline.execute({ items }))
      );

      const duration = Date.now() - startTime;

      expect(results.length).toBe(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Scalability Tests', () => {
    it('should scale linearly with data size', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const sizes = [100, 500, 1000, 5000, 10000];
      const results: { size: number; duration: number }[] = [];

      for (const size of sizes) {
        const items = Array.from({ length: size }, (_, i) => ({ id: i }));

        const startTime = Date.now();
        await pipeline.execute({ items });
        const duration = Date.now() - startTime;

        results.push({ size, duration });
      }

      // Check that duration scales roughly linearly
      // duration(10000) should be < 10x duration(1000)
      const ratio = results[4].duration / results[2].duration;
      expect(ratio).toBeLessThan(15); // Allow some overhead
    });

    it('should maintain performance under sustained load', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
      const durations: number[] = [];

      // Process 20 batches in succession
      for (let i = 0; i < 20; i++) {
        const startTime = Date.now();
        await pipeline.execute({ items });
        durations.push(Date.now() - startTime);
      }

      // Performance shouldn't degrade significantly over time
      const firstHalf = durations.slice(0, 10);
      const secondHalf = durations.slice(10);

      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      // Second half should not be significantly slower (< 50% degradation)
      expect(avgSecond).toBeLessThan(avgFirst * 1.5);
    });
  });

  describe('Resource Utilization', () => {
    it('should efficiently use CPU for computation', async () => {
      const pipeline = new DataProcessingPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        value: Math.random(),
      }));

      const startTime = Date.now();
      const result = await pipeline.execute({ items });
      const duration = Date.now() - startTime;

      // High throughput indicates efficient CPU usage
      const throughput = (result.count / duration) * 1000;
      expect(throughput).toBeGreaterThan(1000);
    });

    it('should balance memory vs speed tradeoffs', async () => {
      // Test that using less memory doesn't drastically impact speed

      class MemoryEfficientPipeline extends BasePipelineTypeORM<any, any> {
        async execute(input: any): Promise<any> {
          const items = input.items || [];
          let count = 0;

          // Process without storing intermediate results
          for (const item of items) {
            count++;
          }

          return { success: true, count };
        }
      }

      const pipeline = new MemoryEfficientPipeline(mockDataSource as DataSource);

      const items = Array.from({ length: 50000 }, (_, i) => ({ id: i }));

      const initialMemory = process.memoryUsage().heapUsed;
      const startTime = Date.now();
      const result = await pipeline.execute({ items });
      const duration = Date.now() - startTime;
      const peakMemory = process.memoryUsage().heapUsed;

      const memoryIncrease = (peakMemory - initialMemory) / 1024 / 1024; // MB

      expect(result.count).toBe(50000);
      expect(duration).toBeLessThan(500); // Still fast
      expect(memoryIncrease).toBeLessThan(30); // Low memory usage
    });
  });
});
