/**
 * Grafana API Client Unit Tests
 *
 * Tests the Grafana API client functionality including:
 * - Request batching
 * - Response processing
 * - Error handling
 * - Retry logic
 */

import { describe, test, expect, beforeEach, vi, Mock } from 'vitest';
import { GrafanaAPIClient } from '@perfana/shared/services/grafana';
import { mockGrafanaAPI, createMockGrafanaRequest } from '../../mocks/grafana.js';
import { panelDocumentFixtures } from '../../fixtures/test-data.js';

// Mock axios at module level (vi.hoisted — vi.mock factories are hoisted above const declarations)
const { mockAxiosCreate } = vi.hoisted(() => ({ mockAxiosCreate: vi.fn() }));

vi.mock('axios', () => ({
  default: {
    create: mockAxiosCreate
  },
  isAxiosError: vi.fn(() => false)
}));

// TODO: GrafanaAPIClient test - requires HTTP mock setup
describe.skip('GrafanaAPIClient', () => {
  let client: GrafanaAPIClient;
  let mockAxios: any;

  beforeEach(() => {
    const mock = mockGrafanaAPI();
    mockAxios = mock.mockAxios;

    // Reset and configure axios mock
    vi.clearAllMocks();
    mockAxiosCreate.mockReturnValue(mockAxios);

    client = new GrafanaAPIClient({
      baseURL: 'http://localhost:3000',
      apiKey: 'test-api-key'
    });
  });

  describe('Configuration', () => {
    test('should initialize with correct configuration', () => {
      expect(client).toBeInstanceOf(GrafanaAPIClient);
    });

    test('should handle missing API key gracefully', () => {
      expect(() => {
        new GrafanaAPIClient({
          baseURL: 'http://localhost:3000',
          apiKey: ''
        });
      }).not.toThrow();
    });

    test('should handle invalid base URL', () => {
      expect(() => {
        new GrafanaAPIClient({
          baseURL: 'invalid-url',
          apiKey: 'test-key'
        });
      }).not.toThrow();
    });
  });

  describe('Single Query Execution', () => {
    test('should execute single query successfully', async () => {
      const request = createMockGrafanaRequest();

      const result = await client.executeQuery(request);

      expect(mockAxios.post).toHaveBeenCalledWith(
        request.endpoint,
        request.request_body,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    test('should handle query timeout', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Request timeout'));

      const request = createMockGrafanaRequest();
      const result = await client.executeQuery(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Request timeout');
    });

    test('should handle authentication errors', async () => {
      mockAxios.post.mockResolvedValueOnce({
        status: 401,
        data: { error: 'Unauthorized' }
      });

      const request = createMockGrafanaRequest();
      const result = await client.executeQuery(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication failed');
    });

    test('should handle server errors', async () => {
      mockAxios.post.mockResolvedValueOnce({
        status: 500,
        data: { error: 'Internal Server Error' }
      });

      const request = createMockGrafanaRequest();
      const result = await client.executeQuery(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server error');
    });
  });

  describe('Batch Query Execution', () => {
    test('should execute multiple queries in batch', async () => {
      const panels = [
        panelDocumentFixtures.responseTimePanel(),
        panelDocumentFixtures.requestRatePanel()
      ];

      const timeRange = {
        from: new Date('2024-01-01T10:00:00Z'),
        to: new Date('2024-01-01T11:00:00Z')
      };

      const results = await client.executeBatchQueries(panels, timeRange, { batchSize: 2 });

      expect(results).toHaveLength(2);
      expect(mockAxios.post).toHaveBeenCalled();

      results.forEach(result => {
        expect(result).toHaveProperty('panel');
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('data');
      });
    });

    test('should handle partial batch failures', async () => {
      const panels = [
        panelDocumentFixtures.responseTimePanel(),
        panelDocumentFixtures.requestRatePanel()
      ];

      // Mock first call success, second call failure
      mockAxios.post
        .mockResolvedValueOnce({
          status: 200,
          data: { results: { A: { status: 200, frames: [] } } }
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const timeRange = {
        from: new Date('2024-01-01T10:00:00Z'),
        to: new Date('2024-01-01T11:00:00Z')
      };

      const results = await client.executeBatchQueries(panels, timeRange, { batchSize: 1 });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toContain('Network error');
    });

    test('should respect batch size configuration', async () => {
      const panels = Array(5).fill(null).map(() => panelDocumentFixtures.responseTimePanel());
      const timeRange = {
        from: new Date('2024-01-01T10:00:00Z'),
        to: new Date('2024-01-01T11:00:00Z')
      };

      await client.executeBatchQueries(panels, timeRange, { batchSize: 2 });

      // Should make 3 calls (2+2+1 panels)
      expect(mockAxios.post).toHaveBeenCalledTimes(3);
    });
  });

  describe('Request Processing', () => {
    test('should add path parameters to URL', async () => {
      const requestWithParams = {
        ...createMockGrafanaRequest(),
        path_parameters: { dashboardUid: 'abc123', panelId: '1' }
      };

      await client.executeQuery(requestWithParams);

      const callArgs = mockAxios.post.mock.calls[0];
      expect(callArgs[0]).toContain('dashboardUid=abc123');
      expect(callArgs[0]).toContain('panelId=1');
    });

    test('should handle missing path parameters gracefully', async () => {
      const request = createMockGrafanaRequest();
      delete (request as any).path_parameters;

      await client.executeQuery(request);

      expect(mockAxios.post).toHaveBeenCalledWith(
        request.endpoint,
        request.request_body,
        expect.any(Object)
      );
    });

    test('should set correct request headers', async () => {
      const request = createMockGrafanaRequest();

      await client.executeQuery(request);

      const callArgs = mockAxios.post.mock.calls[0];
      const config = callArgs[2];

      expect(config.headers).toMatchObject({
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json'
      });
    });
  });

  describe('Response Processing', () => {
    test('should process successful Grafana response', async () => {
      const mockResponse = {
        status: 200,
        data: {
          results: {
            A: {
              status: 200,
              frames: [
                {
                  schema: {
                    fields: [
                      { name: 'Time', type: 'time' },
                      { name: 'Value', type: 'number' }
                    ]
                  },
                  data: {
                    values: [
                      [1704110400000, 1704110460000],
                      [0.125, 0.130]
                    ]
                  }
                }
              ]
            }
          }
        }
      };

      mockAxios.post.mockResolvedValueOnce(mockResponse);

      const request = createMockGrafanaRequest();
      const result = await client.executeQuery(request);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.frames).toHaveLength(1);
    });

    test('should handle empty query results', async () => {
      const mockResponse = {
        status: 200,
        data: {
          results: {
            A: {
              status: 200,
              frames: []
            }
          }
        }
      };

      mockAxios.post.mockResolvedValueOnce(mockResponse);

      const request = createMockGrafanaRequest();
      const result = await client.executeQuery(request);

      expect(result.success).toBe(true);
      expect(result.data?.frames).toHaveLength(0);
    });

    test('should handle malformed response data', async () => {
      mockAxios.post.mockResolvedValueOnce({
        status: 200,
        data: null // Malformed response
      });

      const request = createMockGrafanaRequest();
      const result = await client.executeQuery(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid response format');
    });
  });

  describe('Rate Limiting and Retries', () => {
    test('should handle rate limiting with exponential backoff', async () => {
      // Mock rate limit response then success
      mockAxios.post
        .mockResolvedValueOnce({ status: 429, data: { error: 'Rate limit exceeded' } })
        .mockResolvedValueOnce({ status: 200, data: { results: { A: { status: 200, frames: [] } } } });

      const request = createMockGrafanaRequest();
      const result = await client.executeQuery(request);

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    test('should give up after maximum retries', async () => {
      // Mock continuous failures
      mockAxios.post.mockResolvedValue({
        status: 429,
        data: { error: 'Rate limit exceeded' }
      });

      const request = createMockGrafanaRequest();
      const result = await client.executeQuery(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
      expect(mockAxios.post).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('Concurrent Request Handling', () => {
    test('should handle multiple concurrent requests', async () => {
      const requests = Array(5).fill(null).map(() => createMockGrafanaRequest());

      const promises = requests.map(request => client.executeQuery(request));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      expect(results.every(result => result.success)).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledTimes(5);
    });

    test('should handle concurrent request failures independently', async () => {
      // Mock alternating success/failure
      mockAxios.post
        .mockResolvedValueOnce({ status: 200, data: { results: { A: { status: 200, frames: [] } } } })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ status: 200, data: { results: { A: { status: 200, frames: [] } } } });

      const requests = [
        createMockGrafanaRequest('A'),
        createMockGrafanaRequest('B'),
        createMockGrafanaRequest('C')
      ];

      const promises = requests.map(request => client.executeQuery(request));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });
  });
});