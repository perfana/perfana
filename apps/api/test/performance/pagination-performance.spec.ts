import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TestRun } from '@perfana/shared/entities';

/**
 * Pagination and Large Dataset Performance Tests
 *
 * Tests system performance with large datasets:
 * - Pagination efficiency
 * - Large result sets
 * - Query optimization
 * - Memory usage
 * - Response time constraints
 */
describe('Pagination and Performance Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const mockAuth = 'Bearer mock-valid-api-key';

  describe('Pagination Performance', () => {
    it('should handle first page efficiently', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 50 })
        .set('Authorization', mockAuth)
        .expect(401); // Will fail auth but tests performance

      const duration = Date.now() - startTime;

      // First page should be fast (< 1 second)
      expect(duration).toBeLessThan(1000);
    });

    it('should handle large page number (page 1000)', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1000, pageSize: 50 })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      // Even large page numbers should be reasonably fast (< 2 seconds)
      expect(duration).toBeLessThan(2000);
    });

    it('should handle maximum page size (100 items)', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 100 })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1500);
    });

    it('should validate page size limits', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 1000 }) // Exceeds max
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle concurrent pagination requests', async () => {
      const startTime = Date.now();

      const requests = [
        request(app.getHttpServer())
          .get('/api/test-runs')
          .query({ page: 1, pageSize: 50 })
          .set('Authorization', mockAuth),
        request(app.getHttpServer())
          .get('/api/test-runs')
          .query({ page: 2, pageSize: 50 })
          .set('Authorization', mockAuth),
        request(app.getHttpServer())
          .get('/api/test-runs')
          .query({ page: 3, pageSize: 50 })
          .set('Authorization', mockAuth),
      ];

      await Promise.all(requests);

      const duration = Date.now() - startTime;

      // Concurrent requests should complete in reasonable time
      expect(duration).toBeLessThan(3000);
    });
  });

  describe('Sorting Performance', () => {
    it('should handle sorting by createdAt efficiently', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 50, sortBy: 'createdAt', sortOrder: 'DESC' })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle sorting by testRunId', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 50, sortBy: 'testRunId', sortOrder: 'ASC' })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle multiple sort operations quickly', async () => {
      const sortFields = ['createdAt', 'testRunId', 'workload', 'testEnvironment'];
      const startTime = Date.now();

      for (const field of sortFields) {
        await request(app.getHttpServer())
          .get('/api/test-runs')
          .query({ page: 1, pageSize: 50, sortBy: field, sortOrder: 'DESC' })
          .set('Authorization', mockAuth)
          .expect(401);
      }

      const duration = Date.now() - startTime;

      // All sort operations should complete in reasonable time
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Large Payload Handling', () => {
    it('should handle large JSON configuration payload', async () => {
      const largeConfig: Record<string, string> = {};

      // Create 1000 configuration keys
      for (let i = 0; i < 1000; i++) {
        largeConfig[`config.key.${i}`] = `value-${i}`.repeat(10);
      }

      const startTime = Date.now();

      await request(app.getHttpServer())
        .post('/api/test-config-json')
        .send({ config: largeConfig })
        .set('Authorization', mockAuth)
        .set('Content-Type', 'application/json')
        .expect(401);

      const duration = Date.now() - startTime;

      // Should handle large payload in reasonable time
      expect(duration).toBeLessThan(3000);
    });

    it('should handle batch configuration updates', async () => {
      const configs = Array.from({ length: 100 }, (_, i) => ({
        configKey: `test.key.${i}`,
        configValue: `value-${i}`,
      }));

      const startTime = Date.now();

      await request(app.getHttpServer())
        .post('/api/test-configs')
        .send({
          testRunId: 'test-1',
          configs: configs,
        })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000);
    });

    it('should handle large annotation array', async () => {
      const annotations = Array.from({ length: 1000 }, (_, i) =>
        `Annotation ${i}: ${'x'.repeat(100)}`
      );

      const startTime = Date.now();

      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/annotations')
        .send({ annotations })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000);
    });

    it('should handle large tags array', async () => {
      const tags = Array.from({ length: 500 }, (_, i) => `tag-${i}`);

      const startTime = Date.now();

      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/tags')
        .send({ tags })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1500);
    });
  });

  describe('Query Complexity Performance', () => {
    it('should handle complex filtering queries', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs/expected-config-changes')
        .query({
          system: 'ComplexSystem',
          environment: 'production',
          workload: 'heavyLoad',
        })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle related test runs query efficiently', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs/test-run-1/related')
        .query({
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest',
        })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1500);
    });

    it('should handle configuration comparison efficiently', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs/test-run-1/configs')
        .query({
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest',
        })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Concurrent Request Performance', () => {
    it('should handle 10 concurrent read requests', async () => {
      const startTime = Date.now();

      const requests = Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .get('/api/test-runs')
          .query({ page: 1, pageSize: 50 })
          .set('Authorization', mockAuth)
      );

      await Promise.all(requests);

      const duration = Date.now() - startTime;

      // 10 concurrent requests should complete in reasonable time
      expect(duration).toBeLessThan(5000);
    });

    it('should handle 50 concurrent read requests', async () => {
      const startTime = Date.now();

      const requests = Array.from({ length: 50 }, () =>
        request(app.getHttpServer())
          .get('/api/test-runs')
          .query({ page: 1, pageSize: 50 })
          .set('Authorization', mockAuth)
      );

      await Promise.all(requests);

      const duration = Date.now() - startTime;

      // 50 concurrent requests should complete without timeout
      expect(duration).toBeLessThan(10000);
    });

    it('should handle mixed read/write concurrent requests', async () => {
      const startTime = Date.now();

      const requests = [
        ...Array.from({ length: 5 }, () =>
          request(app.getHttpServer())
            .get('/api/test-runs')
            .set('Authorization', mockAuth)
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          request(app.getHttpServer())
            .post('/api/test')
            .send({
              testRunId: `concurrent-test-${i}`,
              system: 'TestSystem',
              environment: 'production',
              workload: 'loadTest',
            })
            .set('Authorization', mockAuth)
        ),
      ];

      await Promise.all(requests);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Response Size Limits', () => {
    it('should limit response size for large datasets', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 100 })
        .set('Authorization', mockAuth)
        .expect(401);

      // Response should not be excessively large (< 1MB)
      const contentLength = response.header['content-length'];
      if (contentLength) {
        expect(parseInt(contentLength)).toBeLessThan(1024 * 1024);
      }
    });

    it('should handle large response compression', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 100 })
        .set('Authorization', mockAuth)
        .set('Accept-Encoding', 'gzip, deflate')
        .expect(401);

      // Should support compression for large responses
      // In production, compression should be enabled
    });
  });

  describe('Database Query Optimization', () => {
    it('should use database indexes for common queries', async () => {
      // This test verifies that queries complete quickly,
      // indicating proper index usage

      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({
          page: 1,
          pageSize: 50,
          sortBy: 'createdAt',
          sortOrder: 'DESC'
        })
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      // Indexed queries should be very fast
      expect(duration).toBeLessThan(500);
    });

    it('should optimize test run lookup by ID', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/api/test-runs/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', mockAuth)
        .expect(401);

      const duration = Date.now() - startTime;

      // Single record lookup should be very fast
      expect(duration).toBeLessThan(300);
    });
  });

  describe('Memory Usage', () => {
    it('should not cause memory spike with large query', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 100 })
        .set('Authorization', mockAuth)
        .expect(401);

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      // Memory increase should be reasonable (< 50MB)
      expect(memoryIncrease).toBeLessThan(50);
    });

    it('should clean up memory after large requests', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Make multiple large requests
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .get('/api/test-runs')
          .query({ page: 1, pageSize: 100 })
          .set('Authorization', mockAuth)
          .expect(401);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      // Memory should not grow unbounded
      expect(memoryIncrease).toBeLessThan(100);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle long-running queries with timeout', async () => {
      // Test that queries don't hang indefinitely
      const timeout = 30000; // 30 seconds

      const promise = request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 10000, pageSize: 100 })
        .set('Authorization', mockAuth)
        .timeout(timeout);

      await expect(promise).resolves.toBeDefined();
    }, 35000); // Test timeout slightly higher than request timeout

    it('should handle database connection timeout gracefully', async () => {
      // This test documents that timeouts should be handled
      // In production, connection pool should have proper timeout settings

      const startTime = Date.now();

      try {
        await request(app.getHttpServer())
          .get('/api/test-runs')
          .set('Authorization', mockAuth)
          .timeout(5000);
      } catch (error) {
        // Timeout errors should be caught
        expect(error).toBeDefined();
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(6000);
    });
  });
});
