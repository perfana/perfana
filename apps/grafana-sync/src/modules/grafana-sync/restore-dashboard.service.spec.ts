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
            createQueryBuilder: jest.fn(),
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

    // A real Grafana dashboard carries the JSON needed to recreate it. Synthetic
    // rows created for non-Grafana sources have none, which is what makes them
    // permanently unrestorable.
    const restorableJson = { dashboard: { title: 'Some dashboard' }, meta: {} };

    /**
     * Stub the query builder chain getDashboardsToRestore uses to look up which
     * application dashboards reference a stored dashboard, and through which
     * metrics source. Each argument is the raw result for one successive call;
     * pass an Error to make that call reject.
     */
    const mockApplicationDashboardLookups = (
      ...results: Array<Array<{ sourceType: string | null }> | Error>
    ) => {
      const getRawMany = jest.fn();
      for (const result of results) {
        if (result instanceof Error) {
          getRawMany.mockRejectedValueOnce(result);
        } else {
          getRawMany.mockResolvedValueOnce(result);
        }
      }
      getRawMany.mockResolvedValue([]);

      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany,
      };
      (applicationDashboardRepo.createQueryBuilder as jest.Mock).mockReturnValue(queryBuilder);

      return queryBuilder;
    };

    // The query builder is fully stubbed everywhere else, so nothing would catch a
    // wrong property path, join column, or raw alias — the exact bug class this
    // change could introduce. Pin the shape here.
    it('should query application dashboards joined to their metrics source', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'used-dashboard',
          name: 'Used Dashboard',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      const qb = mockApplicationDashboardLookups([{ sourceType: 'grafana' }]);

      await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(applicationDashboardRepo.createQueryBuilder).toHaveBeenCalledWith('ad');
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'metrics_sources',
        'ms',
        'ms.id = ad.metrics_source_id',
      );
      expect(qb.select).toHaveBeenCalledWith('ms.source_type', 'sourceType');
      expect(qb.where).toHaveBeenCalledWith('ad.dashboardUid = :uid', { uid: 'used-dashboard' });
    });

    // A uid is only unique within an instance, and the same uid routinely exists on
    // several. Without the instance filter, another instance's application dashboards
    // vouch for this copy and it gets pushed into the wrong Grafana every cycle.
    it('should scope the application dashboard lookup to the instance', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'span-metrics',
          name: 'Span Metrics',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      const qb = mockApplicationDashboardLookups([{ sourceType: 'grafana' }]);

      await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(qb.andWhere).toHaveBeenCalledWith('ad.grafanaInstanceId = :instanceId', {
        instanceId: 'test-instance-id',
      });
    });

    // `every`, not `some`: one mislinked application dashboard must not block
    // restoring a real Grafana dashboard that other systems still use.
    it('should still restore a shared dashboard when only one reference is non-grafana', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'shared-dashboard',
          name: 'Shared Dashboard',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      mockApplicationDashboardLookups([{ sourceType: 'dynatrace' }, { sourceType: 'grafana' }]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('shared-dashboard');
    });

    it('should find dashboards missing in Grafana that are templates', async () => {
      // Stored dashboards
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'exists-1',
          name: 'Dashboard 1',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
        {
          uid: 'missing-template',
          name: 'Template',
          tags: ['perfana-template'],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      // Grafana only has 'exists-1'
      jest
        .spyOn(grafanaApiService, 'searchDashboards')
        .mockResolvedValue([{ uid: 'exists-1', type: 'dash-db' }]);

      mockApplicationDashboardLookups([]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('missing-template');
    });

    it('should find dashboards used by applications', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'used-dashboard',
          name: 'Used Dashboard',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      // Dashboard is used by an application backed by a Grafana metrics source
      mockApplicationDashboardLookups([{ sourceType: 'grafana' }]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('used-dashboard');
    });

    it('should not restore dashboards that are not used and not templates', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'unused-dashboard',
          name: 'Unused',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      mockApplicationDashboardLookups([]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(0);
    });

    // Regression: artificial dashboards (Dynatrace, performance-test metrics) have
    // no Grafana counterpart. Restoring one would push an empty placeholder into
    // Grafana, and it can never stop being "missing", so the sweep retried it every
    // cycle forever.
    it('should not restore dashboards whose metrics source is not grafana', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'dynatrace-host-metrics-host1',
          name: 'Dynatrace host metrics host1',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      mockApplicationDashboardLookups([{ sourceType: 'dynatrace' }]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(0);
    });

    // Guards the `sourceType != null` half of the exclusion. A legacy application
    // dashboard predating the metrics_source link has no source_type to report,
    // and treating "unknown source" as non-Grafana would silently stop restoring
    // every real dashboard behind one.
    it('should still restore a dashboard whose application dashboards have no metrics source', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'legacy-real-dashboard',
          name: 'Legacy Real Dashboard',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      // Used by an application, but no MetricsSource is linked
      mockApplicationDashboardLookups([{ sourceType: null }]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('legacy-real-dashboard');
    });

    // Regression for the observed production case: the synthetic rows predate the
    // metrics_source link, so metrics_source_id is NULL and source_type alone does
    // not identify them. They carry no grafanaJson, which does.
    it('should not restore dashboards with no restorable grafanaJson', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'dynatrace-dynatrace-host-metrics-host1',
          name: 'Dynatrace host metrics host1',
          tags: [],
          grafanaJson: null,
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      // Used by an application, but with no metrics source linked at all
      mockApplicationDashboardLookups([{ sourceType: null }]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(0);
    });

    it('should not restore dashboards whose grafanaJson has no dashboard property', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'half-stored',
          name: 'Half Stored',
          tags: ['perfana-template'],
          grafanaJson: { meta: { folderId: 3 } },
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      mockApplicationDashboardLookups([]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      expect(result).toHaveLength(0);
    });

    it('should exclude folders from Grafana dashboard check', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'dashboard-1',
          name: 'Dashboard 1',
          tags: ['perfana-template'],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      // Grafana returns both folders and dashboards
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'folder-1', type: 'dash-folder' }, // Should be excluded
        { uid: 'dashboard-1', type: 'dash-db' }, // Should be included
      ]);

      mockApplicationDashboardLookups([]);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      // Dashboard exists in Grafana, so should not be restored
      expect(result).toHaveLength(0);
    });

    it('should handle multiple missing dashboards', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'template-1',
          name: 'Template 1',
          tags: ['perfana-template'],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
        {
          uid: 'used-1',
          name: 'Used 1',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
        {
          uid: 'unused-1',
          name: 'Unused 1',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      // Only 'used-1' is used by applications
      mockApplicationDashboardLookups(
        [], // template-1 not used
        [{ sourceType: 'grafana' }], // used-1 is used
        [], // unused-1 not used
      );

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
        {
          uid: 'error-dashboard',
          name: 'Error Dashboard',
          tags: [],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
        {
          uid: 'good-dashboard',
          name: 'Good Dashboard',
          tags: ['perfana-template'],
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      // First call throws error, second succeeds
      mockApplicationDashboardLookups(new Error('DB error'), []);

      const result = await service.getDashboardsToRestore(mockGrafanaInstance as GrafanaInstance);

      // Should still include good-dashboard (it's a template)
      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('good-dashboard');
    });

    it('should handle dashboards with null tags', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'no-tags',
          name: 'No Tags',
          tags: null,
          grafanaJson: restorableJson,
        } as unknown as GrafanaDashboard,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      mockApplicationDashboardLookups([{ sourceType: 'grafana' }]);

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

    it('should return false and not call Grafana when grafanaJson is missing', async () => {
      const unrestorable: Partial<GrafanaDashboard> = {
        uid: 'dynatrace-dynatrace-host-metrics-host1',
        name: 'Dynatrace host metrics host1',
        grafanaJson: null as unknown as GrafanaDashboard['grafanaJson'],
      };

      const restored = await service.restoreDashboard(
        mockGrafanaInstance as GrafanaInstance,
        unrestorable as GrafanaDashboard,
      );

      expect(restored).toBe(false);
      expect(grafanaApiService.createDashboard).not.toHaveBeenCalled();
    });

    it('should return false when grafanaJson is unparseable rather than throwing', async () => {
      const corrupt: Partial<GrafanaDashboard> = {
        uid: 'corrupt',
        name: 'Corrupt',
        grafanaJson: '{not json' as unknown as GrafanaDashboard['grafanaJson'],
      };

      const restored = await service.restoreDashboard(
        mockGrafanaInstance as GrafanaInstance,
        corrupt as GrafanaDashboard,
      );

      expect(restored).toBe(false);
      expect(grafanaApiService.createDashboard).not.toHaveBeenCalled();
    });

    it('should restore dashboard to Grafana', async () => {
      jest
        .spyOn(grafanaApiService, 'createDashboard')
        .mockResolvedValue({ id: 456, uid: 'dashboard-1' } as any);

      const restored = await service.restoreDashboard(
        mockGrafanaInstance as GrafanaInstance,
        mockDashboard as GrafanaDashboard,
      );

      expect(restored).toBe(true);

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

    // Regression: the count used to increment for every dashboard attempted, so a
    // dashboard that was skipped or dropped still reported as restored. The sync
    // log then claimed work it never did, every cycle.
    it('should not count a dashboard that was dropped instead of restored', async () => {
      jest
        .spyOn(instanceRepo, 'find')
        .mockResolvedValue([{ id: 'instance-1', label: 'Grafana 1' }] as any);

      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'gone-from-grafana',
          name: 'Gone',
          tags: ['perfana-template'],
          grafanaJson: { dashboard: { title: 'Gone' }, meta: {} },
        } as unknown as GrafanaDashboard,
      ]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      (applicationDashboardRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      // Grafana refuses it, so the row is removed from Perfana rather than restored
      jest
        .spyOn(grafanaApiService, 'createDashboard')
        .mockRejectedValue(new Error('412 Precondition Failed'));
      jest.spyOn(dashboardRepo, 'remove').mockResolvedValue({} as any);

      const result = await service.restoreDashboards();

      expect(dashboardRepo.remove).toHaveBeenCalled();
      expect(result).toBe(0);
    });

    // restoreDashboard rethrows anything that is not a 412. Without per-dashboard
    // isolation that abort would starve every dashboard behind it, on every cycle.
    it('should keep restoring after one dashboard fails hard', async () => {
      jest
        .spyOn(instanceRepo, 'find')
        .mockResolvedValue([{ id: 'instance-1', label: 'Grafana 1' }] as any);

      const json = { dashboard: { title: 'x' }, meta: {} };
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        { uid: 'bad', name: 'Bad', tags: ['perfana-template'], grafanaJson: json },
        { uid: 'good', name: 'Good', tags: ['perfana-template'], grafanaJson: json },
      ] as unknown as GrafanaDashboard[]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      (applicationDashboardRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      // First dashboard fails with a non-412 (rethrown), second succeeds
      jest
        .spyOn(grafanaApiService, 'createDashboard')
        .mockRejectedValueOnce(new Error('Grafana returned 500'))
        .mockResolvedValueOnce({ id: 1 } as any);

      const result = await service.restoreDashboards();

      expect(grafanaApiService.createDashboard).toHaveBeenCalledTimes(2);
      expect(result).toBe(1);
    });

    it('should count a dashboard Grafana actually accepted', async () => {
      jest
        .spyOn(instanceRepo, 'find')
        .mockResolvedValue([{ id: 'instance-1', label: 'Grafana 1' }] as any);

      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        {
          uid: 'gone-from-grafana',
          name: 'Gone',
          tags: ['perfana-template'],
          grafanaJson: { dashboard: { title: 'Gone' }, meta: {} },
        } as unknown as GrafanaDashboard,
      ]);
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);
      (applicationDashboardRepo.createQueryBuilder as jest.Mock).mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      jest.spyOn(grafanaApiService, 'createDashboard').mockResolvedValue({ id: 456 } as any);

      const result = await service.restoreDashboards();

      expect(result).toBe(1);
    });
  });
});
