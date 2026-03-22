import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { MetricsSourcesController } from './metrics-sources.controller';
import { MetricsSourcesService, MetricsSourceResponse } from './metrics-sources.service';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('MetricsSourcesController', () => {
  let controller: MetricsSourcesController;
  let service: jest.Mocked<MetricsSourcesService>;

  const mockCtx: UserContext = {
    userId: 'test-user-id',
    roles: ['user'],
    organizations: [],
    teams: [],
  };

  const mockResponse: MetricsSourceResponse = {
    id: 'ms-uuid',
    system_under_test_id: 'system-uuid',
    test_environment: 'production',
    source_type: 'grafana',
    source_config_id: 'grafana-instance-uuid',
    external_ref: 'jvm-memory-uid',
    display_name: 'JVM Memory Usage',
    display_label: 'JVM Memory - Production',
    workload: 'load-test',
    tags: ['performance'],
    metadata: {},
    organization_id: 'org-uuid',
    team_id: 'team-uuid',
    created_by: 'creator',
    created_at: '2024-01-15T10:00:00.000Z',
    updated_at: '2024-01-15T10:00:00.000Z',
    system_under_test: { id: 'system-uuid', name: 'Test System' },
  };

  beforeEach(async () => {
    const mockService = {
      findAll: jest.fn().mockResolvedValue([mockResponse]),
      findOne: jest.fn().mockResolvedValue(mockResponse),
      findByApplicationDashboardId: jest.fn().mockResolvedValue(mockResponse),
      create: jest.fn().mockResolvedValue(mockResponse),
      update: jest.fn().mockResolvedValue(mockResponse),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsSourcesController],
      providers: [
        { provide: MetricsSourcesService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<MetricsSourcesController>(MetricsSourcesController);
    service = module.get(MetricsSourcesService);

    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return metrics sources', async () => {
      const result = await controller.findAll({}, mockCtx);
      expect(result).toEqual([mockResponse]);
      expect(service.findAll).toHaveBeenCalledWith('test-user-id', ['user'], {});
    });

    it('should parse comma-separated tags', async () => {
      const query = { tags: 'perf,jvm' };
      await controller.findAll(query, mockCtx);
      expect(service.findAll).toHaveBeenCalledWith('test-user-id', ['user'], {
        tags: ['perf', 'jvm'],
      });
    });

    it('should handle service errors', async () => {
      service.findAll.mockRejectedValue(new Error('DB error'));
      await expect(controller.findAll({}, mockCtx)).rejects.toThrow('Failed to fetch metrics sources');
    });
  });

  describe('findOne', () => {
    it('should return metrics source by id', async () => {
      const result = await controller.findOne('ms-uuid', mockCtx);
      expect(result).toEqual(mockResponse);
      expect(service.findOne).toHaveBeenCalledWith('ms-uuid', 'test-user-id', ['user']);
    });

    it('should return 404 when not found', async () => {
      service.findOne.mockRejectedValue(new NotFoundException('not found'));
      await expect(controller.findOne('bad-id', mockCtx)).rejects.toThrow('Metrics source not found');
    });
  });

  describe('findByApplicationDashboard', () => {
    it('should return metrics source for app dashboard', async () => {
      const result = await controller.findByApplicationDashboard('ad-uuid', mockCtx);
      expect(result).toEqual(mockResponse);
      expect(service.findByApplicationDashboardId).toHaveBeenCalledWith('ad-uuid', 'test-user-id', ['user']);
    });
  });

  describe('create', () => {
    it('should create metrics source', async () => {
      const dto = {
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        sourceType: 'grafana',
        displayName: 'New Source',
      } as any;

      const result = await controller.create(dto, mockCtx);
      expect(result).toEqual(mockResponse);
      expect(service.create).toHaveBeenCalledWith(dto, 'test-user-id', ['user']);
    });

    it('should return 400 on creation error', async () => {
      service.create.mockRejectedValue(new Error('Constraint violation'));
      await expect(controller.create({} as any, mockCtx)).rejects.toThrow('Constraint violation');
    });
  });

  describe('update', () => {
    it('should update metrics source', async () => {
      const dto = { displayLabel: 'Updated' } as any;
      const result = await controller.update('ms-uuid', dto, mockCtx);
      expect(result).toEqual(mockResponse);
      expect(service.update).toHaveBeenCalledWith('ms-uuid', dto, 'test-user-id', ['user']);
    });

    it('should return 404 when not found', async () => {
      service.update.mockRejectedValue(new NotFoundException('not found'));
      await expect(controller.update('bad-id', {} as any, mockCtx)).rejects.toThrow('Metrics source not found');
    });
  });

  describe('delete', () => {
    it('should delete metrics source', async () => {
      const result = await controller.delete('ms-uuid', mockCtx);
      expect(result).toEqual({ deleted: true });
      expect(service.delete).toHaveBeenCalledWith('ms-uuid', 'test-user-id', ['user']);
    });

    it('should return 404 when not found', async () => {
      service.delete.mockRejectedValue(new NotFoundException('not found'));
      await expect(controller.delete('bad-id', mockCtx)).rejects.toThrow('Metrics source not found');
    });
  });
});
