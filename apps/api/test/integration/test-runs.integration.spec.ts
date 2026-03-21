import { HttpStatus } from '@nestjs/common';
import { TestRunsModule } from '../../src/modules/test-runs/test-runs.module';
import { SystemsUnderTestModule } from '../../src/modules/systems-under-test/systems-under-test.module';
import { ApiKeysModule } from '../../src/modules/api-keys/api-keys.module';
import {
  createTestApp,
  closeTestApp,
  getAuthHeaders,
  getApiKeyHeaders,
  generateTestRunId,
  generateUUID,
  cleanupTestData,
  IntegrationTestContext,
} from '../helpers/integration-test.helper';

describe('Test Runs API Integration Tests', () => {
  let context: IntegrationTestContext;

  beforeAll(async () => {
    context = await createTestApp(
      [TestRunsModule, SystemsUnderTestModule, ApiKeysModule],
      [],
      [],
    );
  });

  afterAll(async () => {
    await cleanupTestData(context.dataSource, [
      'test_run_configurations',
      'test_runs',
      'systems_under_test',
    ]);
    await closeTestApp(context);
  });

  describe('POST /api/test - Create Test Run', () => {
    it('should create a new test run with full payload', async () => {
      const testRunId = generateTestRunId('integration-test');
      const payload = {
        systemUnderTest: 'PaymentService',
        testEnvironment: 'production',
        workload: 'loadTest',
        testRunId,
        completed: false,
        version: '1.2.3',
        annotations: 'Integration test for payment service',
        tags: ['integration', 'payment', 'load'],
        CIBuildResultsUrl: 'https://jenkins.example.com/build/123',
        start: new Date().toISOString(),
        duration: 3600,
        rampUp: 300,
      };

      const response = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send(payload)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('id');
      expect(response.body.test_run_id).toBe(testRunId);
      expect(response.body.system_under_test_id).toBeDefined();
      expect(response.body.test_environment).toBe('production');
      expect(response.body.workload).toBe('loadTest');
      expect(response.body.version).toBe('1.2.3');
      expect(response.body.annotations).toContain('Integration test');
      expect(response.body.tags).toEqual(expect.arrayContaining(['integration', 'payment']));
    });

    it('should update existing test run when called with same testRunId', async () => {
      const testRunId = generateTestRunId('update-test');

      // Create initial test run
      const createPayload = {
        systemUnderTest: 'OrderService',
        testEnvironment: 'staging',
        workload: 'smokeTest',
        testRunId,
        completed: false,
        start: new Date().toISOString(),
      };

      await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send(createPayload)
        .expect(HttpStatus.OK);

      // Update with completed=true
      const updatePayload = {
        ...createPayload,
        completed: true,
        end: new Date().toISOString(),
        duration: 1800,
      };

      const response = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send(updatePayload)
        .expect(HttpStatus.OK);

      expect(response.body.completed).toBe(true);
      expect(response.body.end_time).toBeDefined();
      expect(response.body.duration).toBe(1800);
    });

    it('should validate required fields and return 400', async () => {
      const invalidPayload = {
        systemUnderTest: 'TestService',
        // Missing testEnvironment, workload, testRunId
        completed: false,
      };

      await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send(invalidPayload)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should accept API key authentication', async () => {
      const testRunId = generateTestRunId('api-key-test');
      const payload = {
        systemUnderTest: 'APITestService',
        testEnvironment: 'dev',
        workload: 'perfTest',
        testRunId,
        completed: false,
      };

      const response = await context.request
        .post('/api/test')
        .set(getApiKeyHeaders('test-integration', generateUUID()))
        .send(payload)
        .expect(HttpStatus.OK);

      expect(response.body.test_run_id).toBe(testRunId);
    });

    it('should handle abort scenario', async () => {
      const testRunId = generateTestRunId('abort-test');
      const payload = {
        systemUnderTest: 'AbortService',
        testEnvironment: 'qa',
        workload: 'stressTest',
        testRunId,
        completed: false,
        abort: true,
        abortMessage: 'Test aborted due to high error rate',
      };

      const response = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send(payload)
        .expect(HttpStatus.OK);

      expect(response.body.abort).toBe(true);
      expect(response.body.abort_message).toBe('Test aborted due to high error rate');
    });

    it('should handle variables in test run creation', async () => {
      const testRunId = generateTestRunId('vars-test');
      const payload = {
        systemUnderTest: 'VarsService',
        testEnvironment: 'production',
        workload: 'loadTest',
        testRunId,
        completed: false,
        variables: [
          { placeholder: '${hostname}', value: 'prod-server-01' },
          { placeholder: '${region}', value: 'us-east-1' },
        ],
      };

      const response = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send(payload)
        .expect(HttpStatus.OK);

      expect(response.body.variables).toBeDefined();
      expect(response.body.variables).toHaveLength(2);
    });

    it('should handle deep links in test run creation', async () => {
      const testRunId = generateTestRunId('deeplink-test');
      const payload = {
        systemUnderTest: 'DeepLinkService',
        testEnvironment: 'staging',
        workload: 'loadTest',
        testRunId,
        completed: false,
        deepLinks: [
          { name: 'Grafana Dashboard', url: 'https://grafana.example.com/d/abc123' },
          { name: 'Kibana Logs', url: 'https://kibana.example.com/app/logs' },
        ],
      };

      const response = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send(payload)
        .expect(HttpStatus.OK);

      expect(response.body.deep_links).toBeDefined();
      expect(response.body.deep_links).toHaveLength(2);
    });
  });

  describe('POST /api/config/key - Add Single Configuration', () => {
    let testRunId: string;

    beforeEach(async () => {
      testRunId = generateTestRunId('config-test');
      await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'ConfigService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId,
          completed: false,
        });
    });

    it('should add single configuration key-value pair', async () => {
      const configPayload = {
        testRunId,
        key: 'jvm.heap.size',
        value: '2048m',
      };

      const response = await context.request
        .post('/api/config/key')
        .set(getAuthHeaders())
        .send(configPayload)
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('added');
    });

    it('should add configuration with nested JSON value', async () => {
      const configPayload = {
        testRunId,
        key: 'database.config',
        value: JSON.stringify({
          host: 'db.example.com',
          port: 5432,
          poolSize: 50,
          ssl: true,
        }),
      };

      const response = await context.request
        .post('/api/config/key')
        .set(getAuthHeaders())
        .send(configPayload)
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('added');

      // Verify it was stored
      const configs = await context.request
        .get(`/api/test-runs/${testRunId}/configs`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      const dbConfig = configs.body.find((c: any) => c.key === 'database.config');
      expect(dbConfig).toBeDefined();
      const parsedValue = JSON.parse(dbConfig.value);
      expect(parsedValue.host).toBe('db.example.com');
      expect(parsedValue.poolSize).toBe(50);
    });

    it('should return 404 for non-existent test run', async () => {
      const configPayload = {
        testRunId: 'non-existent-test-run',
        key: 'some.key',
        value: 'some.value',
      };

      await context.request
        .post('/api/config/key')
        .set(getAuthHeaders())
        .send(configPayload)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should validate key format', async () => {
      const invalidConfigPayload = {
        testRunId,
        key: '', // Empty key
        value: 'some-value',
      };

      await context.request
        .post('/api/config/key')
        .set(getAuthHeaders())
        .send(invalidConfigPayload)
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('POST /api/config/keys - Add Multiple Configurations', () => {
    let testRunId: string;

    beforeEach(async () => {
      testRunId = generateTestRunId('multi-config-test');
      await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'MultiConfigService',
          testEnvironment: 'staging',
          workload: 'loadTest',
          testRunId,
          completed: false,
        });
    });

    it('should add multiple configuration key-value pairs', async () => {
      const configsPayload = {
        testRunId,
        configItems: [
          { key: 'jvm.heap.size', value: '2048m' },
          { key: 'jvm.gc.algorithm', value: 'G1GC' },
          { key: 'thread.pool.size', value: '100' },
          { key: 'connection.timeout', value: '30000' },
        ],
      };

      const response = await context.request
        .post('/api/config/keys')
        .set(getAuthHeaders())
        .send(configsPayload)
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('added');

      // Verify all configs were stored
      const configs = await context.request
        .get(`/api/test-runs/${testRunId}/configs`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(configs.body).toHaveLength(4);
      expect(configs.body.map((c: any) => c.key)).toEqual(
        expect.arrayContaining(['jvm.heap.size', 'jvm.gc.algorithm', 'thread.pool.size', 'connection.timeout']),
      );
    });

    it('should handle empty configItems array', async () => {
      const configsPayload = {
        testRunId,
        configItems: [],
      };

      await context.request
        .post('/api/config/keys')
        .set(getAuthHeaders())
        .send(configsPayload)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should validate all config items', async () => {
      const invalidConfigsPayload = {
        testRunId,
        configItems: [
          { key: 'valid.key', value: 'valid-value' },
          { key: '', value: 'invalid-empty-key' }, // Invalid
        ],
      };

      await context.request
        .post('/api/config/keys')
        .set(getAuthHeaders())
        .send(invalidConfigsPayload)
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('POST /api/config/json - Add Configuration from JSON', () => {
    let testRunId: string;

    beforeEach(async () => {
      testRunId = generateTestRunId('json-config-test');
      await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'JSONConfigService',
          testEnvironment: 'qa',
          workload: 'perfTest',
          testRunId,
          completed: false,
        });
    });

    it('should add configuration from JSON object', async () => {
      const jsonConfigPayload = {
        testRunId,
        json: {
          'application.name': 'PaymentService',
          'application.version': '2.0.0',
          'server.port': '8080',
          'database.url': 'jdbc:postgresql://localhost:5432/perfana',
          'feature.flags': {
            newPaymentFlow: true,
            legacySupport: false,
          },
        },
      };

      const response = await context.request
        .post('/api/config/json')
        .set(getAuthHeaders())
        .send(jsonConfigPayload)
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('added');

      // Verify configs were stored
      const configs = await context.request
        .get(`/api/test-runs/${testRunId}/configs`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(configs.body.length).toBeGreaterThan(0);
      const appName = configs.body.find((c: any) => c.key === 'application.name');
      expect(appName?.value).toBe('PaymentService');
    });

    it('should filter configuration with include patterns', async () => {
      const jsonConfigPayload = {
        testRunId,
        json: {
          'jvm.heap.size': '4096m',
          'jvm.gc.algorithm': 'G1GC',
          'database.pool.size': '100',
          'application.name': 'TestApp',
          'application.version': '1.0.0',
        },
        includes: ['^jvm\\.', '^application\\.'],
      };

      const response = await context.request
        .post('/api/config/json')
        .set(getAuthHeaders())
        .send(jsonConfigPayload)
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('added');

      // Verify only jvm.* and application.* keys were stored
      const configs = await context.request
        .get(`/api/test-runs/${testRunId}/configs`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      const keys = configs.body.map((c: any) => c.key);
      expect(keys).toEqual(
        expect.arrayContaining(['jvm.heap.size', 'jvm.gc.algorithm', 'application.name', 'application.version']),
      );
      expect(keys).not.toContain('database.pool.size');
    });

    it('should filter configuration with exclude patterns', async () => {
      const jsonConfigPayload = {
        testRunId,
        json: {
          'password': 'secret123',
          'api.key': 'abc-xyz-789',
          'jvm.heap.size': '2048m',
          'database.url': 'jdbc:postgresql://localhost:5432/db',
        },
        excludes: ['password', 'api\\.key'],
      };

      const response = await context.request
        .post('/api/config/json')
        .set(getAuthHeaders())
        .send(jsonConfigPayload)
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('added');

      // Verify sensitive keys were excluded
      const configs = await context.request
        .get(`/api/test-runs/${testRunId}/configs`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      const keys = configs.body.map((c: any) => c.key);
      expect(keys).not.toContain('password');
      expect(keys).not.toContain('api.key');
      expect(keys).toContain('jvm.heap.size');
      expect(keys).toContain('database.url');
    });

    it('should combine include and exclude patterns', async () => {
      const jsonConfigPayload = {
        testRunId,
        json: {
          'jvm.heap.size': '2048m',
          'jvm.password': 'secret',
          'database.url': 'jdbc:postgresql://localhost:5432/db',
          'database.password': 'dbsecret',
          'app.name': 'TestApp',
        },
        includes: ['^jvm\\.', '^database\\.'],
        excludes: ['password'],
      };

      const response = await context.request
        .post('/api/config/json')
        .set(getAuthHeaders())
        .send(jsonConfigPayload)
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('added');

      // Verify only jvm.* and database.* keys were stored, excluding passwords
      const configs = await context.request
        .get(`/api/test-runs/${testRunId}/configs`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      const keys = configs.body.map((c: any) => c.key);
      expect(keys).toContain('jvm.heap.size');
      expect(keys).toContain('database.url');
      expect(keys).not.toContain('jvm.password');
      expect(keys).not.toContain('database.password');
      expect(keys).not.toContain('app.name');
    });

    it('should reject malicious regex patterns', async () => {
      const maliciousPayload = {
        testRunId,
        json: { 'test.key': 'value' },
        includes: ['(a+)+$'], // ReDoS pattern
      };

      await context.request
        .post('/api/config/json')
        .set(getAuthHeaders())
        .send(maliciousPayload)
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('GET /api/test-runs - List Test Runs', () => {
    beforeAll(async () => {
      // Create multiple test runs for pagination testing
      const testRuns = [
        { systemUnderTest: 'ListService1', testEnvironment: 'prod', workload: 'load' },
        { systemUnderTest: 'ListService2', testEnvironment: 'staging', workload: 'smoke' },
        { systemUnderTest: 'ListService3', testEnvironment: 'qa', workload: 'stress' },
      ];

      for (const tr of testRuns) {
        await context.request
          .post('/api/test')
          .set(getAuthHeaders())
          .send({
            ...tr,
            testRunId: generateTestRunId(`list-${tr.systemUnderTest}`),
            completed: false,
          });
      }
    });

    it('should return paginated test runs with default params', async () => {
      const response = await context.request
        .get('/api/test-runs')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('pageSize');
      expect(response.body).toHaveProperty('totalPages');
      expect(response.body).toHaveProperty('hasNextPage');
      expect(response.body).toHaveProperty('hasPreviousPage');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should support custom pagination parameters', async () => {
      const response = await context.request
        .get('/api/test-runs?page=1&pageSize=10')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(10);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
    });

    it('should support sorting by field', async () => {
      const response = await context.request
        .get('/api/test-runs?sortBy=createdAt&sortOrder=DESC')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body.data).toBeDefined();
      // Verify descending order (most recent first)
      if (response.body.data.length > 1) {
        const first = new Date(response.body.data[0].created_at);
        const second = new Date(response.body.data[1].created_at);
        expect(first >= second).toBe(true);
      }
    });

    it('should handle empty results gracefully', async () => {
      const response = await context.request
        .get('/api/test-runs?page=9999')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.hasNextPage).toBe(false);
    });
  });

  describe('GET /api/test-runs/:testRunId - Get Single Test Run', () => {
    let testRunId: string;
    let uuid: string;

    beforeAll(async () => {
      testRunId = generateTestRunId('single-test');
      const response = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'SingleTestService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId,
          completed: true,
          version: '3.1.4',
          tags: ['single', 'test'],
        });
      uuid = response.body.id;
    });

    it('should retrieve test run by UUID', async () => {
      const response = await context.request
        .get(`/api/test-runs/${uuid}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body.id).toBe(uuid);
      expect(response.body.test_run_id).toBe(testRunId);
      expect(response.body.version).toBe('3.1.4');
    });

    it('should retrieve test run by test_run_id with query params', async () => {
      const response = await context.request
        .get(`/api/test-runs/${testRunId}?system=SingleTestService&environment=production&workload=loadTest`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body.test_run_id).toBe(testRunId);
      expect(response.body.system_under_test_id).toBeDefined();
    });

    it('should return 404 for non-existent test run', async () => {
      await context.request
        .get(`/api/test-runs/${generateUUID()}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 400 for invalid UUID format', async () => {
      await context.request
        .get('/api/test-runs/invalid-uuid-format')
        .set(getAuthHeaders())
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('GET /api/test-runs/:testRunId/configs - Get Test Run Configurations', () => {
    let testRunId: string;

    beforeAll(async () => {
      testRunId = generateTestRunId('get-configs-test');
      await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'GetConfigsService',
          testEnvironment: 'staging',
          workload: 'loadTest',
          testRunId,
          completed: false,
        });

      // Add configurations
      await context.request
        .post('/api/config/keys')
        .set(getAuthHeaders())
        .send({
          testRunId,
          configItems: [
            { key: 'config.key1', value: 'value1' },
            { key: 'config.key2', value: 'value2' },
            { key: 'config.key3', value: 'value3' },
          ],
        });
    });

    it('should retrieve all configurations for a test run', async () => {
      const response = await context.request
        .get(`/api/test-runs/${testRunId}/configs`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(3);
      expect(response.body.map((c: any) => c.key)).toEqual(
        expect.arrayContaining(['config.key1', 'config.key2', 'config.key3']),
      );
    });

    it('should return empty array for test run with no configurations', async () => {
      const newTestRunId = generateTestRunId('no-configs');
      await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'NoConfigsService',
          testEnvironment: 'dev',
          workload: 'smokeTest',
          testRunId: newTestRunId,
          completed: false,
        });

      const response = await context.request
        .get(`/api/test-runs/${newTestRunId}/configs`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body).toHaveLength(0);
    });
  });

  describe('PUT /api/test-runs/:id/annotations - Update Annotations', () => {
    let uuid: string;

    beforeAll(async () => {
      const response = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'AnnotationsService',
          testEnvironment: 'qa',
          workload: 'loadTest',
          testRunId: generateTestRunId('annotations-test'),
          completed: false,
        });
      uuid = response.body.id;
    });

    it('should update test run annotations', async () => {
      const newAnnotations = ['Updated annotation 1', 'Updated annotation 2'];

      const response = await context.request
        .put(`/api/test-runs/${uuid}/annotations`)
        .set(getAuthHeaders())
        .send({ annotations: newAnnotations })
        .expect(HttpStatus.OK);

      expect(response.body.annotations).toEqual(newAnnotations);
    });

    it('should handle empty annotations array', async () => {
      const response = await context.request
        .put(`/api/test-runs/${uuid}/annotations`)
        .set(getAuthHeaders())
        .send({ annotations: [] })
        .expect(HttpStatus.OK);

      expect(response.body.annotations).toHaveLength(0);
    });

    it('should validate annotations must be an array', async () => {
      await context.request
        .put(`/api/test-runs/${uuid}/annotations`)
        .set(getAuthHeaders())
        .send({ annotations: 'not-an-array' })
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('PUT /api/test-runs/:id/tags - Update Tags', () => {
    let uuid: string;

    beforeAll(async () => {
      const response = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'TagsService',
          testEnvironment: 'production',
          workload: 'perfTest',
          testRunId: generateTestRunId('tags-test'),
          completed: false,
        });
      uuid = response.body.id;
    });

    it('should update test run tags', async () => {
      const newTags = ['performance', 'production', 'critical'];

      const response = await context.request
        .put(`/api/test-runs/${uuid}/tags`)
        .set(getAuthHeaders())
        .send({ tags: newTags })
        .expect(HttpStatus.OK);

      expect(response.body.tags).toEqual(newTags);
    });

    it('should handle empty tags array', async () => {
      const response = await context.request
        .put(`/api/test-runs/${uuid}/tags`)
        .set(getAuthHeaders())
        .send({ tags: [] })
        .expect(HttpStatus.OK);

      expect(response.body.tags).toHaveLength(0);
    });

    it('should validate tags must be an array', async () => {
      await context.request
        .put(`/api/test-runs/${uuid}/tags`)
        .set(getAuthHeaders())
        .send({ tags: 'not-an-array' })
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('DELETE /api/test-runs/:id - Delete Test Run', () => {
    it('should delete a test run by UUID', async () => {
      const testRunId = generateTestRunId('delete-test');
      const createResponse = await context.request
        .post('/api/test')
        .set(getAuthHeaders())
        .send({
          systemUnderTest: 'DeleteService',
          testEnvironment: 'dev',
          workload: 'loadTest',
          testRunId,
          completed: false,
        });

      const uuid = createResponse.body.id;

      const deleteResponse = await context.request
        .delete(`/api/test-runs/${uuid}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(deleteResponse.body.message).toContain('deleted successfully');

      // Verify it's deleted
      await context.request
        .get(`/api/test-runs/${uuid}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 404 for non-existent test run', async () => {
      await context.request
        .delete(`/api/test-runs/${generateUUID()}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 400 for invalid UUID', async () => {
      await context.request
        .delete('/api/test-runs/invalid-uuid')
        .set(getAuthHeaders())
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('Authentication and Authorization', () => {
    it('should reject requests without authentication', async () => {
      await context.request
        .get('/api/test-runs')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should accept valid Keycloak JWT token', async () => {
      await context.request
        .get('/api/test-runs')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);
    });

    it('should accept valid API key token', async () => {
      await context.request
        .get('/api/test-runs')
        .set(getApiKeyHeaders('integration-test', generateUUID()))
        .expect(HttpStatus.OK);
    });
  });
});
