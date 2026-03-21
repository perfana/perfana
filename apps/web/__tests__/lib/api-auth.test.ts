/**
 * Unit tests for API Authentication Utilities
 *
 * Tests the core API authentication functions:
 * - getAuthHeaders: Retrieves authentication headers (Keycloak or fallback token)
 * - handleAuthError: Handles 401 errors with token refresh logic
 * - authenticatedFetch: Makes authenticated API requests with auto-retry
 */

import { getAuthHeaders, handleAuthError, authenticatedFetch } from '@/lib/api';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock window.location
delete (window as any).location;
window.location = {
  href: 'http://localhost:3000',
  origin: 'http://localhost:3000',
} as any;

// Mock environment
jest.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://localhost:3001/api',
    USE_KEYCLOAK_AUTH: false,
    KEYCLOAK_URL: 'http://localhost:8080',
    KEYCLOAK_REALM: 'perfana-test',
    KEYCLOAK_CLIENT_ID: 'perfana-web',
  },
}));

// Mock keycloak-auth
const mockGetToken = jest.fn();
const mockIsAuthenticated = jest.fn();
const mockUpdateToken = jest.fn();
const mockLogin = jest.fn();

jest.mock('@/lib/keycloak-auth', () => ({
  __esModule: true,
  default: {
    getToken: mockGetToken,
    isAuthenticated: mockIsAuthenticated,
    updateToken: mockUpdateToken,
    login: mockLogin,
  },
}));

// Mock fetch globally
global.fetch = jest.fn();

describe('API Authentication Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockGetToken.mockReturnValue(undefined);
    mockIsAuthenticated.mockReturnValue(false);
  });

  describe('getAuthHeaders()', () => {
    describe('Traditional Token Authentication', () => {
      it('should return Authorization header with Bearer token when traditional token exists', () => {
        // Arrange
        localStorageMock.setItem('perfana_access_token', 'traditional-token-123');

        // Act
        const headers = getAuthHeaders();

        // Assert
        expect(headers).toEqual({
          Authorization: 'Bearer traditional-token-123',
        });
      });

      it('should return empty object when no token exists', () => {
        // Arrange - no tokens set

        // Act
        const headers = getAuthHeaders();

        // Assert
        expect(headers).toEqual({});
      });
    });

    describe('Server-Side Rendering (SSR)', () => {
      it('should return empty object when called on server (window undefined)', () => {
        // Arrange
        const originalWindow = global.window;
        delete (global as any).window;

        // Act
        const headers = getAuthHeaders();

        // Assert
        expect(headers).toEqual({});

        // Restore
        (global as any).window = originalWindow;
      });
    });
  });

  describe('handleAuthError()', () => {
    describe('401 Unauthorized - Traditional Token Refresh', () => {
      it('should refresh token and return true when refresh succeeds', async () => {
        // Arrange
        localStorageMock.setItem('perfana_refresh_token', 'refresh-token-abc');

        const mockResponse = new Response(null, { status: 401 });
        const mockRefreshResponse = {
          ok: true,
          json: async () => ({
            session: {
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
            },
          }),
        };

        (global.fetch as jest.Mock).mockResolvedValue(mockRefreshResponse);

        // Act
        const result = await handleAuthError(mockResponse);

        // Assert
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/auth/refresh',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: 'refresh-token-abc' }),
          })
        );
        expect(result).toBe(true);
        expect(localStorageMock.getItem('perfana_access_token')).toBe('new-access-token');
        expect(localStorageMock.getItem('perfana_refresh_token')).toBe('new-refresh-token');
      });

      it('should clear tokens and redirect to signin when refresh fails', async () => {
        // Arrange
        localStorageMock.setItem('perfana_access_token', 'old-access-token');
        localStorageMock.setItem('perfana_refresh_token', 'old-refresh-token');
        localStorageMock.setItem('perfana_user', JSON.stringify({ id: '123' }));

        const mockResponse = new Response(null, { status: 401 });
        const mockRefreshResponse = {
          ok: false,
          status: 401,
        };

        (global.fetch as jest.Mock).mockResolvedValue(mockRefreshResponse);

        // Act
        const result = await handleAuthError(mockResponse);

        // Assert
        expect(result).toBe(false);
        expect(localStorageMock.getItem('perfana_access_token')).toBeNull();
        expect(localStorageMock.getItem('perfana_refresh_token')).toBeNull();
        expect(localStorageMock.getItem('perfana_user')).toBeNull();
        expect(window.location.href).toBe('/signin');
      });

      it('should handle network errors during refresh gracefully', async () => {
        // Arrange
        localStorageMock.setItem('perfana_refresh_token', 'refresh-token-abc');

        const mockResponse = new Response(null, { status: 401 });
        (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

        // Act
        const result = await handleAuthError(mockResponse);

        // Assert
        expect(result).toBe(false);
        expect(window.location.href).toBe('/signin');
      });

      it('should redirect to signin when no refresh token exists', async () => {
        // Arrange - no refresh token
        const mockResponse = new Response(null, { status: 401 });

        // Act
        const result = await handleAuthError(mockResponse);

        // Assert
        expect(result).toBe(false);
        expect(window.location.href).toBe('/signin');
      });
    });

    describe('Non-401 Status Codes', () => {
      it('should return false for 403 Forbidden', async () => {
        // Arrange
        const mockResponse = new Response(null, { status: 403 });

        // Act
        const result = await handleAuthError(mockResponse);

        // Assert
        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('should return false for 500 Internal Server Error', async () => {
        // Arrange
        const mockResponse = new Response(null, { status: 500 });

        // Act
        const result = await handleAuthError(mockResponse);

        // Assert
        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('should return false for 200 OK', async () => {
        // Arrange
        const mockResponse = new Response(null, { status: 200 });

        // Act
        const result = await handleAuthError(mockResponse);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('authenticatedFetch()', () => {
    describe('Successful Requests', () => {
      it('should make authenticated request with auth headers', async () => {
        // Arrange
        localStorageMock.setItem('perfana_access_token', 'token-123');
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: 'test' }),
        };
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

        // Act
        const response = await authenticatedFetch('/test-endpoint');

        // Assert
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/test-endpoint',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer token-123',
            }),
          })
        );
        expect(response.ok).toBe(true);
      });

      it('should handle absolute URLs correctly', async () => {
        // Arrange
        const mockResponse = { ok: true, status: 200, statusText: 'OK' };
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

        // Act
        await authenticatedFetch('http://external-api.com/endpoint');

        // Assert
        expect(global.fetch).toHaveBeenCalledWith(
          'http://external-api.com/endpoint',
          expect.any(Object)
        );
      });

      it('should preserve custom headers from options', async () => {
        // Arrange
        localStorageMock.setItem('perfana_access_token', 'token-123');
        const mockResponse = { ok: true, status: 200, statusText: 'OK' };
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

        // Act
        await authenticatedFetch('/test', {
          headers: {
            'Content-Type': 'application/json',
            'X-Custom-Header': 'custom-value',
          },
        });

        // Assert
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/test',
          expect.objectContaining({
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
              'X-Custom-Header': 'custom-value',
              Authorization: 'Bearer token-123',
            }),
          })
        );
      });

      it('should support POST requests with body', async () => {
        // Arrange
        const mockResponse = { ok: true, status: 201, statusText: 'Created' };
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

        const requestBody = { name: 'Test', value: 123 };

        // Act
        await authenticatedFetch('/api-keys', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        // Assert
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/api-keys',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(requestBody),
          })
        );
      });
    });

    describe('401 Auto-Retry Logic', () => {
      it('should retry request once after successful token refresh', async () => {
        // Arrange
        localStorageMock.setItem('perfana_access_token', 'old-token');
        localStorageMock.setItem('perfana_refresh_token', 'refresh-token');

        const mock401Response = {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        };

        const mockRefreshResponse = {
          ok: true,
          json: async () => ({
            session: {
              access_token: 'new-token',
              refresh_token: 'new-refresh-token',
            },
          }),
        };

        const mockSuccessResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: 'success' }),
        };

        // First call returns 401, refresh call succeeds, retry succeeds
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce(mock401Response) // Initial request
          .mockResolvedValueOnce(mockRefreshResponse) // Refresh token
          .mockResolvedValueOnce(mockSuccessResponse); // Retry request

        // Act
        const response = await authenticatedFetch('/test-endpoint');

        // Assert
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(response.ok).toBe(true);
        expect(localStorageMock.getItem('perfana_access_token')).toBe('new-token');
      });

      it('should not retry when token refresh fails', async () => {
        // Arrange
        localStorageMock.setItem('perfana_refresh_token', 'invalid-refresh-token');

        const mock401Response = {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        };

        const mockFailedRefresh = {
          ok: false,
          status: 401,
        };

        (global.fetch as jest.Mock)
          .mockResolvedValueOnce(mock401Response) // Initial request
          .mockResolvedValueOnce(mockFailedRefresh); // Failed refresh

        // Act
        const response = await authenticatedFetch('/test-endpoint');

        // Assert
        expect(global.fetch).toHaveBeenCalledTimes(2); // No retry
        expect(response.status).toBe(401);
        expect(window.location.href).toBe('/signin');
      });

      it('should use new token in retry request headers', async () => {
        // Arrange
        localStorageMock.setItem('perfana_access_token', 'old-token');
        localStorageMock.setItem('perfana_refresh_token', 'refresh-token');

        const mock401Response = { ok: false, status: 401, statusText: 'Unauthorized' };
        const mockRefreshResponse = {
          ok: true,
          json: async () => ({
            session: {
              access_token: 'new-token-xyz',
              refresh_token: 'new-refresh-token',
            },
          }),
        };
        const mockSuccessResponse = { ok: true, status: 200, statusText: 'OK' };

        (global.fetch as jest.Mock)
          .mockResolvedValueOnce(mock401Response)
          .mockResolvedValueOnce(mockRefreshResponse)
          .mockResolvedValueOnce(mockSuccessResponse);

        // Act
        await authenticatedFetch('/test');

        // Assert
        const retryCall = (global.fetch as jest.Mock).mock.calls[2];
        expect(retryCall[1].headers.Authorization).toBe('Bearer new-token-xyz');
      });
    });

    describe('Error Handling', () => {
      it('should handle network errors', async () => {
        // Arrange
        (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

        // Act & Assert
        await expect(authenticatedFetch('/test')).rejects.toThrow('Network error');
      });

      it('should return error response without throwing for 404', async () => {
        // Arrange
        const mock404Response = {
          ok: false,
          status: 404,
          statusText: 'Not Found',
        };
        (global.fetch as jest.Mock).mockResolvedValue(mock404Response);

        // Act
        const response = await authenticatedFetch('/test');

        // Assert
        expect(response.ok).toBe(false);
        expect(response.status).toBe(404);
      });

      it('should return error response without throwing for 500', async () => {
        // Arrange
        const mock500Response = {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        };
        (global.fetch as jest.Mock).mockResolvedValue(mock500Response);

        // Act
        const response = await authenticatedFetch('/test');

        // Assert
        expect(response.ok).toBe(false);
        expect(response.status).toBe(500);
      });
    });

    describe('URL Construction', () => {
      it('should handle URLs with leading slash', async () => {
        // Arrange
        const mockResponse = { ok: true, status: 200, statusText: 'OK' };
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

        // Act
        await authenticatedFetch('/api/test-runs');

        // Assert
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/api/test-runs',
          expect.any(Object)
        );
      });

      it('should handle URLs without leading slash', async () => {
        // Arrange
        const mockResponse = { ok: true, status: 200, statusText: 'OK' };
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

        // Act
        await authenticatedFetch('test-runs');

        // Assert
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/test-runs',
          expect.any(Object)
        );
      });

      it('should handle query parameters', async () => {
        // Arrange
        const mockResponse = { ok: true, status: 200, statusText: 'OK' };
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

        // Act
        await authenticatedFetch('/test-runs?page=1&limit=50');

        // Assert
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/test-runs?page=1&limit=50',
          expect.any(Object)
        );
      });
    });
  });
});
