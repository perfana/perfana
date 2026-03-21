import { HttpStatus } from '@nestjs/common';
import { GrafanaModule } from '../../src/modules/grafana/grafana.module';
import { SystemsUnderTestModule } from '../../src/modules/systems-under-test/systems-under-test.module';
import {
  createTestApp,
  closeTestApp,
  getAuthHeaders,
  cleanupTestData,
  generateUUID,
  IntegrationTestContext,
} from '../helpers/integration-test.helper';

describe('Grafana API Integration Tests', () => {
  let context: IntegrationTestContext;

  beforeAll(async () => {
    context = await createTestApp(
      [GrafanaModule, SystemsUnderTestModule],
      [],
      [],
    );
  });

  afterAll(async () => {
    await cleanupTestData(context.dataSource, [
      'application_dashboards',
      'grafana_dashboards',
      'grafana_instances',
    ]);
    await closeTestApp(context);
  });

  describe('POST /api/grafana-instances - Create Grafana Instance', () => {
    it('should create a new Grafana instance', async () => {
      const createDto = {
        label: 'Production Grafana',
        url: 'https://grafana.prod.example.com',
        snapshotInstance: false,
      };

      const response = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body).toHaveProperty('id');
      expect(response.body.label).toBe('Production Grafana');
      expect(response.body.url).toBe('https://grafana.prod.example.com');
      expect(response.body.snapshot_instance).toBe(false);
    });

    it('should create Grafana instance with authentication token', async () => {
      const createDto = {
        label: 'Staging Grafana',
        url: 'https://grafana.staging.example.com',
        snapshotInstance: false,
        authToken: 'Bearer glsa_xxxxxxxxxxxxxxxxxxxxx',
      };

      const response = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body.label).toBe('Staging Grafana');
      expect(response.body.auth_token).toBe('Bearer glsa_xxxxxxxxxxxxxxxxxxxxx');
    });

    it('should create snapshot instance', async () => {
      const createDto = {
        label: 'Snapshot Grafana',
        url: 'https://grafana-snapshots.example.com',
        snapshotInstance: true,
      };

      const response = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body.snapshot_instance).toBe(true);
    });

    it('should validate required fields', async () => {
      const invalidDto = {
        label: 'Incomplete Instance',
        // Missing url
      };

      await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send(invalidDto)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should validate URL format', async () => {
      const invalidDto = {
        label: 'Invalid URL Instance',
        url: 'not-a-valid-url',
        snapshotInstance: false,
      };

      await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send(invalidDto)
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('GET /api/grafana-instances - List Grafana Instances', () => {
    beforeAll(async () => {
      // Create multiple instances for listing
      const instances = [
        { label: 'List Instance 1', url: 'https://g1.example.com', snapshotInstance: false },
        { label: 'List Instance 2', url: 'https://g2.example.com', snapshotInstance: false },
        { label: 'Snapshot Instance', url: 'https://g3.example.com', snapshotInstance: true },
      ];

      for (const instance of instances) {
        await context.request
          .post('/api/grafana-instances')
          .set(getAuthHeaders())
          .send(instance);
      }
    });

    it('should return list of all Grafana instances', async () => {
      const response = await context.request
        .get('/api/grafana-instances')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(3);

      const instance = response.body[0];
      expect(instance).toHaveProperty('id');
      expect(instance).toHaveProperty('label');
      expect(instance).toHaveProperty('url');
      expect(instance).toHaveProperty('snapshot_instance');
    });

    it('should filter by snapshot instance flag', async () => {
      const response = await context.request
        .get('/api/grafana-instances?snapshotInstance=true')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((instance: any) => {
        expect(instance.snapshot_instance).toBe(true);
      });
    });

    it('should filter by label', async () => {
      const response = await context.request
        .get('/api/grafana-instances?label=List Instance 1')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      const found = response.body.find((i: any) => i.label === 'List Instance 1');
      expect(found).toBeDefined();
    });
  });

  describe('GET /api/grafana-instances/:id - Get Single Grafana Instance', () => {
    let instanceId: string;

    beforeAll(async () => {
      const createResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Single Instance Test',
          url: 'https://grafana-single.example.com',
          snapshotInstance: false,
        });

      instanceId = createResponse.body.id;
    });

    it('should retrieve Grafana instance by ID', async () => {
      const response = await context.request
        .get(`/api/grafana-instances/${instanceId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body.id).toBe(instanceId);
      expect(response.body.label).toBe('Single Instance Test');
    });

    it('should return 404 for non-existent instance', async () => {
      await context.request
        .get(`/api/grafana-instances/${generateUUID()}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('PATCH /api/grafana-instances/:id - Update Grafana Instance', () => {
    let instanceId: string;

    beforeAll(async () => {
      const createResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Update Instance Test',
          url: 'https://grafana-update.example.com',
          snapshotInstance: false,
        });

      instanceId = createResponse.body.id;
    });

    it('should update Grafana instance label', async () => {
      const updateDto = {
        label: 'Updated Instance Label',
      };

      const response = await context.request
        .patch(`/api/grafana-instances/${instanceId}`)
        .set(getAuthHeaders())
        .send(updateDto)
        .expect(HttpStatus.OK);

      expect(response.body.label).toBe('Updated Instance Label');
      expect(response.body.url).toBe('https://grafana-update.example.com'); // Unchanged
    });

    it('should update Grafana instance URL', async () => {
      const updateDto = {
        url: 'https://grafana-new-url.example.com',
      };

      const response = await context.request
        .patch(`/api/grafana-instances/${instanceId}`)
        .set(getAuthHeaders())
        .send(updateDto)
        .expect(HttpStatus.OK);

      expect(response.body.url).toBe('https://grafana-new-url.example.com');
    });

    it('should update auth token', async () => {
      const updateDto = {
        authToken: 'Bearer new_token_abc123',
      };

      const response = await context.request
        .patch(`/api/grafana-instances/${instanceId}`)
        .set(getAuthHeaders())
        .send(updateDto)
        .expect(HttpStatus.OK);

      expect(response.body.auth_token).toBe('Bearer new_token_abc123');
    });

    it('should return 404 for non-existent instance', async () => {
      await context.request
        .patch(`/api/grafana-instances/${generateUUID()}`)
        .set(getAuthHeaders())
        .send({ label: 'New Label' })
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('DELETE /api/grafana-instances/:id - Delete Grafana Instance', () => {
    it('should delete a Grafana instance', async () => {
      const createResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Delete Instance Test',
          url: 'https://grafana-delete.example.com',
          snapshotInstance: false,
        });

      const instanceId = createResponse.body.id;

      const deleteResponse = await context.request
        .delete(`/api/grafana-instances/${instanceId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(deleteResponse.body.message).toContain('deleted successfully');

      // Verify deletion
      await context.request
        .get(`/api/grafana-instances/${instanceId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 404 for non-existent instance', async () => {
      await context.request
        .delete(`/api/grafana-instances/${generateUUID()}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('POST /api/grafana-instances/:id/test-connection - Test Connection', () => {
    let instanceId: string;

    beforeAll(async () => {
      const createResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Connection Test Instance',
          url: 'https://grafana-test-conn.example.com',
          snapshotInstance: false,
        });

      instanceId = createResponse.body.id;
    });

    it('should test connection to Grafana instance', async () => {
      const response = await context.request
        .post(`/api/grafana-instances/${instanceId}/test-connection`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('message');
      expect(typeof response.body.success).toBe('boolean');
    });

    it('should return 404 for non-existent instance', async () => {
      await context.request
        .post(`/api/grafana-instances/${generateUUID()}/test-connection`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('POST /api/grafana/dashboards - Create Grafana Dashboard', () => {
    let grafanaInstanceId: string;

    beforeAll(async () => {
      const instanceResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Dashboard Test Instance',
          url: 'https://grafana-dashboards.example.com',
          snapshotInstance: false,
        });

      grafanaInstanceId = instanceResponse.body.id;
    });

    it('should create a new Grafana dashboard', async () => {
      const createDto = {
        grafanaInstanceId,
        name: 'JVM Metrics Dashboard',
        uid: 'jvm-metrics-001',
        url: 'https://grafana.example.com/d/jvm-metrics-001',
        tags: ['jvm', 'performance', 'metrics'],
      };

      const response = await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('JVM Metrics Dashboard');
      expect(response.body.uid).toBe('jvm-metrics-001');
      expect(response.body.tags).toEqual(['jvm', 'performance', 'metrics']);
      expect(response.body.grafana_instance_id).toBe(grafanaInstanceId);
    });

    it('should create dashboard with folder information', async () => {
      const createDto = {
        grafanaInstanceId,
        name: 'Application Metrics',
        uid: 'app-metrics-001',
        url: 'https://grafana.example.com/d/app-metrics-001',
        folder: 'Production Dashboards',
        tags: ['application'],
      };

      const response = await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send(createDto)
        .expect(HttpStatus.CREATED);

      expect(response.body.folder).toBe('Production Dashboards');
    });

    it('should validate required fields', async () => {
      const invalidDto = {
        grafanaInstanceId,
        name: 'Incomplete Dashboard',
        // Missing uid and url
      };

      await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send(invalidDto)
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('GET /api/grafana/dashboards - List Grafana Dashboards', () => {
    let grafanaInstanceId: string;

    beforeAll(async () => {
      const instanceResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Dashboard List Instance',
          url: 'https://grafana-list.example.com',
          snapshotInstance: false,
        });

      grafanaInstanceId = instanceResponse.body.id;

      // Create multiple dashboards
      const dashboards = [
        {
          grafanaInstanceId,
          name: 'Dashboard 1',
          uid: 'dash-001',
          url: 'https://grafana.example.com/d/dash-001',
          tags: ['tag1', 'tag2'],
        },
        {
          grafanaInstanceId,
          name: 'Dashboard 2',
          uid: 'dash-002',
          url: 'https://grafana.example.com/d/dash-002',
          tags: ['tag2', 'tag3'],
        },
      ];

      for (const dashboard of dashboards) {
        await context.request
          .post('/api/grafana/dashboards')
          .set(getAuthHeaders())
          .send(dashboard);
      }
    });

    it('should return list of all dashboards', async () => {
      const response = await context.request
        .get('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);

      const dashboard = response.body[0];
      expect(dashboard).toHaveProperty('id');
      expect(dashboard).toHaveProperty('name');
      expect(dashboard).toHaveProperty('uid');
      expect(dashboard).toHaveProperty('tags');
    });

    it('should filter dashboards by Grafana instance', async () => {
      const response = await context.request
        .get(`/api/grafana/dashboards?grafanaInstanceId=${grafanaInstanceId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((dashboard: any) => {
        expect(dashboard.grafana_instance_id).toBe(grafanaInstanceId);
      });
    });

    it('should filter dashboards by tags', async () => {
      const response = await context.request
        .get('/api/grafana/dashboards?tags=tag2')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((dashboard: any) => {
        expect(dashboard.tags).toContain('tag2');
      });
    });

    it('should filter dashboards by name', async () => {
      const response = await context.request
        .get('/api/grafana/dashboards?name=Dashboard 1')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      const found = response.body.find((d: any) => d.name === 'Dashboard 1');
      expect(found).toBeDefined();
    });

    it('should filter dashboards by UID', async () => {
      const response = await context.request
        .get('/api/grafana/dashboards?uid=dash-001')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      const found = response.body.find((d: any) => d.uid === 'dash-001');
      expect(found).toBeDefined();
    });
  });

  describe('GET /api/grafana/dashboards/:id - Get Single Dashboard', () => {
    let dashboardId: string;
    let grafanaInstanceId: string;

    beforeAll(async () => {
      const instanceResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Single Dashboard Instance',
          url: 'https://grafana-single-dash.example.com',
          snapshotInstance: false,
        });

      grafanaInstanceId = instanceResponse.body.id;

      const dashboardResponse = await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send({
          grafanaInstanceId,
          name: 'Single Dashboard Test',
          uid: 'single-dash-001',
          url: 'https://grafana.example.com/d/single-dash-001',
          tags: ['test'],
        });

      dashboardId = dashboardResponse.body.id;
    });

    it('should retrieve dashboard by ID', async () => {
      const response = await context.request
        .get(`/api/grafana/dashboards/${dashboardId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(response.body.id).toBe(dashboardId);
      expect(response.body.name).toBe('Single Dashboard Test');
      expect(response.body.uid).toBe('single-dash-001');
    });

    it('should return 404 for non-existent dashboard', async () => {
      await context.request
        .get(`/api/grafana/dashboards/${generateUUID()}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('PATCH /api/grafana/dashboards/:id - Update Dashboard', () => {
    let dashboardId: string;
    let grafanaInstanceId: string;

    beforeAll(async () => {
      const instanceResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Update Dashboard Instance',
          url: 'https://grafana-update-dash.example.com',
          snapshotInstance: false,
        });

      grafanaInstanceId = instanceResponse.body.id;

      const dashboardResponse = await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send({
          grafanaInstanceId,
          name: 'Update Dashboard Test',
          uid: 'update-dash-001',
          url: 'https://grafana.example.com/d/update-dash-001',
          tags: ['original'],
        });

      dashboardId = dashboardResponse.body.id;
    });

    it('should update dashboard name', async () => {
      const updateDto = {
        name: 'Updated Dashboard Name',
      };

      const response = await context.request
        .patch(`/api/grafana/dashboards/${dashboardId}`)
        .set(getAuthHeaders())
        .send(updateDto)
        .expect(HttpStatus.OK);

      expect(response.body.name).toBe('Updated Dashboard Name');
    });

    it('should update dashboard tags', async () => {
      const updateDto = {
        tags: ['updated', 'new-tag'],
      };

      const response = await context.request
        .patch(`/api/grafana/dashboards/${dashboardId}`)
        .set(getAuthHeaders())
        .send(updateDto)
        .expect(HttpStatus.OK);

      expect(response.body.tags).toEqual(['updated', 'new-tag']);
    });

    it('should return 404 for non-existent dashboard', async () => {
      await context.request
        .patch(`/api/grafana/dashboards/${generateUUID()}`)
        .set(getAuthHeaders())
        .send({ name: 'New Name' })
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('DELETE /api/grafana/dashboards/:id - Delete Dashboard', () => {
    it('should delete a dashboard', async () => {
      const instanceResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Delete Dashboard Instance',
          url: 'https://grafana-delete-dash.example.com',
          snapshotInstance: false,
        });

      const dashboardResponse = await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send({
          grafanaInstanceId: instanceResponse.body.id,
          name: 'Delete Dashboard Test',
          uid: 'delete-dash-001',
          url: 'https://grafana.example.com/d/delete-dash-001',
          tags: ['delete-test'],
        });

      const dashboardId = dashboardResponse.body.id;

      const deleteResponse = await context.request
        .delete(`/api/grafana/dashboards/${dashboardId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(deleteResponse.body.message).toContain('deleted successfully');

      // Verify deletion
      await context.request
        .get(`/api/grafana/dashboards/${dashboardId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('POST /api/grafana/dashboards/variable-values - Get Variable Values', () => {
    let grafanaInstanceId: string;
    let dashboardId: string;

    beforeAll(async () => {
      const instanceResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Variable Values Instance',
          url: 'https://grafana-vars.example.com',
          snapshotInstance: false,
        });

      grafanaInstanceId = instanceResponse.body.id;

      const dashboardResponse = await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send({
          grafanaInstanceId,
          name: 'Variables Dashboard',
          uid: 'vars-dash-001',
          url: 'https://grafana.example.com/d/vars-dash-001',
          tags: ['variables'],
        });

      dashboardId = dashboardResponse.body.id;
    });

    it('should retrieve variable values from dashboard', async () => {
      const requestBody = {
        grafanaDashboardId: dashboardId,
        variableName: 'environment',
        system: 'PaymentService',
        environment: 'production',
      };

      const response = await context.request
        .post('/api/grafana/dashboards/variable-values')
        .set(getAuthHeaders())
        .send(requestBody)
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should handle existing variables parameter', async () => {
      const requestBody = {
        grafanaDashboardId: dashboardId,
        variableName: 'workload',
        system: 'PaymentService',
        environment: 'production',
        existingVariables: {
          environment: ['production', 'staging'],
        },
      };

      const response = await context.request
        .post('/api/grafana/dashboards/variable-values')
        .set(getAuthHeaders())
        .send(requestBody)
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should validate required fields', async () => {
      const invalidBody = {
        grafanaDashboardId: dashboardId,
        // Missing variableName, system, environment
      };

      await context.request
        .post('/api/grafana/dashboards/variable-values')
        .set(getAuthHeaders())
        .send(invalidBody)
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('GET /api/grafana/application-dashboards - List Application Dashboards', () => {
    it('should return list of application dashboards', async () => {
      const response = await context.request
        .get('/api/grafana/application-dashboards')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should filter by system under test ID', async () => {
      const response = await context.request
        .get('/api/grafana/application-dashboards?systemId=test-system-id')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should filter by test environment', async () => {
      const response = await context.request
        .get('/api/grafana/application-dashboards?testEnvironment=production')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should filter by dashboard label', async () => {
      const response = await context.request
        .get('/api/grafana/application-dashboards?dashboardLabel=JVM')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should filter by tags', async () => {
      const response = await context.request
        .get('/api/grafana/application-dashboards?tags=performance,jvm')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Authentication and Authorization', () => {
    it('should reject requests without authentication for instances', async () => {
      await context.request
        .get('/api/grafana-instances')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should reject requests without authentication for dashboards', async () => {
      await context.request
        .get('/api/grafana/dashboards')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should accept valid Keycloak JWT token', async () => {
      await context.request
        .get('/api/grafana-instances')
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);
    });
  });

  describe('Grafana Integration Workflow', () => {
    it('should complete full Grafana setup workflow', async () => {
      // 1. Create Grafana instance
      const instanceResponse = await context.request
        .post('/api/grafana-instances')
        .set(getAuthHeaders())
        .send({
          label: 'Workflow Test Instance',
          url: 'https://grafana-workflow.example.com',
          snapshotInstance: false,
          authToken: 'Bearer workflow_token',
        })
        .expect(HttpStatus.CREATED);

      const instanceId = instanceResponse.body.id;
      expect(instanceId).toBeDefined();

      // 2. Test connection
      const connectionResponse = await context.request
        .post(`/api/grafana-instances/${instanceId}/test-connection`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(connectionResponse.body).toHaveProperty('success');

      // 3. Create dashboards
      const dashboard1Response = await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send({
          grafanaInstanceId: instanceId,
          name: 'Workflow Dashboard 1',
          uid: 'workflow-dash-001',
          url: 'https://grafana.example.com/d/workflow-dash-001',
          tags: ['workflow'],
        })
        .expect(HttpStatus.CREATED);

      const dashboard2Response = await context.request
        .post('/api/grafana/dashboards')
        .set(getAuthHeaders())
        .send({
          grafanaInstanceId: instanceId,
          name: 'Workflow Dashboard 2',
          uid: 'workflow-dash-002',
          url: 'https://grafana.example.com/d/workflow-dash-002',
          tags: ['workflow'],
        })
        .expect(HttpStatus.CREATED);

      // 4. List all dashboards for this instance
      const listResponse = await context.request
        .get(`/api/grafana/dashboards?grafanaInstanceId=${instanceId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(listResponse.body.length).toBeGreaterThanOrEqual(2);

      // 5. Update dashboard
      await context.request
        .patch(`/api/grafana/dashboards/${dashboard1Response.body.id}`)
        .set(getAuthHeaders())
        .send({ tags: ['workflow', 'updated'] })
        .expect(HttpStatus.OK);

      // 6. Delete dashboard
      await context.request
        .delete(`/api/grafana/dashboards/${dashboard2Response.body.id}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      // 7. Verify only one dashboard remains
      const finalListResponse = await context.request
        .get(`/api/grafana/dashboards?grafanaInstanceId=${instanceId}`)
        .set(getAuthHeaders())
        .expect(HttpStatus.OK);

      expect(finalListResponse.body.length).toBe(1);
    });
  });
});
