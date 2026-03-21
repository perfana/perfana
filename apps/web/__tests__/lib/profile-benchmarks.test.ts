/**
 * Unit tests for Profile Benchmarks API Client
 *
 * Tests profile benchmark (SLO) management functions including:
 * - fetchProfileBenchmarks: Get all benchmarks for a profile
 * - createProfileBenchmark: Create a new benchmark (SLO)
 * - updateProfileBenchmark: Update an existing benchmark
 * - deleteProfileBenchmark: Delete a benchmark
 *
 * Comprehensive coverage includes:
 * - Happy path scenarios
 * - Error cases (400, 401, 403, 404, 409, 500)
 * - Edge cases (empty data, null, undefined, invalid IDs)
 * - Data validation and transformation
 * - Authentication header inclusion
 */

import {
  fetchProfileBenchmarks,
  createProfileBenchmark,
  updateProfileBenchmark,
  deleteProfileBenchmark,
  type ProfileBenchmark,
  type CreateProfileBenchmarkData,
  type UpdateProfileBenchmarkData,
} from '@/lib/profile-benchmarks';
import * as api from '@/lib/api';

// Mock authenticatedFetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockAuthenticatedFetch = api.authenticatedFetch as jest.MockedFunction<
  typeof api.authenticatedFetch
>;

describe('Profile Benchmarks API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchProfileBenchmarks()', () => {
    it('should fetch all benchmarks for a profile successfully', async () => {
      // Arrange
      const profileId = 'profile-123';
      const mockBenchmarks: ProfileBenchmark[] = [
        {
          id: 'benchmark-1',
          profileId: profileId,
          profileDashboardId: 'dashboard-1',
          workloadPattern: 'load-test-.*',
          source: 'influxdb',
          grafanaInstance: 'production-grafana',
          dashboardLabel: 'System Under Test',
          dashboardUid: 'sut-uid',
          panelId: 1,
          panelTitle: 'CPU Usage',
          panelType: 'graph',
          panelDescription: 'CPU utilization over time',
          evaluateType: 'avg',
          metricUnit: 'percent',
          requirementOperator: '<',
          requirementValue: 80,
          excludeRampUpTime: true,
          averageAll: false,
          matchPattern: '.*cpu.*',
          validateWithDefaultIfNoData: false,
          tags: ['performance', 'cpu'],
          metadata: { priority: 'high' },
          readOnly: false,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        },
        {
          id: 'benchmark-2',
          profileId: profileId,
          profileDashboardId: 'dashboard-2',
          workloadPattern: 'stress-test-.*',
          source: 'prometheus',
          excludeRampUpTime: false,
          averageAll: true,
          validateWithDefaultIfNoData: true,
          validateWithDefaultIfNoDataValue: 0,
          tags: ['memory'],
          metadata: {},
          createdAt: '2025-01-05T00:00:00Z',
          updatedAt: '2025-01-05T00:00:00Z',
        },
      ];

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockBenchmarks,
      } as Response);

      // Act
      const result = await fetchProfileBenchmarks(profileId);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/profiles/${profileId}/benchmarks`,
        { cache: 'no-store' }
      );
      expect(result).toEqual(mockBenchmarks);
      expect(result).toHaveLength(2);
      expect(result[0].workloadPattern).toBe('load-test-.*');
      expect(result[1].averageAll).toBe(true);
    });

    it('should fetch empty array when profile has no benchmarks', async () => {
      // Arrange
      const profileId = 'profile-no-benchmarks';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      // Act
      const result = await fetchProfileBenchmarks(profileId);

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should throw error with message when fetch fails', async () => {
      // Arrange
      const profileId = 'profile-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Profile not found' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow('Profile not found');
    });

    it('should throw generic error when no error message provided', async () => {
      // Arrange
      const profileId = 'profile-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow(
        'Failed to fetch profile benchmarks'
      );
    });

    it('should handle unauthorized errors (401)', async () => {
      // Arrange
      const profileId = 'profile-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized - token expired' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow(
        'Unauthorized - token expired'
      );
    });

    it('should handle forbidden errors (403)', async () => {
      // Arrange
      const profileId = 'restricted-profile';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Forbidden - insufficient permissions' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow(
        'Forbidden - insufficient permissions'
      );
    });

    it('should handle network errors', async () => {
      // Arrange
      const profileId = 'profile-123';
      mockAuthenticatedFetch.mockRejectedValue(new Error('Network timeout'));

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow('Network timeout');
    });

    it('should handle malformed JSON responses', async () => {
      // Arrange
      const profileId = 'profile-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON response');
        },
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow('Invalid JSON response');
    });

    it('should fetch benchmarks with minimal fields', async () => {
      // Arrange
      const profileId = 'profile-minimal';
      const minimalBenchmark: ProfileBenchmark = {
        id: 'minimal-benchmark',
        profileId: profileId,
        profileDashboardId: 'dashboard-minimal',
        workloadPattern: 'test-.*',
        source: 'grafana',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => [minimalBenchmark],
      } as Response);

      // Act
      const result = await fetchProfileBenchmarks(profileId);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].grafanaInstance).toBeUndefined();
      expect(result[0].panelId).toBeUndefined();
      expect(result[0].requirementOperator).toBeUndefined();
      expect(result[0].requirementValue).toBeUndefined();
    });
  });

  describe('createProfileBenchmark()', () => {
    it('should create benchmark with minimal required data', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
      };

      const mockResponse: ProfileBenchmark = {
        id: 'new-benchmark-123',
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: '',
        source: 'grafana',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileBenchmark(profileId, createData);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/profiles/${profileId}/benchmarks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createData),
        }
      );
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe('new-benchmark-123');
    });

    it('should create benchmark with complete data', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'load-test-.*',
        source: 'influxdb',
        grafanaInstance: 'production-grafana',
        dashboardLabel: 'System Under Test',
        dashboardUid: 'sut-uid',
        panelId: 5,
        panelTitle: 'Response Time P95',
        panelType: 'graph',
        panelDescription: '95th percentile response time',
        evaluateType: 'p95',
        metricUnit: 'ms',
        requirementOperator: '<',
        requirementValue: 500,
        excludeRampUpTime: true,
        averageAll: false,
        matchPattern: '.*response.*time.*',
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: 1000,
        tags: ['performance', 'response-time', 'slo'],
        metadata: { priority: 'critical', team: 'platform' },
      };

      const mockResponse: ProfileBenchmark = {
        id: 'benchmark-complete',
        profileId: profileId,
        ...createData,
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileBenchmark(profileId, createData);

      // Assert
      expect(result.workloadPattern).toBe('load-test-.*');
      expect(result.requirementOperator).toBe('<');
      expect(result.requirementValue).toBe(500);
      expect(result.tags).toEqual(['performance', 'response-time', 'slo']);
      expect(result.metadata).toEqual({ priority: 'critical', team: 'platform' });
    });

    it('should create benchmark with workload pattern matching', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-k8s',
        workloadPattern: '^stress-test-.*',
        matchPattern: '.*memory.*',
      };

      const mockResponse: ProfileBenchmark = {
        id: 'benchmark-pattern',
        profileId: profileId,
        profileDashboardId: 'dashboard-k8s',
        workloadPattern: '^stress-test-.*',
        source: 'grafana',
        matchPattern: '.*memory.*',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileBenchmark(profileId, createData);

      // Assert
      expect(result.workloadPattern).toBe('^stress-test-.*');
      expect(result.matchPattern).toBe('.*memory.*');
    });

    it('should create benchmark with default value validation', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: 999,
      };

      const mockResponse: ProfileBenchmark = {
        id: 'benchmark-default',
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: '',
        source: 'grafana',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: 999,
        tags: [],
        metadata: {},
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileBenchmark(profileId, createData);

      // Assert
      expect(result.validateWithDefaultIfNoData).toBe(true);
      expect(result.validateWithDefaultIfNoDataValue).toBe(999);
    });

    it('should throw error when dashboard not found (404)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'non-existent-dashboard',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Profile dashboard not found' }),
      } as Response);

      // Act & Assert
      await expect(createProfileBenchmark(profileId, createData)).rejects.toThrow(
        'Profile dashboard not found'
      );
    });

    it('should throw error when validation fails (400)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
        requirementOperator: 'invalid-operator' as any,
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid requirement operator' }),
      } as Response);

      // Act & Assert
      await expect(createProfileBenchmark(profileId, createData)).rejects.toThrow(
        'Invalid requirement operator'
      );
    });

    it('should throw error when profile not found (404)', async () => {
      // Arrange
      const profileId = 'non-existent-profile';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Profile not found' }),
      } as Response);

      // Act & Assert
      await expect(createProfileBenchmark(profileId, createData)).rejects.toThrow(
        'Profile not found'
      );
    });

    it('should throw error when benchmark already exists (409)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'existing-pattern',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          message: 'Benchmark with this workload pattern already exists',
        }),
      } as Response);

      // Act & Assert
      await expect(createProfileBenchmark(profileId, createData)).rejects.toThrow(
        'Benchmark with this workload pattern already exists'
      );
    });

    it('should throw generic error when no error message provided', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      // Act & Assert
      await expect(createProfileBenchmark(profileId, createData)).rejects.toThrow(
        'Failed to create profile benchmark'
      );
    });

    it('should handle unauthorized errors (401)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      } as Response);

      // Act & Assert
      await expect(createProfileBenchmark(profileId, createData)).rejects.toThrow(
        'Unauthorized'
      );
    });

    it('should handle forbidden errors (403)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Insufficient permissions' }),
      } as Response);

      // Act & Assert
      await expect(createProfileBenchmark(profileId, createData)).rejects.toThrow(
        'Insufficient permissions'
      );
    });

    it('should handle network errors during creation', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
      };

      mockAuthenticatedFetch.mockRejectedValue(new Error('Connection refused'));

      // Act & Assert
      await expect(createProfileBenchmark(profileId, createData)).rejects.toThrow(
        'Connection refused'
      );
    });
  });

  describe('updateProfileBenchmark()', () => {
    it('should update benchmark with single field', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        requirementValue: 600,
      };

      const mockResponse: ProfileBenchmark = {
        id: benchmarkId,
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'test-.*',
        source: 'influxdb',
        requirementOperator: '<',
        requirementValue: 600,
        excludeRampUpTime: true,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: ['performance'],
        metadata: {},
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await updateProfileBenchmark(profileId, benchmarkId, updateData);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/profiles/${profileId}/benchmarks/${benchmarkId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        }
      );
      expect(result.requirementValue).toBe(600);
    });

    it('should update benchmark with multiple fields', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        workloadPattern: 'updated-pattern-.*',
        requirementOperator: '<=',
        requirementValue: 750,
        excludeRampUpTime: false,
        averageAll: true,
        tags: ['updated', 'performance', 'critical'],
        metadata: { version: '2.0', priority: 'high' },
      };

      const mockResponse: ProfileBenchmark = {
        id: benchmarkId,
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'updated-pattern-.*',
        source: 'influxdb',
        requirementOperator: '<=',
        requirementValue: 750,
        excludeRampUpTime: false,
        averageAll: true,
        validateWithDefaultIfNoData: false,
        tags: ['updated', 'performance', 'critical'],
        metadata: { version: '2.0', priority: 'high' },
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-11T12:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await updateProfileBenchmark(profileId, benchmarkId, updateData);

      // Assert
      expect(result.workloadPattern).toBe('updated-pattern-.*');
      expect(result.requirementOperator).toBe('<=');
      expect(result.requirementValue).toBe(750);
      expect(result.excludeRampUpTime).toBe(false);
      expect(result.averageAll).toBe(true);
      expect(result.tags).toEqual(['updated', 'performance', 'critical']);
      expect(result.metadata).toEqual({ version: '2.0', priority: 'high' });
    });

    it('should update benchmark validation settings', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: 5000,
      };

      const mockResponse: ProfileBenchmark = {
        id: benchmarkId,
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'test-.*',
        source: 'grafana',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: 5000,
        tags: [],
        metadata: {},
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-11T12:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await updateProfileBenchmark(profileId, benchmarkId, updateData);

      // Assert
      expect(result.validateWithDefaultIfNoData).toBe(true);
      expect(result.validateWithDefaultIfNoDataValue).toBe(5000);
    });

    it('should update benchmark panel configuration', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        panelId: 10,
        panelTitle: 'Updated Panel Title',
        panelType: 'timeseries',
        panelDescription: 'Updated panel description',
      };

      const mockResponse: ProfileBenchmark = {
        id: benchmarkId,
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'test-.*',
        source: 'grafana',
        panelId: 10,
        panelTitle: 'Updated Panel Title',
        panelType: 'timeseries',
        panelDescription: 'Updated panel description',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-11T12:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await updateProfileBenchmark(profileId, benchmarkId, updateData);

      // Assert
      expect(result.panelId).toBe(10);
      expect(result.panelTitle).toBe('Updated Panel Title');
      expect(result.panelType).toBe('timeseries');
      expect(result.panelDescription).toBe('Updated panel description');
    });

    it('should update benchmark Grafana configuration', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        grafanaInstance: 'staging-grafana',
        dashboardLabel: 'Staging Dashboard',
        dashboardUid: 'staging-uid',
      };

      const mockResponse: ProfileBenchmark = {
        id: benchmarkId,
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'test-.*',
        source: 'grafana',
        grafanaInstance: 'staging-grafana',
        dashboardLabel: 'Staging Dashboard',
        dashboardUid: 'staging-uid',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-11T12:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await updateProfileBenchmark(profileId, benchmarkId, updateData);

      // Assert
      expect(result.grafanaInstance).toBe('staging-grafana');
      expect(result.dashboardLabel).toBe('Staging Dashboard');
      expect(result.dashboardUid).toBe('staging-uid');
    });

    it('should throw error when benchmark not found (404)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'non-existent-benchmark';
      const updateData: UpdateProfileBenchmarkData = {
        requirementValue: 500,
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Profile benchmark not found' }),
      } as Response);

      // Act & Assert
      await expect(
        updateProfileBenchmark(profileId, benchmarkId, updateData)
      ).rejects.toThrow('Profile benchmark not found');
    });

    it('should throw error when validation fails (400)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        requirementOperator: 'invalid' as any,
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid requirement operator value' }),
      } as Response);

      // Act & Assert
      await expect(
        updateProfileBenchmark(profileId, benchmarkId, updateData)
      ).rejects.toThrow('Invalid requirement operator value');
    });

    it('should throw generic error when no error message provided', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        requirementValue: 500,
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      // Act & Assert
      await expect(
        updateProfileBenchmark(profileId, benchmarkId, updateData)
      ).rejects.toThrow('Failed to update profile benchmark');
    });

    it('should handle unauthorized errors (401)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        requirementValue: 500,
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Token expired' }),
      } as Response);

      // Act & Assert
      await expect(
        updateProfileBenchmark(profileId, benchmarkId, updateData)
      ).rejects.toThrow('Token expired');
    });

    it('should handle forbidden errors (403)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'readonly-benchmark';
      const updateData: UpdateProfileBenchmarkData = {
        requirementValue: 500,
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Cannot modify read-only benchmark' }),
      } as Response);

      // Act & Assert
      await expect(
        updateProfileBenchmark(profileId, benchmarkId, updateData)
      ).rejects.toThrow('Cannot modify read-only benchmark');
    });

    it('should handle network errors during update', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';
      const updateData: UpdateProfileBenchmarkData = {
        requirementValue: 500,
      };

      mockAuthenticatedFetch.mockRejectedValue(new Error('Network timeout'));

      // Act & Assert
      await expect(
        updateProfileBenchmark(profileId, benchmarkId, updateData)
      ).rejects.toThrow('Network timeout');
    });
  });

  describe('deleteProfileBenchmark()', () => {
    it('should delete benchmark successfully', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-to-delete';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      // Act
      await deleteProfileBenchmark(profileId, benchmarkId);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/profiles/${profileId}/benchmarks/${benchmarkId}`,
        { method: 'DELETE' }
      );
    });

    it('should return void when deletion succeeds', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Benchmark deleted successfully' }),
      } as Response);

      // Act
      const result = await deleteProfileBenchmark(profileId, benchmarkId);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should throw error with message when deletion fails', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'non-existent-benchmark';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Benchmark not found' }),
      } as Response);

      // Act & Assert
      await expect(deleteProfileBenchmark(profileId, benchmarkId)).rejects.toThrow(
        'Benchmark not found'
      );
    });

    it('should throw generic error when no error message provided', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      // Act & Assert
      await expect(deleteProfileBenchmark(profileId, benchmarkId)).rejects.toThrow(
        'Failed to delete profile benchmark'
      );
    });

    it('should handle unauthorized errors (401)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Authentication required' }),
      } as Response);

      // Act & Assert
      await expect(deleteProfileBenchmark(profileId, benchmarkId)).rejects.toThrow(
        'Authentication required'
      );
    });

    it('should handle forbidden errors (403)', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'protected-benchmark';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Cannot delete protected benchmark' }),
      } as Response);

      // Act & Assert
      await expect(deleteProfileBenchmark(profileId, benchmarkId)).rejects.toThrow(
        'Cannot delete protected benchmark'
      );
    });

    it('should handle profile not found (404)', async () => {
      // Arrange
      const profileId = 'non-existent-profile';
      const benchmarkId = 'benchmark-456';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Profile not found' }),
      } as Response);

      // Act & Assert
      await expect(deleteProfileBenchmark(profileId, benchmarkId)).rejects.toThrow(
        'Profile not found'
      );
    });

    it('should handle network errors during deletion', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';

      mockAuthenticatedFetch.mockRejectedValue(new Error('Connection lost'));

      // Act & Assert
      await expect(deleteProfileBenchmark(profileId, benchmarkId)).rejects.toThrow(
        'Connection lost'
      );
    });

    it('should handle malformed JSON response', async () => {
      // Arrange
      const profileId = 'profile-123';
      const benchmarkId = 'benchmark-456';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Malformed JSON');
        },
      } as Response);

      // Act & Assert
      await expect(deleteProfileBenchmark(profileId, benchmarkId)).rejects.toThrow(
        'Malformed JSON'
      );
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle empty string profile ID', async () => {
      // Arrange
      const profileId = '';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid profile ID' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow('Invalid profile ID');
    });

    it('should handle UUID format validation', async () => {
      // Arrange
      const invalidProfileId = 'not-a-uuid';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid UUID format' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(invalidProfileId)).rejects.toThrow(
        'Invalid UUID format'
      );
    });

    it('should handle benchmarks with all optional fields populated', async () => {
      // Arrange
      const profileId = 'profile-123';
      const fullBenchmark: ProfileBenchmark = {
        id: 'full-benchmark',
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'full-test-.*',
        source: 'prometheus',
        grafanaInstance: 'prod-grafana',
        dashboardLabel: 'Full Dashboard',
        dashboardUid: 'full-uid',
        panelId: 42,
        panelTitle: 'Full Panel',
        panelType: 'graph',
        panelDescription: 'Complete panel description',
        evaluateType: 'max',
        metricUnit: 'bytes',
        requirementOperator: '>=',
        requirementValue: 1024,
        excludeRampUpTime: true,
        averageAll: true,
        matchPattern: '.*full.*',
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: 512,
        tags: ['tag1', 'tag2', 'tag3'],
        metadata: { key1: 'value1', key2: 'value2', nested: { deep: 'value' } },
        readOnly: true,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => [fullBenchmark],
      } as Response);

      // Act
      const result = await fetchProfileBenchmarks(profileId);

      // Assert
      expect(result[0]).toEqual(fullBenchmark);
      expect(result[0].metadata.nested.deep).toBe('value');
    });

    it('should handle empty tags array', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
        tags: [],
      };

      const mockResponse: ProfileBenchmark = {
        id: 'benchmark-no-tags',
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: '',
        source: 'grafana',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileBenchmark(profileId, createData);

      // Assert
      expect(result.tags).toEqual([]);
    });

    it('should handle empty metadata object', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
        metadata: {},
      };

      const mockResponse: ProfileBenchmark = {
        id: 'benchmark-no-metadata',
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: '',
        source: 'grafana',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileBenchmark(profileId, createData);

      // Assert
      expect(result.metadata).toEqual({});
    });

    it('should handle server errors (500)', async () => {
      // Arrange
      const profileId = 'profile-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal server error' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow(
        'Internal server error'
      );
    });

    it('should handle service unavailable errors (503)', async () => {
      // Arrange
      const profileId = 'profile-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service temporarily unavailable' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfileBenchmarks(profileId)).rejects.toThrow(
        'Service temporarily unavailable'
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete benchmark lifecycle: create -> update -> delete', async () => {
      // Arrange
      const profileId = 'profile-lifecycle';
      const createData: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'lifecycle-test',
        requirementOperator: '<',
        requirementValue: 500,
      };

      const createdBenchmark: ProfileBenchmark = {
        id: 'lifecycle-benchmark',
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'lifecycle-test',
        source: 'grafana',
        requirementOperator: '<',
        requirementValue: 500,
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      const updatedBenchmark: ProfileBenchmark = {
        ...createdBenchmark,
        requirementValue: 600,
        updatedAt: '2025-01-11T01:00:00Z',
      };

      // Mock create
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createdBenchmark,
      } as Response);

      // Mock update
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updatedBenchmark,
      } as Response);

      // Mock delete
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      // Act
      const created = await createProfileBenchmark(profileId, createData);
      const updated = await updateProfileBenchmark(profileId, created.id, {
        requirementValue: 600,
      });
      await deleteProfileBenchmark(profileId, created.id);

      // Assert
      expect(created.id).toBe('lifecycle-benchmark');
      expect(created.requirementValue).toBe(500);
      expect(updated.requirementValue).toBe(600);
      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(3);
    });

    it('should handle fetching multiple benchmarks after creation', async () => {
      // Arrange
      const profileId = 'profile-multi';
      const createData1: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'pattern-1',
      };
      const createData2: CreateProfileBenchmarkData = {
        profileDashboardId: 'dashboard-2',
        workloadPattern: 'pattern-2',
      };

      const benchmark1: ProfileBenchmark = {
        id: 'benchmark-1',
        profileId: profileId,
        profileDashboardId: 'dashboard-1',
        workloadPattern: 'pattern-1',
        source: 'grafana',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      const benchmark2: ProfileBenchmark = {
        id: 'benchmark-2',
        profileId: profileId,
        profileDashboardId: 'dashboard-2',
        workloadPattern: 'pattern-2',
        source: 'grafana',
        excludeRampUpTime: false,
        averageAll: false,
        validateWithDefaultIfNoData: false,
        tags: [],
        metadata: {},
        createdAt: '2025-01-11T00:01:00Z',
        updatedAt: '2025-01-11T00:01:00Z',
      };

      // Mock create benchmark 1
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => benchmark1,
      } as Response);

      // Mock create benchmark 2
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => benchmark2,
      } as Response);

      // Mock fetch all benchmarks
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [benchmark1, benchmark2],
      } as Response);

      // Act
      await createProfileBenchmark(profileId, createData1);
      await createProfileBenchmark(profileId, createData2);
      const allBenchmarks = await fetchProfileBenchmarks(profileId);

      // Assert
      expect(allBenchmarks).toHaveLength(2);
      expect(allBenchmarks[0].workloadPattern).toBe('pattern-1');
      expect(allBenchmarks[1].workloadPattern).toBe('pattern-2');
    });
  });
});
