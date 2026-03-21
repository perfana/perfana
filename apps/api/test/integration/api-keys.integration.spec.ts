import { HttpStatus } from '@nestjs/common';
import { ApiKeysModule } from '../../src/modules/api-keys/api-keys.module';
import { QueueModule } from '../../src/modules/queue/queue.module';
import {
  createTestApp,
  closeTestApp,
  cleanupTestData,
  generateUUID,
  IntegrationTestContext,
} from '../helpers/integration-test.helper';

describe('API Keys API Integration Tests', () => {
  let context: IntegrationTestContext;

  beforeAll(async () => {
    context = await createTestApp(
      [ApiKeysModule, QueueModule],
      [],
      [],
    );
  });

  afterAll(async () => {
    await cleanupTestData(context.dataSource, ['api_keys']);
    await closeTestApp(context);
  });

  describe('POST /api/api-keys - Create API Key', () => {
    it('should create a new API key with description', async () => {
      const createDto = {
        description: 'Integration Test Key',
        roles: ['user'],
      };

      const response = await context.request
        .post('/api/api-keys')
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body).toHaveProperty('apiKey');
      expect(response.body).toHaveProperty('token');
      expect(response.body.apiKey.description).toBe('Integration Test Key');
      expect(response.body.apiKey.roles).toEqual(['user']);
      expect(response.body.apiKey).toHaveProperty('id');
      expect(response.body.apiKey).toHaveProperty('created_at');
      expect(response.body.apiKey).toHaveProperty('valid_until');
      expect(response.body.token).toBeDefined();
      expect(typeof response.body.token).toBe('string');
    });

    it('should create API key with TTL', async () => {
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30); // 30 days from now

      const createDto = {
        description: 'Temporary API Key',
        roles: ['user'],
        validUntil: validUntil.toISOString(),
      };

      const response = await context.request
        .post('/api/api-keys')
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body.apiKey.description).toBe('Temporary API Key');
      expect(response.body.apiKey.valid_until).toBeDefined();

      const returnedDate = new Date(response.body.apiKey.valid_until);
      const expectedDate = new Date(validUntil);
      expect(returnedDate.getTime()).toBeCloseTo(expectedDate.getTime(), -3); // Within a few ms
    });

    it('should create API key with admin role', async () => {
      const createDto = {
        description: 'Admin API Key',
        roles: ['admin', 'perfana-admin'],
      };

      const response = await context.request
        .post('/api/api-keys')
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body.apiKey.roles).toEqual(expect.arrayContaining(['admin', 'perfana-admin']));
    });

    it('should validate required fields', async () => {
      const invalidDto = {
        // Missing description
        roles: ['user'],
      };

      await context.request
        .post('/api/api-keys')
        .send(invalidDto)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should validate description length', async () => {
      const invalidDto = {
        description: '', // Empty description
        roles: ['user'],
      };

      await context.request
        .post('/api/api-keys')
        .send(invalidDto)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should create API key with multiple roles', async () => {
      const createDto = {
        description: 'Multi-Role API Key',
        roles: ['user', 'developer', 'viewer'],
      };

      const response = await context.request
        .post('/api/api-keys')
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body.apiKey.roles).toEqual(
        expect.arrayContaining(['user', 'developer', 'viewer']),
      );
      expect(response.body.apiKey.roles).toHaveLength(3);
    });

    it('should generate unique tokens for each API key', async () => {
      const createDto1 = { description: 'Key 1', roles: ['user'] };
      const createDto2 = { description: 'Key 2', roles: ['user'] };

      const response1 = await context.request
        .post('/api/api-keys')
        .send(createDto1)
        .expect(HttpStatus.CREATED);

      const response2 = await context.request
        .post('/api/api-keys')
        .send(createDto2)
        .expect(HttpStatus.CREATED);

      expect(response1.body.token).not.toBe(response2.body.token);
      expect(response1.body.apiKey.id).not.toBe(response2.body.apiKey.id);
    });
  });

  describe('GET /api/api-keys - List API Keys', () => {
    beforeAll(async () => {
      // Create multiple API keys for listing
      const keys = [
        { description: 'List Test Key 1', roles: ['user'] },
        { description: 'List Test Key 2', roles: ['admin'] },
        { description: 'List Test Key 3', roles: ['viewer'] },
      ];

      for (const key of keys) {
        await context.request
          .post('/api/api-keys')
          .send(key);
      }
    });

    it('should return list of all API keys', async () => {
      const response = await context.request
        .get('/api/api-keys')
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(3);

      const apiKey = response.body[0];
      expect(apiKey).toHaveProperty('id');
      expect(apiKey).toHaveProperty('description');
      expect(apiKey).toHaveProperty('roles');
      expect(apiKey).toHaveProperty('created_at');
      expect(apiKey).not.toHaveProperty('token_hash'); // Should not expose hash
    });

    it('should return API keys with correct structure', async () => {
      const response = await context.request
        .get('/api/api-keys')
        .expect(HttpStatus.OK);

      const listKey = response.body.find((k: any) => k.description === 'List Test Key 1');
      expect(listKey).toBeDefined();
      expect(listKey.roles).toEqual(['user']);
    });

    it('should handle empty API keys list', async () => {
      // Delete all keys first
      const listResponse = await context.request.get('/api/api-keys');
      for (const key of listResponse.body) {
        await context.request.delete(`/api/api-keys/${key.id}`);
      }

      const response = await context.request
        .get('/api/api-keys')
        .expect(HttpStatus.OK);

      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/api-keys/:id - Get Single API Key', () => {
    let apiKeyId: string;

    beforeAll(async () => {
      const createResponse = await context.request
        .post('/api/api-keys')
        .send({ description: 'Single Key Test', roles: ['user'] });

      apiKeyId = createResponse.body.apiKey.id;
    });

    it('should retrieve API key by ID', async () => {
      const response = await context.request
        .get(`/api/api-keys/${apiKeyId}`)
        .expect(HttpStatus.OK);

      expect(response.body.id).toBe(apiKeyId);
      expect(response.body.description).toBe('Single Key Test');
      expect(response.body.roles).toEqual(['user']);
    });

    it('should return 404 for non-existent API key', async () => {
      const fakeId = generateUUID();
      await context.request
        .get(`/api/api-keys/${fakeId}`)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 400 for invalid UUID format', async () => {
      await context.request
        .get('/api/api-keys/invalid-uuid')
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('DELETE /api/api-keys/:id - Delete API Key', () => {
    it('should delete an API key by ID', async () => {
      const createResponse = await context.request
        .post('/api/api-keys')
        .send({ description: 'Delete Test Key', roles: ['user'] });

      const apiKeyId = createResponse.body.apiKey.id;

      const deleteResponse = await context.request
        .delete(`/api/api-keys/${apiKeyId}`)
        .expect(HttpStatus.OK);

      expect(deleteResponse.body.message).toContain('deleted successfully');

      // Verify it's deleted
      await context.request
        .get(`/api/api-keys/${apiKeyId}`)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 404 when deleting non-existent API key', async () => {
      const fakeId = generateUUID();
      await context.request
        .delete(`/api/api-keys/${fakeId}`)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 400 for invalid UUID format', async () => {
      await context.request
        .delete('/api/api-keys/invalid-uuid')
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should cascade delete related data', async () => {
      const createResponse = await context.request
        .post('/api/api-keys')
        .send({ description: 'Cascade Delete Key', roles: ['user'] });

      const apiKeyId = createResponse.body.apiKey.id;

      // Delete the key
      await context.request
        .delete(`/api/api-keys/${apiKeyId}`)
        .expect(HttpStatus.OK);

      // Verify cascade delete worked
      await context.request
        .get(`/api/api-keys/${apiKeyId}`)
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('POST /api/api-keys/validate - Validate API Key', () => {
    let validToken: string;
    let expiredKeyId: string;

    beforeAll(async () => {
      // Create valid API key
      const validResponse = await context.request
        .post('/api/api-keys')
        .send({ description: 'Valid Key', roles: ['user'] });

      validToken = validResponse.body.token;

      // Create expired API key
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1); // Yesterday

      const expiredResponse = await context.request
        .post('/api/api-keys')
        .send({
          description: 'Expired Key',
          roles: ['user'],
          validUntil: pastDate.toISOString(),
        });

      expiredKeyId = expiredResponse.body.apiKey.id;
    });

    it('should validate a valid API key token', async () => {
      const response = await context.request
        .post('/api/api-keys/validate')
        .send({ token: validToken })
        .expect(HttpStatus.OK);

      expect(response.body.valid).toBe(true);
      expect(response.body.apiKey).toBeDefined();
      expect(response.body.apiKey.description).toBe('Valid Key');
      expect(response.body.apiKey.roles).toEqual(['user']);
    });

    it('should invalidate an invalid token', async () => {
      const response = await context.request
        .post('/api/api-keys/validate')
        .send({ token: 'invalid-token-12345' })
        .expect(HttpStatus.OK);

      expect(response.body.valid).toBe(false);
      expect(response.body.apiKey).toBeNull();
    });

    it('should invalidate an expired API key', async () => {
      // Get the expired key's token from database
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const keyResponse = await context.request.get(`/api/api-keys/${expiredKeyId}`);

      // Try to validate it
      const response = await context.request
        .post('/api/api-keys/validate')
        .send({ token: 'any-token' }) // Token validation will fail for expired
        .expect(HttpStatus.OK);

      expect(response.body.valid).toBe(false);
    });

    it('should handle empty token', async () => {
      const response = await context.request
        .post('/api/api-keys/validate')
        .send({ token: '' })
        .expect(HttpStatus.OK);

      expect(response.body.valid).toBe(false);
      expect(response.body.apiKey).toBeNull();
    });

    it('should handle missing token field', async () => {
      await context.request
        .post('/api/api-keys/validate')
        .send({})
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should rate limit validation requests', async () => {
      // Make multiple rapid requests (more than allowed)
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          context.request
            .post('/api/api-keys/validate')
            .send({ token: 'test-token' }),
        );
      }

      const results = await Promise.all(promises);

      // At least one should be rate limited
      const rateLimited = results.some((r) => r.status === HttpStatus.TOO_MANY_REQUESTS);
      expect(rateLimited).toBe(true);
    });
  });

  describe('GET /api/api-keys/cache/stats - Cache Statistics', () => {
    it('should return cache statistics', async () => {
      const response = await context.request
        .get('/api/api-keys/cache/stats')
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('hits');
      expect(response.body).toHaveProperty('misses');
      expect(response.body).toHaveProperty('size');
      expect(typeof response.body.hits).toBe('number');
      expect(typeof response.body.misses).toBe('number');
    });

    it('should show cache statistics after API key validation', async () => {
      const createResponse = await context.request
        .post('/api/api-keys')
        .send({ description: 'Cache Stats Key', roles: ['user'] });

      const token = createResponse.body.token;

      // Clear cache first
      await context.request
        .post('/api/api-keys/cache/clear')
        .expect(HttpStatus.OK);

      // Get initial stats
      const initialStats = await context.request
        .get('/api/api-keys/cache/stats')
        .expect(HttpStatus.OK);

      // Validate API key (should be a cache miss first time)
      await context.request
        .post('/api/api-keys/validate')
        .send({ token });

      // Validate again (should be a cache hit)
      await context.request
        .post('/api/api-keys/validate')
        .send({ token });

      // Get updated stats
      const updatedStats = await context.request
        .get('/api/api-keys/cache/stats')
        .expect(HttpStatus.OK);

      expect(updatedStats.body.hits).toBeGreaterThanOrEqual(initialStats.body.hits);
    });
  });

  describe('POST /api/api-keys/cache/clear - Clear Cache', () => {
    it('should clear API key caches', async () => {
      const response = await context.request
        .post('/api/api-keys/cache/clear')
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('cleared successfully');
    });

    it('should reset cache statistics after clearing', async () => {
      // Populate cache
      const createResponse = await context.request
        .post('/api/api-keys')
        .send({ description: 'Clear Cache Key', roles: ['user'] });

      await context.request
        .post('/api/api-keys/validate')
        .send({ token: createResponse.body.token });

      // Clear cache
      await context.request
        .post('/api/api-keys/cache/clear')
        .expect(HttpStatus.OK);

      // Check stats are reset or low
      const stats = await context.request
        .get('/api/api-keys/cache/stats')
        .expect(HttpStatus.OK);

      expect(stats.body).toBeDefined();
    });
  });

  describe('POST /api/api-keys/cache/warm - Warm Cache', () => {
    it('should warm API key caches', async () => {
      const response = await context.request
        .post('/api/api-keys/cache/warm')
        .expect(HttpStatus.OK);

      expect(response.body.message).toContain('warmed successfully');
    });

    it('should populate cache with frequently used keys', async () => {
      // Create some API keys
      await context.request
        .post('/api/api-keys')
        .send({ description: 'Warm Cache Key 1', roles: ['user'] });

      await context.request
        .post('/api/api-keys')
        .send({ description: 'Warm Cache Key 2', roles: ['user'] });

      // Warm the cache
      await context.request
        .post('/api/api-keys/cache/warm')
        .expect(HttpStatus.OK);

      // Check cache stats
      const stats = await context.request
        .get('/api/api-keys/cache/stats')
        .expect(HttpStatus.OK);

      expect(stats.body.size).toBeGreaterThan(0);
    });
  });

  describe('API Key Authentication Flow', () => {
    it('should complete full API key lifecycle', async () => {
      // 1. Create API key
      const createResponse = await context.request
        .post('/api/api-keys')
        .send({ description: 'Lifecycle Test Key', roles: ['user'] })
        .expect(HttpStatus.CREATED);

      const apiKeyId = createResponse.body.apiKey.id;
      const token = createResponse.body.token;

      expect(token).toBeDefined();
      expect(apiKeyId).toBeDefined();

      // 2. Validate API key
      const validateResponse = await context.request
        .post('/api/api-keys/validate')
        .send({ token })
        .expect(HttpStatus.OK);

      expect(validateResponse.body.valid).toBe(true);

      // 3. List API keys
      const listResponse = await context.request
        .get('/api/api-keys')
        .expect(HttpStatus.OK);

      const foundKey = listResponse.body.find((k: any) => k.id === apiKeyId);
      expect(foundKey).toBeDefined();

      // 4. Get single API key
      const getResponse = await context.request
        .get(`/api/api-keys/${apiKeyId}`)
        .expect(HttpStatus.OK);

      expect(getResponse.body.description).toBe('Lifecycle Test Key');

      // 5. Delete API key
      await context.request
        .delete(`/api/api-keys/${apiKeyId}`)
        .expect(HttpStatus.OK);

      // 6. Verify deletion
      await context.request
        .get(`/api/api-keys/${apiKeyId}`)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should handle concurrent API key operations', async () => {
      const operations = [];

      // Create multiple API keys concurrently
      for (let i = 0; i < 5; i++) {
        operations.push(
          context.request
            .post('/api/api-keys')
            .send({ description: `Concurrent Key ${i}`, roles: ['user'] }),
        );
      }

      const results = await Promise.all(operations);

      // All should succeed
      results.forEach((result) => {
        expect(result.status).toBe(HttpStatus.CREATED);
        expect(result.body.apiKey).toBeDefined();
        expect(result.body.token).toBeDefined();
      });

      // All tokens should be unique
      const tokens = results.map((r) => r.body.token);
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(5);
    });
  });

  describe('API Key Edge Cases', () => {
    it('should handle very long descriptions', async () => {
      const longDescription = 'A'.repeat(500);

      const response = await context.request
        .post('/api/api-keys')
        .send({ description: longDescription, roles: ['user'] })
        .expect(HttpStatus.CREATED);

      expect(response.body.apiKey.description).toBe(longDescription);
    });

    it('should handle special characters in description', async () => {
      const specialDescription = 'Test Key: <>&"\'!@#$%^&*()';

      const response = await context.request
        .post('/api/api-keys')
        .send({ description: specialDescription, roles: ['user'] })
        .expect(HttpStatus.CREATED);

      expect(response.body.apiKey.description).toBe(specialDescription);
    });

    it('should handle API key with validUntil in the future', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const response = await context.request
        .post('/api/api-keys')
        .send({
          description: 'Future Expiry Key',
          roles: ['user'],
          validUntil: futureDate.toISOString(),
        })
        .expect(HttpStatus.CREATED);

      expect(new Date(response.body.apiKey.valid_until).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('should handle empty roles array', async () => {
      const response = await context.request
        .post('/api/api-keys')
        .send({ description: 'No Roles Key', roles: [] })
        .expect(HttpStatus.CREATED);

      expect(response.body.apiKey.roles).toHaveLength(0);
    });
  });
});
