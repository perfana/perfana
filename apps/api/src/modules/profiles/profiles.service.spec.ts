import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import {
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  GrafanaInstance,
  GrafanaDashboard,
  GenericDeepLink,
} from '../../entities';
import { CreateProfileDashboardDto, UpdateProfileDashboardDto } from './dto/profile-dashboard.dto';
import { CreateProfileBenchmarkDto, UpdateProfileBenchmarkDto } from './dto/profile-benchmark.dto';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';

describe('ProfilesService', () => {
  let service: ProfilesService;
  let profileRepo: jest.Mocked<Repository<Profile>>;
  let profileDashboardRepo: jest.Mocked<Repository<ProfileGrafanaDashboard>>;
  let profileBenchmarkRepo: jest.Mocked<Repository<ProfileBenchmark>>;
  let grafanaInstanceRepo: jest.Mocked<Repository<GrafanaInstance>>;
  let grafanaDashboardRepo: jest.Mocked<Repository<GrafanaDashboard>>;

  const mockDate = new Date('2024-01-15T10:00:00.000Z');

  const mockProfile: Profile = {
    id: 'profile-uuid-1',
    name: 'Test Profile',
    description: 'Test profile description',
    tags: ['tag1', 'tag2'],
    readOnly: false,
    createdAt: mockDate,
    updatedAt: mockDate,
  } as Profile;

  const mockProfile2: Profile = {
    id: 'profile-uuid-2',
    name: 'Another Profile',
    description: 'Another profile description',
    tags: ['tag3'],
    readOnly: true,
    createdAt: mockDate,
    updatedAt: mockDate,
  } as Profile;

  const mockGrafanaInstance: GrafanaInstance = {
    id: 'grafana-instance-uuid',
    label: 'Default',
    client_url: 'https://grafana.example.com',
    orgId: 'default-org',
    createdAt: mockDate,
    updatedAt: mockDate,
  } as GrafanaInstance;

  const mockGrafanaDashboard: GrafanaDashboard = {
    id: 'grafana-dashboard-uuid',
    uid: 'dashboard-uid-123',
    name: 'JVM Memory Usage',
    grafanaInstanceId: 'grafana-instance-uuid',
    grafanaId: 1,
    panels: [],
    tags: ['jvm', 'memory'],
    createdAt: mockDate,
  } as GrafanaDashboard;

  const mockProfileDashboard: ProfileGrafanaDashboard = {
    id: 'profile-dashboard-uuid-1',
    profile: 'Test Profile',
    dashboardName: 'JVM Memory Usage',
    dashboardUid: 'dashboard-uid-123',
    grafanaLabel: 'Default',
    createSeparateDashboardForVariable: 'application',
    setHardcodedValueForVariables: [{ name: 'env', values: ['prod'] }],
    matchRegexForVariables: { region: 'us-.*' },
    readOnly: false,
    createdAt: mockDate,
    updatedAt: mockDate,
  } as ProfileGrafanaDashboard;

  const mockProfileBenchmark: ProfileBenchmark = {
    id: 'benchmark-uuid-1',
    profile_id: 'profile-uuid-1',
    profile_dashboard_id: 'profile-dashboard-uuid-1',
    workload_pattern: '.*load.*',
    source: 'grafana',
    grafana_instance: 'Default',
    dashboard_uid: 'dashboard-uid-123',
    panel_id: 1,
    panel_title: 'Heap Memory',
    panel_type: 'graph',
    panel_description: 'Heap memory usage',
    evaluate_type: 'avg',
    metric_unit: 'MB',
    requirement_operator: 'lt',
    requirement_value: 1024,
    exclude_ramp_up_time: true,
    average_all: false,
    match_pattern: '.*heap.*',
    validate_with_default_if_no_data: false,
    validate_with_default_if_no_data_value: undefined,
    tags: ['memory', 'jvm'],
    metadata: { category: 'performance' },
    read_only: false,
    profile: mockProfile,
    createdAt: mockDate,
    updatedAt: mockDate,
  } as ProfileBenchmark;

  const mockUserId = 'test-user-id';
  // Tests run as global admin (matches the prior fixture: mockRoles=['user']
  // combined with the default mock's isGlobalAdmin=true). Phase 3c C33 swap
  // preserves this behavior by passing isAdmin=true directly.
  const mockIsAdmin = true;

  beforeEach(async () => {
    const mockProfileRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    const mockProfileDashboardRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
      })),
    };

    const mockProfileBenchmarkRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      })),
    };

    const mockGrafanaInstanceRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    const mockGrafanaDashboardRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
      })),
    };

    const mockGenericDeepLinkRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        {
          provide: getRepositoryToken(Profile),
          useValue: mockProfileRepo,
        },
        {
          provide: getRepositoryToken(ProfileGrafanaDashboard),
          useValue: mockProfileDashboardRepo,
        },
        {
          provide: getRepositoryToken(ProfileBenchmark),
          useValue: mockProfileBenchmarkRepo,
        },
        {
          provide: getRepositoryToken(GrafanaInstance),
          useValue: mockGrafanaInstanceRepo,
        },
        {
          provide: getRepositoryToken(GrafanaDashboard),
          useValue: mockGrafanaDashboardRepo,
        },
        {
          provide: getRepositoryToken(GenericDeepLink),
          useValue: mockGenericDeepLinkRepo,
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<ProfilesService>(ProfilesService);
    profileRepo = module.get(getRepositoryToken(Profile));
    profileDashboardRepo = module.get(getRepositoryToken(ProfileGrafanaDashboard));
    profileBenchmarkRepo = module.get(getRepositoryToken(ProfileBenchmark));
    grafanaInstanceRepo = module.get(getRepositoryToken(GrafanaInstance));
    grafanaDashboardRepo = module.get(getRepositoryToken(GrafanaDashboard));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all profiles with dashboard counts', async () => {
      // Arrange
      const profileQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockProfile, mockProfile2]),
      };
      profileRepo.createQueryBuilder.mockReturnValue(profileQueryBuilder as any);

      const dashboardQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { profile: 'Test Profile', count: '3' },
          { profile: 'Another Profile', count: '1' },
        ]),
      };
      profileDashboardRepo.createQueryBuilder.mockReturnValue(dashboardQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockIsAdmin);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]!).toEqual({
        id: 'profile-uuid-1',
        name: 'Test Profile',
        description: 'Test profile description',
        tags: ['tag1', 'tag2'],
        readOnly: false,
        dashboardCount: 3,
        sloCount: expect.any(Number),
        deepLinksCount: expect.any(Number),
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString(),
      });
      expect(result[1]!.dashboardCount).toBe(1);
      expect(profileRepo.createQueryBuilder).toHaveBeenCalledWith('profile');
    });

    it('should return profiles with zero dashboard count when no dashboards exist', async () => {
      // Arrange
      const profileQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockProfile]),
      };
      profileRepo.createQueryBuilder.mockReturnValue(profileQueryBuilder as any);

      const dashboardQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      profileDashboardRepo.createQueryBuilder.mockReturnValue(dashboardQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockIsAdmin);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]!.dashboardCount).toBe(0);
    });

    it('should handle empty profiles list', async () => {
      // Arrange
      const profileQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      profileRepo.createQueryBuilder.mockReturnValue(profileQueryBuilder as any);

      const dashboardQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      profileDashboardRepo.createQueryBuilder.mockReturnValue(dashboardQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockIsAdmin);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      const profileQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockRejectedValue(new Error('Database connection failed')),
      };
      profileRepo.createQueryBuilder.mockReturnValue(profileQueryBuilder as any);

      // Act & Assert
      await expect(service.findAll(mockUserId, mockIsAdmin)).rejects.toThrow('Database connection failed');
    });
  });

  describe('findOne', () => {
    it('should return a single profile by id with dashboard count', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.count.mockResolvedValue(5);

      // Act
      const result = await service.findOne('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toEqual({
        id: 'profile-uuid-1',
        name: 'Test Profile',
        description: 'Test profile description',
        tags: ['tag1', 'tag2'],
        readOnly: false,
        dashboardCount: 5,
        sloCount: expect.any(Number),
        deepLinksCount: expect.any(Number),
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString(),
      });
      expect(profileRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'profile-uuid-1' },
      });
      expect(profileDashboardRepo.count).toHaveBeenCalledWith({
        where: { profile: 'Test Profile' },
      });
    });

    it('should return null when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findOne('non-existent-id', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null and log error when query fails', async () => {
      // Arrange
      profileRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.findOne('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findDashboardsByProfileId', () => {
    it('should return all dashboards for a profile with tags', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.find.mockResolvedValue([mockProfileDashboard]);
      grafanaInstanceRepo.find.mockResolvedValue([mockGrafanaInstance]);

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockGrafanaDashboard]),
      };
      grafanaDashboardRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

      // Act
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'profile-dashboard-uuid-1',
        profile: 'Test Profile',
        dashboardName: 'JVM Memory Usage',
        dashboardUid: 'dashboard-uid-123',
        grafanaLabel: 'Default',
        tags: ['jvm', 'memory'],
        createSeparateDashboardForVariable: 'application',
        setHardcodedValueForVariables: [{ name: 'env', values: ['prod'] }],
        matchRegexForVariables: { region: 'us-.*' },
        readOnly: false,
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString(),
      });
      expect(profileDashboardRepo.find).toHaveBeenCalledWith({
        where: { profile: 'Test Profile' },
        order: { dashboardName: 'ASC' },
      });
    });

    it('should return empty array when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findDashboardsByProfileId('non-existent-id', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when profile has no dashboards', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.find.mockResolvedValue([]);
      grafanaInstanceRepo.find.mockResolvedValue([]);

      // Act
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle dashboards with empty tags gracefully', async () => {
      // Arrange
      const dashboardWithoutTags = { ...mockProfileDashboard };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.find.mockResolvedValue([dashboardWithoutTags]);
      grafanaInstanceRepo.find.mockResolvedValue([mockGrafanaInstance]);

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      grafanaDashboardRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

      // Act
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]!.tags).toEqual([]);
    });

    it('should skip Grafana dashboard query when no dashboard UIDs exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.find.mockResolvedValue([]);
      grafanaInstanceRepo.find.mockResolvedValue([]);

      // Act
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toEqual([]);
      expect(grafanaDashboardRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.find.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockIsAdmin)).rejects.toThrow('Database error');
    });
  });

  describe('createDashboard', () => {
    const createDto: CreateProfileDashboardDto = {
      dashboardUid: 'dashboard-uid-123',
      grafanaLabel: 'Default',
      createSeparateDashboardForVariable: 'application',
      setHardcodedValueForVariables: [{ name: 'env', values: ['prod'] }],
      matchRegexForVariables: { region: 'us-.*' },
      readOnly: false,
    };

    it('should create a new dashboard association for a profile', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(mockGrafanaDashboard);
      profileDashboardRepo.create.mockReturnValue(mockProfileDashboard);
      profileDashboardRepo.save.mockResolvedValue(mockProfileDashboard);

      // Act
      const result = await service.createDashboard('profile-uuid-1', createDto, mockUserId, mockIsAdmin);

      // Assert
      expect(result).toEqual({
        id: 'profile-dashboard-uuid-1',
        profile: 'Test Profile',
        dashboardName: 'JVM Memory Usage',
        dashboardUid: 'dashboard-uid-123',
        grafanaLabel: 'Default',
        tags: ['jvm', 'memory'],
        createSeparateDashboardForVariable: 'application',
        setHardcodedValueForVariables: [{ name: 'env', values: ['prod'] }],
        matchRegexForVariables: { region: 'us-.*' },
        readOnly: false,
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString(),
      });
      expect(profileDashboardRepo.create).toHaveBeenCalledWith({
        profile: 'Test Profile',
        dashboardName: 'JVM Memory Usage',
        dashboardUid: 'dashboard-uid-123',
        grafanaLabel: 'Default',
        createSeparateDashboardForVariable: 'application',
        setHardcodedValueForVariables: [{ name: 'env', values: ['prod'] }],
        matchRegexForVariables: { region: 'us-.*' },
        readOnly: false,
      });
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createDashboard('non-existent-id', createDto, mockUserId, mockIsAdmin)).rejects.toThrow(
        new NotFoundException('Profile non-existent-id not found')
      );
    });

    it('should throw BadRequestException when Grafana instance does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      grafanaInstanceRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createDashboard('profile-uuid-1', createDto, mockUserId, mockIsAdmin)).rejects.toThrow(
        new BadRequestException("Grafana instance with label 'Default' not found")
      );
    });

    it('should throw BadRequestException when Grafana dashboard does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createDashboard('profile-uuid-1', createDto, mockUserId, mockIsAdmin)).rejects.toThrow(
        new BadRequestException(
          "Dashboard with UID 'dashboard-uid-123' not found in Grafana instance 'Default'"
        )
      );
    });

    it('should create dashboard with default readOnly value when not provided', async () => {
      // Arrange
      const dtoWithoutReadOnly = { ...createDto };
      delete dtoWithoutReadOnly.readOnly;

      profileRepo.findOne.mockResolvedValue(mockProfile);
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(mockGrafanaDashboard);
      profileDashboardRepo.create.mockReturnValue(mockProfileDashboard);
      profileDashboardRepo.save.mockResolvedValue(mockProfileDashboard);

      // Act
      await service.createDashboard('profile-uuid-1', dtoWithoutReadOnly, mockUserId, mockIsAdmin);

      // Assert
      expect(profileDashboardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          readOnly: false,
        })
      );
    });
  });

  describe('updateDashboard', () => {
    const updateDto: UpdateProfileDashboardDto = {
      createSeparateDashboardForVariable: 'workload',
      setHardcodedValueForVariables: [{ name: 'region', values: ['eu', 'us'] }],
      matchRegexForVariables: { env: 'prod.*' },
      readOnly: true,
    };

    it('should update an existing dashboard association', async () => {
      // Arrange
      const updatedDashboard = { ...mockProfileDashboard, readOnly: true };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne
        .mockResolvedValueOnce(mockProfileDashboard) // First call in update logic
        .mockResolvedValueOnce(updatedDashboard); // Second call after update
      profileDashboardRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(mockGrafanaDashboard);

      // Act
      const result = await service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', updateDto, mockUserId, mockIsAdmin);

      // Assert
      expect(result.readOnly).toBe(true);
      expect(profileDashboardRepo.update).toHaveBeenCalledWith(
        'profile-dashboard-uuid-1',
        expect.objectContaining({
          readOnly: true,
        })
      );
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateDashboard('non-existent-id', 'dashboard-id', updateDto, mockUserId, mockIsAdmin)
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should throw NotFoundException when dashboard does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateDashboard('profile-uuid-1', 'non-existent-dashboard-id', updateDto)
      ).rejects.toThrow(
        new NotFoundException('Dashboard non-existent-dashboard-id not found for profile Test Profile')
      );
    });

    it('should validate Grafana instance when grafanaLabel is updated', async () => {
      // Arrange
      const dtoWithGrafanaLabel = { ...updateDto, grafanaLabel: 'NewGrafana' };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(mockProfileDashboard);
      grafanaInstanceRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithGrafanaLabel, mockUserId, mockIsAdmin)
      ).rejects.toThrow(new BadRequestException("Grafana instance with label 'NewGrafana' not found"));
    });

    it('should validate dashboard UID when updated', async () => {
      // Arrange
      const dtoWithDashboardUid = { ...updateDto, dashboardUid: 'new-dashboard-uid' };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(mockProfileDashboard);
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithDashboardUid, mockUserId, mockIsAdmin)
      ).rejects.toThrow(
        new BadRequestException(
          "Dashboard with UID 'new-dashboard-uid' not found in Grafana instance 'Default'"
        )
      );
    });

    it('should convert empty array to null for setHardcodedValueForVariables', async () => {
      // Arrange
      const dtoWithEmptyArray = { setHardcodedValueForVariables: [] };
      const updatedDashboard = { ...mockProfileDashboard, setHardcodedValueForVariables: null };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne
        .mockResolvedValueOnce(mockProfileDashboard)
        .mockResolvedValueOnce(updatedDashboard);
      profileDashboardRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(mockGrafanaDashboard);

      // Act
      await service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithEmptyArray, mockUserId, mockIsAdmin);

      // Assert
      expect(profileDashboardRepo.update).toHaveBeenCalledWith(
        'profile-dashboard-uuid-1',
        expect.objectContaining({
          setHardcodedValueForVariables: null,
        })
      );
    });

    it('should convert empty object to null for matchRegexForVariables', async () => {
      // Arrange
      const dtoWithEmptyObject = { matchRegexForVariables: {} };
      const updatedDashboard = { ...mockProfileDashboard, matchRegexForVariables: null };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne
        .mockResolvedValueOnce(mockProfileDashboard)
        .mockResolvedValueOnce(updatedDashboard);
      profileDashboardRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(mockGrafanaDashboard);

      // Act
      await service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithEmptyObject, mockUserId, mockIsAdmin);

      // Assert
      expect(profileDashboardRepo.update).toHaveBeenCalledWith(
        'profile-dashboard-uuid-1',
        expect.objectContaining({
          matchRegexForVariables: null,
        })
      );
    });

    it('should update dashboard name when dashboardUid is changed', async () => {
      // Arrange
      const newDashboard = { ...mockGrafanaDashboard, uid: 'new-uid', name: 'New Dashboard Name' };
      const dtoWithNewUid = { dashboardUid: 'new-uid' };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne
        .mockResolvedValueOnce(mockProfileDashboard)
        .mockResolvedValueOnce({ ...mockProfileDashboard, dashboardName: 'New Dashboard Name' });
      profileDashboardRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(newDashboard);

      // Act
      await service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithNewUid, mockUserId, mockIsAdmin);

      // Assert
      expect(profileDashboardRepo.update).toHaveBeenCalledWith(
        'profile-dashboard-uuid-1',
        expect.objectContaining({
          dashboardName: 'New Dashboard Name',
        })
      );
    });

    it('should throw NotFoundException when dashboard not found after update', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne
        .mockResolvedValueOnce(mockProfileDashboard)
        .mockResolvedValueOnce(null); // Not found after update
      profileDashboardRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      // Act & Assert
      await expect(
        service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', updateDto, mockUserId, mockIsAdmin)
      ).rejects.toThrow(
        new NotFoundException('Dashboard profile-dashboard-uuid-1 not found after update')
      );
    });
  });

  describe('deleteDashboard', () => {
    it('should delete a dashboard association from a profile', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(mockProfileDashboard);
      profileDashboardRepo.remove.mockResolvedValue(mockProfileDashboard);

      // Act
      await service.deleteDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(profileDashboardRepo.remove).toHaveBeenCalledWith(mockProfileDashboard);
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteDashboard('non-existent-id', 'dashboard-id', mockUserId, mockIsAdmin)
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should throw NotFoundException when dashboard does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteDashboard('profile-uuid-1', 'non-existent-dashboard-id', mockUserId, mockIsAdmin)
      ).rejects.toThrow(
        new NotFoundException('Dashboard non-existent-dashboard-id not found for profile Test Profile')
      );
    });

    it('should throw error when delete operation fails', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(mockProfileDashboard);
      profileDashboardRepo.remove.mockRejectedValue(new Error('Database constraint violation'));

      // Act & Assert
      await expect(
        service.deleteDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', mockUserId, mockIsAdmin)
      ).rejects.toThrow('Database constraint violation');
    });
  });

  describe('findBenchmarksByProfileId', () => {
    it('should return all benchmarks for a profile', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockResolvedValue([mockProfileBenchmark]);

      // Act
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'benchmark-uuid-1',
        profileId: 'profile-uuid-1',
        profileDashboardId: 'profile-dashboard-uuid-1',
        workloadPattern: '.*load.*',
        source: 'grafana',
        grafanaInstance: 'Default',
        dashboardUid: 'dashboard-uid-123',
        panelId: 1,
        panelTitle: 'Heap Memory',
        panelType: 'graph',
        panelDescription: 'Heap memory usage',
        evaluateType: 'avg',
        metricUnit: 'MB',
        requirementOperator: 'lt',
        requirementValue: 1024,
        excludeRampUpTime: true,
        averageAll: false,
        matchPattern: '.*heap.*',
        validateWithDefaultIfNoData: false,
        validateWithDefaultIfNoDataValue: undefined,
        tags: ['memory', 'jvm'],
        metadata: { category: 'performance' },
        readOnly: false,
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString(),
      });
      expect(profileBenchmarkRepo.find).toHaveBeenCalledWith({
        where: { profile_id: 'profile-uuid-1' },
        order: { createdAt: 'DESC' },
      });
    });

    it('should return empty array when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findBenchmarksByProfileId('non-existent-id', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when profile has no benchmarks', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockResolvedValue([]);

      // Act
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle benchmarks with null numeric values', async () => {
      // Arrange
      const benchmarkWithNulls = {
        ...mockProfileBenchmark,
        requirement_value: undefined,
        validate_with_default_if_no_data_value: undefined,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockResolvedValue([benchmarkWithNulls] as ProfileBenchmark[]);

      // Act
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result[0]!.requirementValue).toBeUndefined();
      expect(result[0]!.validateWithDefaultIfNoDataValue).toBeUndefined();
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockIsAdmin)).rejects.toThrow('Database error');
    });
  });

  describe('createBenchmark', () => {
    const createDto: CreateProfileBenchmarkDto = {
      profileDashboardId: 'profile-dashboard-uuid-1',
      workloadPattern: '.*stress.*',
      source: 'grafana',
      grafanaInstance: 'Default',
      dashboardLabel: 'JVM Memory Usage',
      dashboardUid: 'dashboard-uid-123',
      panelId: 2,
      panelTitle: 'CPU Usage',
      panelType: 'gauge',
      panelDescription: 'CPU usage percentage',
      evaluateType: 'max',
      metricUnit: '%',
      requirementOperator: 'lt',
      requirementValue: 80,
      excludeRampUpTime: true,
      averageAll: false,
      matchPattern: '.*cpu.*',
      validateWithDefaultIfNoData: false,
      tags: ['cpu', 'performance'],
      metadata: { priority: 'high' },
      readOnly: false,
    };

    it('should create a new benchmark for a profile', async () => {
      // Arrange
      const newBenchmark = {
        ...mockProfileBenchmark,
        panel_title: 'CPU Usage',
        evaluate_type: 'max',
        workload_pattern: '.*stress.*',
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(mockProfileDashboard);
      profileBenchmarkRepo.create.mockReturnValue(newBenchmark as any);
      profileBenchmarkRepo.save.mockResolvedValue(newBenchmark as any);

      // Act
      const result = await service.createBenchmark('profile-uuid-1', createDto, mockUserId, mockIsAdmin);

      // Assert
      expect(result.profileId).toBe('profile-uuid-1');
      expect(result.panelTitle).toBe('CPU Usage');
      expect(result.evaluateType).toBe('max');
      expect(profileBenchmarkRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          profile_id: 'profile-uuid-1',
          profile_dashboard_id: 'profile-dashboard-uuid-1',
          workload_pattern: '.*stress.*',
          panel_title: 'CPU Usage',
        })
      );
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createBenchmark('non-existent-id', createDto, mockUserId, mockIsAdmin)).rejects.toThrow(
        new NotFoundException('Profile non-existent-id not found')
      );
    });

    it('should throw BadRequestException when profile dashboard does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createBenchmark('profile-uuid-1', createDto, mockUserId, mockIsAdmin)).rejects.toThrow(
        new BadRequestException("Profile dashboard with ID 'profile-dashboard-uuid-1' not found")
      );
    });

    it('should throw BadRequestException when profile dashboard belongs to different profile', async () => {
      // Arrange
      const otherProfileDashboard = { ...mockProfileDashboard, profile: 'Different Profile' };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(otherProfileDashboard);

      // Act & Assert
      await expect(service.createBenchmark('profile-uuid-1', createDto, mockUserId, mockIsAdmin)).rejects.toThrow(
        new BadRequestException(
          "Profile dashboard 'profile-dashboard-uuid-1' does not belong to profile 'Test Profile'"
        )
      );
    });

    it('should use default values when optional fields are not provided', async () => {
      // Arrange
      const minimalDto: CreateProfileBenchmarkDto = {
        profileDashboardId: 'profile-dashboard-uuid-1',
      };
      const newBenchmark = {
        ...mockProfileBenchmark,
        workload_pattern: '.*',
        source: 'grafana',
        exclude_ramp_up_time: true,
        average_all: false,
        validate_with_default_if_no_data: false,
        tags: [],
        metadata: {},
        read_only: false,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(mockProfileDashboard);
      profileBenchmarkRepo.create.mockReturnValue(newBenchmark as any);
      profileBenchmarkRepo.save.mockResolvedValue(newBenchmark as any);

      // Act
      await service.createBenchmark('profile-uuid-1', minimalDto, mockUserId, mockIsAdmin);

      // Assert
      expect(profileBenchmarkRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workload_pattern: '.*',
          source: 'grafana',
          exclude_ramp_up_time: true,
          average_all: false,
          validate_with_default_if_no_data: false,
          tags: [],
          metadata: {},
          read_only: false,
        })
      );
    });
  });

  describe('updateBenchmark', () => {
    const updateDto: UpdateProfileBenchmarkDto = {
      workloadPattern: '.*updated.*',
      panelTitle: 'Updated Panel Title',
      requirementValue: 90,
      tags: ['updated', 'tag'],
    };

    it('should update an existing benchmark', async () => {
      // Arrange
      const updatedBenchmark = {
        ...mockProfileBenchmark,
        workload_pattern: '.*updated.*',
        panel_title: 'Updated Panel Title',
        requirement_value: 90,
        tags: ['updated', 'tag'],
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(mockProfileBenchmark);
      profileBenchmarkRepo.save.mockResolvedValue(updatedBenchmark as any);

      // Act
      const result = await service.updateBenchmark('profile-uuid-1', 'benchmark-uuid-1', updateDto, mockUserId, mockIsAdmin);

      // Assert
      expect(result.workloadPattern).toBe('.*updated.*');
      expect(result.panelTitle).toBe('Updated Panel Title');
      expect(result.requirementValue).toBe(90);
      expect(result.tags).toEqual(['updated', 'tag']);
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateBenchmark('non-existent-id', 'benchmark-id', updateDto, mockUserId, mockIsAdmin)
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should throw NotFoundException when benchmark does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateBenchmark('profile-uuid-1', 'non-existent-benchmark-id', updateDto, mockUserId, mockIsAdmin)
      ).rejects.toThrow(
        new NotFoundException('Benchmark non-existent-benchmark-id not found for profile Test Profile')
      );
    });

    it('should validate profile dashboard when profileDashboardId is updated', async () => {
      // Arrange
      const dtoWithNewDashboard = { profileDashboardId: 'new-dashboard-id' };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(mockProfileBenchmark);
      profileDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateBenchmark('profile-uuid-1', 'benchmark-uuid-1', dtoWithNewDashboard, mockUserId, mockIsAdmin)
      ).rejects.toThrow(new BadRequestException("Profile dashboard with ID 'new-dashboard-id' not found"));
    });

    it('should throw BadRequestException when new profile dashboard belongs to different profile', async () => {
      // Arrange
      const dtoWithNewDashboard = { profileDashboardId: 'other-dashboard-id' };
      const otherProfileDashboard = { ...mockProfileDashboard, profile: 'Different Profile' };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(mockProfileBenchmark);
      profileDashboardRepo.findOne.mockResolvedValue(otherProfileDashboard);

      // Act & Assert
      await expect(
        service.updateBenchmark('profile-uuid-1', 'benchmark-uuid-1', dtoWithNewDashboard, mockUserId, mockIsAdmin)
      ).rejects.toThrow(
        new BadRequestException(
          "Profile dashboard 'other-dashboard-id' does not belong to profile 'Test Profile'"
        )
      );
    });

    it('should update all benchmark properties when provided', async () => {
      // Arrange
      const completeUpdateDto: UpdateProfileBenchmarkDto = {
        profileDashboardId: 'profile-dashboard-uuid-1',
        workloadPattern: '.*complete.*',
        source: 'dynatrace',
        grafanaInstance: 'NewGrafana',
        dashboardLabel: 'New Label',
        dashboardUid: 'new-uid',
        panelId: 99,
        panelTitle: 'New Panel',
        panelType: 'timeseries',
        panelDescription: 'New description',
        evaluateType: 'min',
        metricUnit: 's',
        requirementOperator: 'gt',
        requirementValue: 100,
        excludeRampUpTime: false,
        averageAll: true,
        matchPattern: '.*new.*',
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: 50,
        tags: ['new', 'tags'],
        metadata: { updated: true },
        readOnly: true,
      };
      const updatedBenchmark = {
        ...mockProfileBenchmark,
        source: 'dynatrace',
        evaluate_type: 'min',
        average_all: true,
        validate_with_default_if_no_data: true,
        read_only: true,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(mockProfileBenchmark);
      profileDashboardRepo.findOne.mockResolvedValue(mockProfileDashboard);
      profileBenchmarkRepo.save.mockResolvedValue(updatedBenchmark as any);

      // Act
      const result = await service.updateBenchmark('profile-uuid-1', 'benchmark-uuid-1', completeUpdateDto, mockUserId, mockIsAdmin);

      // Assert
      expect(result.source).toBe('dynatrace');
      expect(result.evaluateType).toBe('min');
      expect(result.averageAll).toBe(true);
      expect(result.validateWithDefaultIfNoData).toBe(true);
      expect(result.readOnly).toBe(true);
    });
  });

  describe('deleteBenchmark', () => {
    it('should delete a benchmark from a profile', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(mockProfileBenchmark);
      profileBenchmarkRepo.remove.mockResolvedValue(mockProfileBenchmark);

      // Act
      await service.deleteBenchmark('profile-uuid-1', 'benchmark-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(profileBenchmarkRepo.remove).toHaveBeenCalledWith(mockProfileBenchmark);
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteBenchmark('non-existent-id', 'benchmark-id', mockUserId, mockIsAdmin)
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should throw NotFoundException when benchmark does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteBenchmark('profile-uuid-1', 'non-existent-benchmark-id', mockUserId, mockIsAdmin)
      ).rejects.toThrow(
        new NotFoundException('Benchmark non-existent-benchmark-id not found for profile Test Profile')
      );
    });

    it('should throw error when delete operation fails', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(mockProfileBenchmark);
      profileBenchmarkRepo.remove.mockRejectedValue(new Error('Foreign key constraint violation'));

      // Act & Assert
      await expect(
        service.deleteBenchmark('profile-uuid-1', 'benchmark-uuid-1', mockUserId, mockIsAdmin)
      ).rejects.toThrow('Foreign key constraint violation');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle profiles with null descriptions and tags', async () => {
      // Arrange
      const profileWithNulls = { ...mockProfile, description: null, tags: null };
      profileRepo.findOne.mockResolvedValue(profileWithNulls as any);
      profileDashboardRepo.count.mockResolvedValue(0);
      profileBenchmarkRepo.count.mockResolvedValue(0);

      // Act
      const result = await service.findOne('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result).toBeTruthy();
      expect(result!.description).toBeNull();
      expect(result!.tags).toBeNull();
    });

    it('should handle dashboards with null JSONB fields', async () => {
      // Arrange
      const dashboardWithNulls = {
        ...mockProfileDashboard,
        setHardcodedValueForVariables: null,
        matchRegexForVariables: null,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.find.mockResolvedValue([dashboardWithNulls]);
      grafanaInstanceRepo.find.mockResolvedValue([mockGrafanaInstance]);

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockGrafanaDashboard]),
      };
      grafanaDashboardRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

      // Act
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result[0]!.setHardcodedValueForVariables).toBeUndefined();
      expect(result[0]!.matchRegexForVariables).toBeUndefined();
    });

    it('should handle numeric conversion for benchmark requirement values', async () => {
      // Arrange
      const benchmarkWithStringNumbers = {
        ...mockProfileBenchmark,
        requirement_value: '123.45' as any,
        validate_with_default_if_no_data_value: '67.89' as any,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockResolvedValue([benchmarkWithStringNumbers]);

      // Act
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result[0]!.requirementValue).toBe(123.45);
      expect(result[0]!.validateWithDefaultIfNoDataValue).toBe(67.89);
    });

    it('should handle zero and undefined numeric values correctly', async () => {
      // Arrange
      const benchmarkWithZeros = {
        ...mockProfileBenchmark,
        requirement_value: 0,
        validate_with_default_if_no_data_value: 0,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockResolvedValue([benchmarkWithZeros]);

      // Act
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockIsAdmin);

      // Assert
      expect(result[0]!.requirementValue).toBe(0);
      expect(result[0]!.validateWithDefaultIfNoDataValue).toBe(0);
    });
  });
});
