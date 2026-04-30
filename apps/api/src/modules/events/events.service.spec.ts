import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { EventsService } from './events.service';
import { Event, SystemUnderTest, ApplicationDashboard, GrafanaInstance } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { GrafanaClientService } from '../grafana/grafana-client.service';

describe('EventsService', () => {
  let service: EventsService;
  let eventRepo: any;
  let sutRepo: any;
  let appDashboardRepo: any;
  let authzService: any;
  let grafanaClient: any;

  const mockEvent = {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Deployment v2.3.1',
    description: 'Deployed new version',
    systemUnderTestId: '22222222-2222-2222-2222-222222222222',
    testEnvironment: 'production',
    timestamp: new Date('2024-01-15T10:00:00Z'),
    tags: ['deploy'],
    grafanaAnnotationIds: {},
    organizationId: '33333333-3333-3333-3333-333333333333',
    createdBy: 'user-1',
    updatedBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    systemUnderTest: { id: '22222222-2222-2222-2222-222222222222', name: 'my-service' },
  };

  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([mockEvent]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: getRepositoryToken(Event),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            manager: {
              getRepository: jest.fn().mockReturnValue({
                findOne: jest.fn(),
              }),
            },
          },
        },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ApplicationDashboard),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(GrafanaInstance),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            isGlobalAdmin: jest.fn(),
            getAccessibleOrganizations: jest.fn(),
            isOrganizationMember: jest.fn(),
            canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' }),
          },
        },
        {
          provide: GrafanaClientService,
          useValue: {
            createAnnotation: jest.fn(),
            deleteAnnotation: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    eventRepo = module.get(getRepositoryToken(Event));
    sutRepo = module.get(getRepositoryToken(SystemUnderTest));
    appDashboardRepo = module.get(getRepositoryToken(ApplicationDashboard));
    authzService = module.get(AuthorizationService);
    grafanaClient = module.get(GrafanaClientService);
  });

  describe('findAll', () => {
    it('should return all events for global admin', async () => {
      authzService.isGlobalAdmin.mockReturnValue(true);
      const result = await service.findAll('user-1', ['super-admin']);
      expect(result).toEqual([mockEvent]);
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('organization_id'),
        expect.anything(),
      );
    });

    it('should filter by accessible organizations for non-admin', async () => {
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValue(['org-1', 'org-2']);
      await service.findAll('user-1', ['user']);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(e.organization_id IN (:...orgIds) OR e.organization_id IS NULL)',
        { orgIds: ['org-1', 'org-2'] },
      );
    });

    it('should apply query filters', async () => {
      authzService.isGlobalAdmin.mockReturnValue(true);
      await service.findAll('user-1', ['super-admin'], {
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'e.system_under_test_id = :sutId',
        { sutId: 'sut-1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'e.test_environment = :env',
        { env: 'prod' },
      );
    });
  });

  describe('findByTestRun', () => {
    const mockTestRun = {
      id: 'tr-1',
      systemUnderTestId: 'sut-1',
      testEnvironment: 'prod',
      startTime: new Date('2024-01-15T09:00:00Z'),
      endTime: new Date('2024-01-15T10:00:00Z'),
    };

    it('should throw NotFoundException if test run not found', async () => {
      eventRepo.manager.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
      await expect(service.findByTestRun('tr-1', 'user-1', ['user']))
        .rejects.toThrow(NotFoundException);
    });

    it('should filter by system, env, and time window', async () => {
      eventRepo.manager.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(mockTestRun) });
      authzService.isGlobalAdmin.mockReturnValue(true);
      await service.findByTestRun('tr-1', 'user-1', ['super-admin']);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'e.system_under_test_id = :sutId',
        { sutId: 'sut-1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'e.test_environment = :env',
        { env: 'prod' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "e.title NOT IN ('Test start', 'Test end')",
      );
    });
  });

  describe('findOne', () => {
    it('should return event for global admin', async () => {
      authzService.isGlobalAdmin.mockReturnValue(true);
      eventRepo.findOne.mockResolvedValue(mockEvent);
      const result = await service.findOne(mockEvent.id, 'user-1', ['super-admin']);
      expect(result).toEqual(mockEvent);
    });

    it('should throw NotFoundException if event not found', async () => {
      eventRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('not-found', 'user-1', ['user']))
        .rejects.toThrow(NotFoundException);
    });

    it('should check org membership for non-admin', async () => {
      eventRepo.findOne.mockResolvedValue(mockEvent);
      authzService.canAccessResource.mockResolvedValue({ allowed: true, reason: 'org member' });
      const result = await service.findOne(mockEvent.id, 'user-1', ['user']);
      expect(result).toEqual(mockEvent);
      expect(authzService.canAccessResource).toHaveBeenCalledWith(
        'user-1',
        ['user'],
        expect.objectContaining({ organization_id: mockEvent.organizationId }),
      );
    });

    it('should throw NotFoundException for non-admin without org access', async () => {
      eventRepo.findOne.mockResolvedValue(mockEvent);
      authzService.canAccessResource.mockResolvedValue({ allowed: false, reason: 'denied' });
      await expect(service.findOne(mockEvent.id, 'user-1', ['user']))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create an event and attempt Grafana annotation sync', async () => {
      sutRepo.findOne.mockResolvedValue({ id: 'sut-1', organization_id: 'org-1' });
      eventRepo.create.mockReturnValue({ ...mockEvent, id: undefined });
      eventRepo.save.mockResolvedValue(mockEvent);
      eventRepo.findOne.mockResolvedValue(mockEvent);
      appDashboardRepo.find.mockResolvedValue([]);

      const result = await service.create(
        {
          title: 'Deploy',
          systemUnderTest: 'sut-1',
          testEnvironment: 'prod',
          timestamp: '2024-01-15T10:00:00Z',
        },
        'user-1',
        ['user'],
      );

      expect(eventRepo.create).toHaveBeenCalled();
      expect(eventRepo.save).toHaveBeenCalled();
      expect(result).toEqual(mockEvent);
    });

    it('should throw NotFoundException for unknown system under test', async () => {
      sutRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create(
          { title: 'Deploy', systemUnderTest: 'unknown', testEnvironment: 'prod', timestamp: '2024-01-15T10:00:00Z' },
          'user-1',
          ['user'],
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete event and attempt Grafana annotation cleanup', async () => {
      authzService.isGlobalAdmin.mockReturnValue(true);
      eventRepo.findOne.mockResolvedValue({
        ...mockEvent,
        grafanaAnnotationIds: { 'inst-1:dash-1': 42 },
      });
      eventRepo.remove.mockResolvedValue(undefined);

      // Should not throw even if Grafana annotation deletion fails
      await service.remove(mockEvent.id, 'user-1', ['super-admin']);
      expect(eventRepo.remove).toHaveBeenCalled();
    });
  });
});
