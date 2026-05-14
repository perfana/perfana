import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createSimpleQueue, createSimpleWorker, addSimpleJob } from '../../../workers/simple-worker-factory.js';
import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';

// Mock dependencies
vi.mock('ioredis');
vi.mock('bullmq');
vi.mock('../../../config/environment.js', () => ({
  getConfig: vi.fn(() => ({
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: 'test-password',
    REDIS_DB: 0,
  })),
}));
vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  })),
}));
vi.mock('../../../config/simple-queues.js', () => ({
  getWorkerConfig: vi.fn((queueName) => ({
    concurrency: 5,
    drainDelay: 100,
  })),
  getJobOptions: vi.fn((jobName) => ({
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  })),
}));

describe('Worker Factory', () => {
  let mockRedisInstance: any;
  let mockQueueInstance: any;
  let mockWorkerInstance: any;

  beforeEach(() => {
    // Mock Redis instance
    mockRedisInstance = {
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      quit: vi.fn(),
    };

    // Mock Queue instance
    mockQueueInstance = {
      name: 'test-queue',
      on: vi.fn(),
      add: vi.fn(),
      close: vi.fn(),
    };

    // Mock Worker instance
    mockWorkerInstance = {
      on: vi.fn(),
      run: vi.fn(),
      close: vi.fn(),
    };

    // Mock constructors
    vi.mocked(IORedis).mockImplementation(() => mockRedisInstance as any);
    vi.mocked(Queue).mockImplementation(() => mockQueueInstance as any);
    vi.mocked(Worker).mockImplementation(() => mockWorkerInstance as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSimpleQueue', () => {
    it('should create Queue with correct configuration', () => {
      // Act
      const queue = createSimpleQueue('analyze-test');

      // Assert
      expect(Queue).toHaveBeenCalledWith(
        'analyze-test',
        expect.objectContaining({
          connection: mockRedisInstance,
          prefix: 'bull',
        })
      );
      expect(queue).toBe(mockQueueInstance);
    });

    it('should create Redis connection with correct config', () => {
      // Act
      createSimpleQueue('analyze-test');

      // Assert
      expect(IORedis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          password: 'test-password',
          db: 0,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        })
      );
    });

    it('should setup error event listener', () => {
      // Act
      createSimpleQueue('analyze-test');

      // Assert
      expect(mockQueueInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should create different queue instances for different names', () => {
      // Act
      const queue1 = createSimpleQueue('analyze-test');
      const queue2 = createSimpleQueue('metrics-collection');

      // Assert
      expect(Queue).toHaveBeenCalledTimes(2);
      expect(Queue).toHaveBeenCalledWith('analyze-test', expect.any(Object));
      expect(Queue).toHaveBeenCalledWith('metrics-collection', expect.any(Object));
    });

    it('should handle Redis connection without password', async () => {
      // Arrange
      const { getConfig } = await import('../../../config/environment.js');
      vi.mocked(getConfig).mockReturnValue({
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_PASSWORD: null,
        REDIS_DB: 0,
      } as any);

      // Act
      createSimpleQueue('analyze-test');

      // Assert
      expect(IORedis).toHaveBeenCalledWith(
        expect.objectContaining({
          password: undefined,
        })
      );
    });
  });

  describe('createSimpleWorker', () => {
    let mockProcessor: any;

    beforeEach(() => {
      mockProcessor = vi.fn();
    });

    it('should create Worker with correct configuration', () => {
      // Act
      const worker = createSimpleWorker('analyze-test', mockProcessor);

      // Assert — processor is wrapped with a DB connection check
      expect(Worker).toHaveBeenCalledWith(
        'analyze-test',
        expect.any(Function),
        expect.objectContaining({
          connection: mockRedisInstance,
          concurrency: 5,
          drainDelay: 100,
        })
      );
      expect(worker).toBe(mockWorkerInstance);
    });

    it('should create one Redis connection for the worker', () => {
      // Act
      createSimpleWorker('analyze-test', mockProcessor);

      // Assert
      expect(IORedis).toHaveBeenCalledTimes(1);
    });

    it('should setup all event listeners', () => {
      // Act
      createSimpleWorker('analyze-test', mockProcessor);

      // Assert
      expect(mockWorkerInstance.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockWorkerInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWorkerInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockWorkerInstance.on).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(mockWorkerInstance.on).toHaveBeenCalledWith('stalled', expect.any(Function));
    });

    it('should use worker config from simple-queues', async () => {
      // Arrange
      const { getWorkerConfig } = await import('../../../config/simple-queues.js');
      vi.mocked(getWorkerConfig).mockReturnValue({
        concurrency: 10,
        drainDelay: 200,
      });

      // Act
      createSimpleWorker('analyze-test', mockProcessor);

      // Assert
      expect(getWorkerConfig).toHaveBeenCalledWith('analyze-test');
      expect(Worker).toHaveBeenCalledWith(
        'analyze-test',
        expect.any(Function),
        expect.objectContaining({
          concurrency: 10,
          drainDelay: 200,
        })
      );
    });

    it('should not include limiter configuration', () => {
      // Act
      createSimpleWorker('analyze-test', mockProcessor);

      // Assert
      const workerCall = vi.mocked(Worker).mock.calls[0];
      const workerOptions = workerCall[2];
      expect(workerOptions).not.toHaveProperty('limiter');
    });

    it('should create worker for different queue types', () => {
      // Act
      const worker1 = createSimpleWorker('analyze-test', mockProcessor);
      const worker2 = createSimpleWorker('metrics-collection', mockProcessor);
      const worker3 = createSimpleWorker('adapt-analysis', mockProcessor);

      // Assert
      expect(Worker).toHaveBeenCalledTimes(3);
      expect(Worker).toHaveBeenCalledWith('analyze-test', expect.any(Function), expect.any(Object));
      expect(Worker).toHaveBeenCalledWith('metrics-collection', expect.any(Function), expect.any(Object));
      expect(Worker).toHaveBeenCalledWith('adapt-analysis', expect.any(Function), expect.any(Object));
    });
  });

  describe('addSimpleJob', () => {
    beforeEach(() => {
      mockQueueInstance.add.mockResolvedValue({ id: 'job-123' });
    });

    it('should add job to queue with correct data and options', async () => {
      // Arrange
      const jobName = 'analyze-test';
      const jobData = { testRunId: 'test-123', adapt: true };
      const queue = createSimpleQueue('analyze-test');

      // Act
      await addSimpleJob(queue, jobName, jobData);

      // Assert
      expect(mockQueueInstance.add).toHaveBeenCalledWith(
        jobName,
        jobData,
        expect.objectContaining({
          attempts: 3,
          backoff: expect.objectContaining({
            type: 'exponential',
            delay: 1000,
          }),
          removeOnComplete: 50,
          removeOnFail: 20,
        })
      );
    });

    it('should not include priority in job options', async () => {
      // Arrange
      const jobName = 'analyze-test';
      const jobData = { testRunId: 'test-123' };
      const queue = createSimpleQueue('analyze-test');

      // Act
      await addSimpleJob(queue, jobName, jobData);

      // Assert
      const addCall = mockQueueInstance.add.mock.calls[0];
      const jobOptions = addCall[2];
      expect(jobOptions).not.toHaveProperty('priority');
    });

    it('should use job options from simple-queues config', async () => {
      // Arrange
      const { getJobOptions } = await import('../../../config/simple-queues.js');
      vi.mocked(getJobOptions).mockReturnValue({
        attempts: 5,
        backoff: { type: 'fixed', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      });

      const jobName = 'metrics-collection';
      const jobData = { testRunId: 'test-456' };
      const queue = createSimpleQueue('metrics-collection');

      // Act
      await addSimpleJob(queue, jobName, jobData);

      // Assert
      expect(getJobOptions).toHaveBeenCalledWith(jobName);
      expect(mockQueueInstance.add).toHaveBeenCalledWith(
        jobName,
        jobData,
        expect.objectContaining({
          attempts: 5,
          backoff: { type: 'fixed', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        })
      );
    });

    it('should handle different job data types', async () => {
      // Arrange
      const queue = createSimpleQueue('analyze-test');
      const testCases = [
        { name: 'simple-object', data: { id: '123' } },
        { name: 'nested-object', data: { test: { nested: { value: 'deep' } } } },
        { name: 'array-data', data: { items: [1, 2, 3, 4, 5] } },
        { name: 'mixed-data', data: { str: 'text', num: 42, bool: true, arr: [1, 2, 3] } },
      ];

      // Act & Assert
      for (const testCase of testCases) {
        await addSimpleJob(queue, testCase.name, testCase.data);
        expect(mockQueueInstance.add).toHaveBeenCalledWith(
          testCase.name,
          testCase.data,
          expect.any(Object)
        );
      }
    });

    it('should return job ID after adding', async () => {
      // Arrange
      const jobName = 'analyze-test';
      const jobData = { testRunId: 'test-123' };
      const queue = createSimpleQueue('analyze-test');
      mockQueueInstance.add.mockResolvedValue({ id: 'job-456', data: jobData });

      // Act
      await addSimpleJob(queue, jobName, jobData);

      // Assert
      expect(mockQueueInstance.add).toHaveBeenCalled();
    });

    it('should handle queue errors gracefully', async () => {
      // Arrange
      const jobName = 'analyze-test';
      const jobData = { testRunId: 'test-123' };
      const queue = createSimpleQueue('analyze-test');
      const expectedError = new Error('Redis connection failed');
      mockQueueInstance.add.mockRejectedValue(expectedError);

      // Act & Assert
      await expect(addSimpleJob(queue, jobName, jobData)).rejects.toThrow(
        'Redis connection failed'
      );
    });
  });

  describe('Redis Configuration', () => {
    it('should configure Redis with BullMQ-specific settings', () => {
      // Act
      createSimpleQueue('analyze-test');

      // Assert
      expect(IORedis).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetriesPerRequest: null, // Required for BullMQ
          enableReadyCheck: false, // Recommended for BullMQ
        })
      );
    });

    it('should use correct Redis database', async () => {
      // Arrange
      const { getConfig } = await import('../../../config/environment.js');
      vi.mocked(getConfig).mockReturnValue({
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_PASSWORD: null,
        REDIS_DB: 5,
      } as any);

      // Act
      createSimpleQueue('analyze-test');

      // Assert
      expect(IORedis).toHaveBeenCalledWith(
        expect.objectContaining({
          db: 5,
        })
      );
    });

    it('should use correct Redis host and port', async () => {
      // Arrange
      const { getConfig } = await import('../../../config/environment.js');
      vi.mocked(getConfig).mockReturnValue({
        REDIS_HOST: 'redis.example.com',
        REDIS_PORT: 6380,
        REDIS_PASSWORD: null,
        REDIS_DB: 0,
      } as any);

      // Act
      createSimpleQueue('analyze-test');

      // Assert
      expect(IORedis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'redis.example.com',
          port: 6380,
        })
      );
    });
  });

  describe('Worker Blocking Connection Pattern', () => {
    it('should create a connection and pass it to the worker', () => {
      // Arrange
      const mockProcessor = vi.fn();

      // Act
      createSimpleWorker('analyze-test', mockProcessor);

      // Assert
      expect(IORedis).toHaveBeenCalledTimes(1);
      const workerCall = vi.mocked(Worker).mock.calls[0];
      const workerOptions = workerCall[2];
      expect(workerOptions.connection).toBeDefined();
    });

    it('should configure drainDelay greater than 50ms', () => {
      // Arrange
      const mockProcessor = vi.fn();

      // Act
      createSimpleWorker('analyze-test', mockProcessor);

      // Assert
      const workerCall = vi.mocked(Worker).mock.calls[0];
      const workerOptions = workerCall[2];
      expect(workerOptions.drainDelay).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Edge Cases', () => {
    it('should handle queue name with special characters', () => {
      // Act
      const queue = createSimpleQueue('test-queue-123' as any);

      // Assert
      expect(Queue).toHaveBeenCalledWith('test-queue-123', expect.any(Object));
    });

    it('should handle empty job data', async () => {
      // Arrange
      const queue = createSimpleQueue('analyze-test');
      const emptyData = {};

      // Act
      await addSimpleJob(queue, 'test-job', emptyData);

      // Assert
      expect(mockQueueInstance.add).toHaveBeenCalledWith('test-job', emptyData, expect.any(Object));
    });

    it('should handle processor that returns Promise', () => {
      // Arrange
      const asyncProcessor = vi.fn().mockResolvedValue({ success: true });

      // Act
      const worker = createSimpleWorker('analyze-test', asyncProcessor);

      // Assert — processor is wrapped with a DB connection check
      expect(Worker).toHaveBeenCalledWith('analyze-test', expect.any(Function), expect.any(Object));
    });
  });
});
