/**
 * RolesGuard Test Suite
 *
 * Comprehensive tests for Role-Based Access Control (RBAC) Guard
 *
 * This guard enforces role requirements defined by @Roles(), @RequireRoles(),
 * and @RequireAllRoles() decorators. It supports two matching modes:
 * - ANY (default): User must have at least one of the required roles
 * - ALL: User must have all of the required roles
 *
 * Test Coverage Areas:
 * - Public route bypass
 * - No roles required (allow access)
 * - ANY mode role matching
 * - ALL mode role matching
 * - Global admin bypass
 * - JWT role extraction
 * - API key role extraction
 * - Missing user/authentication
 * - Null/undefined roles handling
 * - Case-sensitive role matching
 * - Edge cases and special characters
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AuthenticatedRequest } from './keycloak-enhanced-auth.guard';
import { RoleOptions, RoleMatchingMode, ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  // Mock execution context helper
  const createMockExecutionContext = (
    request: Partial<AuthenticatedRequest> = {},
  ): ExecutionContext => {
    const mockRequest: Partial<AuthenticatedRequest> = {
      headers: {},
      user: undefined,
      authType: undefined,
      apiKey: undefined,
      ...request,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('Public Route Bypass', () => {
    it('should allow access to public routes without role checking', () => {
      // Arrange
      const context = createMockExecutionContext({});
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should skip role checking for routes marked with @Public()', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: [] },
      });

      // Even with @Roles() decorator, public routes are allowed
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
        if (key === ROLES_KEY)
          return { roles: ['admin'], mode: RoleMatchingMode.ANY } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('No Roles Required', () => {
    it('should allow access when no @Roles() decorator is present', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['user'] },
      });

      reflector.getAllAndOverride.mockReturnValue(undefined);

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should allow access when roleOptions is null', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: [] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return null;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should allow access when roles array is empty in decorator', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return { roles: [], mode: RoleMatchingMode.ANY } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should allow access when roleOptions.roles is undefined', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return { mode: RoleMatchingMode.ANY } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('ANY Mode Role Matching', () => {
    it('should allow access when user has one of the required roles', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['editor', 'viewer'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'editor', 'moderator'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should allow access when user has all required roles in ANY mode', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'superuser', roles: ['admin', 'editor', 'moderator'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'editor'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny access when user has none of the required roles', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'regular-user', roles: ['user', 'viewer'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'editor', 'moderator'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('Access denied');
    });

    it('should default to ANY mode when mode is not specified', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['developer'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return { roles: ['developer', 'admin'] } as RoleOptions; // No mode specified
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should allow access with single matching role using RequireRoles pattern', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'developer', roles: ['developer'] },
      });

      // Simulating @RequireRoles('developer', 'admin')
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['developer', 'admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('ALL Mode Role Matching', () => {
    it('should allow access when user has all required roles', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'super-admin', roles: ['admin', 'moderator', 'user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'moderator'],
            mode: RoleMatchingMode.ALL,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny access when user has only some required roles (partial match)', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'partial-admin', roles: ['admin', 'user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'moderator', 'super-admin'],
            mode: RoleMatchingMode.ALL,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('all required');
    });

    it('should deny access when user has none of the required roles in ALL mode', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'viewer', roles: ['viewer'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'moderator'],
            mode: RoleMatchingMode.ALL,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should allow access with RequireAllRoles pattern when all roles present', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'full-access', roles: ['editor', 'reviewer', 'publisher'] },
      });

      // Simulating @RequireAllRoles('editor', 'reviewer')
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['editor', 'reviewer'],
            mode: RoleMatchingMode.ALL,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should allow access when single required role matches in ALL mode', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'admin', roles: ['admin'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin'],
            mode: RoleMatchingMode.ALL,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('Keycloak JWT Role Extraction', () => {
    it('should correctly extract roles from Keycloak JWT user object', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: {
          sub: 'keycloak-user-123',
          email: 'user@example.com',
          preferred_username: 'testuser',
          roles: ['developer', 'user'],
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['developer'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle Keycloak JWT user with multiple roles', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: {
          sub: 'multi-role-user',
          roles: ['admin', 'developer', 'reviewer', 'ci-cd'],
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['reviewer', 'ci-cd'],
            mode: RoleMatchingMode.ALL,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('API Key Role Extraction', () => {
    it('should correctly extract roles from API key metadata', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'api-key',
        apiKey: {
          id: 'api-key-123',
          description: 'CI/CD Pipeline Key',
          roles: ['ci-cd', 'automation'],
          validUntil: new Date('2099-12-31'),
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['ci-cd'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle API key with admin role for protected endpoints', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'api-key',
        apiKey: {
          id: 'admin-api-key',
          description: 'Admin API Key',
          roles: ['perfana-admin', 'user'],
          validUntil: new Date('2099-12-31'),
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['perfana-admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny access for API key without required roles', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'api-key',
        apiKey: {
          id: 'limited-api-key',
          description: 'Limited API Key',
          roles: ['user', 'viewer'],
          validUntil: new Date('2099-12-31'),
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'editor'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('Missing User/Authentication', () => {
    it('should deny access when request has no user or apiKey', () => {
      // Arrange
      const context = createMockExecutionContext({
        // No authType, user, or apiKey
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['user'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access when authType is keycloak-jwt but user is undefined', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: undefined,
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['user'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access when authType is api-key but apiKey is undefined', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'api-key',
        apiKey: undefined,
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['user'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access for unknown authType', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'unknown-auth-type' as 'keycloak-jwt',
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['user'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('Null/Undefined Roles Handling', () => {
    it('should treat null roles array as empty array', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: {
          sub: 'user-no-roles',
          roles: null as unknown as string[],
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['user'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should treat undefined roles array as empty array', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: {
          sub: 'user-undefined-roles',
          // roles is undefined
        } as { sub: string; roles?: string[] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['user'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access when user has empty roles array', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: {
          sub: 'user-empty-roles',
          roles: [],
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['required-role'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('Case-Sensitive Role Matching', () => {
    it('should match roles in a case-sensitive manner', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['Admin'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin'], // lowercase
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      // 'Admin' !== 'admin', so access should be denied
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should allow access when role case matches exactly', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['Admin'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['Admin'], // Same case
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny when ADMIN !== admin (all caps vs lowercase)', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['ADMIN'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should allow case-sensitive match for perfana-admin', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'admin-user', roles: ['perfana-admin'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['perfana-admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('Special Characters in Role Names', () => {
    it('should handle roles with hyphens', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['org-admin', 'team-admin'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['org-admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle roles with underscores', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['org_admin', 'team_lead'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['org_admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle roles with dots', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['org.admin', 'realm.user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['realm.user'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle roles with colons (namespace pattern)', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['perfana:admin', 'perfana:user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['perfana:admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('Error Message Content', () => {
    it('should include required roles in error message for ANY mode', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['viewer'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'editor'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      try {
        guard.canActivate(context);
        fail('Expected ForbiddenException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        const message = (error as ForbiddenException).message;
        expect(message).toContain('admin');
        expect(message).toContain('editor');
        expect(message).toContain('any required');
      }
    });

    it('should include "all required" in error message for ALL mode', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['admin'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'superuser'],
            mode: RoleMatchingMode.ALL,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      try {
        guard.canActivate(context);
        fail('Expected ForbiddenException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        const message = (error as ForbiddenException).message;
        expect(message).toContain('all required');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle request with both user and apiKey (prefer authType)', () => {
      // Arrange - Both are set but authType determines which is used
      const context = createMockExecutionContext({
        authType: 'api-key',
        user: { sub: 'user', roles: ['admin'] }, // Should be ignored
        apiKey: {
          id: 'key',
          description: 'Test',
          roles: ['user'], // This should be used
          validUntil: new Date('2099-12-31'),
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert - apiKey roles used (no 'admin'), should fail
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should handle duplicate roles in user roles array', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['admin', 'admin', 'user', 'admin'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle duplicate roles in required roles array', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['admin'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin', 'admin', 'admin'], // Duplicates in required
            mode: RoleMatchingMode.ALL,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle very long role names', () => {
      // Arrange
      const longRoleName = 'organization-team-project-resource-admin-role-with-very-long-name';
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: [longRoleName] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: [longRoleName],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle roles with whitespace', () => {
      // Arrange - Role with leading/trailing whitespace (unusual but possible)
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: [' admin ', 'user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin'], // No whitespace
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert - ' admin ' !== 'admin', should fail
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should handle empty string in roles array', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['', 'user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should handle matching empty string role if required', () => {
      // Arrange - Unusual case but should work
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['', 'user'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: [''], // Empty string required
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('Reflector Metadata Reading', () => {
    it('should check handler first, then class for role metadata', () => {
      // Arrange
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: { sub: 'user', roles: ['handler-role'] },
      });

      reflector.getAllAndOverride.mockImplementation((key: string, targets: unknown[]) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) {
          // Verify targets array contains handler and class
          expect(targets).toHaveLength(2);
          return {
            roles: ['handler-role'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        }
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, expect.any(Array));
    });
  });

  describe('Integration-like Scenarios', () => {
    it('should allow admin to access role-protected endpoint', () => {
      // Arrange - Simulating a real admin accessing an endpoint requiring 'editor' role
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: {
          sub: 'admin-user-123',
          email: 'admin@example.com',
          preferred_username: 'admin',
          roles: ['perfana-admin', 'user'],
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['editor', 'perfana-admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny regular user trying to access admin endpoint', () => {
      // Arrange - Regular user trying to access admin-protected endpoint
      const context = createMockExecutionContext({
        authType: 'keycloak-jwt',
        user: {
          sub: 'regular-user-456',
          email: 'user@example.com',
          preferred_username: 'regularuser',
          roles: ['user', 'viewer'],
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['perfana-admin', 'admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act & Assert
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should allow CI/CD API key with automation role', () => {
      // Arrange - API key used for automated deployments
      const context = createMockExecutionContext({
        authType: 'api-key',
        apiKey: {
          id: 'cicd-key-789',
          description: 'GitHub Actions Key',
          roles: ['ci-cd', 'automation', 'deploy'],
          validUntil: new Date('2099-12-31'),
        },
      });

      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY)
          return {
            roles: ['ci-cd', 'admin'],
            mode: RoleMatchingMode.ANY,
          } as RoleOptions;
        return undefined;
      });

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });
  });
});
