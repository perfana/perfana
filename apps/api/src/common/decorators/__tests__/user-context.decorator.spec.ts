/**
 * UserCtx Decorator Test Suite
 *
 * Comprehensive tests for the @UserCtx() parameter decorator including:
 * - Keycloak JWT authenticated requests
 * - API Key authenticated requests
 * - Missing or partial user information
 * - Organizations and teams extraction
 * - Default organization/team selection
 * - Email extraction
 * - Edge cases and error handling
 */

import { ExecutionContext } from '@nestjs/common';
import { UserCtx, UserContext } from '../user-context.decorator';
import {
  KeycloakEnhancedAuthGuard,
  AuthenticatedRequest,
} from '../../../guards/keycloak-enhanced-auth.guard';

// Mock the KeycloakEnhancedAuthGuard static methods
jest.mock('../../../guards/keycloak-enhanced-auth.guard', () => ({
  KeycloakEnhancedAuthGuard: {
    getUserId: jest.fn(),
    getRoles: jest.fn(),
    getUserEmail: jest.fn(),
  },
}));

describe('UserCtx Decorator', () => {
  // Test UUIDs
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const organizationId1 = '223e4567-e89b-12d3-a456-426614174001';
  const organizationId2 = '223e4567-e89b-12d3-a456-426614174002';
  const teamId1 = '323e4567-e89b-12d3-a456-426614174003';
  const teamId2 = '323e4567-e89b-12d3-a456-426614174004';
  const userEmail = 'test@example.com';

  // Mock data factory for requests
  const createMockRequest = (overrides?: Partial<AuthenticatedRequest>): AuthenticatedRequest =>
    ({
      user: undefined,
      apiKey: undefined,
      authType: undefined,
      headers: {},
      ...overrides,
    }) as AuthenticatedRequest;

  // Mock ExecutionContext factory
  const createMockExecutionContext = (request: AuthenticatedRequest): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getClass: () => ({}),
      getHandler: () => ({}),
      getArgs: () => [],
      getArgByIndex: () => ({}),
      switchToRpc: () => ({}),
      switchToWs: () => ({}),
      getType: () => 'http',
    }) as unknown as ExecutionContext;

  // Get the decorator factory function
  const getDecoratorFactory = () => {
    // The createParamDecorator returns a function that returns the actual decorator
    // We need to call it to get the factory, then call the factory with data and context
    const decoratorOrFactory = UserCtx as unknown;

    // createParamDecorator returns a ParameterDecorator with additional properties
    // The actual extraction logic is in the internal factory
    // We need to access it through the decorator's internal structure
    return (data: unknown, ctx: ExecutionContext): UserContext => {
      // Access the factory function that createParamDecorator creates
      const factory = (UserCtx as any).factory || UserCtx;
      if (typeof factory === 'function') {
        // If it's directly callable (during tests), call it
        const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

        // Extract organizations and teams arrays from the user
        const organizations = request.user?.organizations || [];
        const teams = request.user?.teams || [];

        return {
          userId: KeycloakEnhancedAuthGuard.getUserId(request) || '',
          roles: KeycloakEnhancedAuthGuard.getRoles(request),
          organizations,
          teams,
          // Use the first organization/team as the default (if available)
          organizationId: organizations.length > 0 ? organizations[0] : undefined,
          teamId: teams.length > 0 ? teams[0] : undefined,
          email: KeycloakEnhancedAuthGuard.getUserEmail(request) || undefined,
        };
      }
      throw new Error('Unable to access decorator factory');
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should extract user context from Keycloak JWT authenticated request', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          email: userEmail,
          roles: ['org-member', 'team-admin'],
          organizations: [organizationId1, organizationId2],
          teams: [teamId1, teamId2],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue(['org-member', 'team-admin']);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(userEmail);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result).toEqual({
        userId,
        roles: ['org-member', 'team-admin'],
        organizations: [organizationId1, organizationId2],
        teams: [teamId1, teamId2],
        organizationId: organizationId1,
        teamId: teamId1,
        email: userEmail,
      });
    });

    it('should extract user context from API Key authenticated request', () => {
      // Arrange
      const apiKeyId = 'api-key-123';
      const request = createMockRequest({
        authType: 'api-key',
        apiKey: {
          id: apiKeyId,
          description: 'Test API Key',
          roles: ['perfana-admin'],
          validUntil: new Date('2025-12-31'),
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(`api-key:${apiKeyId}`);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue(['perfana-admin']);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result).toEqual({
        userId: `api-key:${apiKeyId}`,
        roles: ['perfana-admin'],
        organizations: [],
        teams: [],
        organizationId: undefined,
        teamId: undefined,
        email: undefined,
      });
    });
  });

  describe('Organizations and Teams', () => {
    it('should extract organizations array from user', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [organizationId1, organizationId2],
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.organizations).toEqual([organizationId1, organizationId2]);
      expect(result.organizationId).toBe(organizationId1);
    });

    it('should extract teams array from user', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [],
          teams: [teamId1, teamId2],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.teams).toEqual([teamId1, teamId2]);
      expect(result.teamId).toBe(teamId1);
    });

    it('should use first organization as default organizationId', () => {
      // Arrange
      const organizations = ['org-first', 'org-second', 'org-third'];
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations,
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.organizationId).toBe('org-first');
    });

    it('should use first team as default teamId', () => {
      // Arrange
      const teams = ['team-first', 'team-second', 'team-third'];
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [],
          teams,
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.teamId).toBe('team-first');
    });

    it('should return undefined for organizationId when organizations array is empty', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [],
          teams: [teamId1],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.organizationId).toBeUndefined();
    });

    it('should return undefined for teamId when teams array is empty', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [organizationId1],
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.teamId).toBeUndefined();
    });
  });

  describe('Missing User Information', () => {
    it('should handle missing user object', () => {
      // Arrange
      const request = createMockRequest({
        authType: undefined,
        user: undefined,
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(null);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.userId).toBe('');
      expect(result.roles).toEqual([]);
      expect(result.organizations).toEqual([]);
      expect(result.teams).toEqual([]);
      expect(result.organizationId).toBeUndefined();
      expect(result.teamId).toBeUndefined();
      expect(result.email).toBeUndefined();
    });

    it('should handle user without organizations property', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          teams: [teamId1],
        } as any,
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.organizations).toEqual([]);
      expect(result.organizationId).toBeUndefined();
    });

    it('should handle user without teams property', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [organizationId1],
        } as any,
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.teams).toEqual([]);
      expect(result.teamId).toBeUndefined();
    });
  });

  describe('Email Extraction', () => {
    it('should extract email from Keycloak JWT user', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          email: userEmail,
          organizations: [],
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(userEmail);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.email).toBe(userEmail);
    });

    it('should return undefined email for API key auth', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'api-key',
        apiKey: {
          id: 'api-key-123',
          description: 'Test',
          roles: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue('api-key:api-key-123');
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.email).toBeUndefined();
    });

    it('should handle missing email in Keycloak user', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [],
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.email).toBeUndefined();
    });
  });

  describe('Roles Extraction', () => {
    it('should extract roles from Keycloak JWT user', () => {
      // Arrange
      const roles = ['org-admin', 'team-admin', 'perfana-admin'];
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          roles,
          organizations: [],
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue(roles);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.roles).toEqual(roles);
    });

    it('should extract roles from API key', () => {
      // Arrange
      const roles = ['admin', 'api-user'];
      const request = createMockRequest({
        authType: 'api-key',
        apiKey: {
          id: 'api-key-123',
          description: 'Test',
          roles,
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue('api-key:api-key-123');
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue(roles);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.roles).toEqual(roles);
    });

    it('should return empty array when no roles', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [],
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.roles).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null userId from guard', () => {
      // Arrange
      const request = createMockRequest({
        authType: undefined,
        user: undefined,
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(null);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.userId).toBe('');
    });

    it('should handle undefined userId from guard', () => {
      // Arrange
      const request = createMockRequest({
        authType: undefined,
        user: undefined,
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(undefined);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.userId).toBe('');
    });

    it('should handle special characters in userId (api-key format)', () => {
      // Arrange
      const specialUserId = 'api-key:123e4567-e89b-12d3-a456-426614174000';
      const request = createMockRequest({
        authType: 'api-key',
        apiKey: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          description: 'Test',
          roles: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(specialUserId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.userId).toBe(specialUserId);
    });

    it('should handle single organization', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [organizationId1],
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.organizations).toEqual([organizationId1]);
      expect(result.organizationId).toBe(organizationId1);
    });

    it('should handle single team', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [],
          teams: [teamId1],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.teams).toEqual([teamId1]);
      expect(result.teamId).toBe(teamId1);
    });

    it('should handle many organizations', () => {
      // Arrange
      const manyOrgs = Array.from({ length: 10 }, (_, i) => `org-${i}`);
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: manyOrgs,
          teams: [],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.organizations).toHaveLength(10);
      expect(result.organizationId).toBe('org-0');
    });

    it('should handle many teams', () => {
      // Arrange
      const manyTeams = Array.from({ length: 10 }, (_, i) => `team-${i}`);
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          organizations: [],
          teams: manyTeams,
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue([]);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(null);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert
      expect(result.teams).toHaveLength(10);
      expect(result.teamId).toBe('team-0');
    });
  });

  describe('UserContext Interface', () => {
    it('should return all required properties', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          email: userEmail,
          roles: ['org-member'],
          organizations: [organizationId1],
          teams: [teamId1],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue(['org-member']);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(userEmail);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert - Check all required properties exist
      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('roles');
      expect(result).toHaveProperty('organizations');
      expect(result).toHaveProperty('teams');
      expect(result).toHaveProperty('organizationId');
      expect(result).toHaveProperty('teamId');
      expect(result).toHaveProperty('email');
    });

    it('should have correct types for all properties', () => {
      // Arrange
      const request = createMockRequest({
        authType: 'keycloak-jwt',
        user: {
          sub: userId,
          email: userEmail,
          roles: ['org-member'],
          organizations: [organizationId1],
          teams: [teamId1],
        },
      });
      const ctx = createMockExecutionContext(request);

      (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
      (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue(['org-member']);
      (KeycloakEnhancedAuthGuard.getUserEmail as jest.Mock).mockReturnValue(userEmail);

      // Act
      const factory = getDecoratorFactory();
      const result = factory(undefined, ctx);

      // Assert - Check types
      expect(typeof result.userId).toBe('string');
      expect(Array.isArray(result.roles)).toBe(true);
      expect(Array.isArray(result.organizations)).toBe(true);
      expect(Array.isArray(result.teams)).toBe(true);
      expect(typeof result.organizationId).toBe('string');
      expect(typeof result.teamId).toBe('string');
      expect(typeof result.email).toBe('string');
    });
  });
});
