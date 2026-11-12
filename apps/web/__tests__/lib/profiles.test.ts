/**
 * Unit tests for Profiles API Client
 *
 * Tests profile management functions including:
 * - fetchProfiles: Get all profiles
 * - fetchProfile: Get single profile by ID
 * - fetchProfileDashboards: Get dashboards for a profile
 * - createProfileDashboard: Add dashboard to profile
 * - updateProfileDashboard: Update profile dashboard configuration
 * - deleteProfileDashboard: Remove dashboard from profile
 * - createProfile / updateProfile: Create and edit a profile
 */

import {
  fetchProfiles,
  fetchProfile,
  fetchProfileDashboards,
  createProfileDashboard,
  updateProfileDashboard,
  deleteProfileDashboard,
  createProfile,
  updateProfile,
  type Profile,
  type ProfileDashboard,
  type CreateProfileDashboardData,
  type UpdateProfileDashboardData,
} from '@/lib/profiles';
import * as api from '@/lib/api';

// Mock authenticatedFetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockAuthenticatedFetch = api.authenticatedFetch as jest.MockedFunction<
  typeof api.authenticatedFetch
>;

describe('Profiles API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchProfiles()', () => {
    it('should fetch all profiles successfully', async () => {
      // Arrange
      const mockProfiles: Profile[] = [
        {
          id: 'profile-1',
          name: 'Load Test Profile',
          description: 'Profile for load testing',
          tags: ['load-test', 'performance'],
          readOnly: false,
          dashboardCount: 5,
          sloCount: 10,
          deepLinksCount: 2,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        },
        {
          id: 'profile-2',
          name: 'Monitoring Profile',
          dashboardCount: 3,
          sloCount: 8,
          deepLinksCount: 1,
          createdAt: '2025-01-05T00:00:00Z',
          updatedAt: '2025-01-05T00:00:00Z',
        },
      ];

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockProfiles,
      } as Response);

      // Act
      const result = await fetchProfiles();

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/profiles', {
        cache: 'no-store',
      });
      expect(result).toEqual(mockProfiles);
      expect(result).toHaveLength(2);
    });

    it('should throw error when fetch fails', async () => {
      // Arrange
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      // Act & Assert
      await expect(fetchProfiles()).rejects.toThrow('Failed to fetch profiles');
    });
  });

  describe('fetchProfile()', () => {
    it('should fetch single profile by ID', async () => {
      // Arrange
      const profileId = 'profile-123';
      const mockProfile: Profile = {
        id: profileId,
        name: 'Test Profile',
        description: 'A test profile',
        tags: ['test'],
        dashboardCount: 2,
        sloCount: 5,
        deepLinksCount: 0,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockProfile,
      } as Response);

      // Act
      const result = await fetchProfile(profileId);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/profiles/${profileId}`, {
        cache: 'no-store',
      });
      expect(result).toEqual(mockProfile);
    });

    it('should throw error with message when profile not found', async () => {
      // Arrange
      const profileId = 'non-existent';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Profile not found' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfile(profileId)).rejects.toThrow('Profile not found');
    });

    it('should throw generic error when no error message provided', async () => {
      // Arrange
      const profileId = 'some-id';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      // Act & Assert
      await expect(fetchProfile(profileId)).rejects.toThrow('Failed to fetch profile');
    });
  });

  describe('fetchProfileDashboards()', () => {
    it('should fetch all dashboards for a profile', async () => {
      // Arrange
      const profileId = 'profile-123';
      const mockDashboards: ProfileDashboard[] = [
        {
          id: 'dashboard-1',
          profile: profileId,
          dashboardName: 'System Under Test',
          dashboardUid: 'sut-uid',
          grafanaLabel: 'production-grafana',
          tags: ['infrastructure'],
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        {
          id: 'dashboard-2',
          profile: profileId,
          dashboardName: 'JVM Memory',
          dashboardUid: 'jvm-uid',
          grafanaLabel: 'production-grafana',
          setHardcodedValueForVariables: [
            { name: 'application', values: ['my-app'] },
          ],
          createdAt: '2025-01-02T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
        },
      ];

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockDashboards,
      } as Response);

      // Act
      const result = await fetchProfileDashboards(profileId);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/profiles/${profileId}/dashboards`,
        { cache: 'no-store' }
      );
      expect(result).toEqual(mockDashboards);
      expect(result).toHaveLength(2);
    });

    it('should throw error when fetch fails', async () => {
      // Arrange
      const profileId = 'profile-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Database error' }),
      } as Response);

      // Act & Assert
      await expect(fetchProfileDashboards(profileId)).rejects.toThrow('Database error');
    });
  });

  describe('createProfile()', () => {
    const created: Profile = {
      id: 'profile-new',
      name: 'jvm',
      dashboardCount: 0,
      sloCount: 0,
      deepLinksCount: 0,
      createdAt: '2025-01-11T00:00:00Z',
      updatedAt: '2025-01-11T00:00:00Z',
    };

    // The organization decides which runs the profile's ADAPT templates reach, so it must reach the API.
    it('sends the organization it is given in the request body', async () => {
      mockAuthenticatedFetch.mockResolvedValue({ ok: true, json: async () => created } as Response);

      await createProfile({ name: 'jvm', organizationId: 'org-uuid-1' });

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/profiles', expect.objectContaining({ method: 'POST' }));
      const body = JSON.parse(mockAuthenticatedFetch.mock.calls[0]![1]!.body as string);
      expect(body).toEqual({ name: 'jvm', organizationId: 'org-uuid-1' });
    });

    it('omits organizationId when none is given, leaving the pick to the API', async () => {
      mockAuthenticatedFetch.mockResolvedValue({ ok: true, json: async () => created } as Response);

      await createProfile({ name: 'jvm', organizationId: undefined });

      const body = JSON.parse(mockAuthenticatedFetch.mock.calls[0]![1]!.body as string);
      expect(body).not.toHaveProperty('organizationId');
    });
  });

  describe('updateProfile()', () => {
    const saved: Profile = {
      id: 'p-1',
      name: 'checkout',
      dashboardCount: 0,
      sloCount: 0,
      deepLinksCount: 0,
      createdAt: '2025-01-11T00:00:00Z',
      updatedAt: '2025-01-11T00:00:00Z',
    };

    it('PUTs the complete payload to the profile', async () => {
      mockAuthenticatedFetch.mockResolvedValue({ ok: true, json: async () => saved } as Response);

      await updateProfile('p-1', {
        name: 'checkout',
        description: '',
        tags: ['frontend', 'perfana'],
      });

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        '/profiles/p-1',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      const body = JSON.parse(mockAuthenticatedFetch.mock.calls[0]![1]!.body as string);
      // The empty description has to survive serialization: it is how clearing the field persists.
      expect(body).toEqual({ name: 'checkout', description: '', tags: ['frontend', 'perfana'] });
    });

    // The reason the dialog can name a cause: 400 read-only, 400 duplicate name, 403, 404 all
    // carry `message`, and it is shown verbatim.
    it('rethrows the API message on a rejection', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Cannot update a read-only profile' }),
      } as Response);

      await expect(updateProfile('p-1', { name: 'x' })).rejects.toThrow(
        'Cannot update a read-only profile'
      );
    });

    // A 502 from a proxy answers HTML, not JSON. `createProfile` beside this throws the parse
    // error; this path deliberately falls back to a sentence a user can read.
    it('falls back to a generic message when the error body is not JSON', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
      } as unknown as Response);

      await expect(updateProfile('p-1', { name: 'x' })).rejects.toThrow('Failed to update profile');
    });
  });

  describe('createProfileDashboard()', () => {
    it('should create dashboard association with minimal data', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileDashboardData = {
        dashboardUid: 'gatling-uid',
        grafanaLabel: 'test-grafana',
      };

      const mockResponse: ProfileDashboard = {
        id: 'new-dashboard-123',
        profile: profileId,
        dashboardName: 'Gatling Overview',
        dashboardUid: 'gatling-uid',
        grafanaLabel: 'test-grafana',
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileDashboard(profileId, createData);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/profiles/${profileId}/dashboards`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createData),
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create dashboard with hardcoded variables', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileDashboardData = {
        dashboardUid: 'jvm-uid',
        grafanaLabel: 'prod-grafana',
        setHardcodedValueForVariables: [
          { name: 'application', values: ['my-service'] },
          { name: 'environment', values: ['production'] },
        ],
      };

      const mockResponse: ProfileDashboard = {
        id: 'dashboard-with-vars',
        profile: profileId,
        dashboardName: 'JVM Memory',
        dashboardUid: 'jvm-uid',
        grafanaLabel: 'prod-grafana',
        setHardcodedValueForVariables: createData.setHardcodedValueForVariables,
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileDashboard(profileId, createData);

      // Assert
      expect(result.setHardcodedValueForVariables).toEqual(
        createData.setHardcodedValueForVariables
      );
    });

    it('should create dashboard with regex matching', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileDashboardData = {
        dashboardUid: 'k8s-uid',
        grafanaLabel: 'k8s-grafana',
        matchRegexForVariables: {
          namespace: '^prod-.*',
          pod: '.*-backend-.*',
        },
      };

      const mockResponse: ProfileDashboard = {
        id: 'dashboard-with-regex',
        profile: profileId,
        dashboardName: 'Kubernetes Pod',
        dashboardUid: 'k8s-uid',
        grafanaLabel: 'k8s-grafana',
        matchRegexForVariables: createData.matchRegexForVariables,
        createdAt: '2025-01-11T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createProfileDashboard(profileId, createData);

      // Assert
      expect(result.matchRegexForVariables).toEqual(createData.matchRegexForVariables);
    });

    it('should throw error when creation fails', async () => {
      // Arrange
      const profileId = 'profile-123';
      const createData: CreateProfileDashboardData = {
        dashboardUid: 'invalid-uid',
        grafanaLabel: 'test-grafana',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Dashboard not found in Grafana' }),
      } as Response);

      // Act & Assert
      await expect(createProfileDashboard(profileId, createData)).rejects.toThrow(
        'Dashboard not found in Grafana'
      );
    });
  });

  describe('updateProfileDashboard()', () => {
    it('should update dashboard configuration', async () => {
      // Arrange
      const profileId = 'profile-123';
      const dashboardId = 'dashboard-456';
      const updateData: UpdateProfileDashboardData = {
        setHardcodedValueForVariables: [
          { name: 'application', values: ['updated-app'] },
        ],
      };

      const mockResponse: ProfileDashboard = {
        id: dashboardId,
        profile: profileId,
        dashboardName: 'Updated Dashboard',
        dashboardUid: 'some-uid',
        grafanaLabel: 'prod-grafana',
        setHardcodedValueForVariables: updateData.setHardcodedValueForVariables,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await updateProfileDashboard(profileId, dashboardId, updateData);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/profiles/${profileId}/dashboards/${dashboardId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('should update multiple fields at once', async () => {
      // Arrange
      const profileId = 'profile-123';
      const dashboardId = 'dashboard-456';
      const updateData: UpdateProfileDashboardData = {
        dashboardUid: 'new-uid',
        grafanaLabel: 'new-grafana',
        readOnly: true,
        matchRegexForVariables: {
          workload: '^load-test-.*',
        },
      };

      const mockResponse: ProfileDashboard = {
        id: dashboardId,
        profile: profileId,
        dashboardName: 'Dashboard',
        ...updateData,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-11T00:00:00Z',
      } as ProfileDashboard;

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await updateProfileDashboard(profileId, dashboardId, updateData);

      // Assert
      expect(result.readOnly).toBe(true);
      expect(result.matchRegexForVariables).toEqual(updateData.matchRegexForVariables);
    });

    it('should throw error when update fails', async () => {
      // Arrange
      const profileId = 'profile-123';
      const dashboardId = 'non-existent';
      const updateData: UpdateProfileDashboardData = {
        dashboardUid: 'new-uid',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Profile dashboard not found' }),
      } as Response);

      // Act & Assert
      await expect(
        updateProfileDashboard(profileId, dashboardId, updateData)
      ).rejects.toThrow('Profile dashboard not found');
    });
  });

  describe('deleteProfileDashboard()', () => {
    it('should delete dashboard association', async () => {
      // Arrange
      const profileId = 'profile-123';
      const dashboardId = 'dashboard-to-delete';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      // Act
      await deleteProfileDashboard(profileId, dashboardId);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/profiles/${profileId}/dashboards/${dashboardId}`,
        { method: 'DELETE' }
      );
    });

    it('should throw error when deletion fails', async () => {
      // Arrange
      const profileId = 'profile-123';
      const dashboardId = 'non-existent';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Dashboard not found' }),
      } as Response);

      // Act & Assert
      await expect(deleteProfileDashboard(profileId, dashboardId)).rejects.toThrow(
        'Dashboard not found'
      );
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle network errors gracefully', async () => {
      // Arrange
      mockAuthenticatedFetch.mockRejectedValue(new Error('Network timeout'));

      // Act & Assert
      await expect(fetchProfiles()).rejects.toThrow('Network timeout');
    });

    it('should handle malformed JSON responses', async () => {
      // Arrange
      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Response);

      // Act & Assert
      await expect(fetchProfiles()).rejects.toThrow('Invalid JSON');
    });

    it('should handle empty profile lists', async () => {
      // Arrange
      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      // Act
      const result = await fetchProfiles();

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle profiles with minimal fields', async () => {
      // Arrange
      const minimalProfile: Profile = {
        id: 'minimal-profile',
        name: 'Minimal',
        dashboardCount: 0,
        sloCount: 0,
        deepLinksCount: 0,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => minimalProfile,
      } as Response);

      // Act
      const result = await fetchProfile('minimal-profile');

      // Assert
      expect(result).toEqual(minimalProfile);
      expect(result.description).toBeUndefined();
      expect(result.tags).toBeUndefined();
    });
  });
});
