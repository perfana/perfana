/**
 * Unit tests for API Keys Client
 *
 * Tests the API keys management functions:
 * - fetchApiKeys: Retrieve all API keys
 * - createApiKey: Create a new API key with TTL
 * - deleteApiKey: Delete an API key by ID
 * - validateApiKey: Validate an API key token
 */

import {
  fetchApiKeys,
  createApiKey,
  deleteApiKey,
  validateApiKey,
  ApiKeyRequestError,
  type ApiKey,
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
} from '@/lib/api-keys';
import * as api from '@/lib/api';

// Mock authenticatedFetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockAuthenticatedFetch = api.authenticatedFetch as jest.MockedFunction<
  typeof api.authenticatedFetch
>;

global.fetch = jest.fn();

describe('API Keys Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchApiKeys()', () => {
    it('should fetch all API keys successfully', async () => {
      // Arrange
      const mockApiKeys: ApiKey[] = [
        {
          id: 'key-1',
          description: 'Test Key 1',
          valid_until: '2025-12-31T23:59:59Z',
          created_at: '2025-01-01T00:00:00Z',
          last_used: '2025-01-15T10:30:00Z',
        },
        {
          id: 'key-2',
          description: 'Test Key 2',
          valid_until: '2026-01-31T23:59:59Z',
          created_at: '2025-02-01T00:00:00Z',
        },
      ];

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiKeys,
      } as Response);

      // Act
      const result = await fetchApiKeys();

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/api-keys', {
        cache: 'no-store',
      });
      expect(result).toEqual(mockApiKeys);
    });

    it('should throw error when fetch fails', async () => {
      // Arrange
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      // Act & Assert
      await expect(fetchApiKeys()).rejects.toThrow('Failed to fetch API keys');
    });

    it('should return empty array when no API keys exist', async () => {
      // Arrange
      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      // Act
      const result = await fetchApiKeys();

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle network errors', async () => {
      // Arrange
      mockAuthenticatedFetch.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(fetchApiKeys()).rejects.toThrow('Network error');
    });
  });

  describe('createApiKey()', () => {
    it('should create API key successfully with description and TTL', async () => {
      // Arrange
      const requestData: CreateApiKeyRequest = {
        description: 'My Test API Key',
        ttl: '90d',
      };

      const mockResponse: CreateApiKeyResponse = {
        apiKey: {
          id: 'new-key-123',
          description: 'My Test API Key',
          valid_until: '2025-04-11T00:00:00Z',
          created_at: '2025-01-11T00:00:00Z',
        },
        token: 'base64encodedtoken==',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createApiKey(requestData);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      expect(result).toEqual(mockResponse);
      expect(result.token).toBe('base64encodedtoken==');
    });

    it('should handle different TTL formats', async () => {
      // Arrange - TTL in hours
      const requestData: CreateApiKeyRequest = {
        description: 'Short-lived key',
        ttl: '24h',
      };

      const mockResponse: CreateApiKeyResponse = {
        apiKey: {
          id: 'temp-key',
          description: 'Short-lived key',
          valid_until: '2025-01-12T00:00:00Z',
          created_at: '2025-01-11T00:00:00Z',
        },
        token: 'temptoken==',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Act
      const result = await createApiKey(requestData);

      // Assert
      expect(result.apiKey.description).toBe('Short-lived key');
    });

    it('should throw error with message when creation fails', async () => {
      // Arrange
      const requestData: CreateApiKeyRequest = {
        description: 'Invalid key',
        ttl: 'invalid',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid TTL format' }),
      } as Response);

      // Act & Assert
      await expect(createApiKey(requestData)).rejects.toThrow('Invalid TTL format');
    });

    it('should throw generic error when error response has no message', async () => {
      // Arrange
      const requestData: CreateApiKeyRequest = {
        description: 'Test',
        ttl: '30d',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      // Act & Assert
      await expect(createApiKey(requestData)).rejects.toThrow('Failed to create API key');
    });

    it('should throw ApiKeyRequestError with status 409 on duplicate description', async () => {
      // Arrange — issue #117: backend now returns 409 when the same
      // description is reused within the same organization.
      const requestData: CreateApiKeyRequest = {
        description: 'CI',
        ttl: '30d',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          message: 'An API key with description "CI" already exists in this organization.',
        }),
      } as Response);

      // Act & Assert
      await expect(createApiKey(requestData)).rejects.toBeInstanceOf(
        ApiKeyRequestError,
      );
      await expect(createApiKey(requestData)).rejects.toMatchObject({
        status: 409,
        message: expect.stringMatching(/already exists in this organization/),
      });
    });

    it('should handle unauthorized errors (401)', async () => {
      // Arrange
      const requestData: CreateApiKeyRequest = {
        description: 'Test',
        ttl: '30d',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      } as Response);

      // Act & Assert
      await expect(createApiKey(requestData)).rejects.toThrow('Unauthorized');
    });
  });

  describe('deleteApiKey()', () => {
    it('should delete API key successfully', async () => {
      // Arrange
      const keyId = 'key-to-delete-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      // Act
      await deleteApiKey(keyId);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/api-keys/${keyId}`, {
        method: 'DELETE',
      });
    });

    it('should throw error with message when deletion fails', async () => {
      // Arrange
      const keyId = 'non-existent-key';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'API key not found' }),
      } as Response);

      // Act & Assert
      await expect(deleteApiKey(keyId)).rejects.toThrow('API key not found');
    });

    it('should throw generic error when error response has no message', async () => {
      // Arrange
      const keyId = 'some-key';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      // Act & Assert
      await expect(deleteApiKey(keyId)).rejects.toThrow('Failed to delete API key');
    });

    it('should handle forbidden errors (403)', async () => {
      // Arrange
      const keyId = 'protected-key';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Forbidden' }),
      } as Response);

      // Act & Assert
      await expect(deleteApiKey(keyId)).rejects.toThrow('Forbidden');
    });

    it('should handle network errors during deletion', async () => {
      // Arrange
      const keyId = 'some-key';
      mockAuthenticatedFetch.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(deleteApiKey(keyId)).rejects.toThrow('Network error');
    });
  });

  describe('validateApiKey()', () => {
    it('should return true when API key is valid', async () => {
      // Arrange
      const validToken = 'valid-base64-token==';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      } as Response);

      // Act
      const isValid = await validateApiKey(validToken);

      // Assert
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/api-keys/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: validToken }),
      });
      expect(isValid).toBe(true);
    });

    it('should return false when API key is invalid', async () => {
      // Arrange
      const invalidToken = 'invalid-token';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: false }),
      } as Response);

      // Act
      const isValid = await validateApiKey(invalidToken);

      // Assert
      expect(isValid).toBe(false);
    });

    it('should return false when validation endpoint returns error', async () => {
      // Arrange
      const token = 'some-token';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 400,
      } as Response);

      // Act
      const isValid = await validateApiKey(token);

      // Assert
      expect(isValid).toBe(false);
    });

    it('should return false when API key is expired', async () => {
      // Arrange
      const expiredToken = 'expired-token';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: false, reason: 'expired' }),
      } as Response);

      // Act
      const isValid = await validateApiKey(expiredToken);

      // Assert
      expect(isValid).toBe(false);
    });

    it('should return false when network error occurs', async () => {
      // Arrange
      const token = 'some-token';
      mockAuthenticatedFetch.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(validateApiKey(token)).rejects.toThrow('Network error');
    });

    it('should handle malformed JSON responses', async () => {
      // Arrange
      const token = 'some-token';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Response);

      // Act & Assert
      await expect(validateApiKey(token)).rejects.toThrow('Invalid JSON');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete API key lifecycle: create -> validate -> delete', async () => {
      // Arrange
      const createData: CreateApiKeyRequest = {
        description: 'Lifecycle Test Key',
        ttl: '30d',
      };

      const createdKey: CreateApiKeyResponse = {
        apiKey: {
          id: 'lifecycle-key',
          description: 'Lifecycle Test Key',
          valid_until: '2025-02-10T00:00:00Z',
          created_at: '2025-01-11T00:00:00Z',
        },
        token: 'lifecycle-token==',
      };

      // Mock create
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createdKey,
      } as Response);

      // Mock validate (now uses authenticatedFetch)
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true }),
      } as Response);

      // Mock delete
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      // Act
      const created = await createApiKey(createData);
      const isValid = await validateApiKey(created.token);
      await deleteApiKey(created.apiKey.id);

      // Assert
      expect(created.apiKey.id).toBe('lifecycle-key');
      expect(isValid).toBe(true);
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/api-keys/${created.apiKey.id}`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
