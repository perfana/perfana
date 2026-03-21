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

    it('should return dashboards with perfana tag not yet stored', async () => {
      // Mock stored dashboards (UID: stored-1)
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([{ uid: 'stored-1' } as GrafanaDashboard]);

      // Mock Grafana API returns 4 dashboards
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'stored-1', title: 'Already Stored', tags: ['perfana'] },
        { uid: 'new-1', title: 'New Dashboard 1', tags: ['perfana'] },
        { uid: 'new-2', title: 'New Dashboard 2', tags: ['perfana'] },
        { uid: 'no-tag', title: 'No Perfana Tag', tags: ['other'] },
      ]);

      const result = await service.getDashboardsToAdd(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(2);
      expect(result[0].uid).toBe('new-1');
      expect(result[1].uid).toBe('new-2');

      // Verify the correct calls were made
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

    it('should filter out dashboards without perfana tag', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'with-tag', title: 'With Perfana', tags: ['perfana', 'monitoring'] },
        { uid: 'without-tag', title: 'Without Perfana', tags: ['monitoring'] },
        { uid: 'no-tags', title: 'No Tags', tags: [] },
      ]);

      const result = await service.getDashboardsToAdd(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('with-tag');
    });

    it('should handle case-insensitive perfana tag matching', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'lowercase', title: 'Lowercase', tags: ['perfana'] },
        { uid: 'uppercase', title: 'Uppercase', tags: ['PERFANA'] },
        { uid: 'mixedcase', title: 'Mixed', tags: ['Perfana'] },
      ]);

      const result = await service.getDashboardsToAdd(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(3);
    });

    it('should return empty array on error and log error', async () => {
      jest.spyOn(dashboardRepo, 'find').mockRejectedValue(new Error('Database error'));

      const result = await service.getDashboardsToAdd(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0);
    });

    it('should handle dashboards with no tags field', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'no-tags-field', title: 'No Tags Field' }, // No tags property
        { uid: 'with-tags', title: 'With Tags', tags: ['perfana'] },
      ]);

      const result = await service.getDashboardsToAdd(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('with-tags');
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
      expect(result.panels[0].title).toBe('CPU Usage');
      expect(result.panels[0].y_axes_format).toBe('percent');
      expect(result.templatingVariables).toHaveLength(1);
      expect(result.templatingVariables[0].name).toBe('system_under_test');
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

      expect(result.panels[0].y_axes_format).toBe('ms');
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
  });
});
