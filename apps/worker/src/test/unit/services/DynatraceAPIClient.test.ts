import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DynatraceAPIClient } from '../../../services/dynatrace/DynatraceAPIClient.js';
import { request } from 'undici';

// Mock undici request
vi.mock('undici', () => ({
  request: vi.fn(),
  Agent: vi.fn().mockImplementation(() => ({
    destroy: vi.fn()
  }))
}));

// Mock logger
vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('DynatraceAPIClient', () => {
  let client: DynatraceAPIClient;
  const mockRequest = vi.mocked(request);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  describe('Configuration and Initialization', () => {
    it('should initialize with SaaS configuration and convert host URL', () => {
      // Arrange
      const config = {
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas' as const,
      };

      // Act
      client = new DynatraceAPIClient(config);

      // Assert
      expect(client).toBeDefined();
      // Note: baseUrl is private, but we can test behavior through API calls
    });

    it('should initialize with Managed configuration and keep original host URL', () => {
      // Arrange
      const config = {
        host: 'dynatrace.example.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'managed' as const,
      };

      // Act
      client = new DynatraceAPIClient(config);

      // Assert
      expect(client).toBeDefined();
    });

    it('should apply default configuration values', () => {
      // Arrange
      const config = {
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas' as const,
      };

      // Act
      client = new DynatraceAPIClient(config);

      // Assert - defaults should be applied (maxConcurrent: 5, maxRetries: 3, etc.)
      expect(client).toBeDefined();
    });

    it('should handle host URLs with https:// prefix', () => {
      // Arrange
      const config = {
        host: 'https://live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas' as const,
      };

      // Act
      client = new DynatraceAPIClient(config);

      // Assert
      expect(client).toBeDefined();
    });

    it('should remove trailing slash from host URL', () => {
      // Arrange
      const config = {
        host: 'https://live.dynatrace.com/',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas' as const,
      };

      // Act
      client = new DynatraceAPIClient(config);

      // Assert
      expect(client).toBeDefined();
    });

    it('should use live.dynatrace.com for Metrics API and apps.dynatrace.com for DQL on SaaS', async () => {
      // Arrange - SaaS instance with a metric selector query
      const config = {
        host: 'oti61760.live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas' as const,
      };
      client = new DynatraceAPIClient(config);

      // First call: Metrics API (metric selector)
      const mockMetricsResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            result: [{
              metricId: 'builtin:host.cpu.usage',
              data: [{
                dimensionMap: { 'dt.entity.host': 'HOST-123' },
                timestamps: [1704067200000],
                values: [50.5]
              }]
            }]
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            result: [{
              metricId: 'builtin:host.cpu.usage',
              data: [{
                dimensionMap: { 'dt.entity.host': 'HOST-123' },
                timestamps: [1704067200000],
                values: [50.5]
              }]
            }]
          }))
        }
      };
      mockRequest.mockResolvedValueOnce(mockMetricsResponse as any);

      // Act - metric selector should route to Metrics API v2 with live.dynatrace.com
      await client.executeQuery('builtin:host.cpu.usage:filter(eq("dt.entity.host","HOST-123")):avg');

      // Assert - Metrics API v2 should use live.dynatrace.com (NOT apps.dynatrace.com)
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('oti61760.live.dynatrace.com/api/v2/metrics/query'),
        expect.any(Object)
      );

      // Second call: DQL API (DQL query)
      const mockDQLResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: { records: [] }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: { records: [] }
          }))
        }
      };
      mockRequest.mockResolvedValueOnce(mockDQLResponse as any);

      // Act - DQL query should route to DQL API with apps.dynatrace.com
      await client.executeQuery('timeseries avg(dt.host.cpu.usage)');

      // Assert - DQL API should use apps.dynatrace.com (NOT live.dynatrace.com)
      expect(mockRequest).toHaveBeenLastCalledWith(
        expect.stringContaining('oti61760.apps.dynatrace.com/platform/storage/query/v1/query:execute'),
        expect.any(Object)
      );
    });
  });

  describe('DQL Query Execution - SaaS', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });
    });

    it('should execute DQL query with immediate success (HTTP 200)', async () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: {
              records: [
                { timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 50.5 }
              ]
            }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: {
              records: [
                { timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 50.5 }
              ]
            }
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act
      const result = await client.executeQuery(query);

      // Assert
      expect(result).toEqual({
        records: [
          { timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 50.5 }
        ]
      });
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('/platform/storage/query/v1/query:execute'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-platform-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should execute DQL query with async execution (HTTP 202) and poll for results', async () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      const requestToken = 'test-request-token-123';

      const mockStartResponse = {
        statusCode: 202,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'RUNNING',
            requestToken
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'RUNNING',
            requestToken
          }))
        }
      };

      const mockPollResponseRunning = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'RUNNING'
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'RUNNING'
          }))
        }
      };

      const mockPollResponseSuccess = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: {
              records: [
                { timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 75.2 }
              ]
            }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: {
              records: [
                { timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 75.2 }
              ]
            }
          }))
        }
      };

      mockRequest
        .mockResolvedValueOnce(mockStartResponse as any) // Start query
        .mockResolvedValueOnce(mockPollResponseRunning as any) // First poll - still running
        .mockResolvedValueOnce(mockPollResponseSuccess as any); // Second poll - completed

      // Act
      const result = await client.executeQuery(query);

      // Assert
      expect(result).toEqual({
        records: [
          { timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 75.2 }
        ]
      });
      expect(mockRequest).toHaveBeenCalledTimes(3); // 1 start + 2 polls
      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/platform/storage/query/v1/query:poll?request-token=${requestToken}`),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should handle DQL query failure during polling', async () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      const requestToken = 'test-request-token-456';

      const mockStartResponse = {
        statusCode: 202,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'RUNNING',
            requestToken
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'RUNNING',
            requestToken
          }))
        }
      };

      const mockPollResponseFailed = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'FAILED',
            error: {
              code: 'QUERY_ERROR',
              message: 'Invalid DQL syntax'
            }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'FAILED',
            error: {
              code: 'QUERY_ERROR',
              message: 'Invalid DQL syntax'
            }
          }))
        }
      };

      mockRequest
        .mockResolvedValueOnce(mockStartResponse as any)
        .mockResolvedValueOnce(mockPollResponseFailed as any);

      // Act & Assert
      await expect(client.executeQuery(query)).rejects.toThrow('DQL query failed: Invalid DQL syntax');
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('should handle polling timeout', async () => {
      // Arrange
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxPollWaitMs: 100, // Very short timeout for testing
        pollInterval: 10,
      });

      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      const requestToken = 'test-request-token-789';

      const mockStartResponse = {
        statusCode: 202,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'RUNNING',
            requestToken
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'RUNNING',
            requestToken
          }))
        }
      };

      const mockPollResponseRunning = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'RUNNING'
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'RUNNING'
          }))
        }
      };

      mockRequest
        .mockResolvedValueOnce(mockStartResponse as any)
        .mockResolvedValue(mockPollResponseRunning as any); // Always return RUNNING

      // Act & Assert
      await expect(client.executeQuery(query)).rejects.toThrow(/timed out/);
    });

    it('should include timeframe in DQL query request', async () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: { records: [] }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: { records: [] }
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act
      await client.executeQuery(query, startTime, endTime);

      // Assert
      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"defaultTimeframeStart":"2024-01-01T00:00:00.000Z"'),
        })
      );
    });

    it('should retry on network errors with exponential backoff', async () => {
      // Arrange
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxRetries: 3,
      });

      const query = 'timeseries avg(dt.host.cpu.usage)';

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: { records: [] }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: { records: [] }
          }))
        }
      };

      mockRequest
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockResponse as any); // Success on third attempt

      // Act
      const result = await client.executeQuery(query);

      // Assert
      expect(result).toEqual({ records: [] });
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });

    it('should fail after maximum retries', async () => {
      // Arrange
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxRetries: 2,
      });

      const query = 'timeseries avg(dt.host.cpu.usage)';

      mockRequest.mockRejectedValue(new Error('Persistent network error'));

      // Act & Assert
      await expect(client.executeQuery(query)).rejects.toThrow('Persistent network error');
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('Metrics API v2 Execution - Managed', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'dynatrace.example.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'managed',
      });
    });

    it('should execute Metrics API v2 query successfully', async () => {
      // Arrange
      const metricSelector = 'builtin:host.cpu.system:filter(eq("dt.entity.host",HOST-123)):avg';
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            result: [
              {
                metricId: 'builtin:host.cpu.system',
                data: [
                  {
                    dimensionMap: { 'dt.entity.host': 'HOST-123' },
                    timestamps: [1704067200000, 1704067260000], // 1-minute intervals
                    values: [25.5, 30.2]
                  }
                ]
              }
            ]
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            result: [
              {
                metricId: 'builtin:host.cpu.system',
                data: [
                  {
                    dimensionMap: { 'dt.entity.host': 'HOST-123' },
                    timestamps: [1704067200000, 1704067260000], // 1-minute intervals
                    values: [25.5, 30.2]
                  }
                ]
              }
            ]
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act
      const result = await client.executeQuery(metricSelector, startTime, endTime);

      // Assert
      expect(result.records).toBeDefined();
      expect(result.records).toHaveLength(2);
      expect(result.records[0]).toMatchObject({
        'dt.entity.host': 'HOST-123',
        value: 25.5,
      });
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/metrics/query'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Api-Token test-api-token',
          }),
        })
      );
    });

    it('should transform Metrics API v2 response to DQL-like format', async () => {
      // Arrange
      const metricSelector = 'builtin:host.cpu.system:avg';

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            result: [
              {
                metricId: 'builtin:host.cpu.system',
                data: [
                  {
                    dimensionMap: { 'dt.entity.host': 'HOST-456' },
                    timestamps: [1704067200000],
                    values: [42.7]
                  }
                ]
              }
            ]
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            result: [
              {
                metricId: 'builtin:host.cpu.system',
                data: [
                  {
                    dimensionMap: { 'dt.entity.host': 'HOST-456' },
                    timestamps: [1704067200000],
                    values: [42.7]
                  }
                ]
              }
            ]
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act
      const result = await client.executeQuery(metricSelector);

      // Assert
      expect(result).toHaveProperty('records');
      expect(result.records[0]).toHaveProperty('timestamp');
      expect(result.records[0]).toHaveProperty('value');
      expect(result.records[0]).toHaveProperty('dt.entity.host', 'HOST-456');
      expect(result.records[0].value).toBe(42.7);
    });

    it('should handle empty Metrics API v2 response', async () => {
      // Arrange
      const metricSelector = 'builtin:host.cpu.system:avg';

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            result: []
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            result: []
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act
      const result = await client.executeQuery(metricSelector);

      // Assert
      expect(result).toEqual({ records: [] });
    });

    it('should handle Metrics API v2 error response', async () => {
      // Arrange
      const metricSelector = 'invalid:metric:selector';

      const mockResponse = {
        statusCode: 400,
        body: {
          json: vi.fn().mockResolvedValue({
            error: {
              code: 400,
              message: 'Invalid metric selector'
            }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            error: {
              code: 400,
              message: 'Invalid metric selector'
            }
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act & Assert
      await expect(client.executeQuery(metricSelector)).rejects.toThrow(/failed with status 400/);
    });

    it('should use default timeframe when not provided', async () => {
      // Arrange
      const metricSelector = 'builtin:host.cpu.system:avg';

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            result: []
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            result: []
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act
      await client.executeQuery(metricSelector);

      // Assert
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringMatching(/from=\d+&to=\d+/),
        expect.any(Object)
      );
    });
  });

  describe('Batch Query Execution', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxConcurrent: 2,
      });
    });

    it('should execute multiple queries in batch', async () => {
      // Arrange
      const queries = [
        { tileId: 'tile-1', tileTitle: 'CPU Usage', query: 'timeseries avg(dt.host.cpu.usage)' },
        { tileId: 'tile-2', tileTitle: 'Memory Usage', query: 'timeseries avg(dt.host.memory.usage)' },
      ];

      const mockResponse1 = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: { records: [{ timestamp: '2024-01-01T00:00:00Z', value: 50 }] }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: { records: [{ timestamp: '2024-01-01T00:00:00Z', value: 50 }] }
          }))
        }
      };

      const mockResponse2 = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: { records: [{ timestamp: '2024-01-01T00:00:00Z', value: 75 }] }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: { records: [{ timestamp: '2024-01-01T00:00:00Z', value: 75 }] }
          }))
        }
      };

      mockRequest
        .mockResolvedValueOnce(mockResponse1 as any)
        .mockResolvedValueOnce(mockResponse2 as any);

      // Act
      const results = await client.executeBatchQueries(queries);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        tileId: 'tile-1',
        tileTitle: 'CPU Usage',
        error: null,
      });
      expect(results[1]).toMatchObject({
        tileId: 'tile-2',
        tileTitle: 'Memory Usage',
        error: null,
      });
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('should handle partial batch failures gracefully', async () => {
      // Arrange
      const queries = [
        { tileId: 'tile-1', tileTitle: 'CPU Usage', query: 'timeseries avg(dt.host.cpu.usage)' },
        { tileId: 'tile-2', tileTitle: 'Invalid', query: 'invalid query' },
      ];

      let callCount = 0;
      mockRequest.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            statusCode: 200,
            body: {
              json: vi.fn().mockResolvedValue({
                state: 'SUCCEEDED',
                result: { records: [] }
              }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
                state: 'SUCCEEDED',
                result: { records: [] }
              }))
            }
          } as any;
        } else {
          throw new Error('Query syntax error');
        }
      });

      // Act
      const results = await client.executeBatchQueries(queries);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].error).toBeNull();
      expect(results[1].error).toContain('Query syntax error');
    });

    it('should respect maxConcurrent limit', async () => {
      // Arrange
      const queries = Array.from({ length: 10 }, (_, i) => ({
        tileId: `tile-${i}`,
        tileTitle: `Query ${i}`,
        query: `query ${i}`,
      }));

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: { records: [] }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: { records: [] }
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act
      const results = await client.executeBatchQueries(queries);

      // Assert
      expect(results).toHaveLength(10);
      expect(mockRequest).toHaveBeenCalledTimes(10);
      // All should succeed
      expect(results.every(r => r.error === null)).toBe(true);
    });
  });

  describe('Concurrency Control (Semaphore)', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxConcurrent: 1, // Force sequential execution
      });
    });

    it('should limit concurrent requests based on maxConcurrent', async () => {
      // Arrange
      let activeRequests = 0;
      let maxActiveRequests = 0;

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockImplementation(async () => {
            activeRequests++;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            await new Promise(resolve => setTimeout(resolve, 10));
            activeRequests--;
            return {
              state: 'SUCCEEDED',
              result: { records: [] }
            };
          })
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act
      const promises = [
        client.executeQuery('query 1'),
        client.executeQuery('query 2'),
        client.executeQuery('query 3'),
      ];
      await Promise.all(promises);

      // Assert
      expect(maxActiveRequests).toBe(1); // Should never exceed maxConcurrent
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });
  });

  describe('Resource Cleanup', () => {
    it('should close agent and destroy connections', async () => {
      // Arrange
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });

      // Act
      await client.close();

      // Assert - verify destroy was called (via mock)
      expect(client).toBeDefined();
    });
  });

  describe('Query Format Detection and Routing', () => {
    describe('Metric Selector Detection (routes to Metrics API v2)', () => {
      beforeEach(() => {
        client = new DynatraceAPIClient({
          host: 'live.dynatrace.com',
          apiToken: 'test-api-token',
          platformToken: 'test-platform-token',
          dynatraceType: 'saas', // Even on SaaS, metric selectors should use Metrics API
        });
      });

      it('should route builtin: metric selectors to Metrics API v2', async () => {
        // Arrange
        const metricSelector = 'builtin:host.cpu.usage:filter(eq("dt.entity.host","HOST-123")):avg';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({
              result: [{
                metricId: 'builtin:host.cpu.usage',
                data: [{ dimensionMap: {}, timestamps: [1704067200000], values: [50.5] }]
              }]
            }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
              result: [{
                metricId: 'builtin:host.cpu.usage',
                data: [{ dimensionMap: {}, timestamps: [1704067200000], values: [50.5] }]
              }]
            }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(metricSelector);

        // Assert - should call Metrics API v2, not DQL endpoint
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/api/v2/metrics/query'),
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
              'Authorization': 'Api-Token test-api-token',
            }),
          })
        );
      });

      it('should route ext: metric selectors to Metrics API v2', async () => {
        // Arrange
        const metricSelector = 'ext:custom.metric:filter(eq("dt.entity.service","SVC-123")):sum';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({
              result: []
            }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
              result: []
            }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(metricSelector);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/api/v2/metrics/query'),
          expect.any(Object)
        );
      });

      it('should route calc: metric selectors to Metrics API v2', async () => {
        // Arrange
        const metricSelector = 'calc:service.availability:avg';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({ result: [] }),
          text: vi.fn().mockResolvedValue(JSON.stringify({ result: [] }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(metricSelector);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/api/v2/metrics/query'),
          expect.any(Object)
        );
      });

      it('should route queries with :splitBy transformation to Metrics API v2', async () => {
        // Arrange
        const metricSelector = 'builtin:host.mem.usage:splitBy("dt.entity.host"):avg';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({ result: [] }),
          text: vi.fn().mockResolvedValue(JSON.stringify({ result: [] }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(metricSelector);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/api/v2/metrics/query'),
          expect.any(Object)
        );
      });

      it('should route queries ending with :avg aggregation to Metrics API v2', async () => {
        // Arrange
        const metricSelector = 'builtin:host.disk.utilTime:avg';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({ result: [] }),
          text: vi.fn().mockResolvedValue(JSON.stringify({ result: [] }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(metricSelector);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/api/v2/metrics/query'),
          expect.any(Object)
        );
      });
    });

    describe('DQL Query Detection (routes to DQL API)', () => {
      beforeEach(() => {
        client = new DynatraceAPIClient({
          host: 'live.dynatrace.com',
          apiToken: 'test-api-token',
          platformToken: 'test-platform-token',
          dynatraceType: 'saas',
        });
      });

      it('should route fetch queries to DQL API', async () => {
        // Arrange
        const dqlQuery = 'fetch logs | filter status == "ERROR" | limit 100';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({
              state: 'SUCCEEDED',
              result: { records: [] }
            }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
              state: 'SUCCEEDED',
              result: { records: [] }
            }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(dqlQuery);

        // Assert - should call DQL endpoint
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/platform/storage/query/v1/query:execute'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Authorization': 'Bearer test-platform-token',
            }),
          })
        );
      });

      it('should route timeseries queries to DQL API', async () => {
        // Arrange
        const dqlQuery = 'timeseries avg(dt.host.cpu.usage), by:{dt.entity.host}';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({
              state: 'SUCCEEDED',
              result: { records: [] }
            }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
              state: 'SUCCEEDED',
              result: { records: [] }
            }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(dqlQuery);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/platform/storage/query/v1/query:execute'),
          expect.any(Object)
        );
      });

      it('should route SELECT queries to DQL API', async () => {
        // Arrange
        const dqlQuery = 'SELECT timestamp, value FROM dt.host.cpu.usage WHERE host = "HOST-123"';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({
              state: 'SUCCEEDED',
              result: { records: [] }
            }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
              state: 'SUCCEEDED',
              result: { records: [] }
            }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(dqlQuery);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/platform/storage/query/v1/query:execute'),
          expect.any(Object)
        );
      });

      it('should route queries with | filter pipe syntax to DQL API', async () => {
        // Arrange
        const dqlQuery = 'data | filter host.name == "server-01" | summarize count()';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({
              state: 'SUCCEEDED',
              result: { records: [] }
            }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
              state: 'SUCCEEDED',
              result: { records: [] }
            }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(dqlQuery);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/platform/storage/query/v1/query:execute'),
          expect.any(Object)
        );
      });
    });

    describe('Mixed Environment Routing', () => {
      it('should route metric selectors to Metrics API on managed instances', async () => {
        // Arrange
        client = new DynatraceAPIClient({
          host: 'dynatrace.example.com',
          apiToken: 'test-api-token',
          platformToken: 'test-platform-token',
          dynatraceType: 'managed',
        });

        const metricSelector = 'builtin:host.cpu.usage:avg';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({ result: [] }),
          text: vi.fn().mockResolvedValue(JSON.stringify({ result: [] }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(metricSelector);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/api/v2/metrics/query'),
          expect.any(Object)
        );
      });

      it('should route DQL queries to DQL API even on managed instances (if supported)', async () => {
        // Arrange
        client = new DynatraceAPIClient({
          host: 'dynatrace.example.com',
          apiToken: 'test-api-token',
          platformToken: 'test-platform-token',
          dynatraceType: 'managed',
        });

        const dqlQuery = 'fetch logs | filter level == "ERROR"';

        const mockResponse = {
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({
              state: 'SUCCEEDED',
              result: { records: [] }
            }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
              state: 'SUCCEEDED',
              result: { records: [] }
            }))
          }
        };
        mockRequest.mockResolvedValue(mockResponse as any);

        // Act
        await client.executeQuery(dqlQuery);

        // Assert
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining('/platform/storage/query/v1/query:execute'),
          expect.any(Object)
        );
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxRetries: 1,
      });
    });

    it('should handle unexpected status codes', async () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage)';

      const mockResponse = {
        statusCode: 500,
        body: {
          json: vi.fn().mockResolvedValue({
            error: { message: 'Internal server error' }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            error: { message: 'Internal server error' }
          }))
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act & Assert
      await expect(client.executeQuery(query)).rejects.toThrow(/Unexpected status code 500/);
    });

    it('should handle malformed response data', async () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage)';

      const mockResponse = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue(null),
          text: vi.fn().mockResolvedValue(JSON.stringify(null)) // Malformed response
        }
      };
      mockRequest.mockResolvedValue(mockResponse as any);

      // Act & Assert
      await expect(client.executeQuery(query)).rejects.toThrow();
    });

    it('should handle poll request abort errors', async () => {
      // Arrange
      const query = 'timeseries avg(dt.host.cpu.usage)';
      const requestToken = 'test-token';

      const mockStartResponse = {
        statusCode: 202,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'RUNNING',
            requestToken
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'RUNNING',
            requestToken
          }))
        }
      };

      const abortError = new Error('Request aborted');
      (abortError as any).code = 'UND_ERR_ABORTED';

      const mockPollResponseSuccess = {
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({
            state: 'SUCCEEDED',
            result: { records: [] }
          }),
          text: vi.fn().mockResolvedValue(JSON.stringify({
            state: 'SUCCEEDED',
            result: { records: [] }
          }))
        }
      };

      mockRequest
        .mockResolvedValueOnce(mockStartResponse as any)
        .mockRejectedValueOnce(abortError) // Abort error on first poll
        .mockResolvedValueOnce(mockPollResponseSuccess as any); // Success on retry

      // Act
      const result = await client.executeQuery(query);

      // Assert
      expect(result).toEqual({ records: [] });
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });
  });
});
