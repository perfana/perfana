import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RestoreDashboardService } from './restore-dashboard.service';
import { GrafanaDashboard, GrafanaInstance, ApplicationDashboard } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

describe('RestoreDashboardService', () => {
  let service: RestoreDashboardService;
  let dashboardRepo: Repository<GrafanaDashboard>;
  let instanceRepo: Repository<GrafanaInstance>;
  let applicationDashboardRepo: Repository<ApplicationDashboard>;
  let grafanaApiService: GrafanaApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreDashboardService,
        {
          provide: getRepositoryToken(GrafanaDashboard),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            remove: jest.fn(),
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
            createDashboard: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RestoreDashboardService>(RestoreDashboardService);
    dashboardRepo = module.get<Repository<GrafanaDashboard>>(getRepositoryToken(GrafanaDashboard));
    instanceRepo = module.get<Repository<GrafanaInstance>>(getRepositoryToken(GrafanaInstance));
    applicationDashboardRepo = module.get<Repository<ApplicationDashboard>>(
      getRepositoryToken(ApplicationDashboard),
    );
    grafanaApiService = module.get<GrafanaApiService>(GrafanaApiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboardsToRestore', () => {
    const mockGrafanaInstance: Partial<GrafanaInstance> = {
      id: 'test-instance-id',
      label: 'Test Grafana',
    };

    it('should find dashboards missing in Grafana that are templates', async () => {
      // Stored dashboards
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        { uid: 'exists-1', name: 'Dashboard 1', tags: [] } as GrafanaDashboard,
        {
          uid: 'missing-template',
          name: 'Template',
          tags: ['perfana-template'],
        } as GrafanaDashboard,
      ]);

      // Grafana only has 'exists-1'
      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'exists-1', type: 'dash-db' }]);

      jest.spyOn(applicationDashboardRepo, 'find').mockResolvedValue([]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('missing-template');
    });

    it('should find dashboards used by applications', async () => {
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'used-dashboard', name: 'Used Dashboard', tags: [] } as GrafanaDashboard,
        ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      // Dashboard is used by an application
      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValue([{ dashboardUid: 'used-dashboard' } as ApplicationDashboard]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('used-dashboard');
    });

    it('should not restore dashboards that are not used and not templates', async () => {
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'unused-dashboard', name: 'Unused', tags: [] } as GrafanaDashboard,
        ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      jest.spyOn(applicationDashboardRepo, 'find').mockResolvedValue([]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(0);
    });

    it('should exclude folders from Grafana dashboard check', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'dashboard-1',
          name: 'Dashboard 1',
          tags: ['perfana-template'],
        } as GrafanaDashboard,
      ]);

      // Grafana returns both folders and dashboards
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'folder-1', type: 'dash-folder' }, // Should be excluded
        { uid: 'dashboard-1', type: 'dash-db' }, // Should be included
      ]);

      jest.spyOn(applicationDashboardRepo, 'find').mockResolvedValue([]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      // Dashboard exists in Grafana, so should not be restored
      expect(result).toHaveLength(0);
    });

    it('should handle multiple missing dashboards', async () => {
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([
          { uid: 'template-1', name: 'Template 1', tags: ['perfana-template'] } as GrafanaDashboard,
          { uid: 'used-1', name: 'Used 1', tags: [] } as GrafanaDashboard,
          { uid: 'unused-1', name: 'Unused 1', tags: [] } as GrafanaDashboard,
        ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      // Only 'used-1' is used by applications
      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValueOnce([]) // template-1 not used
        .mockResolvedValueOnce([{ dashboardUid: 'used-1' } as ApplicationDashboard]) // used-1 is used
        .mockResolvedValueOnce([]); // unused-1 not used

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(2);
      expect(result.map((d) => d.uid)).toContain('template-1');
      expect(result.map((d) => d.uid)).toContain('used-1');
      expect(result.map((d) => d.uid)).not.toContain('unused-1');
    });

    it('should return empty array on error and log error', async () => {
      jest.spyOn(dashboardRepo, 'find').mockRejectedValue(new Error('Database error'));

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);
      expect(result).toHaveLength(0);
    });

    it('should handle errors checking individual dashboards', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        { uid: 'error-dashboard', name: 'Error Dashboard', tags: [] } as GrafanaDashboard,
        {
          uid: 'good-dashboard',
          name: 'Good Dashboard',
          tags: ['perfana-template'],
        } as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      // First call throws error, second succeeds
      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce([]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      // Should still include good-dashboard (it's a template)
      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('good-dashboard');
    });

    it('should handle dashboards with null tags', async () => {
      jest
        .spyOn(dashboardRepo, 'find')
        .mockResolvedValue([{ uid: 'no-tags', name: 'No Tags', tags: null } as GrafanaDashboard]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      jest
        .spyOn(applicationDashboardRepo, 'find')
        .mockResolvedValue([{ dashboardUid: 'no-tags' } as ApplicationDashboard]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(1); // Should be restored because it's used by application
    });
  });

  describe('restoreDashboard', () => {
    const mockGrafanaInstance: Partial<GrafanaInstance> = {
      id: 'test-instance-id',
      label: 'Test Grafana',
    };

    const mockDashboard: Partial<GrafanaDashboard> = {
      uid: 'dashboard-1',
      name: 'Dashboard 1',
      grafanaJson: {
        dashboard: {
          id: 123,
          uid: 'dashboard-1',
          title: 'Dashboard 1',
          panels: [],
        },
        meta: {
          folderId: 5,
        },
      },
    };

    it('should restore dashboard to Grafana', async () => {
      jest
        .spyOn(grafanaApiService, 'createDashboard')
        .mockResolvedValue({ id: 456, uid: 'dashboard-1' } as any);

      await service.restoreDashboard(
        mockGrafanaInstance as GrafanaInstance,
        mockDashboard as GrafanaDashboard,
      );

      expect(grafanaApiService.createDashboard).toHaveBeenCalledWith(
        'test-instance-id',
        expect.objectContaining({
          dashboard: expect.objectContaining({
            uid: 'dashboard-1',
            title: 'Dashboard 1',
          }),
          folderId: 5,
          overwrite: false,
        }),
      );

      // Should not have 'id' property in dashboard
      const call = (grafanaApiService.createDashboard as jest.Mock).mock.calls[0][1];
      expect(call.dashboard.id).toBeUndefined();
    });

    it('should use General folder (0) if no folderId in meta', async () => {
      const grafanaJsonData = mockDashboard.grafanaJson as any;
      const dashboardWithoutFolder: Partial<GrafanaDashboard> = {
        ...mockDashboard,
        grafanaJson: {
          dashboard: grafanaJsonData.dashboard,
          meta: {},
        },
      };

      jest.spyOn(grafanaApiService, 'createDashboard').mockResolvedValue({ id: 456 } as any);

      await service.restoreDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardWithoutFolder as GrafanaDashboard,
      );

      expect(grafanaApiService.createDashboard).toHaveBeenCalledWith(
        'test-instance-id',
        expect.objectContaining({
          folderId: 0,
        }),
      );
    });

    it('should parse grafanaJson if it is a string', async () => {
      const dashboardWithStringJson: Partial<GrafanaDashboard> = {
        ...mockDashboard,
        grafanaJson: JSON.stringify(mockDashboard.grafanaJson) as any,
      };

      jest.spyOn(grafanaApiService, 'createDashboard').mockResolvedValue({ id: 456 } as any);

      await service.restoreDashboard(
        mockGrafanaInstance as GrafanaInstance,
        dashboardWithStringJson as GrafanaDashboard,
      );

      expect(grafanaApiService.createDashboard).toHaveBeenCalled();
    });

    it('should remove dashboard from DB if restore fails with 412 precondition', async () => {
      const error = new Error(
        'Grafana API POST /api/dashboards/db failed: 412 Precondition Failed',
      );
      jest.spyOn(grafanaApiService, 'createDashboard').mockRejectedValue(error);
      jest.spyOn(dashboardRepo, 'remove').mockResolvedValue(mockDashboard as any);

      await service.restoreDashboard(
        mockGrafanaInstance as GrafanaInstance,
        mockDashboard as GrafanaDashboard,
      );

      expect(dashboardRepo.remove).toHaveBeenCalledWith(mockDashboard);
    });

    it('should throw error if restore fails with non-412 error', async () => {
      const error = new Error('Network error');
      jest.spyOn(grafanaApiService, 'createDashboard').mockRejectedValue(error);

      await expect(
        service.restoreDashboard(
          mockGrafanaInstance as GrafanaInstance,
          mockDashboard as GrafanaDashboard,
        ),
      ).rejects.toThrow('Network error');

      expect(dashboardRepo.remove).not.toHaveBeenCalled();
    });

    it('should handle error when removing dashboard from DB fails', async () => {
      const createError = new Error('412 Precondition Failed');
      const removeError = new Error('Database error');

      jest.spyOn(grafanaApiService, 'createDashboard').mockRejectedValue(createError);
      jest.spyOn(dashboardRepo, 'remove').mockRejectedValue(removeError);

      // Should not throw, just log error
      await service.restoreDashboard(
        mockGrafanaInstance as GrafanaInstance,
        mockDashboard as GrafanaDashboard,
      );

      expect(dashboardRepo.remove).toHaveBeenCalled();
    });
  });

  describe('restoreDashboards', () => {
    it('should restore dashboards from all instances', async () => {
      const mockInstances = [
        { id: 'instance-1', label: 'Grafana 1' },
        { id: 'instance-2', label: 'Grafana 2' },
      ];

      jest.spyOn(instanceRepo, 'find').mockResolvedValue(mockInstances as any);
      jest
        .spyOn(instanceRepo, 'findOne')
        .mockResolvedValueOnce(mockInstances[0] as any)
        .mockResolvedValueOnce(mockInstances[1] as any);

      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      const result = await service.restoreDashboards();

      expect(instanceRepo.find).toHaveBeenCalled();
      expect(result).toBe(0); // No dashboards to restore in this test
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(instanceRepo, 'find').mockRejectedValue(new Error('Connection error'));

      const result = await service.restoreDashboards();

      expect(result).toBe(0);
    });
  });
});
