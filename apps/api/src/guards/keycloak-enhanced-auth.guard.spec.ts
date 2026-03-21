/**
 * KeycloakEnhancedAuthGuard Test Suite
 *
 * CRITICAL SECURITY COMPONENT - Comprehensive tests for dual authentication
 *
 * This guard is the primary security gatekeeper for the Perfana API.
 * It supports two authentication methods:
 * 1. API Key authentication (highest priority)
 * 2. Keycloak JWT authentication (fallback)
 *
 * Test Coverage Areas:
 * - Public route bypass
 * - Missing/invalid authorization headers
 * - API key authentication (valid, invalid, expired, malformed)
 * - Keycloak JWT authentication (valid, invalid, expired, malformed)
 * - Fallback behavior between auth methods
 * - Admin role checking
 * - Static helper methods
 * - Edge cases and security scenarios
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { KeycloakEnhancedAuthGuard, AuthenticatedRequest } from './keycloak-enhanced-auth.guard';
import { ApiKeysService } from '../modules/api-keys/api-keys.service';
import { KeycloakUser } from '../types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_ADMIN_ONLY_KEY } from '../decorators/admin-only.decorator';

// Mock jose library for JWT verification
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
}));

describe('KeycloakEnhancedAuthGuard', () => {
  let guard: KeycloakEnhancedAuthGuard;
  let apiKeysService: jest.Mocked<ApiKeysService>;
  let reflector: jest.Mocked<Reflector>;

  // Mock execution context helper
  const createMockExecutionContext = (
    headers: Record<string, string> = {},
  ): ExecutionContext => {
    const mockRequest: Partial<AuthenticatedRequest> = {
      headers: headers as any,
      user: undefined,
      authType: undefined,
      apiKey: undefined,
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
        KeycloakEnhancedAuthGuard,
        {
          provide: ApiKeysService,
          useValue: {
            validateApiKey: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                KEYCLOAK_URL: 'http://localhost:8080',
                KEYCLOAK_REALM: 'perfana-test',
                KEYCLOAK_CLIENT_ID: 'perfana-api',
              };
              return config[key] || defaultValue;
            }),
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

    guard = module.get<KeycloakEnhancedAuthGuard>(KeycloakEnhancedAuthGuard);
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
      const context = createMockExecutionContext({ authorization: 'Bearer test' });
      reflector.getAllAndOverride.mockReturnValue(true);

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalled();
    });
  });

  describe('Missing Authorization Header', () => {
    it('should throw UnauthorizedException when Authorization header is missing', async () => {
      // Arrange
      const context = createMockExecutionContext({});
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Missing Authorization header');
    });

    it('should throw UnauthorizedException when Authorization header is empty string', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: '' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when Authorization header is undefined', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: undefined as any });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
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
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid authorization type. Expected Bearer token',
      );
    });

    it('should throw UnauthorizedException when token is missing after Bearer', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'Bearer' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token is empty after Bearer', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'Bearer ' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle malformed authorization headers gracefully', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'InvalidFormat',
      });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('API Key Authentication - Valid Scenarios', () => {
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
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

      // Assert
      expect(result).toBe(true);
      expect(apiKeysService.validateApiKey).toHaveBeenCalledWith(validApiKey);
      expect(request.authType).toBe('api-key');
      expect(request.apiKey).toEqual({
        id: mockApiKey.id,
        description: mockApiKey.description,
        roles: mockApiKey.roles,
        validUntil: mockApiKey.validUntil,
        organization_id: undefined,
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
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

      // Assert
      expect(request.authType).toBe('api-key');
      expect(request.apiKey?.roles).toContain('perfana-admin');
      expect(request.apiKey?.roles).toContain('user');
    });

    it('should handle API keys with empty roles array', async () => {
      // Arrange
      const validApiKey = Buffer.from('Limited Key#uuid-limited').toString('base64');
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
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

      // Assert
      expect(result).toBe(true);
      expect(request.apiKey?.roles).toEqual([]);
    });
  });

  describe('API Key Authentication - Invalid Scenarios', () => {
    it('should reject invalid API key', async () => {
      // Arrange
      const invalidApiKey = Buffer.from('Invalid Key#uuid-invalid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${invalidApiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired token');
    });

    it('should reject expired API key', async () => {
      // Arrange
      const expiredApiKey = Buffer.from('Expired Key#uuid-expired').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${expiredApiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle API key service errors gracefully', async () => {
      // Arrange
      const apiKey = Buffer.from('Test Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${apiKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject malformed base64 API keys', async () => {
      // Arrange
      const malformedKey = 'not-valid-base64!@#$%';
      const context = createMockExecutionContext({
        authorization: `Bearer ${malformedKey}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Keycloak JWT Authentication - Valid Scenarios', () => {
    it('should authenticate successfully with valid Keycloak JWT', async () => {
      // Arrange
      const validJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature';
      const context = createMockExecutionContext({
        authorization: `Bearer ${validJwt}`,
      });
      const mockJwtPayload = {
        sub: 'user-123',
        email: 'user@example.com',
        preferred_username: 'testuser',
        realm_access: { roles: ['user'] },
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null); // API key validation fails

      // Mock jose jwtVerify
      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({ payload: mockJwtPayload });

      // Act
      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

      // Assert
      expect(result).toBe(true);
      expect(request.authType).toBe('keycloak-jwt');
      expect(request.user?.sub).toBe('user-123');
      expect(request.user?.email).toBe('user@example.com');
      expect(request.user?.roles).toEqual(['user']);
    });

    it('should attach Keycloak user to request on successful JWT authentication', async () => {
      // Arrange
      const validJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiJ9.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${validJwt}`,
      });
      const mockJwtPayload = {
        sub: 'admin-456',
        email: 'admin@example.com',
        preferred_username: 'admin',
        realm_access: { roles: ['perfana-admin', 'user'] },
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({ payload: mockJwtPayload });

      // Act
      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

      // Assert
      expect(request.authType).toBe('keycloak-jwt');
      expect(request.user?.roles).toContain('perfana-admin');
      expect(request.user?.email).toBe('admin@example.com');
    });

    it('should handle multiple accepted issuers for Docker/localhost scenarios', async () => {
      // Arrange
      const validJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${validJwt}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({
        payload: {
          sub: 'user-789',
          email: 'user@example.com',
          realm_access: { roles: ['user'] },
        },
      });

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(jwtVerify).toHaveBeenCalled();
    });
  });

  describe('Keycloak JWT Authentication - Invalid Scenarios', () => {
    it('should reject invalid JWT tokens', async () => {
      // Arrange
      const invalidJwt = 'invalid.jwt.token';
      const context = createMockExecutionContext({
        authorization: `Bearer ${invalidJwt}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid signature'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle JWT verification errors with non-Error objects', async () => {
      // Arrange
      const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwt}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      // Reject with non-Error object to test error handling
      jwtVerify.mockRejectedValue({ code: 'INVALID_TOKEN', details: 'Token malformed' });

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired token');
    });

    it('should handle JWT verification errors with string exceptions', async () => {
      // Arrange
      const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwt}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      // Reject with string instead of Error to test error handling path
      jwtVerify.mockRejectedValue('String error message');

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired token');
    });

    it('should handle JWT verification errors with null exception', async () => {
      // Arrange
      const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwt}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      // Reject with null to test error handling path with falsy value
      jwtVerify.mockRejectedValue(null);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired token');
    });

    it('should reject expired JWT tokens', async () => {
      // Arrange
      const expiredJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.expired.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${expiredJwt}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Token expired'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject JWT with invalid issuer', async () => {
      // Arrange
      const jwtInvalidIssuer = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.invalidIssuer.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwtInvalidIssuer}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid issuer'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject JWT with invalid audience', async () => {
      // Arrange
      const jwtInvalidAudience = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.invalidAud.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwtInvalidAudience}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid audience'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle JWT verification service unavailability', async () => {
      // Arrange
      const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwt}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('JWKS endpoint unreachable'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Authentication Fallback Behavior', () => {
    it('should try API key first, then fall back to Keycloak JWT', async () => {
      // Arrange
      const jwtToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwtToken}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null); // API key fails

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({
        payload: { sub: 'user', email: 'user@example.com', realm_access: { roles: ['user'] } },
      });

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(apiKeysService.validateApiKey).toHaveBeenCalled(); // API key tried first
      expect(jwtVerify).toHaveBeenCalled(); // JWT tried second
    });

    it('should fail when both authentication methods fail', async () => {
      // Arrange
      const token = 'invalid-token';
      const context = createMockExecutionContext({
        authorization: `Bearer ${token}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid token'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired token');
    });

    it('should prefer API key when both API key and JWT formats are valid', async () => {
      // Arrange
      const apiKeyToken = Buffer.from('API Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${apiKeyToken}`,
      });
      const mockApiKey = {
        id: 'api-key-id',
        description: 'API Key',
        roles: ['user'],
        validUntil: new Date('2099-12-31'),
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({
        payload: { sub: 'user', realm_access: { roles: ['user'] } },
      });

      // Act
      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

      // Assert
      expect(result).toBe(true);
      expect(request.authType).toBe('api-key'); // API key has priority
      expect(jwtVerify).not.toHaveBeenCalled(); // JWT not tried when API key succeeds
    });
  });

  describe('Admin-Only Route Enforcement', () => {
    it('should allow admin users to access admin-only routes', async () => {
      // Arrange
      const adminJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.admin.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${adminJwt}`,
      });
      const mockAdminPayload = {
        sub: 'admin-user-123',
        email: 'admin@example.com',
        preferred_username: 'admin',
        realm_access: { roles: ['perfana-admin', 'user'] },
      };

      // Mock: not public, but admin-only
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === IS_ADMIN_ONLY_KEY) return true;
        return false;
      });
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({ payload: mockAdminPayload });

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return 403 ForbiddenException for non-admin users on admin-only routes', async () => {
      // Arrange
      const userJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.user.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${userJwt}`,
      });
      const mockRegularPayload = {
        sub: 'regular-user-456',
        email: 'user@example.com',
        preferred_username: 'regularuser',
        realm_access: { roles: ['user'] },
      };

      // Mock: not public, but admin-only
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === IS_ADMIN_ONLY_KEY) return true;
        return false;
      });
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({ payload: mockRegularPayload });

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Admin privileges required');
    });

    it('should allow admin API keys to access admin-only routes', async () => {
      // Arrange
      const adminApiKey = Buffer.from('Admin API Key#uuid-admin').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${adminApiKey}`,
      });
      const mockApiKey = {
        id: 'admin-api-key-id',
        description: 'Admin API Key',
        roles: ['perfana-admin', 'user'],
        validUntil: new Date('2099-12-31'),
      };

      // Mock: not public, but admin-only
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === IS_ADMIN_ONLY_KEY) return true;
        return false;
      });
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return 403 ForbiddenException for non-admin API keys on admin-only routes', async () => {
      // Arrange
      const userApiKey = Buffer.from('User API Key#uuid-user').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${userApiKey}`,
      });
      const mockApiKey = {
        id: 'user-api-key-id',
        description: 'User API Key',
        roles: ['user'], // No admin role
        validUntil: new Date('2099-12-31'),
      };

      // Mock: not public, but admin-only
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === IS_ADMIN_ONLY_KEY) return true;
        return false;
      });
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Admin privileges required');
    });

    it('should allow access to non-admin-only routes for regular users', async () => {
      // Arrange
      const userJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.user.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${userJwt}`,
      });
      const mockRegularPayload = {
        sub: 'regular-user-789',
        email: 'user@example.com',
        preferred_username: 'regularuser',
        realm_access: { roles: ['user'] },
      };

      // Mock: not public, not admin-only
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === IS_ADMIN_ONLY_KEY) return false;
        return false;
      });
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({ payload: mockRegularPayload });

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should allow access with "admin" role (alternative to perfana-admin)', async () => {
      // Arrange
      const adminJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.admin-alt.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${adminJwt}`,
      });
      const mockAdminPayload = {
        sub: 'admin-alt-user',
        email: 'admin-alt@example.com',
        preferred_username: 'adminalt',
        realm_access: { roles: ['admin'] }, // Using 'admin' instead of 'perfana-admin'
      };

      // Mock: not public, but admin-only
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === IS_ADMIN_ONLY_KEY) return true;
        return false;
      });
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({ payload: mockAdminPayload });

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should reject users with empty roles array on admin-only routes', async () => {
      // Arrange
      const emptyRolesApiKey = Buffer.from('Empty Roles Key#uuid-empty').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${emptyRolesApiKey}`,
      });
      const mockApiKey = {
        id: 'empty-roles-key-id',
        description: 'Empty Roles Key',
        roles: [], // Empty roles array
        validUntil: new Date('2099-12-31'),
      };

      // Mock: not public, but admin-only
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === IS_ADMIN_ONLY_KEY) return true;
        return false;
      });
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Admin privileges required');
    });
  });

  describe('Static Helper Methods - isAdmin', () => {
    it('should return true for Keycloak JWT with perfana-admin role', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'admin-user',
          email: 'admin@example.com',
          roles: ['perfana-admin', 'user'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for Keycloak JWT with admin role', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'admin-user',
          email: 'admin@example.com',
          roles: ['admin'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for Keycloak JWT without admin roles', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'regular-user',
          email: 'user@example.com',
          roles: ['user'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true for API key with perfana-admin role', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'api-key',
        apiKey: {
          id: 'admin-key',
          description: 'Admin API Key',
          roles: ['perfana-admin'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for API key with admin role', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'api-key',
        apiKey: {
          id: 'admin-key',
          description: 'Admin API Key',
          roles: ['admin'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for API key without admin roles', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'api-key',
        apiKey: {
          id: 'user-key',
          description: 'User API Key',
          roles: ['user'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when no auth type is set', () => {
      // Arrange
      const request: AuthenticatedRequest = {} as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle missing roles array gracefully', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'user',
          email: 'user@example.com',
        } as any,
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('Static Helper Methods - hasRole', () => {
    it('should return true when Keycloak user has specified role', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'user',
          roles: ['developer', 'user'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.hasRole(request, 'developer');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when Keycloak user does not have specified role', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'user',
          roles: ['user'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.hasRole(request, 'admin');

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when API key has specified role', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'api-key',
        apiKey: {
          id: 'key',
          description: 'Test Key',
          roles: ['ci-cd', 'automation'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.hasRole(request, 'ci-cd');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when API key does not have specified role', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'api-key',
        apiKey: {
          id: 'key',
          description: 'Test Key',
          roles: ['user'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.hasRole(request, 'admin');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when no auth type is set', () => {
      // Arrange
      const request: AuthenticatedRequest = {} as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.hasRole(request, 'any-role');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('Static Helper Methods - getUserId', () => {
    it('should return sub for Keycloak JWT user', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'keycloak-user-123',
          preferred_username: 'testuser',
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserId(request);

      // Assert
      expect(result).toBe('keycloak-user-123');
    });

    it('should return preferred_username when sub is not available', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          preferred_username: 'testuser',
        } as any,
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserId(request);

      // Assert
      expect(result).toBe('testuser');
    });

    it('should return api-key:id format for API key authentication', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'api-key',
        apiKey: {
          id: 'api-key-456',
          description: 'Test Key',
          roles: [],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserId(request);

      // Assert
      expect(result).toBe('api-key:api-key-456');
    });

    it('should return null when no authentication is present', () => {
      // Arrange
      const request: AuthenticatedRequest = {} as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserId(request);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Static Helper Methods - getRoles', () => {
    it('should return roles array for Keycloak JWT user', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'user',
          roles: ['admin', 'user', 'developer'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getRoles(request);

      // Assert
      expect(result).toEqual(['admin', 'user', 'developer']);
    });

    it('should return empty array when Keycloak user has no roles', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'user',
        } as any,
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getRoles(request);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return roles array for API key', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'api-key',
        apiKey: {
          id: 'key',
          description: 'Test',
          roles: ['ci-cd', 'automation'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getRoles(request);

      // Assert
      expect(result).toEqual(['ci-cd', 'automation']);
    });

    it('should return empty array when no authentication is present', () => {
      // Arrange
      const request: AuthenticatedRequest = {} as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getRoles(request);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('Static Helper Methods - getUserEmail', () => {
    it('should return email for Keycloak JWT user', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'user',
          email: 'user@example.com',
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserEmail(request);

      // Assert
      expect(result).toBe('user@example.com');
    });

    it('should return null for API key authentication', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'api-key',
        apiKey: {
          id: 'key',
          description: 'Test',
          roles: [],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserEmail(request);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when no authentication is present', () => {
      // Arrange
      const request: AuthenticatedRequest = {} as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserEmail(request);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Keycloak Custom Issuer Configuration', () => {
    it('should use custom issuers from environment variable', async () => {
      // Arrange
      const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwt}`,
      });

      // Create a new guard instance with custom issuer config
      const customConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'KEYCLOAK_ACCEPTED_ISSUERS') {
            return 'https://custom.keycloak.com/realms/test, https://another.keycloak.com/realms/test';
          }
          if (key === 'KEYCLOAK_URL') return 'http://localhost:8080';
          if (key === 'KEYCLOAK_REALM') return 'perfana-test';
          if (key === 'KEYCLOAK_CLIENT_ID') return 'perfana-api';
          return undefined;
        }),
      };

      const customModule = await Test.createTestingModule({
        providers: [
          KeycloakEnhancedAuthGuard,
          { provide: ApiKeysService, useValue: apiKeysService },
          { provide: ConfigService, useValue: customConfigService },
          { provide: Reflector, useValue: reflector },
        ],
      }).compile();

      const customGuard = customModule.get<KeycloakEnhancedAuthGuard>(KeycloakEnhancedAuthGuard);

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({
        payload: {
          sub: 'user-custom',
          email: 'user@custom.com',
          realm_access: { roles: ['user'] },
        },
      });

      // Act
      const result = await customGuard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(customConfigService.get).toHaveBeenCalledWith('KEYCLOAK_ACCEPTED_ISSUERS');
    });

    it('should handle empty custom issuers string', async () => {
      // Arrange
      const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.sig';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwt}`,
      });

      const customConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'KEYCLOAK_ACCEPTED_ISSUERS') return '   ';
          if (key === 'KEYCLOAK_URL') return 'http://localhost:8080';
          if (key === 'KEYCLOAK_REALM') return 'perfana-test';
          if (key === 'KEYCLOAK_CLIENT_ID') return 'perfana-api';
          return undefined;
        }),
      };

      const customModule = await Test.createTestingModule({
        providers: [
          KeycloakEnhancedAuthGuard,
          { provide: ApiKeysService, useValue: apiKeysService },
          { provide: ConfigService, useValue: customConfigService },
          { provide: Reflector, useValue: reflector },
        ],
      }).compile();

      const customGuard = customModule.get<KeycloakEnhancedAuthGuard>(KeycloakEnhancedAuthGuard);

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({
        payload: {
          sub: 'user-empty-issuer',
          email: 'user@example.com',
          realm_access: { roles: ['user'] },
        },
      });

      // Act
      const result = await customGuard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('Edge Cases and Security', () => {
    it('should handle very long tokens', async () => {
      // Arrange
      const longToken = 'A'.repeat(10000);
      const context = createMockExecutionContext({
        authorization: `Bearer ${longToken}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Token too long'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle tokens with special characters', async () => {
      // Arrange
      const specialToken = 'token-with-special-chars-!@#$%^&*()';
      const context = createMockExecutionContext({
        authorization: `Bearer ${specialToken}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid format'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle null token value', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer null',
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid token'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle undefined token value', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer undefined',
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid token'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should not log sensitive token data in errors', async () => {
      // Arrange
      const sensitiveToken = 'sensitive-api-key-123456';
      const context = createMockExecutionContext({
        authorization: `Bearer ${sensitiveToken}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid'));

      // Act & Assert
      try {
        await guard.canActivate(context);
      } catch (error) {
        // Verify error message doesn't contain full token
        const errorMessage =
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : '';
        expect(errorMessage).not.toContain(sensitiveToken);
      }
    });

    it('should handle concurrent authentication requests', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const context1 = createMockExecutionContext({ authorization: `Bearer ${token}` });
      const context2 = createMockExecutionContext({ authorization: `Bearer ${token}` });
      const context3 = createMockExecutionContext({ authorization: `Bearer ${token}` });

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

    it('should handle empty authorization header string', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: '' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Missing Authorization header');
    });

    it('should handle whitespace-only Bearer token', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'Bearer    ' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid authorization type');
    });

    it('should handle case-sensitive Bearer validation', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'bearer token123' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid authorization type');
    });

    it('should handle authorization header with extra spaces', async () => {
      // Arrange
      const token = Buffer.from('Valid Key#uuid').toString('base64');
      const context = createMockExecutionContext({ authorization: `Bearer  ${token}` });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid token'));

      // Act & Assert
      // The second space becomes part of the token, which should fail validation
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle API key service throwing non-Error exception', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const context = createMockExecutionContext({ authorization: `Bearer ${token}` });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockRejectedValue('String error instead of Error object');

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Also failed'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle Keycloak user with empty sub field', async () => {
      // Arrange
      const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIifS5zaWc';
      const context = createMockExecutionContext({
        authorization: `Bearer ${jwt}`,
      });

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockResolvedValue({
        payload: {
          sub: '',
          email: 'user@example.com',
          realm_access: { roles: ['user'] },
        },
      });

      // Act
      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

      // Assert
      expect(result).toBe(true);
      expect(request.user?.sub).toBe('');
    });

    it('should handle multiple roles including duplicates', async () => {
      // Arrange
      const token = Buffer.from('Multi-Role Key#uuid').toString('base64');
      const context = createMockExecutionContext({
        authorization: `Bearer ${token}`,
      });
      const mockApiKey = {
        id: 'multi-role-key',
        description: 'Multi-Role Key',
        roles: ['admin', 'user', 'developer', 'admin'], // duplicate admin
        validUntil: new Date('2099-12-31'),
      };

      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(mockApiKey as any);

      // Act
      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

      // Assert
      expect(result).toBe(true);
      expect(request.apiKey?.roles).toContain('admin');
      expect(request.apiKey?.roles).toContain('user');
      expect(request.apiKey?.roles).toContain('developer');
    });
  });

  describe('Token Extraction Edge Cases', () => {
    it('should handle authorization header without space separator', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'BearerToken123' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle authorization header with multiple Bearer keywords', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'Bearer Bearer token' });
      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid token'));

      // Act & Assert
      // "Bearer" becomes the token (second word), which should fail
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle authorization header with newline characters', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: 'Bearer\ntoken\n123' });
      reflector.getAllAndOverride.mockReturnValue(false);
      apiKeysService.validateApiKey.mockResolvedValue(null);

      const { jwtVerify } = require('jose');
      jwtVerify.mockRejectedValue(new Error('Invalid format'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Static Helper Methods - Edge Cases', () => {
    it('should handle getUserId when both sub and preferred_username are missing', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          email: 'user@example.com',
        } as any,
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserId(request);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should handle hasRole with empty role string', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'user',
          roles: ['admin', '', 'user'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.hasRole(request, '');

      // Assert
      expect(result).toBe(true); // Empty string exists in roles array
    });

    it('should handle isAdmin with both perfana-admin and admin roles', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'super-admin',
          roles: ['perfana-admin', 'admin', 'user'],
        },
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.isAdmin(request);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle getRoles with null user object', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: null as any,
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getRoles(request);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle getUserEmail with missing email field', () => {
      // Arrange
      const request: AuthenticatedRequest = {
        authType: 'keycloak-jwt',
        user: {
          sub: 'user-without-email',
        } as any,
      } as any;

      // Act
      const result = KeycloakEnhancedAuthGuard.getUserEmail(request);

      // Assert
      expect(result).toBeUndefined();
    });
  });
});
