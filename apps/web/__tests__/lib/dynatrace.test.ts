/**
 * Unit tests for Dynatrace API Client
 *
 * Tests comprehensive Dynatrace integration functionality:
 * - Configuration management (CRUD operations)
 * - Connection testing
 * - Request attributes fetching
 * - Query management (CRUD operations)
 * - Dashboard and metrics fetching for SLO support
 * - Error handling and edge cases
 */

import {
  fetchDynatraceConfigs,
  createDynatraceConfig,
  testDynatraceConnection,
  updateDynatraceConfig,
  fetchRequestAttributesForHost,
  deleteDynatraceConfig,
  fetchDynatraceQueries,
  fetchDynatraceQueryById,
  createDynatraceQuery,
  updateDynatraceQuery,
  deleteDynatraceQuery,
  fetchDynatraceDashboards,
  fetchDynatraceMetrics,
  type DynatraceConfig,
  type CreateDynatraceConfigDto,
  type TestConnectionResponse,
  type UpdateDynatraceConfigDto,
  type RequestAttributesResponse,
  type DynatraceQuery,
  type CreateDynatraceQueryDto,
  type UpdateDynatraceQueryDto,
  type DynatraceDashboard,
  type DynatraceMetric,
} from '@/lib/dynatrace';

// Mock the API module
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';

const mockAuthenticatedFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

describe('Dynatrace API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to create mock Response objects
  const createMockResponse = (data: any, ok: boolean = true, status: number = 200): Response => {
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => data,
    } as Response;
  };

  const createMockErrorResponse = (status: number, message?: string): Response => {
    return {
      ok: false,
      status,
      statusText: 'Error',
      json: async () => (message ? { message } : {}),
    } as Response;
  };

  describe('Dynatrace Configuration Management', () => {
    describe('fetchDynatraceConfigs()', () => {
      it('should fetch all Dynatrace configurations successfully', async () => {
        // Arrange
        const mockConfigs: DynatraceConfig[] = [
          {
            id: 'config-1',
            host: 'https://tenant1.live.dynatrace.com',
            apiToken: 'dt0c01.abc123',
            dynatraceType: 'saas',
            label: 'Production',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'config-2',
            host: 'https://managed.company.com/e/environment-id',
            apiToken: 'dt0c01.xyz789',
            dynatraceType: 'managed',
            label: 'Staging',
            perfanaTestRunIdAttribute: 'test-run-id',
            perfanaRequestNameAttribute: 'request-name',
            createdAt: '2025-01-02T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockConfigs));

        // Act
        const result = await fetchDynatraceConfigs();

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/dynatrace', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        expect(result).toEqual(mockConfigs);
        expect(result).toHaveLength(2);
      });

      it('should return empty array when no configurations exist', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue(createMockResponse([]));

        // Act
        const result = await fetchDynatraceConfigs();

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });

      it('should throw error when API request fails with 500', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(500));

        // Act & Assert
        await expect(fetchDynatraceConfigs()).rejects.toThrow('Failed to fetch Dynatrace configurations');
      });

      it('should throw error when API request fails with 401', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(401));

        // Act & Assert
        await expect(fetchDynatraceConfigs()).rejects.toThrow('Failed to fetch Dynatrace configurations');
      });

      it('should throw error when API request fails with 403', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(403));

        // Act & Assert
        await expect(fetchDynatraceConfigs()).rejects.toThrow('Failed to fetch Dynatrace configurations');
      });
    });

    describe('createDynatraceConfig()', () => {
      it('should create a new Dynatrace configuration successfully', async () => {
        // Arrange
        const createDto: CreateDynatraceConfigDto = {
          host: 'https://tenant1.live.dynatrace.com',
          apiToken: 'dt0c01.abc123',
          dynatraceType: 'saas',
        };

        const mockCreatedConfig: DynatraceConfig = {
          id: 'new-config-id',
          ...createDto,
          label: 'New Configuration',
          createdAt: '2025-01-10T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockCreatedConfig, true, 201));

        // Act
        const result = await createDynatraceConfig(createDto);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/dynatrace', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createDto),
        });
        expect(result).toEqual(mockCreatedConfig);
        expect(result.id).toBe('new-config-id');
      });

      it('should create configuration without explicit dynatraceType (defaults to saas)', async () => {
        // Arrange
        const createDto: CreateDynatraceConfigDto = {
          host: 'https://tenant1.live.dynatrace.com',
          apiToken: 'dt0c01.abc123',
        };

        const mockCreatedConfig: DynatraceConfig = {
          id: 'new-config-id',
          host: createDto.host,
          apiToken: createDto.apiToken,
          dynatraceType: 'saas',
          label: 'New Configuration',
          createdAt: '2025-01-10T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockCreatedConfig, true, 201));

        // Act
        const result = await createDynatraceConfig(createDto);

        // Assert
        expect(result.dynatraceType).toBe('saas');
      });

      it('should throw error with custom message when creation fails', async () => {
        // Arrange
        const createDto: CreateDynatraceConfigDto = {
          host: 'invalid-host',
          apiToken: 'invalid-token',
        };

        const mockErrorResponse = createMockErrorResponse(400, 'Invalid host URL format');

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(createDynatraceConfig(createDto)).rejects.toThrow('Invalid host URL format');
      });

      it('should throw generic error when creation fails without error message', async () => {
        // Arrange
        const createDto: CreateDynatraceConfigDto = {
          host: 'https://tenant1.live.dynatrace.com',
          apiToken: 'dt0c01.abc123',
        };

        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(createDynatraceConfig(createDto)).rejects.toThrow('Failed to create Dynatrace configuration');
      });

      it('should handle 401 unauthorized error', async () => {
        // Arrange
        const createDto: CreateDynatraceConfigDto = {
          host: 'https://tenant1.live.dynatrace.com',
          apiToken: 'dt0c01.abc123',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(401, 'Unauthorized'));

        // Act & Assert
        await expect(createDynatraceConfig(createDto)).rejects.toThrow('Unauthorized');
      });
    });

    describe('testDynatraceConnection()', () => {
      it('should test connection successfully', async () => {
        // Arrange
        const connectionData = {
          host: 'https://tenant1.live.dynatrace.com',
          apiToken: 'dt0c01.abc123',
        };

        const mockResponse: TestConnectionResponse = {
          success: true,
          version: '1.287.0.20250108-123456',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockResponse));

        // Act
        const result = await testDynatraceConnection(connectionData);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/dynatrace/test-connection', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(connectionData),
        });
        expect(result.success).toBe(true);
        expect(result.version).toBe('1.287.0.20250108-123456');
      });

      it('should return success without version', async () => {
        // Arrange
        const connectionData = {
          host: 'https://tenant1.live.dynatrace.com',
          apiToken: 'dt0c01.abc123',
        };

        const mockResponse: TestConnectionResponse = {
          success: true,
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockResponse));

        // Act
        const result = await testDynatraceConnection(connectionData);

        // Assert
        expect(result.success).toBe(true);
        expect(result.version).toBeUndefined();
      });

      it('should throw error when connection test fails with custom message', async () => {
        // Arrange
        const connectionData = {
          host: 'https://invalid.dynatrace.com',
          apiToken: 'invalid-token',
        };

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(403, 'Invalid API token or insufficient permissions')
        );

        // Act & Assert
        await expect(testDynatraceConnection(connectionData)).rejects.toThrow(
          'Invalid API token or insufficient permissions'
        );
      });

      it('should throw generic error when connection test fails without message', async () => {
        // Arrange
        const connectionData = {
          host: 'https://invalid.dynatrace.com',
          apiToken: 'invalid-token',
        };

        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(testDynatraceConnection(connectionData)).rejects.toThrow('Connection test failed');
      });

      it('should handle network timeout errors', async () => {
        // Arrange
        const connectionData = {
          host: 'https://unreachable.dynatrace.com',
          apiToken: 'dt0c01.abc123',
        };

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(504, 'Connection timeout')
        );

        // Act & Assert
        await expect(testDynatraceConnection(connectionData)).rejects.toThrow('Connection timeout');
      });
    });

    describe('updateDynatraceConfig()', () => {
      it('should update Dynatrace configuration successfully', async () => {
        // Arrange
        const configId = 'config-123';
        const updateDto: UpdateDynatraceConfigDto = {
          perfanaTestRunIdAttribute: 'testRunId',
          perfanaRequestNameAttribute: 'requestName',
        };

        const mockUpdatedConfig: DynatraceConfig = {
          id: configId,
          host: 'https://tenant1.live.dynatrace.com',
          apiToken: 'dt0c01.abc123',
          dynatraceType: 'saas',
          label: 'Production',
          perfanaTestRunIdAttribute: 'testRunId',
          perfanaRequestNameAttribute: 'requestName',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockUpdatedConfig));

        // Act
        const result = await updateDynatraceConfig(configId, updateDto);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/dynatrace/${configId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateDto),
        });
        expect(result).toEqual(mockUpdatedConfig);
        expect(result.perfanaTestRunIdAttribute).toBe('testRunId');
      });

      it('should update only perfanaTestRunIdAttribute', async () => {
        // Arrange
        const configId = 'config-123';
        const updateDto: UpdateDynatraceConfigDto = {
          perfanaTestRunIdAttribute: 'newTestRunId',
        };

        const mockUpdatedConfig: DynatraceConfig = {
          id: configId,
          host: 'https://tenant1.live.dynatrace.com',
          apiToken: 'dt0c01.abc123',
          dynatraceType: 'saas',
          label: 'Production',
          perfanaTestRunIdAttribute: 'newTestRunId',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockUpdatedConfig));

        // Act
        const result = await updateDynatraceConfig(configId, updateDto);

        // Assert
        expect(result.perfanaTestRunIdAttribute).toBe('newTestRunId');
        expect(result.perfanaRequestNameAttribute).toBeUndefined();
      });

      it('should throw error when update fails with 404', async () => {
        // Arrange
        const configId = 'non-existent-id';
        const updateDto: UpdateDynatraceConfigDto = {
          perfanaTestRunIdAttribute: 'testRunId',
        };

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(404, 'Configuration not found')
        );

        // Act & Assert
        await expect(updateDynatraceConfig(configId, updateDto)).rejects.toThrow('Configuration not found');
      });

      it('should throw generic error when update fails without message', async () => {
        // Arrange
        const configId = 'config-123';
        const updateDto: UpdateDynatraceConfigDto = {
          perfanaTestRunIdAttribute: 'testRunId',
        };

        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(updateDynatraceConfig(configId, updateDto)).rejects.toThrow(
          'Failed to update Dynatrace configuration'
        );
      });
    });

    describe('fetchRequestAttributesForHost()', () => {
      it('should fetch request attributes for a host successfully', async () => {
        // Arrange
        const host = 'https://tenant1.live.dynatrace.com';
        const mockResponse: RequestAttributesResponse = {
          all: [
            { id: 'attr-1', name: 'requestId' },
            { id: 'attr-2', name: 'userId' },
            { id: 'attr-3', name: 'perfana-test-run-id' },
            { id: 'attr-4', name: 'perfana-request-name' },
          ],
          perfanaAttributes: [
            { id: 'attr-3', name: 'perfana-test-run-id' },
            { id: 'attr-4', name: 'perfana-request-name' },
          ],
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockResponse));

        // Act
        const result = await fetchRequestAttributesForHost(host);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/dynatrace/${encodeURIComponent(host)}/request-attributes`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
        expect(result.all).toHaveLength(4);
        expect(result.perfanaAttributes).toHaveLength(2);
      });

      it('should encode special characters in host URL', async () => {
        // Arrange
        const host = 'https://managed.company.com/e/environment-id';
        const mockResponse: RequestAttributesResponse = {
          all: [],
          perfanaAttributes: [],
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockResponse));

        // Act
        await fetchRequestAttributesForHost(host);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/dynatrace/${encodeURIComponent(host)}/request-attributes`,
          expect.any(Object)
        );
      });

      it('should return empty arrays when no attributes exist', async () => {
        // Arrange
        const host = 'https://tenant1.live.dynatrace.com';
        const mockResponse: RequestAttributesResponse = {
          all: [],
          perfanaAttributes: [],
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockResponse));

        // Act
        const result = await fetchRequestAttributesForHost(host);

        // Assert
        expect(result.all).toEqual([]);
        expect(result.perfanaAttributes).toEqual([]);
      });

      it('should throw error when fetch fails with custom message', async () => {
        // Arrange
        const host = 'https://invalid.dynatrace.com';

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(403, 'Insufficient permissions to access request attributes')
        );

        // Act & Assert
        await expect(fetchRequestAttributesForHost(host)).rejects.toThrow(
          'Insufficient permissions to access request attributes'
        );
      });

      it('should throw generic error when fetch fails without message', async () => {
        // Arrange
        const host = 'https://tenant1.live.dynatrace.com';

        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(fetchRequestAttributesForHost(host)).rejects.toThrow('Failed to fetch request attributes');
      });
    });

    describe('deleteDynatraceConfig()', () => {
      it('should delete Dynatrace configuration successfully', async () => {
        // Arrange
        const configId = 'config-to-delete';
        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(null, true, 204));

        // Act
        await deleteDynatraceConfig(configId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/dynatrace/${configId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      });

      it('should not throw error when deletion succeeds', async () => {
        // Arrange
        const configId = 'config-123';
        mockAuthenticatedFetch.mockResolvedValue(createMockResponse({}, true, 200));

        // Act & Assert
        await expect(deleteDynatraceConfig(configId)).resolves.toBeUndefined();
      });

      it('should throw error when configuration not found', async () => {
        // Arrange
        const configId = 'non-existent-id';

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(404, 'Configuration not found')
        );

        // Act & Assert
        await expect(deleteDynatraceConfig(configId)).rejects.toThrow('Configuration not found');
      });

      it('should throw generic error when deletion fails without message', async () => {
        // Arrange
        const configId = 'config-123';

        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(deleteDynatraceConfig(configId)).rejects.toThrow(
          'Failed to delete Dynatrace configuration'
        );
      });

      it('should handle 403 forbidden error', async () => {
        // Arrange
        const configId = 'config-123';

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(403, 'Insufficient permissions to delete configuration')
        );

        // Act & Assert
        await expect(deleteDynatraceConfig(configId)).rejects.toThrow(
          'Insufficient permissions to delete configuration'
        );
      });
    });
  });

  describe('Dynatrace Query Management', () => {
    describe('fetchDynatraceQueries()', () => {
      it('should fetch all queries without filters', async () => {
        // Arrange
        const mockQueries: DynatraceQuery[] = [
          {
            id: 'query-1',
            dynatraceConfigId: 'config-1',
            systemUnderTestId: 'system-1',
            testEnvironment: 'production',
            workload: 'load-test',
            dashboardLabel: 'Performance Dashboard',
            applicationDashboardId: 'dashboard-1',
            panelTitle: 'Response Time',
            panelId: 1,
            query: 'SELECT * FROM metrics',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockQueries));

        // Act
        const result = await fetchDynatraceQueries();

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/dynatrace/queries', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        expect(result).toEqual(mockQueries);
      });

      it('should fetch queries with systemId filter', async () => {
        // Arrange
        const systemId = 'system-123';
        const mockQueries: DynatraceQuery[] = [];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockQueries));

        // Act
        const result = await fetchDynatraceQueries(systemId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/dynatrace/queries?systemId=system-123', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        expect(result).toEqual([]);
      });

      it('should fetch queries with environment filter', async () => {
        // Arrange
        const environment = 'staging';
        const mockQueries: DynatraceQuery[] = [];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockQueries));

        // Act
        await fetchDynatraceQueries(undefined, environment);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/dynatrace/queries?environment=staging', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      });

      it('should fetch queries with workload filter', async () => {
        // Arrange
        const workload = 'stress-test';
        const mockQueries: DynatraceQuery[] = [];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockQueries));

        // Act
        await fetchDynatraceQueries(undefined, undefined, workload);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/dynatrace/queries?workload=stress-test', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      });

      it('should fetch queries with all filters combined', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';
        const mockQueries: DynatraceQuery[] = [];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockQueries));

        // Act
        await fetchDynatraceQueries(systemId, environment, workload);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/dynatrace/queries?systemId=system-1&environment=production&workload=load-test',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      });

      it('should throw error when fetch fails', async () => {
        // Arrange
        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(500));

        // Act & Assert
        await expect(fetchDynatraceQueries()).rejects.toThrow('Failed to fetch Dynatrace queries');
      });
    });

    describe('fetchDynatraceQueryById()', () => {
      it('should fetch a single query by ID successfully', async () => {
        // Arrange
        const queryId = 'query-123';
        const mockQuery: DynatraceQuery = {
          id: queryId,
          dynatraceConfigId: 'config-1',
          systemUnderTestId: 'system-1',
          testEnvironment: 'production',
          workload: 'load-test',
          dashboardLabel: 'Performance Dashboard',
          applicationDashboardId: 'dashboard-1',
          panelTitle: 'Response Time',
          query: 'SELECT avg(duration) FROM metrics',
          matchMetricPattern: 'response_time_*',
          omitGroupByVariableFromMetricName: ['environment'],
          templateVariables: { region: 'us-east-1' },
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockQuery));

        // Act
        const result = await fetchDynatraceQueryById(queryId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/dynatrace/queries/${queryId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        expect(result).toEqual(mockQuery);
        expect(result.id).toBe(queryId);
      });

      it('should throw error when query not found', async () => {
        // Arrange
        const queryId = 'non-existent-id';
        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(404));

        // Act & Assert
        await expect(fetchDynatraceQueryById(queryId)).rejects.toThrow('Failed to fetch Dynatrace query');
      });

      it('should throw error when fetch fails with 500', async () => {
        // Arrange
        const queryId = 'query-123';
        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(500));

        // Act & Assert
        await expect(fetchDynatraceQueryById(queryId)).rejects.toThrow('Failed to fetch Dynatrace query');
      });
    });

    describe('createDynatraceQuery()', () => {
      it('should create a new Dynatrace query successfully', async () => {
        // Arrange
        const createDto: CreateDynatraceQueryDto = {
          dynatraceConfigId: 'config-1',
          systemUnderTestId: 'system-1',
          testEnvironment: 'production',
          workload: 'load-test',
          dashboardLabel: 'Performance Dashboard',
          applicationDashboardId: 'dashboard-1',
          panelTitle: 'Response Time',
          panelId: 1,
          query: 'SELECT avg(duration) FROM metrics',
          matchMetricPattern: 'response_time_*',
          omitGroupByVariableFromMetricName: ['environment'],
          templateVariables: { region: 'us-east-1' },
          metricUnit: 'milliseconds',
        };

        const mockCreatedQuery: DynatraceQuery = {
          id: 'new-query-id',
          ...createDto,
          createdAt: '2025-01-10T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockCreatedQuery, true, 201));

        // Act
        const result = await createDynatraceQuery(createDto);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/dynatrace/queries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createDto),
        });
        expect(result).toEqual(mockCreatedQuery);
        expect(result.id).toBe('new-query-id');
      });

      it('should create query with minimal required fields', async () => {
        // Arrange
        const createDto: CreateDynatraceQueryDto = {
          dynatraceConfigId: 'config-1',
          systemUnderTestId: 'system-1',
          testEnvironment: 'production',
          workload: 'load-test',
          dashboardLabel: 'Dashboard',
          applicationDashboardId: 'dashboard-1',
          panelTitle: 'Metric',
          query: 'SELECT * FROM metrics',
        };

        const mockCreatedQuery: DynatraceQuery = {
          id: 'new-query-id',
          ...createDto,
          createdAt: '2025-01-10T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockCreatedQuery, true, 201));

        // Act
        const result = await createDynatraceQuery(createDto);

        // Assert
        expect(result.panelId).toBeUndefined();
        expect(result.matchMetricPattern).toBeUndefined();
        expect(result.omitGroupByVariableFromMetricName).toBeUndefined();
        expect(result.templateVariables).toBeUndefined();
      });

      it('should throw error with custom message when creation fails', async () => {
        // Arrange
        const createDto: CreateDynatraceQueryDto = {
          dynatraceConfigId: 'invalid-config',
          systemUnderTestId: 'system-1',
          testEnvironment: 'production',
          workload: 'load-test',
          dashboardLabel: 'Dashboard',
          applicationDashboardId: 'dashboard-1',
          panelTitle: 'Metric',
          query: 'INVALID QUERY',
        };

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(400, 'Invalid DQL query syntax')
        );

        // Act & Assert
        await expect(createDynatraceQuery(createDto)).rejects.toThrow('Invalid DQL query syntax');
      });

      it('should throw generic error when creation fails without message', async () => {
        // Arrange
        const createDto: CreateDynatraceQueryDto = {
          dynatraceConfigId: 'config-1',
          systemUnderTestId: 'system-1',
          testEnvironment: 'production',
          workload: 'load-test',
          dashboardLabel: 'Dashboard',
          applicationDashboardId: 'dashboard-1',
          panelTitle: 'Metric',
          query: 'SELECT * FROM metrics',
        };

        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(createDynatraceQuery(createDto)).rejects.toThrow('Failed to create Dynatrace query');
      });
    });

    describe('updateDynatraceQuery()', () => {
      it('should update Dynatrace query successfully', async () => {
        // Arrange
        const queryId = 'query-123';
        const updateDto: UpdateDynatraceQueryDto = {
          query: 'SELECT avg(duration) FROM metrics WHERE environment="production"',
          matchMetricPattern: 'updated_pattern_*',
          metricUnit: 'seconds',
        };

        const mockUpdatedQuery: DynatraceQuery = {
          id: queryId,
          dynatraceConfigId: 'config-1',
          systemUnderTestId: 'system-1',
          testEnvironment: 'production',
          workload: 'load-test',
          dashboardLabel: 'Performance Dashboard',
          applicationDashboardId: 'dashboard-1',
          panelTitle: 'Response Time',
          query: updateDto.query!,
          matchMetricPattern: updateDto.matchMetricPattern,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockUpdatedQuery));

        // Act
        const result = await updateDynatraceQuery(queryId, updateDto);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/dynatrace/queries/${queryId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateDto),
        });
        expect(result.query).toBe(updateDto.query);
        expect(result.matchMetricPattern).toBe(updateDto.matchMetricPattern);
      });

      it('should update single field successfully', async () => {
        // Arrange
        const queryId = 'query-123';
        const updateDto: UpdateDynatraceQueryDto = {
          panelTitle: 'Updated Panel Title',
        };

        const mockUpdatedQuery: DynatraceQuery = {
          id: queryId,
          dynatraceConfigId: 'config-1',
          systemUnderTestId: 'system-1',
          testEnvironment: 'production',
          workload: 'load-test',
          dashboardLabel: 'Performance Dashboard',
          applicationDashboardId: 'dashboard-1',
          panelTitle: 'Updated Panel Title',
          query: 'SELECT * FROM metrics',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockUpdatedQuery));

        // Act
        const result = await updateDynatraceQuery(queryId, updateDto);

        // Assert
        expect(result.panelTitle).toBe('Updated Panel Title');
      });

      it('should throw error when update fails with 404', async () => {
        // Arrange
        const queryId = 'non-existent-id';
        const updateDto: UpdateDynatraceQueryDto = {
          query: 'SELECT * FROM metrics',
        };

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(404, 'Query not found')
        );

        // Act & Assert
        await expect(updateDynatraceQuery(queryId, updateDto)).rejects.toThrow('Query not found');
      });

      it('should throw generic error when update fails without message', async () => {
        // Arrange
        const queryId = 'query-123';
        const updateDto: UpdateDynatraceQueryDto = {
          query: 'SELECT * FROM metrics',
        };

        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(updateDynatraceQuery(queryId, updateDto)).rejects.toThrow(
          'Failed to update Dynatrace query'
        );
      });
    });

    describe('deleteDynatraceQuery()', () => {
      it('should delete Dynatrace query successfully', async () => {
        // Arrange
        const queryId = 'query-to-delete';
        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(null, true, 204));

        // Act
        await deleteDynatraceQuery(queryId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/dynatrace/queries/${queryId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      });

      it('should not throw error when deletion succeeds', async () => {
        // Arrange
        const queryId = 'query-123';
        mockAuthenticatedFetch.mockResolvedValue(createMockResponse({}, true, 200));

        // Act & Assert
        await expect(deleteDynatraceQuery(queryId)).resolves.toBeUndefined();
      });

      it('should throw error when query not found', async () => {
        // Arrange
        const queryId = 'non-existent-id';

        mockAuthenticatedFetch.mockResolvedValue(
          createMockErrorResponse(404, 'Query not found')
        );

        // Act & Assert
        await expect(deleteDynatraceQuery(queryId)).rejects.toThrow('Query not found');
      });

      it('should throw generic error when deletion fails without message', async () => {
        // Arrange
        const queryId = 'query-123';

        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(deleteDynatraceQuery(queryId)).rejects.toThrow('Failed to delete Dynatrace query');
      });
    });
  });

  describe('SLO Support Functions', () => {
    describe('fetchDynatraceDashboards()', () => {
      it('should fetch dashboards with all required parameters', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';

        const mockDashboards: DynatraceDashboard[] = [
          { dashboardLabel: 'Performance Dashboard' },
          { dashboardLabel: 'Error Dashboard' },
          { dashboardLabel: 'Throughput Dashboard' },
        ];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockDashboards));

        // Act
        const result = await fetchDynatraceDashboards(systemId, environment, workload);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/dynatrace/queries/dashboards?systemId=system-1&environment=production&workload=load-test',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
        expect(result).toEqual(mockDashboards);
        expect(result).toHaveLength(3);
      });

      it('should return empty array when no dashboards exist', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'staging';
        const workload = 'smoke-test';

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse([]));

        // Act
        const result = await fetchDynatraceDashboards(systemId, environment, workload);

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });

      it('should handle special characters in parameters', async () => {
        // Arrange
        const systemId = 'system-with-dashes';
        const environment = 'prod & staging';
        const workload = 'load test';

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse([]));

        // Act
        await fetchDynatraceDashboards(systemId, environment, workload);

        // Assert
        // URLSearchParams uses + for spaces, not %20
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/dynatrace/queries/dashboards?systemId=system-with-dashes&environment=prod+%26+staging&workload=load+test',
          expect.any(Object)
        );
      });

      it('should throw error with custom message when fetch fails', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';

        const mockErrorResponse = createMockErrorResponse(404, 'No dashboards found for the specified criteria');

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(fetchDynatraceDashboards(systemId, environment, workload)).rejects.toThrow(
          'Failed to fetch Dynatrace dashboards: 404 Error'
        );
      });

      it('should log error details when fetch fails', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const mockErrorResponse = createMockErrorResponse(500, 'Internal server error');

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(fetchDynatraceDashboards(systemId, environment, workload)).rejects.toThrow(
          'Failed to fetch Dynatrace dashboards: 500 Error'
        );

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Dynatrace API error:',
          500,
          'Error',
          { message: 'Internal server error' }
        );

        consoleErrorSpy.mockRestore();
      });

      it('should handle JSON parse error gracefully', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const mockErrorResponse: Response = {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response;

        mockAuthenticatedFetch.mockResolvedValue(mockErrorResponse);

        // Act & Assert
        await expect(fetchDynatraceDashboards(systemId, environment, workload)).rejects.toThrow(
          'Failed to fetch Dynatrace dashboards: 500 Internal Server Error'
        );

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Dynatrace API error:',
          500,
          'Internal Server Error',
          {}
        );

        consoleErrorSpy.mockRestore();
      });
    });

    describe('fetchDynatraceMetrics()', () => {
      it('should fetch metrics with all required parameters', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';
        const dashboardLabel = 'Performance Dashboard';

        const mockMetrics: DynatraceMetric[] = [
          {
            panelTitle: 'Response Time',
            panelId: 1,
            applicationDashboardId: 'dashboard-1',
            metricUnit: 'milliseconds',
          },
          {
            panelTitle: 'Error Rate',
            panelId: 2,
            applicationDashboardId: 'dashboard-1',
            metricUnit: 'percentage',
          },
          {
            panelTitle: 'Throughput',
            panelId: 3,
            applicationDashboardId: 'dashboard-1',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockMetrics));

        // Act
        const result = await fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/dynatrace/queries/metrics?systemId=system-1&environment=production&dashboardLabel=Performance+Dashboard&workload=load-test',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
        expect(result).toEqual(mockMetrics);
        expect(result).toHaveLength(3);
      });

      it('should return empty array when no metrics exist', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'staging';
        const workload = 'smoke-test';
        const dashboardLabel = 'Empty Dashboard';

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse([]));

        // Act
        const result = await fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel);

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });

      it('should handle special characters in dashboard label', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';
        const dashboardLabel = 'Dashboard & Metrics';

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse([]));

        // Act
        await fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel);

        // Assert
        // URLSearchParams uses + for spaces, not %20
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          '/dynatrace/queries/metrics?systemId=system-1&environment=production&dashboardLabel=Dashboard+%26+Metrics&workload=load-test',
          expect.any(Object)
        );
      });

      it('should include metrics with and without metricUnit', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';
        const dashboardLabel = 'Dashboard';

        const mockMetrics: DynatraceMetric[] = [
          {
            panelTitle: 'Metric With Unit',
            panelId: 1,
            applicationDashboardId: 'dashboard-1',
            metricUnit: 'bytes',
          },
          {
            panelTitle: 'Metric Without Unit',
            panelId: 2,
            applicationDashboardId: 'dashboard-1',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockMetrics));

        // Act
        const result = await fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel);

        // Assert
        expect(result[0].metricUnit).toBe('bytes');
        expect(result[1].metricUnit).toBeUndefined();
      });

      it('should throw error when fetch fails', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';
        const dashboardLabel = 'Dashboard';

        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(500));

        // Act & Assert
        await expect(
          fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel)
        ).rejects.toThrow('Failed to fetch Dynatrace metrics');
      });

      it('should handle 404 error for non-existent dashboard', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';
        const dashboardLabel = 'Non-Existent Dashboard';

        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(404));

        // Act & Assert
        await expect(
          fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel)
        ).rejects.toThrow('Failed to fetch Dynatrace metrics');
      });

      it('should handle 401 unauthorized error', async () => {
        // Arrange
        const systemId = 'system-1';
        const environment = 'production';
        const workload = 'load-test';
        const dashboardLabel = 'Dashboard';

        mockAuthenticatedFetch.mockResolvedValue(createMockErrorResponse(401));

        // Act & Assert
        await expect(
          fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel)
        ).rejects.toThrow('Failed to fetch Dynatrace metrics');
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      // Arrange
      mockAuthenticatedFetch.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(fetchDynatraceConfigs()).rejects.toThrow('Network error');
    });

    it('should handle empty string parameters', async () => {
      // Arrange
      mockAuthenticatedFetch.mockResolvedValue(createMockResponse([]));

      // Act
      await fetchDynatraceQueries('', '', '');

      // Assert
      // Empty strings are treated as falsy and omitted from URL
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        '/dynatrace/queries',
        expect.any(Object)
      );
    });

    it('should handle undefined as different from omitted parameters', async () => {
      // Arrange
      mockAuthenticatedFetch.mockResolvedValue(createMockResponse([]));

      // Act
      await fetchDynatraceQueries(undefined, 'production', undefined);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        '/dynatrace/queries?environment=production',
        expect.any(Object)
      );
    });

    it('should preserve Content-Type header in all requests', async () => {
      // Arrange
      mockAuthenticatedFetch.mockResolvedValue(createMockResponse({}));

      // Act
      await createDynatraceConfig({
        host: 'https://tenant.dynatrace.com',
        apiToken: 'token',
      });

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should handle very long host URLs with URL encoding', async () => {
      // Arrange
      const longHost = 'https://very-long-subdomain.managed.dynatrace.com/e/environment-id-with-very-long-uuid';
      mockAuthenticatedFetch.mockResolvedValue(createMockResponse({ all: [], perfanaAttributes: [] }));

      // Act
      await fetchRequestAttributesForHost(longHost);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/dynatrace/${encodeURIComponent(longHost)}/request-attributes`,
        expect.any(Object)
      );
    });

    it('should handle queries with complex template variables', async () => {
      // Arrange
      const createDto: CreateDynatraceQueryDto = {
        dynatraceConfigId: 'config-1',
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        dashboardLabel: 'Dashboard',
        applicationDashboardId: 'dashboard-1',
        panelTitle: 'Metric',
        query: 'SELECT * FROM metrics',
        templateVariables: {
          region: 'us-east-1',
          environment: 'prod',
          tier: 'backend',
        },
      };

      const mockCreatedQuery: DynatraceQuery = {
        id: 'query-id',
        ...createDto,
        createdAt: '2025-01-10T00:00:00Z',
        updatedAt: '2025-01-10T00:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue(createMockResponse(mockCreatedQuery, true, 201));

      // Act
      const result = await createDynatraceQuery(createDto);

      // Assert
      expect(result.templateVariables).toEqual({
        region: 'us-east-1',
        environment: 'prod',
        tier: 'backend',
      });
    });
  });
});
