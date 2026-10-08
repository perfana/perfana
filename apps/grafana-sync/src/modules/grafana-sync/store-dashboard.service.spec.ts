import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreDashboardService } from './store-dashboard.service';
import { GrafanaDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

describe('StoreDashboardService', () => {
  let service: StoreDashboardService;
  let dashboardRepo: Repository<GrafanaDashboard>;
  let instanceRepo: Repository<GrafanaInstance>;
  let grafanaApiService: GrafanaApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreDashboardService,
        {
          provide: getRepositoryToken(GrafanaDashboard),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(GrafanaInstance),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: GrafanaApiService,
          useValue: {
            searchDashboards: jest.fn(),
            getDashboardByUid: jest.fn(),
            getDatasourceByUid: jest.fn(),
            getDatasourceByName: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StoreDashboardService>(StoreDashboardService);
    dashboardRepo = module.get<Repository<GrafanaDashboard>>(getRepositoryToken(GrafanaDashboard));
    instanceRepo = module.get<Repository<GrafanaInstance>>(getRepositoryToken(GrafanaInstance));
    grafanaApiService = module.get<GrafanaApiService>(GrafanaApiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboardsToAdd', () => {
    const mockGrafanaInstance: Partial<GrafanaInstance> = {
      id: 'test-instance-id',
      label: 'Test Grafana',
    };

    it('should return dashboards not yet stored (API already filters by perfana tag)', async () => {
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([{ uid: 'stored-1' } as GrafanaDashboard]);

      // The Grafana API already filters by 'perfana' tag, so all returned
      // dashboards are assumed to have the tag.
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'stored-1', title: 'Already Stored', tags: ['perfana'] },
        { uid: 'new-1', title: 'New Dashboard 1', tags: ['perfana'] },
        { uid: 'new-2', title: 'New Dashboard 2', tags: ['perfana'] },
      ]);

      const result = await service.getDashboardsToAdd(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(2);
      expect(result[0].uid).toBe('new-1');
      expect(result[1].uid).toBe('new-2');

      expect(dashboardRepo.find).toHaveBeenCalledWith({
        where: { grafanaInstanceId: 'test-instance-id' },
        select: ['uid'],
      });

      expect(grafanaApiService.searchDashboards).toHaveBeenCalledWith('test-instance-id', {
        tag: 'perfana',
        limit: 5000,
      });
    });

    it('should return empty array if all dashboards already stored', async () => {
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1' } as GrafanaDashboard,
          { uid: 'dashboard-2' } as GrafanaDashboard,
        ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] },
        { uid: 'dashboard-2', title: 'Dashboard 2', tags: ['perfana'] },
      ]);

      const result = await service.getDashboardsToAdd(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0);
    });

    it('should return empty array on error and log error', async () => {
      jest.spyOn(dashboardRepo, 'find').mockRejectedValue(new Error('Database error'));

      const result = await service.getDashboardsToAdd(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0);
    });
  });

  describe('storeDashboard', () => {
    const mockGrafanaInstance: Partial<GrafanaInstance> = {
      id: 'test-instance-id',
      label: 'Test Grafana',
    };

    const dashboardSummary = { uid: 'new-dashboard', title: 'New Dashboard' };

    const dashboardDetails = {
      dashboard: {
        id: 123,
        uid: 'new-dashboard',
        title: 'New Dashboard',
        tags: ['perfana'],
        panels: [
          {
            id: 1,
            title: 'CPU Usage',
            type: 'graph',
            datasource: { uid: 'prometheus-uid', type: 'prometheus' },
            fieldConfig: { defaults: { unit: 'percent' } },
          },
        ],
        templating: {
          list: [{ name: 'system_under_test', type: 'query', query: 'label_values(system)' }],
        },
      },
      meta: {
        url: '/d/new-dashboard',
        slug: 'new-dashboard',
      },
    };

    it('should store new dashboard with panels and variables', async () => {
      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(dashboardDetails);
      jest.spyOn(grafanaApiService, 'getDatasourceByUid').mockResolvedValue({
        type: 'prometheus',
        name: 'Prometheus',
      } as any);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect(result.uid).toBe('new-dashboard');
      expect(result.name).toBe('New Dashboard');
      expect(result.datasourceType).toBe('prometheus');
      expect(result.panels).toHaveLength(1);
      expect((result.panels as any[])[0].title).toBe('CPU Usage');
      expect((result.panels as any[])[0].y_axes_format).toBe('percent');
      expect(result.templatingVariables).toHaveLength(1);
      expect((result.templatingVariables as any[])[0].name).toBe('system_under_test');
      expect(result.variables).toHaveLength(1);
    });

    it('should skip storing if already exists and update=false', async () => {
      const existing = { uid: 'existing', name: 'Existing' } as GrafanaDashboard;
      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(existing);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        { uid: 'existing', title: 'Existing' },
        false,
      );

      expect(result).toBe(existing);
      expect(grafanaApiService.getDashboardByUid).not.toHaveBeenCalled();
    });

    it('should update existing dashboard when update=true', async () => {
      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(dashboardDetails);
      jest.spyOn(grafanaApiService, 'getDatasourceByUid').mockResolvedValue({
        type: 'prometheus',
        name: 'Prometheus',
      } as any);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        true,
      );

      expect(result).toBeDefined();
      expect(dashboardRepo.save).toHaveBeenCalled();
    });

    it('should throw error if no graph panel found', async () => {
      const dashboardWithoutGraphPanel = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [{ id: 1, title: 'Text Panel', type: 'text' }],
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest
        .spyOn(grafanaApiService, 'getDashboardByUid')
        .mockResolvedValue(dashboardWithoutGraphPanel);

      await expect(
        service.storeDashboard(mockGrafanaInstance as GrafanaInstance, dashboardSummary, false),
      ).rejects.toThrow('No graph panel found in dashboard New Dashboard');
    });

    it('should handle datasource by name fallback', async () => {
      const dashboardWithDatasourceName = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              ...dashboardDetails.dashboard.panels[0],
              datasource: 'Prometheus', // String instead of object with uid
            },
          ],
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest
        .spyOn(grafanaApiService, 'getDashboardByUid')
        .mockResolvedValue(dashboardWithDatasourceName);
      jest.spyOn(grafanaApiService, 'getDatasourceByName').mockResolvedValue({
        type: 'prometheus',
        name: 'Prometheus',
      } as any);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect(result).toBeDefined();
      expect(grafanaApiService.getDatasourceByName).toHaveBeenCalledWith(
        'test-instance-id',
        'Prometheus',
      );
    });

    it('should handle dashboards with no templating variables', async () => {
      const dashboardWithoutVariables = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          templating: undefined,
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest
        .spyOn(grafanaApiService, 'getDashboardByUid')
        .mockResolvedValue(dashboardWithoutVariables);
      jest.spyOn(grafanaApiService, 'getDatasourceByUid').mockResolvedValue({
        type: 'prometheus',
        name: 'Prometheus',
      } as any);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect(result.templatingVariables).toEqual([]);
      expect(result.variables).toEqual([]);
    });

    it('should extract Y-axis format from old yaxes format', async () => {
      const dashboardWithOldFormat = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              id: 1,
              title: 'CPU Usage',
              type: 'graph',
              datasource: { uid: 'prometheus-uid' },
              yaxes: [{ format: 'ms' }], // Old format
            },
          ],
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(dashboardWithOldFormat);
      jest.spyOn(grafanaApiService, 'getDatasourceByUid').mockResolvedValue({
        type: 'prometheus',
        name: 'Prometheus',
      } as any);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect((result.panels as any[])[0].y_axes_format).toBe('ms');
    });

    it('should keep calling Grafana for a concrete datasource UID', async () => {
      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(dashboardDetails);
      jest.spyOn(grafanaApiService, 'getDatasourceByUid').mockResolvedValue({
        type: 'prometheus',
        name: 'Prometheus',
      } as any);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      await service.storeDashboard(mockGrafanaInstance as GrafanaInstance, dashboardSummary, false);

      expect(grafanaApiService.getDatasourceByUid).toHaveBeenCalledWith(
        'test-instance-id',
        'prometheus-uid',
      );
      expect(grafanaApiService.getDatasourceByUid).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/^\$/),
      );
    });

    it('should resolve "${datasource}" from panel.datasource.type without calling Grafana', async () => {
      const templated = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              id: 1,
              title: 'Abnormal Pod Count',
              type: 'timeseries',
              datasource: { uid: '${datasource}', type: 'prometheus' },
            },
          ],
          templating: {
            list: [
              {
                name: 'datasource',
                type: 'datasource',
                query: 'prometheus',
                current: { value: 'prom-a', text: 'Prometheus A' },
                options: [
                  { value: 'prom-a', text: 'Prometheus A' },
                  { value: 'prom-b', text: 'Prometheus B' },
                ],
              },
            ],
          },
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(templated);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect(result.datasourceType).toBe('prometheus');
      expect(grafanaApiService.getDatasourceByUid).not.toHaveBeenCalled();
      expect(grafanaApiService.getDatasourceByName).not.toHaveBeenCalled();
    });

    it('should resolve "$datasource" from the templating type filter without calling Grafana', async () => {
      const templated = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              id: 1,
              title: 'CPU',
              type: 'graph',
              datasource: '$datasource',
            },
          ],
          templating: {
            list: [{ name: 'datasource', type: 'datasource', query: 'prometheus' }],
          },
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(templated);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect(result.datasourceType).toBe('prometheus');
      expect(grafanaApiService.getDatasourceByUid).not.toHaveBeenCalled();
      expect(grafanaApiService.getDatasourceByName).not.toHaveBeenCalled();
    });

    it('should resolve a differently named datasource variable generically', async () => {
      const templated = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              id: 1,
              title: 'Latency',
              type: 'timeseries',
              datasource: { uid: '${prometheus}', type: 'prometheus' },
            },
          ],
          templating: {
            list: [{ name: 'prometheus', type: 'datasource', query: 'prometheus' }],
          },
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(templated);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect(result.datasourceType).toBe('prometheus');
      expect(grafanaApiService.getDatasourceByUid).not.toHaveBeenCalled();
    });

    it('should fail when a datasource variable cannot be resolved, without calling Grafana', async () => {
      const templated = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              id: 1,
              title: 'CPU',
              type: 'graph',
              datasource: { uid: '${missing_ds}' },
            },
          ],
          templating: {
            list: [{ name: 'system_under_test', type: 'query', query: 'label_values(system)' }],
          },
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(templated);

      await expect(
        service.storeDashboard(mockGrafanaInstance as GrafanaInstance, dashboardSummary, false),
      ).rejects.toThrow(
        'Panel datasource references template variable "missing_ds" which is not defined in dashboard.templating.list',
      );

      expect(grafanaApiService.getDatasourceByUid).not.toHaveBeenCalled();
      expect(dashboardRepo.save).not.toHaveBeenCalled();
    });

    it('should fail when a datasource variable has no type filter and panel has no type', async () => {
      const templated = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              id: 1,
              title: 'CPU',
              type: 'graph',
              datasource: { uid: '${datasource}' },
            },
          ],
          templating: {
            // Empty query = all datasource types; no reliable single type for Perfana.
            list: [{ name: 'datasource', type: 'datasource', query: '' }],
          },
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(templated);

      await expect(
        service.storeDashboard(mockGrafanaInstance as GrafanaInstance, dashboardSummary, false),
      ).rejects.toThrow(/Cannot determine datasource type for template variable "datasource"/);

      expect(grafanaApiService.getDatasourceByUid).not.toHaveBeenCalled();
    });

    it('should still surface unrelated Grafana API errors', async () => {
      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(dashboardDetails);
      jest
        .spyOn(grafanaApiService, 'getDatasourceByUid')
        .mockRejectedValue(
          new Error('Grafana API GET /api/datasources/uid/prometheus-uid failed: 500'),
        );

      await expect(
        service.storeDashboard(mockGrafanaInstance as GrafanaInstance, dashboardSummary, false),
      ).rejects.toThrow(/500/);

      expect(grafanaApiService.getDatasourceByUid).toHaveBeenCalledWith(
        'test-instance-id',
        'prometheus-uid',
      );
    });

    it('should prefer the panel datasource type when the variable is not in templating.list', async () => {
      const templated = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              id: 1,
              title: 'Abnormal Pod Count',
              type: 'timeseries',
              datasource: { uid: '${datasource}', type: 'prometheus' },
            },
          ],
          // Variable defined elsewhere (library panel / hand-edited JSON).
          templating: { list: [] },
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(templated);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect(result.datasourceType).toBe('prometheus');
      expect(grafanaApiService.getDatasourceByUid).not.toHaveBeenCalled();
    });

    it('should fall back to the first target datasource type', async () => {
      const templated = {
        ...dashboardDetails,
        dashboard: {
          ...dashboardDetails.dashboard,
          panels: [
            {
              id: 1,
              title: 'CPU',
              type: 'graph',
              // Legacy shape: bare string on the panel, type only on the target.
              datasource: '$datasource',
              targets: [{ datasource: { uid: '${datasource}', type: 'prometheus' } }],
            },
          ],
          templating: { list: [{ name: 'datasource', type: 'datasource', query: '' }] },
        },
      };

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(templated);
      jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

      const result = await service.storeDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardSummary,
        false,
      );

      expect(result.datasourceType).toBe('prometheus');
      expect(grafanaApiService.getDatasourceByUid).not.toHaveBeenCalled();
      expect(grafanaApiService.getDatasourceByName).not.toHaveBeenCalled();
    });
  });

  describe('addNewDashboards', () => {
    it('should add dashboards from all instances', async () => {
      const mockInstances = [
        { id: 'instance-1', label: 'Grafana 1' },
        { id: 'instance-2', label: 'Grafana 2' },
      ];

      jest.spyOn(instanceRepo, 'find').mockResolvedValue(mockInstances as any);

      // Mock the private method behavior
      jest
        .spyOn(instanceRepo, 'findOne')
        .mockResolvedValueOnce(mockInstances[0] as any)
        .mockResolvedValueOnce(mockInstances[1] as any);

      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      const result = await service.addNewDashboards();

      expect(instanceRepo.find).toHaveBeenCalled();
      expect(result).toBe(0); // No new dashboards in this test
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(instanceRepo, 'find').mockRejectedValue(new Error('Connection error'));

      const result = await service.addNewDashboards();

      expect(result).toBe(0);
    });

    it('should continue importing after one dashboard fails', async () => {
      const mockInstance = { id: 'instance-1', label: 'Grafana 1' };
      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockInstance] as any);
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'bad', title: 'K8s / Namespaces', tags: ['perfana'] },
        { uid: 'good', title: 'Namespace view', tags: ['perfana'] },
      ]);

      const storeSpy = jest
        .spyOn(service, 'storeDashboard')
        .mockRejectedValueOnce(
          new Error('Grafana API GET /api/datasources/uid/${datasource} failed: 403 Forbidden'),
        )
        .mockResolvedValueOnce({ uid: 'good', name: 'Namespace view' } as GrafanaDashboard);

      const result = await service.addNewDashboards();

      expect(storeSpy).toHaveBeenCalledTimes(2);
      expect(storeSpy).toHaveBeenNthCalledWith(
        1,
        mockInstance,
        expect.objectContaining({ uid: 'bad' }),
        false,
      );
      expect(storeSpy).toHaveBeenNthCalledWith(
        2,
        mockInstance,
        expect.objectContaining({ uid: 'good' }),
        false,
      );
      expect(result).toBe(1);
    });
  });
});
