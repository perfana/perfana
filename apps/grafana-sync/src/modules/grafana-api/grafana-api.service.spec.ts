import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaApiService } from './grafana-api.service';
import { GrafanaInstance } from '@perfana/shared/entities';

// Mock fetch globally
global.fetch = jest.fn();

describe('GrafanaApiService', () => {
  let service: GrafanaApiService;
  let grafanaInstanceRepo: Repository<GrafanaInstance>;

  const mockInstance: Partial<GrafanaInstance> = {
    id: 'test-id',
    label: 'Test Grafana',
    client_url: 'http://grafana.test',
    server_url: 'http://grafana.test',
    apiKey: 'test-api-key',
    orgId: '1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrafanaApiService,
        {
          provide: getRepositoryToken(GrafanaInstance),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GrafanaApiService>(GrafanaApiService);
    grafanaInstanceRepo = module.get<Repository<GrafanaInstance>>(
      getRepositoryToken(GrafanaInstance),
    );

    // Reset mock before each test
    (global.fetch as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllInstances', () => {
    it('should return all Grafana instances', async () => {
      const mockInstances = [
        { id: '1', label: 'Grafana 1' },
        { id: '2', label: 'Grafana 2' },
      ];

      jest.spyOn(grafanaInstanceRepo, 'find').mockResolvedValue(mockInstances as any);

      const instances = await service.getAllInstances();
      expect(instances).toEqual(mockInstances);
    });
  });

  describe('getDashboardByUid', () => {
    it('should fetch dashboard from Grafana API', async () => {
      const dashboardData = {
        dashboard: { id: 1, uid: 'test-uid', title: 'Test Dashboard' },
        meta: { url: '/d/test-uid' },
      };

      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => dashboardData,
      });

      const result = await service.getDashboardByUid('test-id', 'test-uid');

      expect(result).toEqual(dashboardData);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://grafana.test/api/dashboards/uid/test-uid',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should throw error if instance not found', async () => {
      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(null);

      await expect(service.getDashboardByUid('invalid-id', 'test-uid')).rejects.toThrow(
        'Grafana instance invalid-id not found',
      );
    });

    it('should throw error if API request fails', async () => {
      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(service.getDashboardByUid('test-id', 'invalid-uid')).rejects.toThrow(
        'Grafana API GET /api/dashboards/uid/invalid-uid failed: 404 Not Found',
      );
    });
  });

  describe('searchDashboards', () => {
    it('should search dashboards with tag filter', async () => {
      const searchResults = [
        { uid: 'dash-1', title: 'Dashboard 1', tags: ['perfana'] },
        { uid: 'dash-2', title: 'Dashboard 2', tags: ['perfana'] },
      ];

      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => searchResults,
      });

      const result = await service.searchDashboards('test-id', {
        tag: 'perfana',
        limit: 100,
      });

      expect(result).toEqual(searchResults);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/search?tag=perfana&limit=100'),
        expect.any(Object),
      );
    });

    it('should search dashboards with multiple UIDs', async () => {
      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await service.searchDashboards('test-id', {
        dashboardUIDs: ['uid-1', 'uid-2'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('dashboardUIDs=uid-1&dashboardUIDs=uid-2'),
        expect.any(Object),
      );
    });
  });

  describe('getDatasourceByUid', () => {
    it('should fetch datasource by UID', async () => {
      const datasource = {
        id: 1,
        uid: 'prometheus-uid',
        name: 'Prometheus',
        type: 'prometheus',
      };

      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => datasource,
      });

      const result = await service.getDatasourceByUid('test-id', 'prometheus-uid');

      expect(result).toEqual(datasource);
    });
  });

  describe('getDatasourceByName', () => {
    it('should fetch datasource by name', async () => {
      const datasource = {
        id: 1,
        name: 'Prometheus',
        type: 'prometheus',
      };

      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => datasource,
      });

      const result = await service.getDatasourceByName('test-id', 'Prometheus');

      expect(result).toEqual(datasource);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://grafana.test/api/datasources/name/Prometheus',
        expect.any(Object),
      );
    });
  });

  describe('createDashboard', () => {
    it('should create dashboard in Grafana', async () => {
      const dashboardPayload = {
        dashboard: { title: 'New Dashboard' },
        folderId: 0,
        overwrite: false,
      };

      const createResponse = {
        id: 123,
        uid: 'new-uid',
        url: '/d/new-uid',
      };

      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => createResponse,
      });

      const result = await service.createDashboard('test-id', dashboardPayload);

      expect(result).toEqual(createResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://grafana.test/api/dashboards/db',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(dashboardPayload),
        }),
      );
    });
  });

  describe('deleteDashboard', () => {
    it('should delete dashboard from Grafana', async () => {
      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Dashboard deleted' }),
      });

      await service.deleteDashboard('test-id', 'dash-uid');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://grafana.test/api/dashboards/uid/dash-uid',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('createOrFindFolder', () => {
    it('should return existing folder ID if found', async () => {
      const searchResults = [{ id: 5, uid: 'my-app', title: 'My App' }];

      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => searchResults,
      });

      const folderId = await service.createOrFindFolder('test-id', 'My App');

      expect(folderId).toBe(5);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/search?type=dash-folder&query=my-app'),
        expect.any(Object),
      );
    });

    it('should create new folder if not found', async () => {
      const createResponse = { id: 10, uid: 'new-app', title: 'New App' };

      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [], // Search returns empty
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createResponse, // Create succeeds
        });

      const folderId = await service.createOrFindFolder('test-id', 'New App');

      expect(folderId).toBe(10);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'http://grafana.test/api/folders',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'New App',
            uid: 'new-app',
          }),
        }),
      );
    });

    it('should return 0 (General folder) on error', async () => {
      jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(mockInstance as any);

      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const folderId = await service.createOrFindFolder('test-id', 'My App');

      expect(folderId).toBe(0);
    });
  });
});
