import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { UpdateDashboardsService } from './update-dashboards.service';
import { StoreDashboardService } from './store-dashboard.service';
import { GrafanaDashboard, ApplicationDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

describe('UpdateDashboardsService', () => {
  let service: UpdateDashboardsService;
  let dashboardRepo: Repository<GrafanaDashboard>;
  let instanceRepo: Repository<GrafanaInstance>;
  let applicationDashboardRepo: Repository<ApplicationDashboard>;
  let grafanaApiService: GrafanaApiService;
  let storeDashboardService: StoreDashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateDashboardsService,
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
          provide: getRepositoryToken(ApplicationDashboard),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: GrafanaApiService,
          useValue: {
            searchDashboards: jest.fn(),
            getDashboardByUid: jest.fn(),
          },
        },
        {
          provide: StoreDashboardService,
          useValue: {
            storeDashboard: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UpdateDashboardsService>(UpdateDashboardsService);
    dashboardRepo = module.get<Repository<GrafanaDashboard>>(getRepositoryToken(GrafanaDashboard));
    instanceRepo = module.get<Repository<GrafanaInstance>>(getRepositoryToken(GrafanaInstance));
    applicationDashboardRepo = module.get<Repository<ApplicationDashboard>>(
      getRepositoryToken(ApplicationDashboard),
    );
    grafanaApiService = module.get<GrafanaApiService>(GrafanaApiService);
    storeDashboardService = module.get<StoreDashboardService>(StoreDashboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboardsToUpdate', () => {
    const mockGrafanaInstance: Partial<GrafanaInstance> = {
      id: 'test-instance-id',
      label: 'Test Grafana',
    };

    it('should return dashboards updated in Grafana in last hour', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Stored dashboard updated 2 hours ago
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1', updated: twoHoursAgo, usedBySut: ['app1'] } as GrafanaDashboard,
        ]);

      // Grafana has same dashboard updated 30 minutes ago
      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] }]);

      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: thirtyMinutesAgo.toISOString() },
        dashboard: { uid: 'dashboard-1' },
      } as any);

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(1);
      expect(result[0].perfanaDashboard.uid).toBe('dashboard-1');
      expect(result[0].usedBySUT).toEqual(['app1']);
    });

    it('should not return dashboards updated more than 1 hour ago', async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1', updated: twoHoursAgo, usedBySut: [] } as GrafanaDashboard,
        ]);

      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] }]);

      // Dashboard updated 2 hours ago (not in last hour)
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: twoHoursAgo.toISOString() },
        dashboard: { uid: 'dashboard-1' },
      } as any);

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0);
    });

    it('should not return dashboards where Grafana version is older than stored', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      // Stored dashboard updated 10 minutes ago (newer)
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1', updated: tenMinutesAgo, usedBySut: [] } as GrafanaDashboard,
        ]);

      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] }]);

      // Grafana dashboard updated 30 minutes ago (older than stored)
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: thirtyMinutesAgo.toISOString() },
        dashboard: { uid: 'dashboard-1' },
      } as any);

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0);
    });

    it('should filter out dashboards without perfana tag', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'with-tag', title: 'With Perfana', tags: ['perfana'] },
        { uid: 'without-tag', title: 'Without Perfana', tags: ['monitoring'] },
      ]);

      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: thirtyMinutesAgo.toISOString() },
      } as any);

      await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);

      // Only perfana-tagged dashboard should be checked (but won't be returned since it's not stored)
      expect(grafanaApiService.getDashboardByUid).toHaveBeenCalledWith(
        'test-instance-id',
        'with-tag',
      );
      expect(grafanaApiService.getDashboardByUid).not.toHaveBeenCalledWith(
        'test-instance-id',
        'without-tag',
      );
    });

    it('should handle case-insensitive perfana tag matching', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1', updated: twoHoursAgo, usedBySut: [] } as GrafanaDashboard,
        ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'dashboard-1', title: 'Dashboard 1', tags: ['PERFANA'] }, // Uppercase
      ]);

      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: thirtyMinutesAgo.toISOString() },
        dashboard: { uid: 'dashboard-1' },
      } as any);

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(1);
    });

    it('should skip dashboards not found in stored dashboards', async () => {
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1', updated: new Date(), usedBySut: [] } as GrafanaDashboard,
        ]);

      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'new-dashboard', title: 'New Dashboard', tags: ['perfana'] }]);

      const now = new Date();
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: now.toISOString() },
        dashboard: { uid: 'new-dashboard' },
      } as any);

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0); // Not in stored dashboards
    });

    it('should handle dashboards with no usedBySut field', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        { uid: 'dashboard-1', updated: twoHoursAgo } as GrafanaDashboard, // No usedBySut
      ]);

      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] }]);

      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: thirtyMinutesAgo.toISOString() },
        dashboard: { uid: 'dashboard-1' },
      } as any);

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(1);
      expect(result[0].usedBySUT).toEqual([]);
    });

    it('should handle dashboards with null updated timestamp', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1', updated: null, usedBySut: [] } as GrafanaDashboard,
        ]);

      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] }]);

      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: thirtyMinutesAgo.toISOString() },
        dashboard: { uid: 'dashboard-1' },
      } as any);

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(1); // Should include since stored timestamp defaults to epoch
    });

    it('should return empty array on error and log error', async () => {
      jest.spyOn(dashboardRepo, 'find').mockRejectedValue(new Error('Database error'));

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0);
    });

    it('should handle errors when fetching individual dashboard details', async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1', updated: twoHoursAgo, usedBySut: [] } as GrafanaDashboard,
        ]);

      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] }]);

      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockRejectedValue(new Error('API error'));

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0); // Should skip failed dashboards
    });

    it('should handle non-Error exceptions when fetching individual dashboard details', async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'dashboard-1', updated: twoHoursAgo, usedBySut: [] } as GrafanaDashboard,
        ]);

      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] }]);

      // Throw a non-Error object
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockRejectedValue('String error');

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0); // Should skip failed dashboards
    });

    it('should handle non-Error exceptions at top level', async () => {
      // Throw a non-Error object
      jest.spyOn(dashboardRepo, 'find').mockRejectedValue('String error');

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0);
    });

    it('should process dashboards in batches of 20', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Create 25 dashboards (should process in 2 batches)
      const storedDashboards = Array.from(
        { length: 25 },
        (_, i) =>
          ({
            uid: `dashboard-${i}`,
            updated: twoHoursAgo,
            usedBySut: [],
          }) as GrafanaDashboard,
      );

      const grafanaDashboards = Array.from({ length: 25 }, (_, i) => ({
        uid: `dashboard-${i}`,
        title: `Dashboard ${i}`,
        tags: ['perfana'],
      }));

      jest.spyOn(dashboardRepo, 'find').mockResolvedValue(storedDashboards);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue(grafanaDashboards);
      jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
        meta: { updated: thirtyMinutesAgo.toISOString() },
        dashboard: {},
      } as any);

      const result = await service.getDashboardsToUpdate(mockGrafanaInstance as GrafanaInstance);

      // All 25 should be returned (all updated in last hour and newer than stored)
      expect(result).toHaveLength(25);
      expect(grafanaApiService.getDashboardByUid).toHaveBeenCalledTimes(25);
    });
  });

  describe('updateDashboards', () => {
    it('should update dashboards for all instances', async () => {
      const mockInstances: Partial<GrafanaInstance>[] = [
        { id: 'instance-1', label: 'Grafana 1' },
        { id: 'instance-2', label: 'Grafana 2' },
      ];

      jest.spyOn(instanceRepo, 'find').mockResolvedValue(mockInstances as GrafanaInstance[]);

      // Mock getDashboardsToUpdate to return one dashboard for each instance
      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'dashboard-1', title: 'Dashboard 1' },
          usedBySUT: [],
        },
      ]);

      jest.spyOn(storeDashboardService, 'storeDashboard').mockResolvedValue({} as any);

      const result = await service.updateDashboards();

      expect(result).toBe(2); // 1 dashboard per instance
      expect(storeDashboardService.storeDashboard).toHaveBeenCalledTimes(2);
      expect(storeDashboardService.storeDashboard).toHaveBeenCalledWith(
        mockInstances[0],
        { uid: 'dashboard-1', title: 'Dashboard 1' },
        true, // update mode
      );
    });

    it('should return 0 when no instances found', async () => {
      jest.spyOn(instanceRepo, 'find').mockResolvedValue([]);

      const result = await service.updateDashboards();

      expect(result).toBe(0);
      expect(storeDashboardService.storeDashboard).not.toHaveBeenCalled();
    });

    it('should return 0 when no dashboards need updating', async () => {
      const mockInstances: Partial<GrafanaInstance>[] = [{ id: 'instance-1', label: 'Grafana 1' }];

      jest.spyOn(instanceRepo, 'find').mockResolvedValue(mockInstances as GrafanaInstance[]);
      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([]);

      const result = await service.updateDashboards();

      expect(result).toBe(0);
      expect(storeDashboardService.storeDashboard).not.toHaveBeenCalled();
    });

    it('should handle errors when updating individual dashboards', async () => {
      const mockInstance: Partial<GrafanaInstance> = {
        id: 'instance-1',
        label: 'Grafana 1',
      };

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockInstance as GrafanaInstance]);
      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'dashboard-1', title: 'Dashboard 1' },
          usedBySUT: [],
        },
        {
          perfanaDashboard: { uid: 'dashboard-2', title: 'Dashboard 2' },
          usedBySUT: [],
        },
      ]);

      jest
        .spyOn(storeDashboardService, 'storeDashboard')
        .mockResolvedValueOnce({} as any) // First succeeds
        .mockRejectedValueOnce(new Error('Storage error')); // Second fails

      const result = await service.updateDashboards();

      expect(result).toBe(1); // Only 1 succeeded
      expect(storeDashboardService.storeDashboard).toHaveBeenCalledTimes(2);
    });

    it('should handle non-Error exceptions when updating individual dashboards', async () => {
      const mockInstance: Partial<GrafanaInstance> = {
        id: 'instance-1',
        label: 'Grafana 1',
      };

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockInstance as GrafanaInstance]);
      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'dashboard-1', title: 'Dashboard 1' },
          usedBySUT: [],
        },
      ]);

      // Throw a non-Error object
      jest.spyOn(storeDashboardService, 'storeDashboard').mockRejectedValue('String error');

      const result = await service.updateDashboards();

      expect(result).toBe(0); // Failed
      expect(storeDashboardService.storeDashboard).toHaveBeenCalledTimes(1);
    });

    it('should handle errors when getting instances', async () => {
      jest.spyOn(instanceRepo, 'find').mockRejectedValue(new Error('Database error'));

      const result = await service.updateDashboards();

      expect(result).toBe(0);
      expect(storeDashboardService.storeDashboard).not.toHaveBeenCalled();
    });

    it('should continue updating other instances if one fails', async () => {
      const mockInstances: Partial<GrafanaInstance>[] = [
        { id: 'instance-1', label: 'Grafana 1' },
        { id: 'instance-2', label: 'Grafana 2' },
      ];

      jest.spyOn(instanceRepo, 'find').mockResolvedValue(mockInstances as GrafanaInstance[]);

      jest
        .spyOn(service, 'getDashboardsToUpdate')
        .mockRejectedValueOnce(new Error('API error')) // First instance fails
        .mockResolvedValueOnce([
          {
            perfanaDashboard: { uid: 'dashboard-2', title: 'Dashboard 2' },
            usedBySUT: [],
          },
        ]); // Second instance succeeds

      jest.spyOn(storeDashboardService, 'storeDashboard').mockResolvedValue({} as any);

      const result = await service.updateDashboards();

      expect(result).toBe(1); // Only second instance succeeded
      expect(storeDashboardService.storeDashboard).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error exceptions at instance level', async () => {
      const mockInstance: Partial<GrafanaInstance> = {
        id: 'instance-1',
        label: 'Grafana 1',
      };

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockInstance as GrafanaInstance]);

      // Throw a non-Error object from getDashboardsToUpdate
      jest.spyOn(service, 'getDashboardsToUpdate').mockRejectedValue('String error');

      const result = await service.updateDashboards();

      expect(result).toBe(0);
      expect(storeDashboardService.storeDashboard).not.toHaveBeenCalled();
    });
  });

  describe('updateTemplateDashboards', () => {
    const mockGrafanaInstance: Partial<GrafanaInstance> = {
      id: 'test-instance-id',
      label: 'Test Grafana',
    };

    it('should propagate template dashboard changes to application dashboards', async () => {
      // Arrange
      const templatePanels = [
        { id: 1, title: 'Panel 1', type: 'graph' },
        { id: 2, title: 'Panel 2', type: 'table' },
      ];

      const updatedTemplateDashboard: Partial<GrafanaDashboard> = {
        uid: 'template-uid',
        grafanaInstanceId: 'test-instance-id',
        panels: templatePanels,
      };

      const referencedDashboard: Partial<GrafanaDashboard> = {
        id: 'referenced-dashboard-id',
        panels: [{ id: 1, title: 'Old Panel', type: 'old' }],
      };

      const appDashboard: Partial<ApplicationDashboard> = {
        id: 'app-dashboard-id',
        dashboardLabel: 'App Dashboard 1',
        templateDashboardUid: 'template-uid',
        grafanaDashboardId: 'referenced-dashboard-id',
      };

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);

      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'template-uid', title: 'Template Dashboard' },
          usedBySUT: [],
        },
      ]);

      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValue([appDashboard as ApplicationDashboard]);

      jest
        .spyOn(dashboardRepo, 'findOne')
        .mockResolvedValueOnce(updatedTemplateDashboard as GrafanaDashboard) // Template dashboard
        .mockResolvedValueOnce(referencedDashboard as GrafanaDashboard); // Referenced dashboard

      jest.spyOn(dashboardRepo, 'save').mockResolvedValue(referencedDashboard as GrafanaDashboard);

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(1);
      expect(dashboardRepo.findOne).toHaveBeenCalledWith({
        where: {
          uid: 'template-uid',
          grafanaInstanceId: 'test-instance-id',
        },
      });
      expect(dashboardRepo.findOne).toHaveBeenCalledWith({
        where: {
          id: 'referenced-dashboard-id',
        },
      });
      expect(dashboardRepo.save).toHaveBeenCalledWith({
        ...referencedDashboard,
        panels: templatePanels, // Should have updated panels
      });
    });

    it('should skip when no application dashboards use the template', async () => {
      // Arrange
      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);

      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'template-uid', title: 'Template Dashboard' },
          usedBySUT: [],
        },
      ]);

      jest.spyOn(applicationDashboardRepo, 'find').mockResolvedValue([]); // No app dashboards

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(0);
      expect(dashboardRepo.findOne).not.toHaveBeenCalled();
      expect(dashboardRepo.save).not.toHaveBeenCalled();
    });

    it('should skip when template dashboard not found in database', async () => {
      // Arrange
      const appDashboard: Partial<ApplicationDashboard> = {
        id: 'app-dashboard-id',
        dashboardLabel: 'App Dashboard 1',
        templateDashboardUid: 'template-uid',
        grafanaDashboardId: 'referenced-dashboard-id',
      };

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);

      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'template-uid', title: 'Template Dashboard' },
          usedBySUT: [],
        },
      ]);

      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValue([appDashboard as ApplicationDashboard]);

      jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(null); // Template not found

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(0);
      expect(dashboardRepo.save).not.toHaveBeenCalled();
    });

    it('should skip when referenced dashboard not found', async () => {
      // Arrange
      const updatedTemplateDashboard: Partial<GrafanaDashboard> = {
        uid: 'template-uid',
        grafanaInstanceId: 'test-instance-id',
        panels: [{ id: 1, title: 'Panel 1' }],
      };

      const appDashboard: Partial<ApplicationDashboard> = {
        id: 'app-dashboard-id',
        dashboardLabel: 'App Dashboard 1',
        templateDashboardUid: 'template-uid',
        grafanaDashboardId: 'referenced-dashboard-id',
      };

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);

      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'template-uid', title: 'Template Dashboard' },
          usedBySUT: [],
        },
      ]);

      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValue([appDashboard as ApplicationDashboard]);

      jest
        .spyOn(dashboardRepo, 'findOne')
        .mockResolvedValueOnce(updatedTemplateDashboard as GrafanaDashboard) // Template found
        .mockResolvedValueOnce(null); // Referenced dashboard not found

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(0);
      expect(dashboardRepo.save).not.toHaveBeenCalled();
    });

    it('should handle errors when updating individual application dashboards', async () => {
      // Arrange
      const templatePanels = [{ id: 1, title: 'Panel 1' }];

      const updatedTemplateDashboard: Partial<GrafanaDashboard> = {
        uid: 'template-uid',
        grafanaInstanceId: 'test-instance-id',
        panels: templatePanels,
      };

      const referencedDashboard1: Partial<GrafanaDashboard> = {
        id: 'referenced-dashboard-1',
        panels: [],
      };

      const referencedDashboard2: Partial<GrafanaDashboard> = {
        id: 'referenced-dashboard-2',
        panels: [],
      };

      const appDashboards: Partial<ApplicationDashboard>[] = [
        {
          id: 'app-dashboard-1',
          dashboardLabel: 'App Dashboard 1',
          templateDashboardUid: 'template-uid',
          grafanaDashboardId: 'referenced-dashboard-1',
        },
        {
          id: 'app-dashboard-2',
          dashboardLabel: 'App Dashboard 2',
          templateDashboardUid: 'template-uid',
          grafanaDashboardId: 'referenced-dashboard-2',
        },
      ];

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);

      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'template-uid', title: 'Template Dashboard' },
          usedBySUT: [],
        },
      ]);

      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValue(appDashboards as ApplicationDashboard[]);

      jest
        .spyOn(dashboardRepo, 'findOne')
        .mockResolvedValueOnce(updatedTemplateDashboard as GrafanaDashboard) // Template
        .mockResolvedValueOnce(referencedDashboard1 as GrafanaDashboard) // First referenced
        .mockResolvedValueOnce(referencedDashboard2 as GrafanaDashboard); // Second referenced

      jest
        .spyOn(dashboardRepo, 'save')
        .mockResolvedValueOnce(referencedDashboard1 as GrafanaDashboard) // First succeeds
        .mockRejectedValueOnce(new Error('Save error')); // Second fails

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(1); // Only one succeeded
      expect(dashboardRepo.save).toHaveBeenCalledTimes(2);
    });

    it('should handle non-Error exceptions when updating individual application dashboards', async () => {
      // Arrange
      const templatePanels = [{ id: 1, title: 'Panel 1' }];

      const updatedTemplateDashboard: Partial<GrafanaDashboard> = {
        uid: 'template-uid',
        grafanaInstanceId: 'test-instance-id',
        panels: templatePanels,
      };

      const referencedDashboard: Partial<GrafanaDashboard> = {
        id: 'referenced-dashboard-id',
        panels: [],
      };

      const appDashboard: Partial<ApplicationDashboard> = {
        id: 'app-dashboard-id',
        dashboardLabel: 'App Dashboard 1',
        templateDashboardUid: 'template-uid',
        grafanaDashboardId: 'referenced-dashboard-id',
      };

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);

      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([
        {
          perfanaDashboard: { uid: 'template-uid', title: 'Template Dashboard' },
          usedBySUT: [],
        },
      ]);

      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValue([appDashboard as ApplicationDashboard]);

      jest
        .spyOn(dashboardRepo, 'findOne')
        .mockResolvedValueOnce(updatedTemplateDashboard as GrafanaDashboard)
        .mockResolvedValueOnce(referencedDashboard as GrafanaDashboard);

      // Throw a non-Error object
      jest.spyOn(dashboardRepo, 'save').mockRejectedValue('String error');

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(0); // Failed
      expect(dashboardRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should process multiple template dashboards across multiple instances', async () => {
      // Arrange
      const instance1: Partial<GrafanaInstance> = { id: 'instance-1', label: 'Grafana 1' };
      const instance2: Partial<GrafanaInstance> = { id: 'instance-2', label: 'Grafana 2' };

      const template1Panels = [{ id: 1, title: 'Template 1 Panel' }];
      const template2Panels = [{ id: 2, title: 'Template 2 Panel' }];

      const templateDashboard1: Partial<GrafanaDashboard> = {
        uid: 'template-1',
        grafanaInstanceId: 'instance-1',
        panels: template1Panels,
      };

      const templateDashboard2: Partial<GrafanaDashboard> = {
        uid: 'template-2',
        grafanaInstanceId: 'instance-2',
        panels: template2Panels,
      };

      const referencedDashboard1: Partial<GrafanaDashboard> = {
        id: 'ref-1',
        panels: [],
      };

      const referencedDashboard2: Partial<GrafanaDashboard> = {
        id: 'ref-2',
        panels: [],
      };

      jest
        .spyOn(instanceRepo, 'find')
        .mockResolvedValue([instance1 as GrafanaInstance, instance2 as GrafanaInstance]);

      jest
        .spyOn(service, 'getDashboardsToUpdate')
        .mockResolvedValueOnce([
          { perfanaDashboard: { uid: 'template-1', title: 'Template 1' }, usedBySUT: [] },
        ])
        .mockResolvedValueOnce([
          { perfanaDashboard: { uid: 'template-2', title: 'Template 2' }, usedBySUT: [] },
        ]);

      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValueOnce([
          {
            dashboardLabel: 'App 1',
            templateDashboardUid: 'template-1',
            grafanaDashboardId: 'ref-1',
          },
        ] as ApplicationDashboard[])
        .mockResolvedValueOnce([
          {
            dashboardLabel: 'App 2',
            templateDashboardUid: 'template-2',
            grafanaDashboardId: 'ref-2',
          },
        ] as ApplicationDashboard[]);

      jest
        .spyOn(dashboardRepo, 'findOne')
        .mockResolvedValueOnce(templateDashboard1 as GrafanaDashboard)
        .mockResolvedValueOnce(referencedDashboard1 as GrafanaDashboard)
        .mockResolvedValueOnce(templateDashboard2 as GrafanaDashboard)
        .mockResolvedValueOnce(referencedDashboard2 as GrafanaDashboard);

      jest.spyOn(dashboardRepo, 'save').mockResolvedValue({} as GrafanaDashboard);

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(2); // Both updated successfully
      expect(dashboardRepo.save).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no instances found', async () => {
      // Arrange
      jest.spyOn(instanceRepo, 'find').mockResolvedValue([]);

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(0);
      expect(applicationDashboardRepo.find).not.toHaveBeenCalled();
    });

    it('should return 0 when no dashboards need updating', async () => {
      // Arrange
      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);
      jest.spyOn(service, 'getDashboardsToUpdate').mockResolvedValue([]); // No updates

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(0);
      expect(applicationDashboardRepo.find).not.toHaveBeenCalled();
    });

    it('should handle top-level errors gracefully', async () => {
      // Arrange
      jest.spyOn(instanceRepo, 'find').mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(0);
      expect(applicationDashboardRepo.find).not.toHaveBeenCalled();
    });

    it('should handle errors during applicationDashboardRepo.find() gracefully', async () => {
      // Arrange
      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);

      jest
        .spyOn(service, 'getDashboardsToUpdate')
        .mockResolvedValue([
          { perfanaDashboard: { uid: 'template-1', title: 'Template 1' }, usedBySUT: [] },
        ]);

      // Repository throws an error
      jest.spyOn(applicationDashboardRepo, 'find').mockRejectedValue(new Error('Query failed'));

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(0); // Error is caught at top level, returns 0
      expect(dashboardRepo.save).not.toHaveBeenCalled();
    });

    it('should update multiple application dashboards using the same template', async () => {
      // Arrange
      const templatePanels = [{ id: 1, title: 'Shared Panel' }];

      const updatedTemplateDashboard: Partial<GrafanaDashboard> = {
        uid: 'template-uid',
        grafanaInstanceId: 'test-instance-id',
        panels: templatePanels,
      };

      const referencedDashboard1: Partial<GrafanaDashboard> = {
        id: 'ref-1',
        panels: [],
      };

      const referencedDashboard2: Partial<GrafanaDashboard> = {
        id: 'ref-2',
        panels: [],
      };

      const referencedDashboard3: Partial<GrafanaDashboard> = {
        id: 'ref-3',
        panels: [],
      };

      const appDashboards: Partial<ApplicationDashboard>[] = [
        {
          dashboardLabel: 'App 1',
          templateDashboardUid: 'template-uid',
          grafanaDashboardId: 'ref-1',
        },
        {
          dashboardLabel: 'App 2',
          templateDashboardUid: 'template-uid',
          grafanaDashboardId: 'ref-2',
        },
        {
          dashboardLabel: 'App 3',
          templateDashboardUid: 'template-uid',
          grafanaDashboardId: 'ref-3',
        },
      ];

      jest.spyOn(instanceRepo, 'find').mockResolvedValue([mockGrafanaInstance as GrafanaInstance]);

      jest
        .spyOn(service, 'getDashboardsToUpdate')
        .mockResolvedValue([
          { perfanaDashboard: { uid: 'template-uid', title: 'Template' }, usedBySUT: [] },
        ]);

      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValue(appDashboards as ApplicationDashboard[]);

      jest
        .spyOn(dashboardRepo, 'findOne')
        .mockResolvedValueOnce(updatedTemplateDashboard as GrafanaDashboard)
        .mockResolvedValueOnce(referencedDashboard1 as GrafanaDashboard)
        .mockResolvedValueOnce(referencedDashboard2 as GrafanaDashboard)
        .mockResolvedValueOnce(referencedDashboard3 as GrafanaDashboard);

      jest.spyOn(dashboardRepo, 'save').mockResolvedValue({} as GrafanaDashboard);

      // Act
      const result = await service.updateTemplateDashboards();

      // Assert
      expect(result).toBe(3); // All three updated
      expect(dashboardRepo.save).toHaveBeenCalledTimes(3);
      expect(dashboardRepo.save).toHaveBeenCalledWith({
        ...referencedDashboard1,
        panels: templatePanels,
      });
      expect(dashboardRepo.save).toHaveBeenCalledWith({
        ...referencedDashboard2,
        panels: templatePanels,
      });
      expect(dashboardRepo.save).toHaveBeenCalledWith({
        ...referencedDashboard3,
        panels: templatePanels,
      });
    });
  });
});
