import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService, ProfileResponse, ProfileDashboardResponse } from './profiles.service';
import { CreateProfileDashboardDto, UpdateProfileDashboardDto } from './dto/profile-dashboard.dto';
import { CreateProfileBenchmarkDto, UpdateProfileBenchmarkDto, ProfileBenchmarkResponse } from './dto/profile-benchmark.dto';
import { UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

describe('ProfilesController', () => {
  let controller: ProfilesController;
  let service: ProfilesService;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  // Mock data
  const mockProfile: ProfileResponse = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Profile',
    description: 'Test Description',
    tags: ['test', 'automation'],
    readOnly: false,
    dashboardCount: 3,
    sloCount: 5,
    deepLinksCount: 2,
    createdAt: '2025-11-08T12:00:00.000Z',
    updatedAt: '2025-11-08T12:00:00.000Z',
  };

  const mockProfiles: ProfileResponse[] = [
    mockProfile,
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Production Profile',
      description: 'Production environment profile',
      tags: ['prod'],
      readOnly: true,
      dashboardCount: 10,
      sloCount: 15,
      deepLinksCount: 8,
      createdAt: '2025-11-07T10:00:00.000Z',
      updatedAt: '2025-11-07T10:00:00.000Z',
    },
  ];

  const mockProfileDashboard: ProfileDashboardResponse = {
    id: '650e8400-e29b-41d4-a716-446655440000',
    profile: 'Test Profile',
    dashboardName: 'JVM Memory Usage',
    dashboardUid: 'abc123def',
    grafanaLabel: 'Default',
    tags: ['jvm', 'memory'],
    createSeparateDashboardForVariable: 'application',
    setHardcodedValueForVariables: [
      { name: 'system_under_test', values: ['MyApp'] },
    ],
    matchRegexForVariables: { environment: 'prod.*' },
    readOnly: false,
    createdAt: '2025-11-08T12:00:00.000Z',
    updatedAt: '2025-11-08T12:00:00.000Z',
  };

  const mockProfileDashboards: ProfileDashboardResponse[] = [
    mockProfileDashboard,
    {
      id: '650e8400-e29b-41d4-a716-446655440001',
      profile: 'Test Profile',
      dashboardName: 'HTTP Requests',
      dashboardUid: 'xyz789ghi',
      grafanaLabel: 'Default',
      tags: ['http', 'requests'],
      readOnly: false,
      createdAt: '2025-11-08T13:00:00.000Z',
      updatedAt: '2025-11-08T13:00:00.000Z',
    },
  ];

  const mockProfileBenchmark: ProfileBenchmarkResponse = {
    id: '750e8400-e29b-41d4-a716-446655440000',
    profileId: '550e8400-e29b-41d4-a716-446655440000',
    profileDashboardId: '650e8400-e29b-41d4-a716-446655440000',
    workloadPattern: '.*',
    source: 'grafana',
    grafanaInstance: 'Default',
    dashboardLabel: 'JVM Memory Usage',
    dashboardUid: 'abc123def',
    panelId: 1,
    panelTitle: 'Heap Memory Usage',
    panelType: 'graph',
    panelDescription: 'Displays heap memory usage over time',
    evaluateType: 'avg',
    metricUnit: 'bytes',
    requirementOperator: 'lt',
    requirementValue: 1000000000,
    excludeRampUpTime: true,
    averageAll: false,
    matchPattern: '.*heap.*',
    validateWithDefaultIfNoData: false,
    validateWithDefaultIfNoDataValue: 0,
    tags: ['performance', 'jvm'],
    metadata: { category: 'memory' },
    readOnly: false,
    createdAt: '2025-11-08T12:00:00.000Z',
    updatedAt: '2025-11-08T12:00:00.000Z',
  };

  const mockProfileBenchmarks: ProfileBenchmarkResponse[] = [
    mockProfileBenchmark,
    {
      id: '750e8400-e29b-41d4-a716-446655440001',
      profileId: '550e8400-e29b-41d4-a716-446655440000',
      profileDashboardId: '650e8400-e29b-41d4-a716-446655440001',
      workloadPattern: 'load.*',
      source: 'grafana',
      grafanaInstance: 'Default',
      dashboardLabel: 'HTTP Requests',
      dashboardUid: 'xyz789ghi',
      panelId: 2,
      panelTitle: 'Request Duration',
      panelType: 'graph',
      evaluateType: 'max',
      metricUnit: 'ms',
      requirementOperator: 'lt',
      requirementValue: 500,
      excludeRampUpTime: true,
      averageAll: true,
      validateWithDefaultIfNoData: false,
      tags: ['performance', 'http'],
      metadata: {},
      readOnly: false,
      createdAt: '2025-11-08T13:00:00.000Z',
      updatedAt: '2025-11-08T13:00:00.000Z',
    },
  ];

  // Mock service
  const mockProfilesService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    createProfile: jest.fn(),
    updateProfile: jest.fn(),
    deleteProfile: jest.fn(),
    findDashboardsByProfileId: jest.fn(),
    createDashboard: jest.fn(),
    updateDashboard: jest.fn(),
    deleteDashboard: jest.fn(),
    findBenchmarksByProfileId: jest.fn(),
    createBenchmark: jest.fn(),
    updateBenchmark: jest.fn(),
    deleteBenchmark: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [
        {
          provide: ProfilesService,
          useValue: mockProfilesService,
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    controller = module.get<ProfilesController>(ProfilesController);
    service = module.get<ProfilesService>(ProfilesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all profiles successfully', async () => {
      // Arrange
      mockProfilesService.findAll.mockResolvedValue(mockProfiles);

      // Act
      const result = await controller.findAll(mockUserContext);

      // Assert
      expect(result).toEqual(mockProfiles);
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, true, undefined);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });

    it('should return an empty array when no profiles exist', async () => {
      // Arrange
      mockProfilesService.findAll.mockResolvedValue([]);

      // Act
      const result = await controller.findAll(mockUserContext);

      // Assert
      expect(result).toEqual([]);
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, true, undefined);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });

    it('should throw INTERNAL_SERVER_ERROR when service throws error', async () => {
      // Arrange
      const error = new Error('Database connection failed');
      mockProfilesService.findAll.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.findAll(mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findAll(mockUserContext)).rejects.toThrow('Failed to fetch profiles');

      try {
        await controller.findAll(mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      }
    });
  });

  describe('findOne', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';

    it('should return a single profile by ID', async () => {
      // Arrange
      mockProfilesService.findOne.mockResolvedValue(mockProfile);

      // Act
      const result = await controller.findOne(profileId, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfile);
      expect(service.findOne).toHaveBeenCalledWith(profileId, mockUserContext.userId, true);
      expect(service.findOne).toHaveBeenCalledTimes(1);
    });

    it('should throw NOT_FOUND when profile does not exist', async () => {
      // Arrange
      mockProfilesService.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(controller.findOne('nonexistent-id', mockUserContext)).rejects.toThrow(HttpException);

      try {
        await controller.findOne('nonexistent-id', mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((err as HttpException).message).toBe('Profile not found');
      }
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Custom error', HttpStatus.BAD_REQUEST);
      mockProfilesService.findOne.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.findOne(profileId, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw INTERNAL_SERVER_ERROR for non-HttpException errors', async () => {
      // Arrange
      const error = new Error('Database error');
      mockProfilesService.findOne.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.findOne(profileId, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect((err as HttpException).message).toBe('Failed to fetch profile');
      }
    });
  });

  describe('findDashboards', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';

    it('should return all dashboards for a profile', async () => {
      // Arrange
      mockProfilesService.findDashboardsByProfileId.mockResolvedValue(mockProfileDashboards);

      // Act
      const result = await controller.findDashboards(profileId, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileDashboards);
      expect(service.findDashboardsByProfileId).toHaveBeenCalledWith(profileId, mockUserContext.userId, true);
      expect(service.findDashboardsByProfileId).toHaveBeenCalledTimes(1);
    });

    it('should return an empty array when profile has no dashboards', async () => {
      // Arrange
      mockProfilesService.findDashboardsByProfileId.mockResolvedValue([]);

      // Act
      const result = await controller.findDashboards(profileId, mockUserContext);

      // Assert
      expect(result).toEqual([]);
      expect(service.findDashboardsByProfileId).toHaveBeenCalledWith(profileId, mockUserContext.userId, true);
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Profile not found', HttpStatus.NOT_FOUND);
      mockProfilesService.findDashboardsByProfileId.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.findDashboards(profileId, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw INTERNAL_SERVER_ERROR for non-HttpException errors', async () => {
      // Arrange
      const error = new Error('Database error');
      mockProfilesService.findDashboardsByProfileId.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.findDashboards(profileId, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect((err as HttpException).message).toBe('Failed to fetch profile dashboards');
      }
    });
  });

  describe('createDashboard', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';
    const createDto: CreateProfileDashboardDto = {
      dashboardUid: 'abc123def',
      grafanaLabel: 'Default',
      createSeparateDashboardForVariable: 'application',
      setHardcodedValueForVariables: [
        { name: 'system_under_test', values: ['MyApp'] },
      ],
      matchRegexForVariables: { environment: 'prod.*' },
      readOnly: false,
    };

    it('should create a new dashboard association successfully', async () => {
      // Arrange
      mockProfilesService.createDashboard.mockResolvedValue(mockProfileDashboard);

      // Act
      const result = await controller.createDashboard(profileId, createDto, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileDashboard);
      expect(service.createDashboard).toHaveBeenCalledWith(profileId, createDto, mockUserContext.userId, true);
      expect(service.createDashboard).toHaveBeenCalledTimes(1);
    });

    it('should create dashboard with minimal required fields', async () => {
      // Arrange
      const minimalDto: CreateProfileDashboardDto = {
        dashboardUid: 'xyz789',
        grafanaLabel: 'Production',
      };
      const minimalResponse = { ...mockProfileDashboard, id: 'new-id' };
      mockProfilesService.createDashboard.mockResolvedValue(minimalResponse);

      // Act
      const result = await controller.createDashboard(profileId, minimalDto, mockUserContext);

      // Assert
      expect(result).toEqual(minimalResponse);
      expect(service.createDashboard).toHaveBeenCalledWith(profileId, minimalDto, mockUserContext.userId, true);
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Profile not found', HttpStatus.NOT_FOUND);
      mockProfilesService.createDashboard.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.createDashboard(profileId, createDto, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw BAD_REQUEST with error message for Error objects', async () => {
      // Arrange
      const error = new Error('Invalid dashboard UID');
      mockProfilesService.createDashboard.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.createDashboard(profileId, createDto, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).message).toBe('Invalid dashboard UID');
      }
    });

    it('should throw BAD_REQUEST with default message for non-Error objects', async () => {
      // Arrange
      mockProfilesService.createDashboard.mockRejectedValue('string error');

      // Act & Assert
      try {
        await controller.createDashboard(profileId, createDto, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).message).toBe('Failed to create profile dashboard');
      }
    });
  });

  describe('updateDashboard', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';
    const dashboardId = '650e8400-e29b-41d4-a716-446655440000';
    const updateDto: UpdateProfileDashboardDto = {
      dashboardUid: 'abc123def',
      grafanaLabel: 'Updated Label',
      setHardcodedValueForVariables: [
        { name: 'environment', values: ['production'] },
      ],
      matchRegexForVariables: { region: 'us-.*' },
      readOnly: true,
    };

    it('should update a dashboard association successfully', async () => {
      // Arrange
      const updatedDashboard = { ...mockProfileDashboard, grafanaLabel: 'Updated Label', readOnly: true };
      mockProfilesService.updateDashboard.mockResolvedValue(updatedDashboard);

      // Act
      const result = await controller.updateDashboard(profileId, dashboardId, updateDto, mockUserContext);

      // Assert
      expect(result).toEqual(updatedDashboard);
      expect(service.updateDashboard).toHaveBeenCalledWith(profileId, dashboardId, updateDto, mockUserContext.userId, true);
      expect(service.updateDashboard).toHaveBeenCalledTimes(1);
    });

    it('should update dashboard with partial fields', async () => {
      // Arrange
      const partialDto: UpdateProfileDashboardDto = {
        readOnly: true,
      };
      mockProfilesService.updateDashboard.mockResolvedValue(mockProfileDashboard);

      // Act
      const result = await controller.updateDashboard(profileId, dashboardId, partialDto, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileDashboard);
      expect(service.updateDashboard).toHaveBeenCalledWith(profileId, dashboardId, partialDto, mockUserContext.userId, true);
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Dashboard not found', HttpStatus.NOT_FOUND);
      mockProfilesService.updateDashboard.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.updateDashboard(profileId, dashboardId, updateDto, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw BAD_REQUEST with error message for Error objects', async () => {
      // Arrange
      const error = new Error('Invalid update data');
      mockProfilesService.updateDashboard.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.updateDashboard(profileId, dashboardId, updateDto, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).message).toBe('Invalid update data');
      }
    });

    it('should throw BAD_REQUEST with default message for non-Error objects', async () => {
      // Arrange
      mockProfilesService.updateDashboard.mockRejectedValue(null);

      // Act & Assert
      try {
        await controller.updateDashboard(profileId, dashboardId, updateDto, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).message).toBe('Failed to update profile dashboard');
      }
    });
  });

  describe('deleteDashboard', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';
    const dashboardId = '650e8400-e29b-41d4-a716-446655440000';

    it('should delete a dashboard association successfully', async () => {
      // Arrange
      mockProfilesService.deleteDashboard.mockResolvedValue(undefined);

      // Act
      const result = await controller.deleteDashboard(profileId, dashboardId, mockUserContext);

      // Assert
      expect(result).toEqual({ message: 'Dashboard association deleted successfully' });
      expect(service.deleteDashboard).toHaveBeenCalledWith(profileId, dashboardId, mockUserContext.userId, true);
      expect(service.deleteDashboard).toHaveBeenCalledTimes(1);
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Dashboard not found', HttpStatus.NOT_FOUND);
      mockProfilesService.deleteDashboard.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.deleteDashboard(profileId, dashboardId, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw INTERNAL_SERVER_ERROR with error message for Error objects', async () => {
      // Arrange
      const error = new Error('Database constraint violation');
      mockProfilesService.deleteDashboard.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.deleteDashboard(profileId, dashboardId, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect((err as HttpException).message).toBe('Database constraint violation');
      }
    });

    it('should throw INTERNAL_SERVER_ERROR with default message for non-Error objects', async () => {
      // Arrange
      mockProfilesService.deleteDashboard.mockRejectedValue(12345);

      // Act & Assert
      try {
        await controller.deleteDashboard(profileId, dashboardId, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect((err as HttpException).message).toBe('Failed to delete profile dashboard');
      }
    });
  });

  describe('getProfileBenchmarks', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';

    it('should return all benchmarks for a profile', async () => {
      // Arrange
      mockProfilesService.findBenchmarksByProfileId.mockResolvedValue(mockProfileBenchmarks);

      // Act
      const result = await controller.getProfileBenchmarks(profileId, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileBenchmarks);
      expect(service.findBenchmarksByProfileId).toHaveBeenCalledWith(profileId, mockUserContext.userId, true);
      expect(service.findBenchmarksByProfileId).toHaveBeenCalledTimes(1);
    });

    it('should return an empty array when profile has no benchmarks', async () => {
      // Arrange
      mockProfilesService.findBenchmarksByProfileId.mockResolvedValue([]);

      // Act
      const result = await controller.getProfileBenchmarks(profileId, mockUserContext);

      // Assert
      expect(result).toEqual([]);
      expect(service.findBenchmarksByProfileId).toHaveBeenCalledWith(profileId, mockUserContext.userId, true);
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Profile not found', HttpStatus.NOT_FOUND);
      mockProfilesService.findBenchmarksByProfileId.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.getProfileBenchmarks(profileId, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw INTERNAL_SERVER_ERROR for non-HttpException errors', async () => {
      // Arrange
      const error = new Error('Database connection timeout');
      mockProfilesService.findBenchmarksByProfileId.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.getProfileBenchmarks(profileId, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect((err as HttpException).message).toBe('Failed to fetch profile benchmarks');
      }
    });
  });

  describe('createProfileBenchmark', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';
    const createDto: CreateProfileBenchmarkDto = {
      profileDashboardId: '650e8400-e29b-41d4-a716-446655440000',
      workloadPattern: '.*',
      source: 'grafana',
      grafanaInstance: 'Default',
      dashboardLabel: 'JVM Memory Usage',
      dashboardUid: 'abc123def',
      panelId: 1,
      panelTitle: 'Heap Memory Usage',
      panelType: 'graph',
      panelDescription: 'Displays heap memory usage over time',
      evaluateType: 'avg',
      metricUnit: 'bytes',
      requirementOperator: 'lt',
      requirementValue: 1000000000,
      excludeRampUpTime: true,
      averageAll: false,
      matchPattern: '.*heap.*',
      validateWithDefaultIfNoData: false,
      validateWithDefaultIfNoDataValue: 0,
      tags: ['performance', 'jvm'],
      metadata: { category: 'memory' },
      readOnly: false,
    };

    it('should create a new benchmark successfully', async () => {
      // Arrange
      mockProfilesService.createBenchmark.mockResolvedValue(mockProfileBenchmark);

      // Act
      const result = await controller.createProfileBenchmark(profileId, createDto, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileBenchmark);
      expect(service.createBenchmark).toHaveBeenCalledWith(profileId, createDto, mockUserContext.userId, true);
      expect(service.createBenchmark).toHaveBeenCalledTimes(1);
    });

    it('should create benchmark with minimal required fields', async () => {
      // Arrange
      const minimalDto: CreateProfileBenchmarkDto = {
        profileDashboardId: '650e8400-e29b-41d4-a716-446655440000',
      };
      const minimalBenchmark = { ...mockProfileBenchmark, id: 'new-benchmark-id' };
      mockProfilesService.createBenchmark.mockResolvedValue(minimalBenchmark);

      // Act
      const result = await controller.createProfileBenchmark(profileId, minimalDto, mockUserContext);

      // Assert
      expect(result).toEqual(minimalBenchmark);
      expect(service.createBenchmark).toHaveBeenCalledWith(profileId, minimalDto, mockUserContext.userId, true);
    });

    it('should create benchmark with optional fields', async () => {
      // Arrange
      const optionalDto: CreateProfileBenchmarkDto = {
        profileDashboardId: '650e8400-e29b-41d4-a716-446655440000',
        workloadPattern: 'load-test-.*',
        source: 'dynatrace',
        tags: ['critical', 'production'],
        metadata: { owner: 'team-a', priority: 'high' },
      };
      mockProfilesService.createBenchmark.mockResolvedValue(mockProfileBenchmark);

      // Act
      const result = await controller.createProfileBenchmark(profileId, optionalDto, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileBenchmark);
      expect(service.createBenchmark).toHaveBeenCalledWith(profileId, optionalDto, mockUserContext.userId, true);
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Profile dashboard not found', HttpStatus.NOT_FOUND);
      mockProfilesService.createBenchmark.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.createProfileBenchmark(profileId, createDto, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw BAD_REQUEST with error message for Error objects', async () => {
      // Arrange
      const error = new Error('Invalid workload pattern regex');
      mockProfilesService.createBenchmark.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.createProfileBenchmark(profileId, createDto, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).message).toBe('Invalid workload pattern regex');
      }
    });

    it('should throw BAD_REQUEST with default message for non-Error objects', async () => {
      // Arrange
      mockProfilesService.createBenchmark.mockRejectedValue({ code: 'INVALID_INPUT' });

      // Act & Assert
      try {
        await controller.createProfileBenchmark(profileId, createDto, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).message).toBe('Failed to create profile benchmark');
      }
    });
  });

  describe('updateProfileBenchmark', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';
    const benchmarkId = '750e8400-e29b-41d4-a716-446655440000';
    const updateDto: UpdateProfileBenchmarkDto = {
      workloadPattern: 'production-.*',
      requirementOperator: 'lt',
      requirementValue: 800000000,
      tags: ['performance', 'jvm', 'critical'],
      metadata: { updated: true },
      readOnly: true,
    };

    it('should update a benchmark successfully', async () => {
      // Arrange
      const updatedBenchmark = { ...mockProfileBenchmark, workloadPattern: 'production-.*', readOnly: true };
      mockProfilesService.updateBenchmark.mockResolvedValue(updatedBenchmark);

      // Act
      const result = await controller.updateProfileBenchmark(profileId, benchmarkId, updateDto, mockUserContext);

      // Assert
      expect(result).toEqual(updatedBenchmark);
      expect(service.updateBenchmark).toHaveBeenCalledWith(profileId, benchmarkId, updateDto, mockUserContext.userId, true);
      expect(service.updateBenchmark).toHaveBeenCalledTimes(1);
    });

    it('should update benchmark with single field', async () => {
      // Arrange
      const partialDto: UpdateProfileBenchmarkDto = {
        requirementValue: 500,
      };
      mockProfilesService.updateBenchmark.mockResolvedValue(mockProfileBenchmark);

      // Act
      const result = await controller.updateProfileBenchmark(profileId, benchmarkId, partialDto, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileBenchmark);
      expect(service.updateBenchmark).toHaveBeenCalledWith(profileId, benchmarkId, partialDto, mockUserContext.userId, true);
    });

    it('should update benchmark with multiple fields', async () => {
      // Arrange
      const multipleFieldsDto: UpdateProfileBenchmarkDto = {
        evaluateType: 'max',
        metricUnit: 'ms',
        requirementOperator: 'gt',
        requirementValue: 100,
        excludeRampUpTime: false,
        averageAll: true,
      };
      mockProfilesService.updateBenchmark.mockResolvedValue(mockProfileBenchmark);

      // Act
      const result = await controller.updateProfileBenchmark(profileId, benchmarkId, multipleFieldsDto, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileBenchmark);
      expect(service.updateBenchmark).toHaveBeenCalledWith(profileId, benchmarkId, multipleFieldsDto, mockUserContext.userId, true);
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Benchmark not found', HttpStatus.NOT_FOUND);
      mockProfilesService.updateBenchmark.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.updateProfileBenchmark(profileId, benchmarkId, updateDto, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw BAD_REQUEST with error message for Error objects', async () => {
      // Arrange
      const error = new Error('Invalid requirement value');
      mockProfilesService.updateBenchmark.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.updateProfileBenchmark(profileId, benchmarkId, updateDto, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).message).toBe('Invalid requirement value');
      }
    });

    it('should throw BAD_REQUEST with default message for non-Error objects', async () => {
      // Arrange
      mockProfilesService.updateBenchmark.mockRejectedValue(undefined);

      // Act & Assert
      try {
        await controller.updateProfileBenchmark(profileId, benchmarkId, updateDto, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).message).toBe('Failed to update profile benchmark');
      }
    });
  });

  describe('deleteProfileBenchmark', () => {
    const profileId = '550e8400-e29b-41d4-a716-446655440000';
    const benchmarkId = '750e8400-e29b-41d4-a716-446655440000';

    it('should delete a benchmark successfully', async () => {
      // Arrange
      mockProfilesService.deleteBenchmark.mockResolvedValue(undefined);

      // Act
      const result = await controller.deleteProfileBenchmark(profileId, benchmarkId, mockUserContext);

      // Assert
      expect(result).toEqual({ message: 'Benchmark deleted successfully' });
      expect(service.deleteBenchmark).toHaveBeenCalledWith(profileId, benchmarkId, mockUserContext.userId, true);
      expect(service.deleteBenchmark).toHaveBeenCalledTimes(1);
    });

    it('should preserve HttpException from service', async () => {
      // Arrange
      const httpException = new HttpException('Benchmark not found', HttpStatus.NOT_FOUND);
      mockProfilesService.deleteBenchmark.mockRejectedValue(httpException);

      // Act & Assert
      await expect(controller.deleteProfileBenchmark(profileId, benchmarkId, mockUserContext)).rejects.toThrow(httpException);
    });

    it('should throw INTERNAL_SERVER_ERROR with error message for Error objects', async () => {
      // Arrange
      const error = new Error('Foreign key constraint violation');
      mockProfilesService.deleteBenchmark.mockRejectedValue(error);

      // Act & Assert
      try {
        await controller.deleteProfileBenchmark(profileId, benchmarkId, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect((err as HttpException).message).toBe('Foreign key constraint violation');
      }
    });

    it('should throw INTERNAL_SERVER_ERROR with default message for non-Error objects', async () => {
      // Arrange
      mockProfilesService.deleteBenchmark.mockRejectedValue(false);

      // Act & Assert
      try {
        await controller.deleteProfileBenchmark(profileId, benchmarkId, mockUserContext);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect((err as HttpException).message).toBe('Failed to delete profile benchmark');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string IDs gracefully in findOne', async () => {
      // Arrange
      mockProfilesService.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(controller.findOne('', mockUserContext)).rejects.toThrow(HttpException);
    });

    it('should handle malformed UUID in dashboard operations', async () => {
      // Arrange
      const invalidId = 'not-a-uuid';
      mockProfilesService.findDashboardsByProfileId.mockRejectedValue(
        new HttpException('Invalid UUID format', HttpStatus.BAD_REQUEST)
      );

      // Act & Assert
      await expect(controller.findDashboards(invalidId, mockUserContext)).rejects.toThrow(HttpException);
    });

    it('should handle null updateDto gracefully', async () => {
      // Arrange
      const profileId = '550e8400-e29b-41d4-a716-446655440000';
      const dashboardId = '650e8400-e29b-41d4-a716-446655440000';
      mockProfilesService.updateDashboard.mockResolvedValue(mockProfileDashboard);

      // Act
      const result = await controller.updateDashboard(profileId, dashboardId, {}, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileDashboard);
      expect(service.updateDashboard).toHaveBeenCalledWith(profileId, dashboardId, {}, mockUserContext.userId, true);
    });

    it('should handle very large metadata objects in benchmark creation', async () => {
      // Arrange
      const profileId = '550e8400-e29b-41d4-a716-446655440000';
      const largeMetadata = {
        field1: 'x'.repeat(10000),
        nested: { deep: { deeper: { data: new Array(1000).fill('data') } } },
      };
      const createDto: CreateProfileBenchmarkDto = {
        profileDashboardId: '650e8400-e29b-41d4-a716-446655440000',
        metadata: largeMetadata,
      };
      mockProfilesService.createBenchmark.mockResolvedValue(mockProfileBenchmark);

      // Act
      const result = await controller.createProfileBenchmark(profileId, createDto, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileBenchmark);
      expect(service.createBenchmark).toHaveBeenCalledWith(profileId, createDto, mockUserContext.userId, true);
    });

    it('should handle empty arrays in setHardcodedValueForVariables', async () => {
      // Arrange
      const profileId = '550e8400-e29b-41d4-a716-446655440000';
      const createDto: CreateProfileDashboardDto = {
        dashboardUid: 'abc123',
        grafanaLabel: 'Default',
        setHardcodedValueForVariables: [],
      };
      mockProfilesService.createDashboard.mockResolvedValue(mockProfileDashboard);

      // Act
      const result = await controller.createDashboard(profileId, createDto, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfileDashboard);
      expect(service.createDashboard).toHaveBeenCalledWith(profileId, createDto, mockUserContext.userId, true);
    });

    it('should handle special characters in profile IDs', async () => {
      // Arrange
      const specialId = '550e8400-e29b-41d4-a716-446655440000%20%23';
      mockProfilesService.findOne.mockResolvedValue(mockProfile);

      // Act
      const result = await controller.findOne(specialId, mockUserContext);

      // Assert
      expect(result).toEqual(mockProfile);
      expect(service.findOne).toHaveBeenCalledWith(specialId, mockUserContext.userId, true);
    });
  });
});
