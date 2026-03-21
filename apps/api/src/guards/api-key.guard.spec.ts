/**
 * ApiKeyGuard Test Suite
 *
 * Comprehensive tests for the API key-only authentication guard
 *
 * This guard is a simpler alternative to KeycloakEnhancedAuthGuard,
 * supporting ONLY API key authentication (no Keycloak JWT fallback).
 *
 * Test Coverage Areas:
 * - Public route bypass
 * - Missing/invalid authorization headers
 * - Valid/invalid API key authentication
 * - Request context attachment
 * - Error handling
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysService } from '../modules/api-keys/api-keys.service';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let apiKeysService: jest.Mocked<ApiKeysService>;
  let reflector: jest.Mocked<Reflector>;

  // Mock execution context helper
  const createMockExecutionContext = (
    headers: Record<string, string> = {},
  ): ExecutionContext => {
    const mockRequest: any = {
      headers: headers as any,
      apiKey: undefined,
      authType: undefined,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        {
          provide: ApiKeysService,
          useValue: {
            validateApiKey: jest.fn(),
          },
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
    apiKeysService = module.get(ApiKeysService);
    reflector = module.get(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('Public Route Bypass', () => {
    it('should allow access to public routes without authentication', async () => {
      // Arrange
      const context = createMockExecutionContext({});
      reflector.getAllAndOverride.mockReturnValue(true);

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(apiKeysService.validateApiKey).not.toHaveBeenCalled();
    });

    it('should skip authentication for routes marked with @Public()', async () => {
      // Arrange
      const context = createMockExecutionContext(
        { authorization: 'Bearer test' },
      );
      reflector.getAllAndOverride.mockReturnValue(true);

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalled();
      expect(apiKeysService.validateApiKey).not.toHaveBeenCalled();
    });
  });

  describe('Missing Authorization Header', () => {
    it('should throw UnauthorizedException when Authorization header is missing', async () => {
      // Arrange
      const context = createMockExecutionContext({});
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing Authorization header',
      );
    });

    it('should throw UnauthorizedException when Authorization header is empty string', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: '' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when Authorization header is undefined', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: undefined as any,
      });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Invalid Authorization Header Format', () => {
    it('should throw UnauthorizedException for non-Bearer auth type', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Basic dXNlcjpwYXNzd29yZA==',
      });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid authorization type. Expected Bearer token',
      );
    });

    it('should throw UnauthorizedException when token is missing after Bearer', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'Bearer' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing Bearer token',
      );
    });

    it('should throw UnauthorizedException when token is empty after Bearer', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'Bearer ' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle malformed authorization headers gracefully', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'InvalidFormat',
      });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle authorization header with only spaces', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: '   ' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Valid API Key Authentication', () => {
    it('should authenticate successfully with valid API key', async () => {
      // Arrange
      const validApiKey = Buffer.from('Test API Key#uuid-123').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${validApiKey}`,
      });
      const mockApiKey = {
        id: 'api-key-id-123',
        description: 'Test API Key',
        roles: ['user'],
        validUntil: new Date('2099-12-31'),
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act
      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      // Assert
      expect(result).toBe(true);
      expect(apiKeysService.validateApiKey).toHaveBeenCalledWith(validApiKey);
      expect(request.authType).toBe('api-key');
      expect(request.apiKey).toEqual({
        id: mockApiKey.id,
        description: mockApiKey.description,
        roles: mockApiKey.roles,
        validUntil: mockApiKey.validUntil,
      });
    });

    it('should attach API key details to request on successful authentication', async () => {
      // Arrange
      const validApiKey = Buffer.from('Admin Key#uuid-admin').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${validApiKey}`,
      });
      const mockApiKey = {
        id: 'admin-key-id',
        description: 'Admin Key',
        roles: ['perfana-admin', 'user'],
        validUntil: new Date('2099-12-31'),
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act
      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      // Assert
      expect(request.authType).toBe('api-key');
      expect(request.apiKey.roles).toContain('perfana-admin');
      expect(request.apiKey.roles).toContain('user');
    });

    it('should handle API keys with empty roles array', async () => {
      // Arrange
      const validApiKey = Buffer.from('Limited Key#uuid-limited').toString(
        'base64',
      );
      const context = createMockExecutionContext({
        authorization: `Bearer ${validApiKey}`,
      });
      const mockApiKey = {
        id: 'limited-key-id',
        description: 'Limited Key',
        roles: [],
        validUntil: new Date('2099-12-31'),
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act
      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      // Assert
      expect(result).toBe(true);
      expect(request.apiKey.roles).toEqual([]);
    });

    it('should handle API keys with null validUntil (never expires)', async () => {
      // Arrange
      const validApiKey = Buffer.from('Eternal Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${validApiKey}`,
      });
      const mockApiKey = {
        id: 'eternal-key-id',
        description: 'Eternal Key',
        roles: ['user'],
        validUntil: null,
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act
      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      // Assert
      expect(result).toBe(true);
      expect(request.apiKey.validUntil).toBeNull();
    });
  });

  describe('Invalid API Key Authentication', () => {
    it('should throw UnauthorizedException for invalid API key', async () => {
      // Arrange
      const invalidApiKey = Buffer.from('Invalid Key#uuid-invalid').toString(
        'base64',
      );
      const context = createMockExecutionContext({
        authorization: `Bearer ${invalidApiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid or expired API key',
      );
    });

    it('should throw UnauthorizedException for expired API key', async () => {
      // Arrange
      const expiredApiKey = Buffer.from('Expired Key#uuid-expired').toString(
        'base64',
      );
      const context = createMockExecutionContext({
        authorization: `Bearer ${expiredApiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for malformed base64 API keys', async () => {
      // Arrange
      const malformedKey = 'not-valid-base64!@#$%';
      const context = createMockExecutionContext({
        authorization: `Bearer ${malformedKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when validateApiKey returns falsy value', async () => {
      // Arrange
      const apiKey = Buffer.from('Test Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${apiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(undefined as any);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw UnauthorizedException when API key service throws', async () => {
      // Arrange
      const apiKey = Buffer.from('Test Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${apiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockRejectedValue(
        new Error('Database connection failed'),
      );

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Authentication failed',
      );
    });

    it('should re-throw UnauthorizedException from service as-is', async () => {
      // Arrange
      const apiKey = Buffer.from('Test Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${apiKey}`,
      });
      const customError = new UnauthorizedException('Custom auth error');

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockRejectedValue(customError);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(customError);
    });

    it('should handle service errors with proper error messages', async () => {
      // Arrange
      const apiKey = Buffer.from('Test Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${apiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockRejectedValue(
        new Error('Redis connection timeout'),
      );

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Authentication failed',
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long API key tokens', async () => {
      // Arrange
      const longToken = 'A'.repeat(10000);
      const context = createMockExecutionContext({
        authorization: `Bearer ${longToken}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle tokens with special characters', async () => {
      // Arrange
      const specialToken = 'token-with-special-chars-!@#$%^&*()';
      const context = createMockExecutionContext({
        authorization: `Bearer ${specialToken}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle null token value', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer null',
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle undefined token value', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer undefined',
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle concurrent authentication requests', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const context1 = createMockExecutionContext({
        authorization: `Bearer ${token}`,
      });
      const context2 = createMockExecutionContext({
        authorization: `Bearer ${token}`,
      });
      const context3 = createMockExecutionContext({
        authorization: `Bearer ${token}`,
      });

      const mockApiKey = {
        id: 'key-id',
        description: 'Test Key',
        roles: ['user'],
        validUntil: new Date('2099-12-31'),
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act
      const results = await Promise.all([
        guard.canActivate(context1),
        guard.canActivate(context2),
        guard.canActivate(context3),
      ]);

      // Assert
      expect(results).toEqual([true, true, true]);
      expect(apiKeysService.validateApiKey).toHaveBeenCalledTimes(3);
    });

    it('should handle authorization header with multiple spaces', async () => {
      // Arrange
      const apiKey = Buffer.from('Test Key#uuid').toString('base64');
      // Multiple spaces between Bearer and token will create empty token
      const context = createMockExecutionContext({
        authorization: `Bearer     ${apiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert - The guard splits on space, so extra spaces create empty token
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing Bearer token',
      );
    });

    it('should handle authorization header case variations', async () => {
      // Arrange
      const apiKey = Buffer.from('Test Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `bearer ${apiKey}`, // lowercase
      });

      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert - Guard expects exact "Bearer" match
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
