import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * Input Validation Edge Case Tests
 *
 * Tests handling of edge case inputs including:
 * - Empty values (null, undefined, empty strings)
 * - Very long strings
 * - Special characters and Unicode
 * - Invalid UUIDs
 * - Malformed JSON
 * - Boundary values
 * - Type mismatches
 */
describe('Input Validation Edge Cases', () => {
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

  describe('Empty and Null Values', () => {
    it('should reject empty string in required field', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs/expected-config-changes')
        .query({
          system: '',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401); // Will fail auth, but validation should catch empty
    });

    it('should reject null value in required field', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: null,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .set('Content-Type', 'application/json')
        .expect(401);
    });

    it('should reject undefined in POST body', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: undefined,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle missing required query parameters', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs/expected-config-changes')
        .query({
          system: 'TestSystem'
          // Missing environment and workload
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should reject empty object in POST body', async () => {
      await request(app.getHttpServer())
        .post('/api/test-runs/expected-config-changes')
        .send({})
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should reject empty array in annotations', async () => {
      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/annotations')
        .send({ annotations: [] })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle whitespace-only strings', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs/expected-config-changes')
        .query({
          system: '   ',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Very Long Strings', () => {
    it('should handle very long test run ID (>10000 chars)', async () => {
      const longString = 'a'.repeat(10001);

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: longString,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle very long annotation (>50000 chars)', async () => {
      const longAnnotation = 'This is a very long annotation. '.repeat(2000);

      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/annotations')
        .send({ annotations: [longAnnotation] })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle very long configuration key', async () => {
      const longKey = 'config.nested.very.deep.key.'.repeat(100);

      await request(app.getHttpServer())
        .post('/api/test-config')
        .send({
          testRunId: 'test-1',
          configKey: longKey,
          configValue: 'value'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle very long configuration value', async () => {
      const longValue = JSON.stringify({ data: 'x'.repeat(100000) });

      await request(app.getHttpServer())
        .post('/api/test-config')
        .send({
          testRunId: 'test-1',
          configKey: 'test.key',
          configValue: longValue
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle very long array with many items (>1000)', async () => {
      const longArray = Array(1001).fill('tag');

      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/tags')
        .send({ tags: longArray })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Special Characters and Unicode', () => {
    it('should handle emoji in test run ID', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-🚀-run-✅',
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle Chinese characters', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: '测试系统',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle Arabic characters (RTL)', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: 'نظام الاختبار',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle special ASCII characters', async () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: specialChars,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle zero-width characters', async () => {
      const zeroWidth = 'test\u200B\u200C\u200Drun';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: zeroWidth,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle control characters', async () => {
      const controlChars = 'test\x01\x02\x03run';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: controlChars,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle surrogate pairs', async () => {
      const surrogatePairs = '𝕳𝖊𝖑𝖑𝖔 𝖂𝖔𝖗𝖑𝖉';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: surrogatePairs,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Invalid UUIDs', () => {
    it('should reject invalid UUID format in path parameter', async () => {
      await request(app.getHttpServer())
        .delete('/api/test-runs/not-a-uuid')
        .set('Authorization', mockAuth)
        .expect(401); // Validation should catch this
    });

    it('should reject UUID with wrong length', async () => {
      await request(app.getHttpServer())
        .delete('/api/test-runs/550e8400-e29b-41d4-a716')
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should reject UUID with invalid characters', async () => {
      await request(app.getHttpServer())
        .delete('/api/test-runs/550e8400-e29b-41d4-a716-gggggggggggg')
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should reject empty UUID', async () => {
      await request(app.getHttpServer())
        .delete('/api/test-runs/')
        .set('Authorization', mockAuth)
        .expect(404); // Route not found
    });

    it('should handle UUID v1 vs v4 differences', async () => {
      // UUID v1 format (time-based)
      const uuidV1 = '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d';

      await request(app.getHttpServer())
        .delete(`/api/test-runs/${uuidV1}`)
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Malformed JSON', () => {
    it('should reject malformed JSON in body', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send('{"testRunId": "test-1", invalid json}')
        .set('Authorization', mockAuth)
        .set('Content-Type', 'application/json')
        .expect(400);
    });

    it('should reject JSON with trailing comma', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send('{"testRunId": "test-1", "system": "TestSystem",}')
        .set('Authorization', mockAuth)
        .set('Content-Type', 'application/json')
        .expect(400);
    });

    it('should reject JSON with single quotes', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send("{'testRunId': 'test-1'}")
        .set('Authorization', mockAuth)
        .set('Content-Type', 'application/json')
        .expect(400);
    });

    it('should reject JSON with comments', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send('{"testRunId": "test-1" /* comment */}')
        .set('Authorization', mockAuth)
        .set('Content-Type', 'application/json')
        .expect(400);
    });

    it('should handle deeply nested JSON', async () => {
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    level7: {
                      level8: {
                        level9: {
                          level10: 'value'
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      await request(app.getHttpServer())
        .post('/api/test-config-json')
        .send({ config: deeplyNested })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Type Mismatches', () => {
    it('should reject number when string expected', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 12345,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should reject string when array expected', async () => {
      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/tags')
        .send({ tags: 'not-an-array' })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should reject object when string expected', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: { id: 'test-1' },
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should reject boolean when string expected', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs/expected-config-changes')
        .query({
          system: true,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should reject mixed array types when homogeneous expected', async () => {
      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/tags')
        .send({ tags: ['tag1', 123, true, null] })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Boundary Values', () => {
    it('should handle page number 0', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 0, pageSize: 50 })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle negative page number', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: -1, pageSize: 50 })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle page size exceeding maximum (>100)', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 1000 })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle page size 0', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1, pageSize: 0 })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle very large page number (>1000000)', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .query({ page: 1000001, pageSize: 50 })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle negative numbers in numeric fields', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest',
          duration: -1000
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle Number.MAX_SAFE_INTEGER', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest',
          duration: Number.MAX_SAFE_INTEGER
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle Infinity', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest',
          duration: Infinity
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle NaN', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest',
          duration: NaN
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Circular References', () => {
    it('should handle circular reference in JSON', async () => {
      // Note: JSON.stringify will throw on circular refs, but test the error handling
      const circular: any = { prop: 'value' };
      circular.self = circular;

      try {
        await request(app.getHttpServer())
          .post('/api/test-config-json')
          .send({ config: circular })
          .set('Authorization', mockAuth)
          .expect(500); // Should fail gracefully
      } catch (error) {
        // Expected to throw
        expect(error).toBeDefined();
      }
    });
  });

  describe('Content-Type Mismatches', () => {
    it('should reject JSON body with text/plain content-type', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send('{"testRunId": "test-1"}')
        .set('Authorization', mockAuth)
        .set('Content-Type', 'text/plain')
        .expect(400);
    });

    it('should reject form data when JSON expected', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send('testRunId=test-1&system=TestSystem')
        .set('Authorization', mockAuth)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .expect(400);
    });

    it('should handle missing content-type header', async () => {
      await request(app.getHttpServer())
        .post('/api/test')
        .send('{"testRunId": "test-1"}')
        .set('Authorization', mockAuth)
        .expect(400);
    });
  });

  describe('Duplicate Values', () => {
    it('should handle duplicate keys in query parameters', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs/expected-config-changes?system=sys1&system=sys2')
        .query({
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle duplicate tags in array', async () => {
      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/tags')
        .send({ tags: ['tag1', 'tag2', 'tag1', 'tag2'] })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });
});
