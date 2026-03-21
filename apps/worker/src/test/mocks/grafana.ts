/**
 * Grafana API Mock Helpers
 *
 * Provides mock responses and utilities for testing Grafana API integration
 */

import { vi } from 'vitest';
import { GrafanaRequest } from '../../types/pipeline.js';

export interface MockGrafanaResponse {
  status: 'success' | 'error';
  data?: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }>;
  };
  error?: string;
  errorType?: string;
}

/**
 * Create mock Grafana API responses for testing
 */
export function createMockGrafanaResponses(): {
  success: MockGrafanaResponse;
  error: MockGrafanaResponse;
  empty: MockGrafanaResponse;
} {
  return {
    success: {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { __name__: 'http_request_duration_seconds', instance: 'app-001' },
            values: [
              [1704110400, '0.125'], // 2024-01-01 10:00:00
              [1704110460, '0.130'], // 2024-01-01 10:01:00
              [1704110520, '0.128'], // 2024-01-01 10:02:00
              [1704110580, '0.135'], // 2024-01-01 10:03:00
              [1704110640, '0.142']  // 2024-01-01 10:04:00
            ]
          },
          {
            metric: { __name__: 'http_request_duration_seconds', instance: 'app-002' },
            values: [
              [1704110400, '0.115'],
              [1704110460, '0.120'],
              [1704110520, '0.118'],
              [1704110580, '0.125'],
              [1704110640, '0.132']
            ]
          }
        ]
      }
    },
    error: {
      status: 'error',
      error: 'Query timeout',
      errorType: 'timeout'
    },
    empty: {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: []
      }
    }
  };
}

/**
 * Mock axios for Grafana API calls
 */
export function mockGrafanaAPI() {
  const responses = createMockGrafanaResponses();

  // Mock successful response by default
  const mockPost = vi.fn().mockImplementation(async (url: string, data: any) => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // Check if it's a Grafana query request
    if (url.includes('/api/ds/query') && data.queries) {
      return {
        status: 200,
        data: {
          results: data.queries.reduce((acc: any, query: any) => {
            acc[query.refId] = {
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
                      [1704110400000, 1704110460000, 1704110520000],
                      [0.125, 0.130, 0.128]
                    ]
                  }
                }
              ]
            };
            return acc;
          }, {})
        }
      };
    }

    return { status: 200, data: responses.success };
  });

  const mockAxios = {
    post: mockPost,
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(() => mockAxios),
    defaults: {},
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() }
    }
  };

  return { mockAxios, mockPost, responses };
}

/**
 * Create mock Grafana request for testing
 */
export function createMockGrafanaRequest(
  refId: string = 'A',
  expr: string = 'up{job="test"}'
): GrafanaRequest {
  return {
    endpoint: '/api/ds/query',
    method: 'POST',
    request_body: {
      queries: [
        {
          refId,
          expr,
          datasource: {
            type: 'prometheus',
            uid: 'prometheus-uid'
          },
          format: 'time_series',
          intervalMs: 60000,
          maxDataPoints: 1000
        }
      ],
      from_: '2024-01-01T10:00:00Z',
      to: '2024-01-01T11:00:00Z'
    }
  };
}

/**
 * Simulate Grafana API errors for error handling tests
 */
export function mockGrafanaAPIError(errorType: 'network' | 'timeout' | 'auth' | 'server') {
  const mockPost = vi.fn();

  switch (errorType) {
    case 'network':
      mockPost.mockRejectedValue(new Error('Network Error'));
      break;
    case 'timeout':
      mockPost.mockRejectedValue(new Error('Request timeout'));
      break;
    case 'auth':
      mockPost.mockResolvedValue({
        status: 401,
        data: { error: 'Unauthorized' }
      });
      break;
    case 'server':
      mockPost.mockResolvedValue({
        status: 500,
        data: { error: 'Internal Server Error' }
      });
      break;
  }

  return mockPost;
}