import { HttpStatus } from '@nestjs/common';
import { TestRunsModule } from '../src/modules/test-runs/test-runs.module';
import { OrganizationsModule } from '../src/modules/organizations/organizations.module';
import { ApiKeysModule } from '../src/modules/api-keys/api-keys.module';
import { SystemsUnderTestModule } from '../src/modules/systems-under-test/systems-under-test.module';
import { GraphPresetsModule } from '../src/modules/graph-presets/graph-presets.module';
import {
  createTestApp,
  closeTestApp,
  generateTestRunId,
  generateUUID,
  cleanupTestData,
  IntegrationTestContext,
} from './helpers/integration-test.helper';

/**
 * Authorization E2E Test Suite
 *
 * Tests the RBAC authorization system implemented in Phase 3:
 * - Organization-based filtering on list/query operations
 * - Permission checks on modify/delete operations
 * - Global admin bypass for all authorization checks
 * - Legacy data compatibility (null organization_id)
 *
 * These tests verify the integration of:
 * - AuthorizationService
 * - AuthorizedBaseService pattern
 * - @UserCtx() decorator
 * - Organization/Team membership checks
 */
describe('Authorization E2E Tests', () => {
  let context: IntegrationTestContext;

  // Test user IDs
  const userOrg1 = 'user-org1-' + generateUUID();
  const userOrg2 = 'user-org2-' + generateUUID();
  const globalAdmin = 'global-admin-' + generateUUID();
  const userNoOrg = 'user-no-org-' + generateUUID();

  // Test organization IDs
  const org1Id = generateUUID();
  const org2Id = generateUUID();

  /**
   * Create a mock Keycloak token with custom user ID and roles
   */
  function mockCustomToken(
    userId: string,
    roles: string[] = [],
    organizations: string[] = [],
  ): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    ).toString('base64');
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        email: `${userId}@example.com`,
        preferred_username: userId,
        realm_access: { roles },
        resource_access: {
          perfana: { roles },
        },
        organizations,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64');
    const signature = Buffer.from('mock-signature').toString('base64');
    return `${header}.${payload}.${signature}`;
  }

  /**
   * Get auth headers for a specific user
   */
  function getCustomAuthHeaders(
    userId: string,
    roles: string[] = [],
    organizations: string[] = [],
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${mockCustomToken(userId, roles, organizations)}`,
    };
  }

  /**
   * Get auth headers for user in org1
   */
  function getUserOrg1Headers(): Record<string, string> {
    return getCustomAuthHeaders(userOrg1, ['org-member'], [org1Id]);
  }

  /**
   * Get auth headers for user in org2
   */
  function getUserOrg2Headers(): Record<string, string> {
    return getCustomAuthHeaders(userOrg2, ['org-member'], [org2Id]);
  }

  /**
   * Get auth headers for global admin
   */
  function getGlobalAdminHeaders(): Record<string, string> {
    return getCustomAuthHeaders(
      globalAdmin,
      ['perfana-admin', 'admin'],
      [org1Id, org2Id],
    );
  }

  /**
   * Get auth headers for user with no organizations
   */
  function getUserNoOrgHeaders(): Record<string, string> {
    return getCustomAuthHeaders(userNoOrg, ['org-member'], []);
  }

  beforeAll(async () => {
    context = await createTestApp(
      [
        TestRunsModule,
        OrganizationsModule,
        ApiKeysModule,
        SystemsUnderTestModule,
        GraphPresetsModule,
      ],
      [],
      [],
    );
  });

  afterAll(async () => {
    await cleanupTestData(context.dataSource, [
      'test_run_configurations',
      'test_runs',
      'systems_under_test',
      'graph_presets',
    ]);
    await closeTestApp(context);
  });

  describe('Global Admin Bypass', () => {
    it('should allow global admin to access all resources', async () => {
      const response = await context.request
        .get('/api/test-runs')
        .set(getGlobalAdminHeaders())
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should allow global admin to create resources', async () => {
      const testRunId = generateTestRunId('global-admin-create');
      const payload = {
        systemUnderTest: 'AdminTestService',
        testEnvironment: 'production',
        workload: 'loadTest',
        testRunId,
        completed: false,
      };

      const response = await context.request
        .post('/api/test')
        .set(getGlobalAdminHeaders())
        .send(payload)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('id');
      expect(response.body.test_run_id).toBe(testRunId);
    });

    it('should identify global admin role correctly', async () => {
      // Test with perfana-admin role
      const perfanaAdminHeaders = getCustomAuthHeaders(
        'test-perfana-admin',
        ['perfana-admin'],
        [],
      );

      const response = await context.request
        .get('/api/test-runs')
        .set(perfanaAdminHeaders)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
    });

    it('should identify admin role as global admin', async () => {
      // Test with admin role (backward compatibility)
      const adminHeaders = getCustomAuthHeaders('test-admin', ['admin'], []);

      const response = await context.request
        .get('/api/test-runs')
        .set(adminHeaders)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
    });
  });

  describe('Authentication Requirements', () => {
    it('should reject requests without authentication', async () => {
      await context.request
        .get('/api/test-runs')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should reject requests with invalid token', async () => {
      await context.request
        .get('/api/test-runs')
        .set('Authorization', 'Bearer invalid-token')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should accept requests with valid JWT token', async () => {
      await context.request
        .get('/api/test-runs')
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);
    });
  });

  describe('User Context Extraction', () => {
    it('should extract userId from JWT token', async () => {
      const testRunId = generateTestRunId('user-context-test');
      const payload = {
        systemUnderTest: 'UserContextService',
        testEnvironment: 'staging',
        workload: 'smokeTest',
        testRunId,
        completed: false,
      };

      const response = await context.request
        .post('/api/test')
        .set(getUserOrg1Headers())
        .send(payload)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('id');
      // The test run should be created successfully with user context
      expect(response.body.test_run_id).toBe(testRunId);
    });

    it('should extract roles from JWT token', async () => {
      // User with org-member role should be able to list test runs
      const response = await context.request
        .get('/api/test-runs')
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
    });
  });

  describe('Legacy Data Compatibility', () => {
    let legacyTestRunId: string;

    beforeAll(async () => {
      // Create a test run using global admin (simulating legacy data with no org filter)
      legacyTestRunId = generateTestRunId('legacy-data');
      await context.request
        .post('/api/test')
        .set(getGlobalAdminHeaders())
        .send({
          systemUnderTest: 'LegacyService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: legacyTestRunId,
          completed: true,
        });
    });

    it('should allow authenticated users to access legacy data', async () => {
      // Any authenticated user should be able to see legacy data (null org_id)
      const response = await context.request
        .get('/api/test-runs')
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      // Legacy data should be included in the results
    });

    it('should allow users with no organizations to access legacy data', async () => {
      // Users with no org memberships should still see legacy data
      const response = await context.request
        .get('/api/test-runs')
        .set(getUserNoOrgHeaders())
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
      // May return empty if no legacy data exists, but should not fail
    });
  });

  describe('Test Runs CRUD Operations with Authorization', () => {
    let createdTestRunId: string;
    let createdTestRunUuid: string;

    beforeAll(async () => {
      // Create a test run as userOrg1
      createdTestRunId = generateTestRunId('crud-auth-test');
      const response = await context.request
        .post('/api/test')
        .set(getUserOrg1Headers())
        .send({
          systemUnderTest: 'CRUDAuthService',
          testEnvironment: 'qa',
          workload: 'perfTest',
          testRunId: createdTestRunId,
          completed: false,
        });
      createdTestRunUuid = response.body.id;
    });

    it('should allow user to read their own resources', async () => {
      const response = await context.request
        .get(`/api/test-runs/${createdTestRunUuid}`)
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      expect(response.body.id).toBe(createdTestRunUuid);
      expect(response.body.test_run_id).toBe(createdTestRunId);
    });

    it('should allow user to update their own resources', async () => {
      const response = await context.request
        .put(`/api/test-runs/${createdTestRunUuid}/annotations`)
        .set(getUserOrg1Headers())
        .send({ annotations: ['Updated by owner'] })
        .expect(HttpStatus.OK);

      expect(response.body.annotations).toContain('Updated by owner');
    });

    it('should allow user to update tags on their own resources', async () => {
      const response = await context.request
        .put(`/api/test-runs/${createdTestRunUuid}/tags`)
        .set(getUserOrg1Headers())
        .send({ tags: ['owner-tag', 'updated'] })
        .expect(HttpStatus.OK);

      expect(response.body.tags).toEqual(
        expect.arrayContaining(['owner-tag', 'updated']),
      );
    });

    it('should allow global admin to modify any resource', async () => {
      const response = await context.request
        .put(`/api/test-runs/${createdTestRunUuid}/annotations`)
        .set(getGlobalAdminHeaders())
        .send({ annotations: ['Updated by admin'] })
        .expect(HttpStatus.OK);

      expect(response.body.annotations).toContain('Updated by admin');
    });

    it('should allow global admin to delete any resource', async () => {
      // Create a test run to delete
      const deleteTestRunId = generateTestRunId('admin-delete-test');
      const createResponse = await context.request
        .post('/api/test')
        .set(getUserOrg1Headers())
        .send({
          systemUnderTest: 'AdminDeleteService',
          testEnvironment: 'dev',
          workload: 'loadTest',
          testRunId: deleteTestRunId,
          completed: false,
        });

      const deleteUuid = createResponse.body.id;

      // Global admin should be able to delete it
      await context.request
        .delete(`/api/test-runs/${deleteUuid}`)
        .set(getGlobalAdminHeaders())
        .expect(HttpStatus.OK);

      // Verify it's deleted
      await context.request
        .get(`/api/test-runs/${deleteUuid}`)
        .set(getGlobalAdminHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('Graph Presets with Authorization', () => {
    let presetId: string;

    it('should allow user to create a graph preset', async () => {
      const preset = {
        name: 'Auth Test Preset',
        metrics: ['cpu', 'memory', 'latency'],
        isGlobal: false,
      };

      const response = await context.request
        .post('/api/graph-presets')
        .set(getUserOrg1Headers())
        .send(preset)
        .expect(HttpStatus.CREATED);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Auth Test Preset');
      presetId = response.body.id;
    });

    it('should allow user to retrieve their own preset', async () => {
      if (!presetId) {
        return; // Skip if preset wasn't created
      }

      const response = await context.request
        .get(`/api/graph-presets/${presetId}`)
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      expect(response.body.id).toBe(presetId);
    });

    it('should allow global admin to see all presets', async () => {
      const response = await context.request
        .get('/api/graph-presets')
        .set(getGlobalAdminHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should allow user to delete their own preset', async () => {
      if (!presetId) {
        return; // Skip if preset wasn't created
      }

      await context.request
        .delete(`/api/graph-presets/${presetId}`)
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      // Verify it's deleted
      await context.request
        .get(`/api/graph-presets/${presetId}`)
        .set(getUserOrg1Headers())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('API Key Operations with Authorization', () => {
    let apiKeyId: string;

    it('should allow authenticated user to create API key', async () => {
      const createDto = {
        description: 'Auth Test API Key',
        roles: ['user'],
      };

      const response = await context.request
        .post('/api/api-keys')
        .set(getUserOrg1Headers())
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body).toHaveProperty('apiKey');
      expect(response.body).toHaveProperty('token');
      expect(response.body.apiKey.description).toBe('Auth Test API Key');
      apiKeyId = response.body.apiKey.id;
    });

    it('should allow user to list API keys', async () => {
      const response = await context.request
        .get('/api/api-keys')
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should allow user to retrieve specific API key', async () => {
      if (!apiKeyId) {
        return; // Skip if key wasn't created
      }

      const response = await context.request
        .get(`/api/api-keys/${apiKeyId}`)
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      expect(response.body.id).toBe(apiKeyId);
    });

    it('should allow global admin to list all API keys', async () => {
      const response = await context.request
        .get('/api/api-keys')
        .set(getGlobalAdminHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should allow user to delete their own API key', async () => {
      if (!apiKeyId) {
        return; // Skip if key wasn't created
      }

      await context.request
        .delete(`/api/api-keys/${apiKeyId}`)
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      // Verify it's deleted
      await context.request
        .get(`/api/api-keys/${apiKeyId}`)
        .set(getUserOrg1Headers())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('Systems Under Test with Authorization', () => {
    let sutId: string;

    it('should list systems under test for authenticated user', async () => {
      const response = await context.request
        .get('/api/systems-under-test')
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should allow authenticated user to retrieve system by name', async () => {
      // First create a test run to ensure SUT exists
      const testRunId = generateTestRunId('sut-auth-test');
      await context.request
        .post('/api/test')
        .set(getUserOrg1Headers())
        .send({
          systemUnderTest: 'SUTAuthTestService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId,
          completed: false,
        });

      // Now try to get the SUT by name
      const response = await context.request
        .get('/api/systems-under-test?name=SUTAuthTestService')
        .set(getUserOrg1Headers())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should allow global admin to access all systems under test', async () => {
      const response = await context.request
        .get('/api/systems-under-test')
        .set(getGlobalAdminHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Error Handling in Authorization', () => {
    it('should return 401 for missing authorization header', async () => {
      const response = await context.request
        .get('/api/test-runs')
        .expect(HttpStatus.UNAUTHORIZED);

      expect(response.body).toHaveProperty('statusCode', 401);
    });

    it('should return 401 for invalid token format', async () => {
      await context.request
        .get('/api/test-runs')
        .set('Authorization', 'InvalidFormat')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should return 401 for expired token', async () => {
      // Create an expired token
      const header = Buffer.from(
        JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
      ).toString('base64');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'expired-user',
          exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        }),
      ).toString('base64');
      const signature = Buffer.from('mock-signature').toString('base64');
      const expiredToken = `${header}.${payload}.${signature}`;

      await context.request
        .get('/api/test-runs')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should return 404 for non-existent resource', async () => {
      const fakeUuid = generateUUID();
      await context.request
        .get(`/api/test-runs/${fakeUuid}`)
        .set(getUserOrg1Headers())
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 400 for invalid UUID format', async () => {
      await context.request
        .get('/api/test-runs/not-a-valid-uuid')
        .set(getUserOrg1Headers())
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('Concurrent Authorization Requests', () => {
    it('should handle multiple concurrent authenticated requests', async () => {
      const promises = [];

      // Make 10 concurrent requests with different users
      for (let i = 0; i < 5; i++) {
        promises.push(
          context.request
            .get('/api/test-runs')
            .set(getUserOrg1Headers())
            .expect(HttpStatus.OK),
        );
        promises.push(
          context.request
            .get('/api/test-runs')
            .set(getGlobalAdminHeaders())
            .expect(HttpStatus.OK),
        );
      }

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result) => {
        expect(result.status).toBe(HttpStatus.OK);
        expect(result.body).toHaveProperty('data');
      });
    });

    it('should handle concurrent create operations', async () => {
      const promises = [];

      for (let i = 0; i < 5; i++) {
        const testRunId = generateTestRunId(`concurrent-${i}`);
        promises.push(
          context.request
            .post('/api/test')
            .set(getUserOrg1Headers())
            .send({
              systemUnderTest: `ConcurrentService${i}`,
              testEnvironment: 'staging',
              workload: 'loadTest',
              testRunId,
              completed: false,
            }),
        );
      }

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result) => {
        expect(result.status).toBe(HttpStatus.OK);
        expect(result.body).toHaveProperty('id');
      });
    });
  });

  describe('Role-Based Access Verification', () => {
    it('should accept org-member role for basic operations', async () => {
      const orgMemberHeaders = getCustomAuthHeaders(
        'org-member-user',
        ['org-member'],
        [org1Id],
      );

      const response = await context.request
        .get('/api/test-runs')
        .set(orgMemberHeaders)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
    });

    it('should accept org-viewer role for read operations', async () => {
      const orgViewerHeaders = getCustomAuthHeaders(
        'org-viewer-user',
        ['org-viewer'],
        [org1Id],
      );

      const response = await context.request
        .get('/api/test-runs')
        .set(orgViewerHeaders)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
    });

    it('should accept org-admin role for all operations', async () => {
      const orgAdminHeaders = getCustomAuthHeaders(
        'org-admin-user',
        ['org-admin'],
        [org1Id],
      );

      const testRunId = generateTestRunId('org-admin-test');
      const response = await context.request
        .post('/api/test')
        .set(orgAdminHeaders)
        .send({
          systemUnderTest: 'OrgAdminService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId,
          completed: false,
        })
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('id');
    });

    it('should accept org-admin role for all operations', async () => {
      const orgAdminHeaders = getCustomAuthHeaders(
        'org-admin-user',
        ['org-admin'],
        [org1Id],
      );

      const response = await context.request
        .get('/api/test-runs')
        .set(orgAdminHeaders)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('data');
    });
  });

  describe('Authorization Service Health', () => {
    it('should maintain performance under load', async () => {
      const startTime = Date.now();
      const iterations = 20;
      const promises = [];

      for (let i = 0; i < iterations; i++) {
        promises.push(
          context.request
            .get('/api/test-runs?page=1&pageSize=5')
            .set(getUserOrg1Headers()),
        );
      }

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests should succeed
      results.forEach((result) => {
        expect(result.status).toBe(HttpStatus.OK);
      });

      // Average response time should be reasonable (< 500ms per request average)
      const avgTime = duration / iterations;
      expect(avgTime).toBeLessThan(500);
    });
  });
});
