/**
 * Unit tests for Grafana Instances API Client
 *
 * Tests the Grafana instance management functions:
 * - fetchGrafanaInstances: Retrieve all Grafana instances with optional filtering
 * - fetchGrafanaInstance: Retrieve a single Grafana instance by ID
 * - createGrafanaInstance: Create a new Grafana instance
 * - updateGrafanaInstance: Update an existing Grafana instance
 * - deleteGrafanaInstance: Delete a Grafana instance by ID
 * - testGrafanaConnection: Test connection to a Grafana instance
 *
 * Testing Standards:
 * - AAA pattern (Arrange, Act, Assert)
 * - Mock authenticatedFetch for all API calls
 * - Test happy paths, error cases, edge cases
 * - Test authentication header inclusion
 * - Test error message handling
 * - Aim for 95%+ coverage
 */

import {
  fetchGrafanaInstances,
  fetchGrafanaInstance,
  createGrafanaInstance,
  updateGrafanaInstance,
  deleteGrafanaInstance,
  testGrafanaConnection,
  type GrafanaInstance,
  type CreateGrafanaInstanceDto,
  type UpdateGrafanaInstanceDto,
  type GrafanaInstanceQuery,
} from '@/lib/grafana-instances';
import * as api from '@/lib/api';

// Mock authenticatedFetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockAuthenticatedFetch = api.authenticatedFetch as jest.MockedFunction<
  typeof api.authenticatedFetch
>;

describe('Grafana Instances API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchGrafanaInstances()', () => {
    describe('Happy Path Scenarios', () => {
      it('should fetch all Grafana instances without query parameters', async () => {
        // Arrange
        const mockInstances: GrafanaInstance[] = [
          {
            id: 'instance-1',
            label: 'Production Grafana',
            clientUrl: 'https://grafana.prod.example.com',
            serverUrl: 'https://grafana-internal.prod.example.com',
            orgId: '1',
            apiKey: 'masked-api-key',
            snapshotInstance: false,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'instance-2',
            label: 'Staging Grafana',
            clientUrl: 'https://grafana.staging.example.com',
            orgId: '1',
            username: 'admin',
            password: 'masked-password',
            snapshotInstance: true,
            createdAt: '2025-01-02T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockInstances,
        } as Response);

        // Act
        const result = await fetchGrafanaInstances();

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/grafana-instances', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        expect(result).toEqual(mockInstances);
        expect(result).toHaveLength(2);
      });

      it('should fetch Grafana instances filtered by label', async () => {
        // Arrange
        const query: GrafanaInstanceQuery = { label: 'Production' };
        const mockInstances: GrafanaInstance[] = [
          {
            id: 'instance-1',
            label: 'Production Grafana',
            clientUrl: 'https://grafana.prod.example.com',
            orgId: '1',
            snapshotInstance: false,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockInstances,
        } as Response);

        // Act
        const result = await fetchGrafanaInstances(query);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/grafana-instances?label=Production',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result).toHaveLength(1);
        expect(result[0].label).toBe('Production Grafana');
      });

      it('should fetch Grafana instances filtered by snapshotInstance=true', async () => {
        // Arrange
        const query: GrafanaInstanceQuery = { snapshotInstance: true };
        const mockInstances: GrafanaInstance[] = [
          {
            id: 'instance-2',
            label: 'Snapshot Instance',
            clientUrl: 'https://grafana-snapshot.example.com',
            orgId: '1',
            snapshotInstance: true,
            createdAt: '2025-01-02T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockInstances,
        } as Response);

        // Act
        const result = await fetchGrafanaInstances(query);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/grafana-instances?snapshotInstance=true',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result[0].snapshotInstance).toBe(true);
      });

      it('should fetch Grafana instances filtered by snapshotInstance=false', async () => {
        // Arrange
        const query: GrafanaInstanceQuery = { snapshotInstance: false };
        const mockInstances: GrafanaInstance[] = [];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockInstances,
        } as Response);

        // Act
        const result = await fetchGrafanaInstances(query);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/grafana-instances?snapshotInstance=false',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result).toEqual([]);
      });

      it('should fetch Grafana instances with both label and snapshotInstance filters', async () => {
        // Arrange
        const query: GrafanaInstanceQuery = { label: 'Test', snapshotInstance: true };
        const mockInstances: GrafanaInstance[] = [
          {
            id: 'instance-3',
            label: 'Test Grafana',
            clientUrl: 'https://grafana.test.example.com',
            orgId: '1',
            snapshotInstance: true,
            createdAt: '2025-01-03T00:00:00Z',
            updatedAt: '2025-01-03T00:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockInstances,
        } as Response);

        // Act
        const result = await fetchGrafanaInstances(query);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/grafana-instances?label=Test&snapshotInstance=true',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result).toHaveLength(1);
      });

      it('should return empty array when no instances exist', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => [],
        } as Response);

        // Act
        const result = await fetchGrafanaInstances();

        // Assert
        expect(result).toEqual([]);
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when fetch fails', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          statusText: 'Internal Server Error',
        } as Response);

        // Act & Assert
        await expect(fetchGrafanaInstances()).rejects.toThrow(
          'Failed to fetch Grafana instances: Internal Server Error'
        );
      });

      it('should handle network errors', async () => {
        // Arrange
        mockAuthenticatedFetch.mockRejectedValue(new Error('Network error'));

        // Act & Assert
        await expect(fetchGrafanaInstances()).rejects.toThrow('Network error');
      });
    });
  });

  describe('fetchGrafanaInstance()', () => {
    describe('Happy Path Scenarios', () => {
      it('should fetch a single Grafana instance by ID', async () => {
        // Arrange
        const instanceId = 'instance-123';
        const mockInstance: GrafanaInstance = {
          id: instanceId,
          label: 'My Grafana',
          clientUrl: 'https://grafana.example.com',
          serverUrl: 'https://grafana-internal.example.com',
          orgId: '2',
          apiKey: 'api-key-value',
          snapshotInstance: false,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-15T10:30:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockInstance,
        } as Response);

        // Act
        const result = await fetchGrafanaInstance(instanceId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/grafana-instances/${instanceId}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
        expect(result).toEqual(mockInstance);
        expect(result.id).toBe(instanceId);
      });

      it('should fetch instance with username/password authentication', async () => {
        // Arrange
        const instanceId = 'instance-456';
        const mockInstance: GrafanaInstance = {
          id: instanceId,
          label: 'Basic Auth Grafana',
          clientUrl: 'https://grafana.example.com',
          orgId: '1',
          username: 'admin',
          password: 'hashed-password',
          snapshotInstance: false,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockInstance,
        } as Response);

        // Act
        const result = await fetchGrafanaInstance(instanceId);

        // Assert
        expect(result.username).toBe('admin');
        expect(result.apiKey).toBeUndefined();
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when instance not found', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          statusText: 'Not Found',
        } as Response);

        // Act & Assert
        await expect(fetchGrafanaInstance('non-existent')).rejects.toThrow(
          'Failed to fetch Grafana instance: Not Found'
        );
      });

      it('should handle unauthorized errors', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          statusText: 'Unauthorized',
        } as Response);

        // Act & Assert
        await expect(fetchGrafanaInstance('instance-1')).rejects.toThrow(
          'Failed to fetch Grafana instance: Unauthorized'
        );
      });
    });
  });

  describe('createGrafanaInstance()', () => {
    describe('Happy Path Scenarios', () => {
      it('should create Grafana instance with API key authentication', async () => {
        // Arrange
        const createData: CreateGrafanaInstanceDto = {
          label: 'New Grafana',
          clientUrl: 'https://grafana.new.example.com',
          serverUrl: 'https://grafana-internal.new.example.com',
          orgId: '1',
          apiKey: 'new-api-key-123',
          snapshotInstance: false,
        };

        const mockCreatedInstance: GrafanaInstance = {
          id: 'new-instance-id',
          ...createData,
          createdAt: '2025-01-15T12:00:00Z',
          updatedAt: '2025-01-15T12:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedInstance,
        } as Response);

        // Act
        const result = await createGrafanaInstance(createData);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/grafana-instances', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createData),
        });
        expect(result).toEqual(mockCreatedInstance);
        expect(result.id).toBe('new-instance-id');
      });

      it('should create Grafana instance with username/password authentication', async () => {
        // Arrange
        const createData: CreateGrafanaInstanceDto = {
          label: 'Basic Auth Grafana',
          clientUrl: 'https://grafana.basic.example.com',
          orgId: '2',
          username: 'admin',
          password: 'secure-password',
          snapshotInstance: false,
        };

        const mockCreatedInstance: GrafanaInstance = {
          id: 'basic-instance-id',
          ...createData,
          createdAt: '2025-01-15T12:00:00Z',
          updatedAt: '2025-01-15T12:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedInstance,
        } as Response);

        // Act
        const result = await createGrafanaInstance(createData);

        // Assert
        expect(result.username).toBe('admin');
        expect(result.apiKey).toBeUndefined();
      });

      it('should create snapshot Grafana instance', async () => {
        // Arrange
        const createData: CreateGrafanaInstanceDto = {
          label: 'Snapshot Grafana',
          clientUrl: 'https://grafana.snapshot.example.com',
          orgId: '1',
          apiKey: 'snapshot-api-key',
          snapshotInstance: true,
        };

        const mockCreatedInstance: GrafanaInstance = {
          id: 'snapshot-instance-id',
          ...createData,
          createdAt: '2025-01-15T12:00:00Z',
          updatedAt: '2025-01-15T12:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedInstance,
        } as Response);

        // Act
        const result = await createGrafanaInstance(createData);

        // Assert
        expect(result.snapshotInstance).toBe(true);
      });

      it('should create instance without optional fields', async () => {
        // Arrange
        const createData: CreateGrafanaInstanceDto = {
          label: 'Minimal Grafana',
          clientUrl: 'https://grafana.minimal.example.com',
          orgId: '1',
        };

        const mockCreatedInstance: GrafanaInstance = {
          id: 'minimal-instance-id',
          ...createData,
          snapshotInstance: false,
          createdAt: '2025-01-15T12:00:00Z',
          updatedAt: '2025-01-15T12:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedInstance,
        } as Response);

        // Act
        const result = await createGrafanaInstance(createData);

        // Assert
        expect(result.serverUrl).toBeUndefined();
        expect(result.apiKey).toBeUndefined();
        expect(result.username).toBeUndefined();
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error with message when creation fails', async () => {
        // Arrange
        const createData: CreateGrafanaInstanceDto = {
          label: 'Invalid Instance',
          clientUrl: 'invalid-url',
          orgId: '1',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({ message: 'Invalid client URL format' }),
        } as Response);

        // Act & Assert
        await expect(createGrafanaInstance(createData)).rejects.toThrow(
          'Invalid client URL format'
        );
      });

      it('should throw generic error when error response has no message', async () => {
        // Arrange
        const createData: CreateGrafanaInstanceDto = {
          label: 'Test Instance',
          clientUrl: 'https://grafana.test.example.com',
          orgId: '1',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({}),
        } as Response);

        // Act & Assert
        await expect(createGrafanaInstance(createData)).rejects.toThrow(
          'Failed to create Grafana instance: Internal Server Error'
        );
      });

      it('should handle duplicate label errors', async () => {
        // Arrange
        const createData: CreateGrafanaInstanceDto = {
          label: 'Existing Label',
          clientUrl: 'https://grafana.example.com',
          orgId: '1',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          json: async () => ({ message: 'Grafana instance with this label already exists' }),
        } as Response);

        // Act & Assert
        await expect(createGrafanaInstance(createData)).rejects.toThrow(
          'Grafana instance with this label already exists'
        );
      });
    });
  });

  describe('updateGrafanaInstance()', () => {
    describe('Happy Path Scenarios', () => {
      it('should update Grafana instance label', async () => {
        // Arrange
        const instanceId = 'instance-123';
        const updateData: UpdateGrafanaInstanceDto = {
          label: 'Updated Label',
        };

        const mockUpdatedInstance: GrafanaInstance = {
          id: instanceId,
          label: 'Updated Label',
          clientUrl: 'https://grafana.example.com',
          orgId: '1',
          snapshotInstance: false,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-15T14:30:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockUpdatedInstance,
        } as Response);

        // Act
        const result = await updateGrafanaInstance(instanceId, updateData);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/grafana-instances/${instanceId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          }
        );
        expect(result.label).toBe('Updated Label');
        expect(result.updatedAt).toBe('2025-01-15T14:30:00Z');
      });

      it('should update multiple fields', async () => {
        // Arrange
        const instanceId = 'instance-456';
        const updateData: UpdateGrafanaInstanceDto = {
          label: 'Updated Instance',
          clientUrl: 'https://grafana-new.example.com',
          serverUrl: 'https://grafana-internal-new.example.com',
          apiKey: 'new-api-key',
        };

        const mockUpdatedInstance: GrafanaInstance = {
          id: instanceId,
          ...updateData,
          orgId: '1',
          snapshotInstance: false,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-15T14:30:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockUpdatedInstance,
        } as Response);

        // Act
        const result = await updateGrafanaInstance(instanceId, updateData);

        // Assert
        expect(result.clientUrl).toBe('https://grafana-new.example.com');
        expect(result.apiKey).toBe('new-api-key');
      });

      it('should update snapshotInstance flag', async () => {
        // Arrange
        const instanceId = 'instance-789';
        const updateData: UpdateGrafanaInstanceDto = {
          snapshotInstance: true,
        };

        const mockUpdatedInstance: GrafanaInstance = {
          id: instanceId,
          label: 'Test Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '1',
          snapshotInstance: true,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-15T14:30:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockUpdatedInstance,
        } as Response);

        // Act
        const result = await updateGrafanaInstance(instanceId, updateData);

        // Assert
        expect(result.snapshotInstance).toBe(true);
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error with message when update fails', async () => {
        // Arrange
        const instanceId = 'instance-123';
        const updateData: UpdateGrafanaInstanceDto = {
          clientUrl: 'invalid-url',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({ message: 'Invalid URL format' }),
        } as Response);

        // Act & Assert
        await expect(updateGrafanaInstance(instanceId, updateData)).rejects.toThrow(
          'Invalid URL format'
        );
      });

      it('should throw generic error when error response has no message', async () => {
        // Arrange
        const instanceId = 'instance-456';
        const updateData: UpdateGrafanaInstanceDto = { label: 'Test' };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({}),
        } as Response);

        // Act & Assert
        await expect(updateGrafanaInstance(instanceId, updateData)).rejects.toThrow(
          'Failed to update Grafana instance: Internal Server Error'
        );
      });

      it('should handle instance not found errors', async () => {
        // Arrange
        const instanceId = 'non-existent';
        const updateData: UpdateGrafanaInstanceDto = { label: 'Test' };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ message: 'Grafana instance not found' }),
        } as Response);

        // Act & Assert
        await expect(updateGrafanaInstance(instanceId, updateData)).rejects.toThrow(
          'Grafana instance not found'
        );
      });
    });
  });

  describe('deleteGrafanaInstance()', () => {
    describe('Happy Path Scenarios', () => {
      it('should delete Grafana instance successfully', async () => {
        // Arrange
        const instanceId = 'instance-to-delete';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => ({}),
        } as Response);

        // Act
        await deleteGrafanaInstance(instanceId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/grafana-instances/${instanceId}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error with message when deletion fails', async () => {
        // Arrange
        const instanceId = 'instance-123';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          json: async () => ({ message: 'Cannot delete instance with active dashboards' }),
        } as Response);

        // Act & Assert
        await expect(deleteGrafanaInstance(instanceId)).rejects.toThrow(
          'Cannot delete instance with active dashboards'
        );
      });

      it('should throw generic error when error response has no message', async () => {
        // Arrange
        const instanceId = 'instance-456';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({}),
        } as Response);

        // Act & Assert
        await expect(deleteGrafanaInstance(instanceId)).rejects.toThrow(
          'Failed to delete Grafana instance: Internal Server Error'
        );
      });

      it('should handle instance not found errors', async () => {
        // Arrange
        const instanceId = 'non-existent';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ message: 'Grafana instance not found' }),
        } as Response);

        // Act & Assert
        await expect(deleteGrafanaInstance(instanceId)).rejects.toThrow(
          'Grafana instance not found'
        );
      });

      it('should handle network errors during deletion', async () => {
        // Arrange
        const instanceId = 'instance-789';
        mockAuthenticatedFetch.mockRejectedValue(new Error('Network timeout'));

        // Act & Assert
        await expect(deleteGrafanaInstance(instanceId)).rejects.toThrow('Network timeout');
      });
    });
  });

  describe('testGrafanaConnection()', () => {
    describe('Happy Path Scenarios', () => {
      it('should successfully test Grafana connection', async () => {
        // Arrange
        const instanceId = 'instance-123';
        const mockResponse = {
          success: true,
          message: 'Connection successful',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await testGrafanaConnection(instanceId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/grafana-instances/${instanceId}/test-connection`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
        expect(result.success).toBe(true);
        expect(result.message).toBe('Connection successful');
      });

      it('should return failed connection test result', async () => {
        // Arrange
        const instanceId = 'instance-456';
        const mockResponse = {
          success: false,
          message: 'Connection refused',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await testGrafanaConnection(instanceId);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toBe('Connection refused');
      });

      it('should return authentication failure message', async () => {
        // Arrange
        const instanceId = 'instance-789';
        const mockResponse = {
          success: false,
          message: 'Invalid API key or credentials',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await testGrafanaConnection(instanceId);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid API key or credentials');
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error with message when connection test fails', async () => {
        // Arrange
        const instanceId = 'instance-123';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ message: 'Grafana instance not found' }),
        } as Response);

        // Act & Assert
        await expect(testGrafanaConnection(instanceId)).rejects.toThrow(
          'Grafana instance not found'
        );
      });

      it('should throw generic error when error response has no message', async () => {
        // Arrange
        const instanceId = 'instance-456';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({}),
        } as Response);

        // Act & Assert
        await expect(testGrafanaConnection(instanceId)).rejects.toThrow(
          'Failed to test Grafana connection: Internal Server Error'
        );
      });

      it('should handle network errors', async () => {
        // Arrange
        const instanceId = 'instance-789';
        mockAuthenticatedFetch.mockRejectedValue(new Error('Network unreachable'));

        // Act & Assert
        await expect(testGrafanaConnection(instanceId)).rejects.toThrow('Network unreachable');
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete lifecycle: create -> fetch -> update -> test -> delete', async () => {
      // Arrange
      const createData: CreateGrafanaInstanceDto = {
        label: 'Lifecycle Test Instance',
        clientUrl: 'https://grafana.lifecycle.example.com',
        orgId: '1',
        apiKey: 'test-api-key',
        snapshotInstance: false,
      };

      const createdInstance: GrafanaInstance = {
        id: 'lifecycle-instance-id',
        ...createData,
        createdAt: '2025-01-15T15:00:00Z',
        updatedAt: '2025-01-15T15:00:00Z',
      };

      // Mock create
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createdInstance,
      } as Response);

      // Mock fetch
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createdInstance,
      } as Response);

      // Mock update
      const updatedInstance = { ...createdInstance, label: 'Updated Label' };
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updatedInstance,
      } as Response);

      // Mock test connection
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Connection OK' }),
      } as Response);

      // Mock delete
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      // Act
      const created = await createGrafanaInstance(createData);
      const fetched = await fetchGrafanaInstance(created.id);
      const updated = await updateGrafanaInstance(created.id, { label: 'Updated Label' });
      const testResult = await testGrafanaConnection(created.id);
      await deleteGrafanaInstance(created.id);

      // Assert
      expect(created.id).toBe('lifecycle-instance-id');
      expect(fetched.id).toBe(created.id);
      expect(updated.label).toBe('Updated Label');
      expect(testResult.success).toBe(true);
      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(5);
    });
  });
});
