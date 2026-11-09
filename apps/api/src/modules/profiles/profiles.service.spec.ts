import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import {
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  GrafanaInstance,
  GrafanaDashboard,
  GenericDeepLink,
  ProvisionedTemplateDsCompareConfig,
} from '../../entities';
import { CreateProfileDashboardDto, UpdateProfileDashboardDto } from './dto/profile-dashboard.dto';
import { CreateProfileBenchmarkDto, UpdateProfileBenchmarkDto } from './dto/profile-benchmark.dto';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

describe('ProfilesService', () => {
  let service: ProfilesService;
  let profileRepo: jest.Mocked<Repository<Profile>>;
  let profileDashboardRepo: jest.Mocked<Repository<ProfileGrafanaDashboard>>;
  let profileBenchmarkRepo: jest.Mocked<Repository<ProfileBenchmark>>;
  let grafanaInstanceRepo: jest.Mocked<Repository<GrafanaInstance>>;
  let grafanaDashboardRepo: jest.Mocked<Repository<GrafanaDashboard>>;
  let authzService: ReturnType<typeof createAuthorizationServiceMock>;
  let auditService: jest.Mocked<AuditService>;
  let mockCompareTemplateRepo: { count: jest.Mock; createQueryBuilder: jest.Mock };

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
  // Tests run as global admin unless they say otherwise: `null` is what the
  // controller's withOrgFilter resolves for one (no organization filter).
  const mockOrgScope: string[] | null = null;

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

    mockCompareTemplateRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
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
          provide: getRepositoryToken(ProvisionedTemplateDsCompareConfig),
          useValue: mockCompareTemplateRepo,
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProfilesService>(ProfilesService);
    profileRepo = module.get(getRepositoryToken(Profile));
    profileDashboardRepo = module.get(getRepositoryToken(ProfileGrafanaDashboard));
    profileBenchmarkRepo = module.get(getRepositoryToken(ProfileBenchmark));
    grafanaInstanceRepo = module.get(getRepositoryToken(GrafanaInstance));
    grafanaDashboardRepo = module.get(getRepositoryToken(GrafanaDashboard));
    authzService = module.get(AuthorizationService);
    auditService = module.get(AuditService);
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
      const result = await service.findAll(null);

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
        adaptTemplateCount: expect.any(Number),
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
      const result = await service.findAll(null);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]!.dashboardCount).toBe(0);
    });

    /**
     * Generated by the ship-workflow test coverage audit (PR #716).
     * Value: protects=GET /profiles reports each profile's own ADAPT template count (what deleting it cascades to);
     *   fails_when=the grouped counts are keyed by profile name (as dashboards and deep links are) or left as strings;
     *   why_new=the findAll fixtures return no template rows and assert expect.any(Number), so any mapping passes;
     *   seam=none; no_claim=the GROUP BY SQL itself, or that the web list page reads this field.
     */
    it('reports each profile its own ADAPT template count, keyed by profile id', async () => {
      profileRepo.createQueryBuilder.mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockProfile, mockProfile2]),
      } as any);
      profileDashboardRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      } as any);
      mockCompareTemplateRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        // Postgres answers COUNT(*) as a string; only the first profile has templates.
        getRawMany: jest.fn().mockResolvedValue([{ profile_id: 'profile-uuid-1', count: '4' }]),
      });

      const result = await service.findAll(null);

      expect(result.map((p) => [p.id, p.adaptTemplateCount])).toEqual([
        ['profile-uuid-1', 4],
        ['profile-uuid-2', 0],
      ]);
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
      const result = await service.findAll(null);

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
      await expect(service.findAll(null)).rejects.toThrow('Database connection failed');
    });
  });

  describe('findOne', () => {
    it('should return a single profile by id with dashboard count', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.count.mockResolvedValue(5);

      // Act
      const result = await service.findOne('profile-uuid-1', mockUserId, mockOrgScope);

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
        adaptTemplateCount: expect.any(Number),
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

    it('counts the ADAPT templates deleting the profile would cascade to (D14)', async () => {
      profileRepo.findOne.mockResolvedValue(mockProfile);
      mockCompareTemplateRepo.count.mockResolvedValue(3);

      const result = await service.findOne('profile-uuid-1', mockUserId, mockOrgScope);

      expect(result?.adaptTemplateCount).toBe(3);
      expect(mockCompareTemplateRepo.count).toHaveBeenCalledWith({
        where: { profile_id: 'profile-uuid-1', system_under_test_id: expect.anything() },
      });
    });

    it('should return null when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findOne('non-existent-id', mockUserId, mockOrgScope);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null and log error when query fails', async () => {
      // Arrange
      profileRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.findOne('profile-uuid-1', mockUserId, mockOrgScope);

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
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

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

    // A missing profile answers 404 like an out-of-scope one (it was a 200 with []), so the two
    // cannot be told apart — see 'tenant scoping' below.
    it('should throw NotFoundException when profile does not exist', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findDashboardsByProfileId('non-existent-id', mockUserId, mockOrgScope),
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should return empty array when profile has no dashboards', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.find.mockResolvedValue([]);
      grafanaInstanceRepo.find.mockResolvedValue([]);

      // Act
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

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
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

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
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

      // Assert
      expect(result).toEqual([]);
      expect(grafanaDashboardRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.find.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockOrgScope)).rejects.toThrow('Database error');
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
      const result = await service.createDashboard('profile-uuid-1', createDto, mockUserId, mockOrgScope);

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
      await expect(service.createDashboard('non-existent-id', createDto, mockUserId, mockOrgScope)).rejects.toThrow(
        new NotFoundException('Profile non-existent-id not found')
      );
    });

    it('should throw BadRequestException when Grafana instance does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      grafanaInstanceRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createDashboard('profile-uuid-1', createDto, mockUserId, mockOrgScope)).rejects.toThrow(
        new BadRequestException("Grafana instance with label 'Default' not found")
      );
    });

    it('should throw BadRequestException when Grafana dashboard does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
      grafanaDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createDashboard('profile-uuid-1', createDto, mockUserId, mockOrgScope)).rejects.toThrow(
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
      await service.createDashboard('profile-uuid-1', dtoWithoutReadOnly, mockUserId, mockOrgScope);

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
      const result = await service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', updateDto, mockUserId, mockOrgScope);

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
        service.updateDashboard('non-existent-id', 'dashboard-id', updateDto, mockUserId, mockOrgScope)
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should throw NotFoundException when dashboard does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateDashboard('profile-uuid-1', 'non-existent-dashboard-id', updateDto, mockUserId, mockOrgScope)
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
        service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithGrafanaLabel, mockUserId, mockOrgScope)
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
        service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithDashboardUid, mockUserId, mockOrgScope)
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
      await service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithEmptyArray, mockUserId, mockOrgScope);

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
      await service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithEmptyObject, mockUserId, mockOrgScope);

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
      await service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', dtoWithNewUid, mockUserId, mockOrgScope);

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
        service.updateDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', updateDto, mockUserId, mockOrgScope)
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
      await service.deleteDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', mockUserId, mockOrgScope);

      // Assert
      expect(profileDashboardRepo.remove).toHaveBeenCalledWith(mockProfileDashboard);
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteDashboard('non-existent-id', 'dashboard-id', mockUserId, mockOrgScope)
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should throw NotFoundException when dashboard does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteDashboard('profile-uuid-1', 'non-existent-dashboard-id', mockUserId, mockOrgScope)
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
        service.deleteDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', mockUserId, mockOrgScope)
      ).rejects.toThrow('Database constraint violation');
    });
  });

  describe('findBenchmarksByProfileId', () => {
    it('should return all benchmarks for a profile', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockResolvedValue([mockProfileBenchmark]);

      // Act
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

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

    // A missing profile answers 404 like an out-of-scope one (it was a 200 with []), so the two
    // cannot be told apart — see 'tenant scoping' below.
    it('should throw NotFoundException when profile does not exist', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findBenchmarksByProfileId('non-existent-id', mockUserId, mockOrgScope),
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should return empty array when profile has no benchmarks', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockResolvedValue([]);

      // Act
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

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
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

      // Assert
      expect(result[0]!.requirementValue).toBeUndefined();
      expect(result[0]!.validateWithDefaultIfNoDataValue).toBeUndefined();
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.find.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockOrgScope)).rejects.toThrow('Database error');
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
      const result = await service.createBenchmark('profile-uuid-1', createDto, mockUserId, mockOrgScope);

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
      await expect(service.createBenchmark('non-existent-id', createDto, mockUserId, mockOrgScope)).rejects.toThrow(
        new NotFoundException('Profile non-existent-id not found')
      );
    });

    it('should throw BadRequestException when profile dashboard does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createBenchmark('profile-uuid-1', createDto, mockUserId, mockOrgScope)).rejects.toThrow(
        new BadRequestException("Profile dashboard with ID 'profile-dashboard-uuid-1' not found")
      );
    });

    it('should throw BadRequestException when profile dashboard belongs to different profile', async () => {
      // Arrange
      const otherProfileDashboard = { ...mockProfileDashboard, profile: 'Different Profile' };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileDashboardRepo.findOne.mockResolvedValue(otherProfileDashboard);

      // Act & Assert
      await expect(service.createBenchmark('profile-uuid-1', createDto, mockUserId, mockOrgScope)).rejects.toThrow(
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
      await service.createBenchmark('profile-uuid-1', minimalDto, mockUserId, mockOrgScope);

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

    it('should throw BadRequestException when a grafana benchmark omits profileDashboardId', async () => {
      // Arrange — the DTO field is optional now (perf-test needs it absent), so the
      // service has to refuse it for a Grafana source itself.
      const { profileDashboardId: _omitted, ...dtoWithoutDashboard } = createDto;
      profileRepo.findOne.mockResolvedValue(mockProfile);

      // Act & Assert
      await expect(
        service.createBenchmark('profile-uuid-1', dtoWithoutDashboard, mockUserId, mockOrgScope)
      ).rejects.toThrow(new BadRequestException('profileDashboardId is required'));
      expect(profileDashboardRepo.findOne).not.toHaveBeenCalled();
      expect(profileBenchmarkRepo.create).not.toHaveBeenCalled();
    });

    it('should default source to grafana and still require profileDashboardId when source is omitted', async () => {
      // Arrange
      const { profileDashboardId: _omitted, source: _source, ...dtoWithoutBoth } = createDto;
      profileRepo.findOne.mockResolvedValue(mockProfile);

      // Act & Assert
      await expect(
        service.createBenchmark('profile-uuid-1', dtoWithoutBoth, mockUserId, mockOrgScope)
      ).rejects.toThrow(new BadRequestException('profileDashboardId is required'));
    });

    it('should create a performance-metrics benchmark with no profile dashboard and the default uid regex', async () => {
      // Arrange
      const perfTestDto: CreateProfileBenchmarkDto = {
        source: 'performance-metrics',
        panelId: 105,
        panelTitle: 'Transaction Error Rate',
        panelType: 'performance-metrics',
        evaluateType: 'avg',
        requirementOperator: 'lt',
        requirementValue: 2,
      };
      const newBenchmark = {
        ...mockProfileBenchmark,
        profile_dashboard_id: null,
        source: 'performance-metrics',
        dashboard_uid: '^performance-test-metrics-(?!all-aggregated$|default$)',
        panel_id: 105,
        panel_title: 'Transaction Error Rate',
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.create.mockReturnValue(newBenchmark as any);
      profileBenchmarkRepo.save.mockResolvedValue(newBenchmark as any);

      // Act
      const result = await service.createBenchmark('profile-uuid-1', perfTestDto, mockUserId, mockOrgScope);

      // Assert — no Grafana template to validate against
      expect(profileDashboardRepo.findOne).not.toHaveBeenCalled();
      expect(profileBenchmarkRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          profile_id: 'profile-uuid-1',
          profile_dashboard_id: null,
          source: 'performance-metrics',
          grafana_instance: undefined,
          dashboard_uid: '^performance-test-metrics-(?!all-aggregated$|default$)',
          panel_id: 105,
        })
      );
      expect(result.profileDashboardId).toBeNull();
      expect(result.source).toBe('performance-metrics');
    });

    it('should keep a caller-supplied uid regex on a performance-metrics benchmark', async () => {
      // Arrange
      const perfTestDto: CreateProfileBenchmarkDto = {
        source: 'performance-metrics',
        dashboardUid: '^performance-test-metrics-t-wm-',
        panelId: 101,
        requirementOperator: 'lt',
        requirementValue: 500,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.create.mockReturnValue(mockProfileBenchmark as any);
      profileBenchmarkRepo.save.mockResolvedValue(mockProfileBenchmark as any);

      // Act
      await service.createBenchmark('profile-uuid-1', perfTestDto, mockUserId, mockOrgScope);

      // Assert
      expect(profileBenchmarkRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dashboard_uid: '^performance-test-metrics-t-wm-',
          profile_dashboard_id: null,
        })
      );
    });

    it('should reject a performance-metrics benchmark whose dashboardUid is not a valid regex', async () => {
      // Arrange — grafana-sync hands the pattern straight to Postgres `~`, so it is validated on write.
      const perfTestDto: CreateProfileBenchmarkDto = {
        source: 'performance-metrics',
        dashboardUid: '^performance-test-metrics-(',
        panelId: 101,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);

      // Act & Assert
      await expect(
        service.createBenchmark('profile-uuid-1', perfTestDto, mockUserId, mockOrgScope)
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createBenchmark('profile-uuid-1', perfTestDto, mockUserId, mockOrgScope)
      ).rejects.toThrow(/dashboardUid must be a valid regex/);
      expect(profileBenchmarkRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a performance-metrics benchmark whose dashboardUid is ReDoS-prone', async () => {
      // Arrange
      const perfTestDto: CreateProfileBenchmarkDto = {
        source: 'performance-metrics',
        dashboardUid: '^(a+)+$',
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);

      // Act & Assert
      await expect(
        service.createBenchmark('profile-uuid-1', perfTestDto, mockUserId, mockOrgScope)
      ).rejects.toThrow(/dashboardUid must be a valid regex/);
      expect(profileBenchmarkRepo.create).not.toHaveBeenCalled();
    });

    it('should ignore a profileDashboardId sent alongside source performance-metrics', async () => {
      // Arrange — a perf-test benchmark never references a profile dashboard, even if the
      // client sends one; the stored column must be NULL and no lookup must be made.
      const perfTestDto: CreateProfileBenchmarkDto = {
        source: 'performance-metrics',
        profileDashboardId: 'profile-dashboard-uuid-1',
        panelId: 101,
        requirementOperator: 'lt',
        requirementValue: 500,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.create.mockReturnValue(mockProfileBenchmark as any);
      profileBenchmarkRepo.save.mockResolvedValue(mockProfileBenchmark as any);

      // Act
      await service.createBenchmark('profile-uuid-1', perfTestDto, mockUserId, mockOrgScope);

      // Assert
      expect(profileDashboardRepo.findOne).not.toHaveBeenCalled();
      expect(profileBenchmarkRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ profile_dashboard_id: null })
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
      const result = await service.updateBenchmark('profile-uuid-1', 'benchmark-uuid-1', updateDto, mockUserId, mockOrgScope);

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
        service.updateBenchmark('non-existent-id', 'benchmark-id', updateDto, mockUserId, mockOrgScope)
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should throw NotFoundException when benchmark does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateBenchmark('profile-uuid-1', 'non-existent-benchmark-id', updateDto, mockUserId, mockOrgScope)
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
        service.updateBenchmark('profile-uuid-1', 'benchmark-uuid-1', dtoWithNewDashboard, mockUserId, mockOrgScope)
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
        service.updateBenchmark('profile-uuid-1', 'benchmark-uuid-1', dtoWithNewDashboard, mockUserId, mockOrgScope)
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
      const result = await service.updateBenchmark('profile-uuid-1', 'benchmark-uuid-1', completeUpdateDto, mockUserId, mockOrgScope);

      // Assert
      expect(result.source).toBe('dynatrace');
      expect(result.evaluateType).toBe('min');
      expect(result.averageAll).toBe(true);
      expect(result.validateWithDefaultIfNoData).toBe(true);
      expect(result.readOnly).toBe(true);
    });

    it('should null the Grafana template columns when a benchmark is switched to performance-metrics', async () => {
      // Arrange — the stored template uid is not a uid regex; a switch must not carry it over.
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue({
        ...mockProfileBenchmark,
        source: 'grafana',
        profile_dashboard_id: 'profile-dashboard-uuid-1',
        grafana_instance: 'Default',
        dashboard_uid: 'dashboard-uid-123',
      } as any);
      profileBenchmarkRepo.save.mockImplementation(async (b: any) => b);

      // Act
      // A Grafana panel id is not a perf-test panel; the switch has to pick one.
      const result = await service.updateBenchmark(
        'profile-uuid-1', 'benchmark-uuid-1', { source: 'performance-metrics', panelId: 105 }, mockUserId, mockOrgScope
      );

      // Assert
      expect(profileDashboardRepo.findOne).not.toHaveBeenCalled();
      expect(profileBenchmarkRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'performance-metrics',
          profile_dashboard_id: null,
          grafana_instance: null, // null, not undefined: save() skips undefined
          dashboard_uid: '^performance-test-metrics-(?!all-aggregated$|default$)',
        })
      );
      expect(result.profileDashboardId).toBeNull();
      expect(result.source).toBe('performance-metrics');
    });

    it('should require a profileDashboardId when a benchmark is switched from performance-metrics to grafana', async () => {
      // Arrange
      const perfTestBenchmark = {
        ...mockProfileBenchmark,
        profile_dashboard_id: null,
        grafana_instance: undefined,
        source: 'performance-metrics',
        dashboard_uid: '^performance-test-metrics-(?!all-aggregated$|default$)',
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(perfTestBenchmark as any);

      // Act & Assert
      await expect(
        service.updateBenchmark(
          'profile-uuid-1', 'benchmark-uuid-1', { source: 'grafana', dashboardUid: 'dashboard-uid-123' }, mockUserId, mockOrgScope
        )
      ).rejects.toThrow(new BadRequestException('profileDashboardId is required'));
      expect(profileBenchmarkRepo.save).not.toHaveBeenCalled();
    });

    it('should switch from performance-metrics to grafana when a valid profileDashboardId is sent', async () => {
      // Arrange
      const perfTestBenchmark = {
        ...mockProfileBenchmark,
        profile_dashboard_id: null,
        grafana_instance: undefined,
        source: 'performance-metrics',
        dashboard_uid: '^performance-test-metrics-(?!all-aggregated$|default$)',
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(perfTestBenchmark as any);
      profileDashboardRepo.findOne.mockResolvedValue(mockProfileDashboard);
      profileBenchmarkRepo.save.mockImplementation(async (b: any) => b);

      // Act
      await service.updateBenchmark(
        'profile-uuid-1',
        'benchmark-uuid-1',
        {
          source: 'grafana',
          profileDashboardId: 'profile-dashboard-uuid-1',
          grafanaInstance: 'Default',
          dashboardUid: 'dashboard-uid-123',
        },
        mockUserId,
        mockOrgScope
      );

      // Assert — the stored uid regex is dropped in favour of the template uid.
      expect(profileDashboardRepo.findOne).toHaveBeenCalledWith({ where: { id: 'profile-dashboard-uuid-1' } });
      expect(profileBenchmarkRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'grafana',
          profile_dashboard_id: 'profile-dashboard-uuid-1',
          grafana_instance: 'Default',
          dashboard_uid: 'dashboard-uid-123',
        })
      );
    });

    it('should reject an invalid uid regex on a performance-metrics update', async () => {
      // Arrange
      const perfTestBenchmark = {
        ...mockProfileBenchmark,
        profile_dashboard_id: null,
        source: 'performance-metrics',
        dashboard_uid: '^performance-test-metrics-(?!all-aggregated$|default$)',
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(perfTestBenchmark as any);

      // Act & Assert
      await expect(
        service.updateBenchmark(
          'profile-uuid-1', 'benchmark-uuid-1', { dashboardUid: '^performance-test-metrics-(' }, mockUserId, mockOrgScope
        )
      ).rejects.toThrow(/dashboardUid must be a valid regex/);
      expect(profileBenchmarkRepo.save).not.toHaveBeenCalled();
    });

    it('should leave the dashboard columns alone when the update touches none of them', async () => {
      // Arrange — no source/profileDashboardId/grafanaInstance/dashboardUid in the body:
      // a Grafana row keeps its template without a profile-dashboard lookup.
      // (Pinned explicitly: the shared fixture is mutated in place by an earlier update test.)
      const grafanaBenchmark = {
        ...mockProfileBenchmark,
        source: 'grafana',
        profile_dashboard_id: 'profile-dashboard-uuid-1',
        grafana_instance: 'Default',
        dashboard_uid: 'dashboard-uid-123',
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(grafanaBenchmark as any);
      profileBenchmarkRepo.save.mockImplementation(async (b: any) => b);

      // Act
      await service.updateBenchmark(
        'profile-uuid-1', 'benchmark-uuid-1', { requirementValue: 42 }, mockUserId, mockOrgScope
      );

      // Assert
      expect(profileDashboardRepo.findOne).not.toHaveBeenCalled();
      expect(profileBenchmarkRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'grafana',
          profile_dashboard_id: 'profile-dashboard-uuid-1',
          grafana_instance: 'Default',
          dashboard_uid: 'dashboard-uid-123',
          requirement_value: 42,
        })
      );
    });

    it('should update a performance-metrics benchmark without touching the profile dashboard', async () => {
      // Arrange — the web edit dialog posts profileDashboardId: undefined for a perf-test
      // benchmark; the NULL reference must survive and no dashboard lookup must be made.
      const perfTestBenchmark = {
        ...mockProfileBenchmark,
        profile_dashboard_id: null,
        source: 'performance-metrics',
        panel_id: 105,
        dashboard_uid: '^performance-test-metrics-(?!all-aggregated$|default$)',
      };
      const perfTestUpdate: UpdateProfileBenchmarkDto = {
        profileDashboardId: undefined,
        source: 'performance-metrics',
        dashboardUid: '^performance-test-metrics-t-wm-',
        requirementValue: 3,
      };
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(perfTestBenchmark as any);
      profileBenchmarkRepo.save.mockImplementation(async (b: any) => b);

      // Act
      const result = await service.updateBenchmark(
        'profile-uuid-1', 'benchmark-uuid-1', perfTestUpdate, mockUserId, mockOrgScope
      );

      // Assert
      expect(profileDashboardRepo.findOne).not.toHaveBeenCalled();
      expect(profileBenchmarkRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          profile_dashboard_id: null,
          source: 'performance-metrics',
          dashboard_uid: '^performance-test-metrics-t-wm-',
          requirement_value: 3,
        })
      );
      expect(result.profileDashboardId).toBeNull();
      expect(result.dashboardUid).toBe('^performance-test-metrics-t-wm-');
    });
  });

  describe('deleteBenchmark', () => {
    it('should delete a benchmark from a profile', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(mockProfileBenchmark);
      profileBenchmarkRepo.remove.mockResolvedValue(mockProfileBenchmark);

      // Act
      await service.deleteBenchmark('profile-uuid-1', 'benchmark-uuid-1', mockUserId, mockOrgScope);

      // Assert
      expect(profileBenchmarkRepo.remove).toHaveBeenCalledWith(mockProfileBenchmark);
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteBenchmark('non-existent-id', 'benchmark-id', mockUserId, mockOrgScope)
      ).rejects.toThrow(new NotFoundException('Profile non-existent-id not found'));
    });

    it('should throw NotFoundException when benchmark does not exist', async () => {
      // Arrange
      profileRepo.findOne.mockResolvedValue(mockProfile);
      profileBenchmarkRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteBenchmark('profile-uuid-1', 'non-existent-benchmark-id', mockUserId, mockOrgScope)
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
        service.deleteBenchmark('profile-uuid-1', 'benchmark-uuid-1', mockUserId, mockOrgScope)
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
      const result = await service.findOne('profile-uuid-1', mockUserId, mockOrgScope);

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
      const result = await service.findDashboardsByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

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
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

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
      const result = await service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, mockOrgScope);

      // Assert
      expect(result[0]!.requirementValue).toBe(0);
      expect(result[0]!.validateWithDefaultIfNoDataValue).toBe(0);
    });
  });

  // Phase 5a — audit logging assertions across the 9 mutation methods.
  describe('audit logging', () => {
    const ownedProfile = {
      ...mockProfile,
      organizationId: 'org-1',
    } as unknown as Profile;
    const ownedDashboard = {
      ...mockProfileDashboard,
      organizationId: 'org-1',
    } as unknown as ProfileGrafanaDashboard;
    const ownedBenchmark = {
      ...mockProfileBenchmark,
      organizationId: 'org-1',
    } as unknown as ProfileBenchmark;

    describe('Profile', () => {
      it('logs CREATE on createProfile()', async () => {
        profileRepo.findOne.mockResolvedValue(null); // uniqueness check
        authzService.getAccessibleOrganizations.mockResolvedValue(['org-1']);
        profileRepo.create.mockReturnValue(ownedProfile);
        profileRepo.save.mockResolvedValue(ownedProfile);

        await service.createProfile(
          { name: 'New Profile', description: 'desc' },
          mockUserId,
          mockOrgScope,
        );

        expect(auditService.logCreate).toHaveBeenCalledTimes(1);
        expect(auditService.logCreate).toHaveBeenCalledWith(
          expect.objectContaining({ id: ownedProfile.id }),
          expect.objectContaining({ organizationIdOverride: 'org-1' }),
        );
      });

      it('logs UPDATE on updateProfile() with cloned before-snapshot', async () => {
        profileRepo.findOne
          .mockResolvedValueOnce(ownedProfile) // load + lock
          .mockResolvedValueOnce(ownedProfile); // findOne re-fetch via this.findOne
        profileDashboardRepo.count.mockResolvedValue(0);
        profileBenchmarkRepo.count.mockResolvedValue(0);
        profileRepo.save.mockImplementation(async (entity) => entity as Profile);

        await service.updateProfile(
          'profile-uuid-1',
          { description: 'updated' },
          mockUserId,
          mockOrgScope,
        );

        expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
        const [before, after, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
        expect(before).toEqual(expect.objectContaining({ id: ownedProfile.id, description: 'Test profile description' }));
        expect(after).toEqual(expect.objectContaining({ id: ownedProfile.id, description: 'updated' }));
        expect(opts).toEqual({ organizationIdOverride: 'org-1' });
      });

      it('logs DELETE before remove on deleteProfile()', async () => {
        profileRepo.findOne.mockResolvedValue(ownedProfile);
        profileRepo.remove.mockResolvedValue(ownedProfile);

        await service.deleteProfile('profile-uuid-1', mockUserId, mockOrgScope);

        expect(auditService.logDelete).toHaveBeenCalledTimes(1);
        expect(auditService.logDelete).toHaveBeenCalledWith(
          expect.objectContaining({ id: ownedProfile.id }),
          { organizationIdOverride: 'org-1' },
        );
        expect(
          (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
        ).toBeLessThan(profileRepo.remove.mock.invocationCallOrder[0]);
      });
    });

    describe('ProfileGrafanaDashboard', () => {
      it('logs CREATE on createDashboard()', async () => {
        profileRepo.findOne.mockResolvedValue(ownedProfile);
        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        grafanaDashboardRepo.findOne.mockResolvedValue(mockGrafanaDashboard);
        profileDashboardRepo.create.mockReturnValue(ownedDashboard);
        profileDashboardRepo.save.mockResolvedValue(ownedDashboard);

        const dto: CreateProfileDashboardDto = {
          dashboardUid: 'dashboard-uid-123',
          grafanaLabel: 'Default',
        };
        await service.createDashboard('profile-uuid-1', dto, mockUserId, mockOrgScope);

        expect(auditService.logCreate).toHaveBeenCalledTimes(1);
        expect(auditService.logCreate).toHaveBeenCalledWith(
          expect.objectContaining({ id: ownedDashboard.id }),
          { organizationIdOverride: 'org-1' },
        );
      });

      it('logs UPDATE on updateDashboard() with cloned before-snapshot', async () => {
        profileRepo.findOne.mockResolvedValue(ownedProfile);
        profileDashboardRepo.findOne
          .mockResolvedValueOnce(ownedDashboard) // initial load
          .mockResolvedValueOnce({
            ...ownedDashboard,
            createSeparateDashboardForVariable: 'env',
          } as ProfileGrafanaDashboard); // re-fetch after update()
        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        grafanaDashboardRepo.findOne.mockResolvedValue(mockGrafanaDashboard);

        const dto: UpdateProfileDashboardDto = {
          createSeparateDashboardForVariable: 'env',
        };
        await service.updateDashboard(
          'profile-uuid-1',
          'profile-dashboard-uuid-1',
          dto,
          mockUserId,
          mockOrgScope,
        );

        expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
        const [before, after, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
        expect(before).toEqual(expect.objectContaining({
          id: ownedDashboard.id,
          createSeparateDashboardForVariable: 'application',
        }));
        expect(after).toEqual(expect.objectContaining({
          id: ownedDashboard.id,
          createSeparateDashboardForVariable: 'env',
        }));
        expect(opts).toEqual({ organizationIdOverride: 'org-1' });
      });

      it('logs DELETE before remove on deleteDashboard()', async () => {
        profileRepo.findOne.mockResolvedValue(ownedProfile);
        profileDashboardRepo.findOne.mockResolvedValue(ownedDashboard);
        profileDashboardRepo.remove.mockResolvedValue(ownedDashboard);

        await service.deleteDashboard(
          'profile-uuid-1',
          'profile-dashboard-uuid-1',
          mockUserId,
          mockOrgScope,
        );

        expect(auditService.logDelete).toHaveBeenCalledTimes(1);
        expect(auditService.logDelete).toHaveBeenCalledWith(
          expect.objectContaining({ id: ownedDashboard.id }),
          { organizationIdOverride: 'org-1' },
        );
        expect(
          (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
        ).toBeLessThan(profileDashboardRepo.remove.mock.invocationCallOrder[0]);
      });
    });

    describe('ProfileBenchmark', () => {
      it('logs CREATE on createBenchmark()', async () => {
        profileRepo.findOne.mockResolvedValue(ownedProfile);
        profileDashboardRepo.findOne.mockResolvedValue(ownedDashboard);
        profileBenchmarkRepo.create.mockReturnValue(ownedBenchmark);
        profileBenchmarkRepo.save.mockResolvedValue(ownedBenchmark);

        const dto: CreateProfileBenchmarkDto = {
          profileDashboardId: 'profile-dashboard-uuid-1',
        };
        await service.createBenchmark('profile-uuid-1', dto, mockUserId, mockOrgScope);

        expect(auditService.logCreate).toHaveBeenCalledTimes(1);
        expect(auditService.logCreate).toHaveBeenCalledWith(
          expect.objectContaining({ id: ownedBenchmark.id }),
          { organizationIdOverride: 'org-1' },
        );
      });

      it('logs UPDATE on updateBenchmark() with cloned before-snapshot', async () => {
        profileRepo.findOne.mockResolvedValue(ownedProfile);
        profileBenchmarkRepo.findOne.mockResolvedValue(ownedBenchmark);
        profileBenchmarkRepo.save.mockImplementation(async (entity) => entity as ProfileBenchmark);

        const dto: UpdateProfileBenchmarkDto = {
          requirementValue: 2048,
        };
        await service.updateBenchmark(
          'profile-uuid-1',
          'benchmark-uuid-1',
          dto,
          mockUserId,
          mockOrgScope,
        );

        expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
        const [before, after, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
        expect(before).toEqual(expect.objectContaining({
          id: ownedBenchmark.id,
          requirement_value: 1024,
        }));
        expect(after).toEqual(expect.objectContaining({
          id: ownedBenchmark.id,
          requirement_value: 2048,
        }));
        expect(opts).toEqual({ organizationIdOverride: 'org-1' });
      });

      it('logs DELETE before remove on deleteBenchmark()', async () => {
        profileRepo.findOne.mockResolvedValue(ownedProfile);
        profileBenchmarkRepo.findOne.mockResolvedValue(ownedBenchmark);
        profileBenchmarkRepo.remove.mockResolvedValue(ownedBenchmark);

        await service.deleteBenchmark(
          'profile-uuid-1',
          'benchmark-uuid-1',
          mockUserId,
          mockOrgScope,
        );

        expect(auditService.logDelete).toHaveBeenCalledTimes(1);
        expect(auditService.logDelete).toHaveBeenCalledWith(
          expect.objectContaining({ id: ownedBenchmark.id }),
          { organizationIdOverride: 'org-1' },
        );
        expect(
          (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
        ).toBeLessThan(profileBenchmarkRepo.remove.mock.invocationCallOrder[0]);
      });
    });
  });

  /**
   * profiles.organization_id is NOT NULL and there is no RLS backstop on a default deploy, so the
   * service is the tenant boundary. Every case below is a caller who IS an org-admin somewhere
   * (`isOrgAdminInAnyOrganization` answers true), which is exactly what the old check asked.
   */
  describe('tenant scoping', () => {
    const ORG_A = 'org-a';
    const ORG_B = 'org-b';
    const profileInA = { ...mockProfile, organizationId: ORG_A } as unknown as Profile;
    const dashboardInA = { ...mockProfileDashboard, organizationId: ORG_A } as unknown as ProfileGrafanaDashboard;
    const benchmarkInA = { ...mockProfileBenchmark, organizationId: ORG_A } as unknown as ProfileBenchmark;

    /** Org-admin of exactly the organizations named; a member (not admin) of the rest of the scope. */
    const adminOf = (...orgs: string[]) => {
      authzService.isOrganizationAdmin.mockImplementation(async (_userId: string, orgId: string) => orgs.includes(orgId));
      authzService.isOrgAdminInAnyOrganization.mockResolvedValue(true);
    };

    /** Every by-id/child route, called as the given scope against profile-uuid-1. */
    const routes: Array<[string, (scope: string[] | null) => Promise<unknown>]> = [
      ['findDashboardsByProfileId', (scope) => service.findDashboardsByProfileId('profile-uuid-1', mockUserId, scope)],
      ['findBenchmarksByProfileId', (scope) => service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, scope)],
      ['updateProfile', (scope) => service.updateProfile('profile-uuid-1', { tags: ['steered'] }, mockUserId, scope)],
      ['deleteProfile', (scope) => service.deleteProfile('profile-uuid-1', mockUserId, scope)],
      ['createDashboard', (scope) => service.createDashboard(
        'profile-uuid-1', { dashboardUid: 'dashboard-uid-123', grafanaLabel: 'Default' } as CreateProfileDashboardDto, mockUserId, scope,
      )],
      ['updateDashboard', (scope) => service.updateDashboard(
        'profile-uuid-1', 'profile-dashboard-uuid-1', { readOnly: true } as UpdateProfileDashboardDto, mockUserId, scope,
      )],
      ['deleteDashboard', (scope) => service.deleteDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', mockUserId, scope)],
      ['createBenchmark', (scope) => service.createBenchmark(
        'profile-uuid-1', { profileDashboardId: 'profile-dashboard-uuid-1', panelId: 1 } as CreateProfileBenchmarkDto, mockUserId, scope,
      )],
      ['updateBenchmark', (scope) => service.updateBenchmark(
        'profile-uuid-1', 'benchmark-uuid-1', { requirementValue: 1 } as UpdateProfileBenchmarkDto, mockUserId, scope,
      )],
      ['deleteBenchmark', (scope) => service.deleteBenchmark('profile-uuid-1', 'benchmark-uuid-1', mockUserId, scope)],
    ];

    const expectNothingWritten = () => {
      expect(profileRepo.save).not.toHaveBeenCalled();
      expect(profileRepo.remove).not.toHaveBeenCalled();
      expect(profileDashboardRepo.save).not.toHaveBeenCalled();
      expect(profileDashboardRepo.update).not.toHaveBeenCalled();
      expect(profileDashboardRepo.remove).not.toHaveBeenCalled();
      expect(profileBenchmarkRepo.save).not.toHaveBeenCalled();
      expect(profileBenchmarkRepo.remove).not.toHaveBeenCalled();
      expect(auditService.logCreate).not.toHaveBeenCalled();
      expect(auditService.logUpdate).not.toHaveBeenCalled();
      expect(auditService.logDelete).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      profileRepo.findOne.mockResolvedValue(profileInA);
      profileDashboardRepo.findOne.mockResolvedValue(dashboardInA);
      profileBenchmarkRepo.findOne.mockResolvedValue(benchmarkInA);
      profileDashboardRepo.find.mockResolvedValue([dashboardInA]);
      profileBenchmarkRepo.find.mockResolvedValue([benchmarkInA]);
    });

    describe('an org-admin of org B, on a profile in org A', () => {
      beforeEach(() => adminOf(ORG_B));

      it('findOne answers null, exactly as for a missing profile, and reads none of its counts', async () => {
        await expect(service.findOne('profile-uuid-1', mockUserId, [ORG_B])).resolves.toBeNull();
        expect(profileDashboardRepo.count).not.toHaveBeenCalled();
        expect(mockCompareTemplateRepo.count).not.toHaveBeenCalled();
      });

      it.each(routes)('%s answers 404, with the same message as a missing profile, and writes nothing', async (_name, call) => {
        const refused = await call([ORG_B]).catch((e: unknown) => e);
        profileRepo.findOne.mockResolvedValue(null);
        const missing = await call([ORG_B]).catch((e: unknown) => e);

        expect(refused).toBeInstanceOf(NotFoundException);
        expect((refused as Error).message).toBe((missing as Error).message);
        expectNothingWritten();
        expect(profileDashboardRepo.find).not.toHaveBeenCalled();
        expect(profileBenchmarkRepo.find).not.toHaveBeenCalled();
      });

      it('is refused before the org-admin check, so a 403 never confirms the profile exists', async () => {
        await expect(service.deleteProfile('profile-uuid-1', mockUserId, [ORG_B])).rejects.toThrow(NotFoundException);
        expect(authzService.isOrganizationAdmin).not.toHaveBeenCalled();
      });

      it('logs the refusal at warn without the raw CR/LF of the path parameter', async () => {
        const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
        await service.findOne('profile-uuid-1\nforged line', mockUserId, [ORG_B]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cross-tenant access refused for profile profile-uuid-1forged line'));
        expect(warn.mock.calls.every(([m]) => !String(m).includes('\n'))).toBe(true);
      });
    });

    describe('an org-admin of org A', () => {
      beforeEach(() => adminOf(ORG_A));

      it('reads the profile', async () => {
        await expect(service.findOne('profile-uuid-1', mockUserId, [ORG_A])).resolves.toEqual(
          expect.objectContaining({ id: 'profile-uuid-1' }),
        );
      });

      it('updates it, checking admin in the profile organization', async () => {
        profileRepo.save.mockImplementation(async (entity) => entity as Profile);

        await service.updateProfile('profile-uuid-1', { tags: ['ok'] }, mockUserId, [ORG_A]);

        expect(authzService.isOrganizationAdmin).toHaveBeenCalledWith(mockUserId, ORG_A);
        expect(profileRepo.save).toHaveBeenCalledWith(expect.objectContaining({ tags: ['ok'] }));
      });

      it('deletes it', async () => {
        await service.deleteProfile('profile-uuid-1', mockUserId, [ORG_A]);
        expect(profileRepo.remove).toHaveBeenCalledWith(profileInA);
      });

      it('deletes its dashboard and its benchmark', async () => {
        await service.deleteDashboard('profile-uuid-1', 'profile-dashboard-uuid-1', mockUserId, [ORG_A]);
        await service.deleteBenchmark('profile-uuid-1', 'benchmark-uuid-1', mockUserId, [ORG_A]);
        expect(profileDashboardRepo.remove).toHaveBeenCalledWith(dashboardInA);
        expect(profileBenchmarkRepo.remove).toHaveBeenCalledWith(benchmarkInA);
      });
    });

    describe('a member (not admin) of org A who is an org-admin of org B', () => {
      beforeEach(() => adminOf(ORG_B));

      it('can still read the profile and its children', async () => {
        await expect(service.findOne('profile-uuid-1', mockUserId, [ORG_A, ORG_B])).resolves.not.toBeNull();
        await expect(service.findBenchmarksByProfileId('profile-uuid-1', mockUserId, [ORG_A, ORG_B])).resolves.toHaveLength(1);
      });

      it.each(routes.filter(([name]) => !name.startsWith('find')))('%s is forbidden and writes nothing', async (_name, call) => {
        await expect(call([ORG_A, ORG_B])).rejects.toThrow(ForbiddenException);
        expect(authzService.isOrganizationAdmin).toHaveBeenCalledWith(mockUserId, ORG_A);
        expectNothingWritten();
      });
    });

    describe('a global admin (accessibleOrgIds null)', () => {
      it('updates and deletes a profile in any organization without an org-admin lookup', async () => {
        adminOf();
        profileRepo.save.mockImplementation(async (entity) => entity as Profile);

        await service.updateProfile('profile-uuid-1', { tags: ['ok'] }, mockUserId, null);
        await service.deleteProfile('profile-uuid-1', mockUserId, null);

        expect(profileRepo.save).toHaveBeenCalled();
        expect(profileRepo.remove).toHaveBeenCalledWith(profileInA);
        expect(authzService.isOrganizationAdmin).not.toHaveBeenCalled();
      });
    });

    describe('a child id that belongs to another profile', () => {
      // The other tenant's rows, as the database would answer: a lookup matches only when
      // every column it names agrees, so dropping the parent constraint would find them.
      const foreignDashboard = { ...dashboardInA, id: 'dash-b', profile: 'Profile In B', organizationId: ORG_B };
      const foreignBenchmark = { ...benchmarkInA, id: 'bench-b', profile_id: 'profile-uuid-b', organizationId: ORG_B };
      const matches = (row: object, where: Record<string, unknown>) =>
        Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);

      beforeEach(() => {
        adminOf(ORG_A);
        profileDashboardRepo.findOne.mockImplementation((async ({ where }: { where: Record<string, unknown> }) =>
          (matches(foreignDashboard, where) ? foreignDashboard : null)) as never);
        profileBenchmarkRepo.findOne.mockImplementation((async ({ where }: { where: Record<string, unknown> }) =>
          (matches(foreignBenchmark, where) ? foreignBenchmark : null)) as never);
      });

      it('is a 404 on dashboard update and delete, under the caller\'s own profile', async () => {
        await expect(
          service.updateDashboard('profile-uuid-1', 'dash-b', { readOnly: true } as UpdateProfileDashboardDto, mockUserId, [ORG_A]),
        ).rejects.toThrow(NotFoundException);
        await expect(service.deleteDashboard('profile-uuid-1', 'dash-b', mockUserId, [ORG_A])).rejects.toThrow(NotFoundException);
        expectNothingWritten();
      });

      it('is a 404 on benchmark update and delete, under the caller\'s own profile', async () => {
        await expect(
          service.updateBenchmark('profile-uuid-1', 'bench-b', { requirementValue: 1 } as UpdateProfileBenchmarkDto, mockUserId, [ORG_A]),
        ).rejects.toThrow(NotFoundException);
        await expect(service.deleteBenchmark('profile-uuid-1', 'bench-b', mockUserId, [ORG_A])).rejects.toThrow(NotFoundException);
        expectNothingWritten();
      });
    });

    describe('createProfile', () => {
      beforeEach(() => {
        profileRepo.findOne.mockResolvedValue(null); // name is free
        profileRepo.create.mockImplementation((entity) => entity as Profile);
        profileRepo.save.mockImplementation(async (entity) => ({ ...entity, id: 'new', createdAt: mockDate, updatedAt: mockDate }) as Profile);
      });

      it('creates in the first organization the caller administers, not merely the first they belong to', async () => {
        adminOf(ORG_B);
        await service.createProfile({ name: 'New' }, mockUserId, [ORG_A, ORG_B]);
        expect(profileRepo.create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_B }));
      });

      it('is forbidden for a caller who administers none of their organizations, before the name lookup', async () => {
        adminOf();
        await expect(service.createProfile({ name: 'New' }, mockUserId, [ORG_A])).rejects.toThrow(ForbiddenException);
        expect(profileRepo.findOne).not.toHaveBeenCalled();
        expect(profileRepo.save).not.toHaveBeenCalled();
      });

      it('is forbidden for a caller with no organization', async () => {
        await expect(service.createProfile({ name: 'New' }, mockUserId, [])).rejects.toThrow(
          new ForbiddenException('No accessible organization found for user'),
        );
        expect(profileRepo.save).not.toHaveBeenCalled();
      });

      it('creates in a global admin\'s first accessible organization without an org-admin lookup', async () => {
        authzService.getAccessibleOrganizations.mockResolvedValue([ORG_B, ORG_A]);
        await service.createProfile({ name: 'New' }, mockUserId, null);
        expect(profileRepo.create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_B }));
        expect(authzService.isOrganizationAdmin).not.toHaveBeenCalled();
      });
    });
  });
});
