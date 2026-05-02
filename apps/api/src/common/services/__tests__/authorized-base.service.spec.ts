/**
 * AuthorizedBaseService Test Suite
 *
 * Comprehensive tests for the abstract AuthorizedBaseService including:
 * - Organization-based query filtering (applyOrgFilter)
 * - Permission checks (access, modify, delete)
 * - Ownership assignment and tracking
 * - Global admin bypass scenarios
 * - Edge cases and error handling
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { AuthorizedBaseService } from '../authorized-base.service';
import { AuthorizationService, AuthorizationResult } from '../authorization.service';
import { OwnedResource } from '@perfana/shared/entities';

/**
 * Concrete implementation of AuthorizedBaseService for testing.
 * Since AuthorizedBaseService is abstract, we need a concrete class to test.
 */
interface TestEntity extends OwnedResource {
  id: string;
  name: string;
  organization_id?: string;
  team_id?: string;
  created_by?: string;
  updated_by?: string;
}

class TestAuthorizedService extends AuthorizedBaseService<TestEntity> {
  constructor(
    repository: Repository<TestEntity>,
    authzService: AuthorizationService,
  ) {
    super(repository, authzService);
  }

  // Expose protected methods for testing
  public async testApplyOrgFilter(
    queryBuilder: SelectQueryBuilder<TestEntity>,
    userId: string,
    roles: string[],
  ) {
    return this.applyOrgFilter(queryBuilder, userId, roles);
  }

  public async testGetAccessibleOrgIds(userId: string, roles: string[]) {
    return this.getAccessibleOrgIds(userId, roles);
  }

  public async testCheckAccessPermission(
    userId: string,
    roles: string[],
    resource: TestEntity,
  ) {
    return this.checkAccessPermission(userId, roles, resource);
  }

  public async testCheckModifyPermission(
    userId: string,
    roles: string[],
    resource: TestEntity,
  ) {
    return this.checkModifyPermission(userId, roles, resource);
  }

  public async testCheckDeletePermission(
    userId: string,
    roles: string[],
    resource: TestEntity,
  ) {
    return this.checkDeletePermission(userId, roles, resource);
  }

  public testAssignOwnership(
    entity: Partial<TestEntity>,
    userId: string,
    organizationId: string,
    teamId?: string,
  ) {
    return this.assignOwnership(entity, userId, organizationId, teamId);
  }

  public testMarkUpdated(entity: TestEntity, userId: string) {
    return this.markUpdated(entity, userId);
  }

  public async testGetDefaultOrganization(userId: string) {
    return this.getDefaultOrganization(userId);
  }

  public testIsGlobalAdmin(roles: string[]) {
    return this.isGlobalAdmin(roles);
  }

  public async testVerifyOrganizationAccess(
    userId: string,
    roles: string[],
    organizationId: string,
  ) {
    return this.verifyOrganizationAccess(userId, roles, organizationId);
  }
}

describe('AuthorizedBaseService', () => {
  let service: TestAuthorizedService;
  let mockRepository: jest.Mocked<Repository<TestEntity>>;
  let mockAuthzService: jest.Mocked<AuthorizationService>;
  let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<TestEntity>>;

  // Test UUIDs
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const organizationId = '223e4567-e89b-12d3-a456-426614174001';
  const teamId = '323e4567-e89b-12d3-a456-426614174002';

  // Mock data factory
  const createMockResource = (overrides?: Partial<TestEntity>): TestEntity => ({
    id: '423e4567-e89b-12d3-a456-426614174003',
    name: 'Test Resource',
    createdBy: 'other-user-id',
    updatedBy: 'other-user-id',
    organizationId: organizationId,
    teamId: teamId,
    ...overrides,
  });

  beforeEach(() => {
    // Create mock repository
    mockRepository = {
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<TestEntity>>;

    // Create mock query builder
    mockQueryBuilder = {
      alias: 'test_entity',
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SelectQueryBuilder<TestEntity>>;

    // Create mock authorization service
    mockAuthzService = {
      isGlobalAdmin: jest.fn(),
      getAccessibleOrganizations: jest.fn(),
      canAccessResource: jest.fn(),
      canModifyResource: jest.fn(),
      isOrganizationMember: jest.fn(),
    } as unknown as jest.Mocked<AuthorizationService>;

    // Create service instance
    service = new TestAuthorizedService(mockRepository, mockAuthzService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('applyOrgFilter', () => {
    it('should not apply filter for global admin', async () => {
      // Arrange
      const roles = ['perfana-admin'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(true);

      // Act
      const result = await service.testApplyOrgFilter(
        mockQueryBuilder,
        userId,
        roles,
      );

      // Assert
      expect(result).toBe(mockQueryBuilder);
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
      expect(mockAuthzService.getAccessibleOrganizations).not.toHaveBeenCalled();
    });

    it('should apply empty result filter when user has no organizations', async () => {
      // Arrange
      const roles = ['org-member'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue([]);

      // Act
      const result = await service.testApplyOrgFilter(
        mockQueryBuilder,
        userId,
        roles,
      );

      // Assert
      expect(result).toBe(mockQueryBuilder);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('1 = 0');
    });

    it('should apply organization filter with orgIds', async () => {
      // Arrange
      const roles = ['org-member'];
      const orgIds = ['org-1', 'org-2', 'org-3'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue(orgIds);

      // Act
      const result = await service.testApplyOrgFilter(
        mockQueryBuilder,
        userId,
        roles,
      );

      // Assert
      expect(result).toBe(mockQueryBuilder);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'test_entity.organization_id IN (:...orgIds)',
        { orgIds },
      );
    });

    it('should use the query builder alias dynamically', async () => {
      // Arrange
      const roles = ['org-member'];
      const customAlias = 'custom_alias';
      const customQueryBuilder = {
        alias: customAlias,
        andWhere: jest.fn().mockReturnThis(),
      } as unknown as jest.Mocked<SelectQueryBuilder<TestEntity>>;
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue(['org-1']);

      // Act
      await service.testApplyOrgFilter(customQueryBuilder, userId, roles);

      // Assert
      expect(customQueryBuilder.andWhere).toHaveBeenCalledWith(
        `${customAlias}.organization_id IN (:...orgIds)`,
        { orgIds: ['org-1'] },
      );
    });

    it('should handle single organization', async () => {
      // Arrange
      const roles = ['org-member'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue([organizationId]);

      // Act
      await service.testApplyOrgFilter(mockQueryBuilder, userId, roles);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'test_entity.organization_id IN (:...orgIds)',
        { orgIds: [organizationId] },
      );
    });
  });

  describe('getAccessibleOrgIds', () => {
    it('should return undefined for global admin', async () => {
      // Arrange
      const roles = ['admin'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(true);

      // Act
      const result = await service.testGetAccessibleOrgIds(userId, roles);

      // Assert
      expect(result).toBeUndefined();
      expect(mockAuthzService.getAccessibleOrganizations).not.toHaveBeenCalled();
    });

    it('should return organization IDs for regular user', async () => {
      // Arrange
      const roles = ['org-member'];
      const orgIds = ['org-1', 'org-2'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue(orgIds);

      // Act
      const result = await service.testGetAccessibleOrgIds(userId, roles);

      // Assert
      expect(result).toEqual(orgIds);
      expect(mockAuthzService.getAccessibleOrganizations).toHaveBeenCalledWith(userId);
    });

    it('should return empty array when user has no organizations', async () => {
      // Arrange
      const roles = ['user'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue([]);

      // Act
      const result = await service.testGetAccessibleOrgIds(userId, roles);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('checkAccessPermission', () => {
    it('should not throw when access is allowed', async () => {
      // Arrange
      const roles = ['org-member'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User is a member of organization',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckAccessPermission(userId, roles, resource),
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when access is denied', async () => {
      // Arrange
      const roles = ['some-role'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: false,
        reason: 'User does not have access to this resource',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckAccessPermission(userId, roles, resource),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.testCheckAccessPermission(userId, roles, resource),
      ).rejects.toThrow('User does not have access to this resource');
    });

    it('should delegate to authzService.canAccessResource', async () => {
      // Arrange
      const roles = ['org-admin'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User has global admin privileges',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);

      // Act
      await service.testCheckAccessPermission(userId, roles, resource);

      // Assert
      expect(mockAuthzService.canAccessResource).toHaveBeenCalledWith(
        userId,
        roles,
        resource,
      );
    });
  });

  describe('checkModifyPermission', () => {
    it('should not throw when modification is allowed', async () => {
      // Arrange
      const roles = ['org-admin'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User is an admin of organization',
      };
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckModifyPermission(userId, roles, resource),
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when modification is denied', async () => {
      // Arrange
      const roles = ['org-member'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: false,
        reason: 'User does not have modification rights for this resource',
      };
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckModifyPermission(userId, roles, resource),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.testCheckModifyPermission(userId, roles, resource),
      ).rejects.toThrow('User does not have modification rights for this resource');
    });

    it('should delegate to authzService.canModifyResource', async () => {
      // Arrange
      const roles = ['team-admin'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User is an admin of team',
      };
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act
      await service.testCheckModifyPermission(userId, roles, resource);

      // Assert
      expect(mockAuthzService.canModifyResource).toHaveBeenCalledWith(
        userId,
        roles,
        resource,
      );
    });
  });

  describe('checkDeletePermission', () => {
    it('should not throw when deletion is allowed', async () => {
      // Arrange
      const roles = ['org-admin'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User is an admin of organization',
      };
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckDeletePermission(userId, roles, resource),
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when deletion is denied', async () => {
      // Arrange
      const roles = ['org-viewer'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: false,
        reason: 'User does not have modification rights for this resource',
      };
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckDeletePermission(userId, roles, resource),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should use same authorization rules as modify permission', async () => {
      // Arrange
      const roles = ['team-admin'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User is an admin of team',
      };
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act
      await service.testCheckDeletePermission(userId, roles, resource);

      // Assert
      expect(mockAuthzService.canModifyResource).toHaveBeenCalledWith(
        userId,
        roles,
        resource,
      );
    });
  });

  describe('assignOwnership', () => {
    it('should assign all ownership fields', () => {
      // Arrange
      const entity: Partial<TestEntity> = {
        name: 'New Resource',
      };

      // Act
      const result = service.testAssignOwnership(
        entity,
        userId,
        organizationId,
        teamId,
      );

      // Assert
      expect(result).toEqual({
        name: 'New Resource',
        created_by: userId,
        updated_by: userId,
        organization_id: organizationId,
        team_id: teamId,
      });
    });

    it('should assign ownership without team_id', () => {
      // Arrange
      const entity: Partial<TestEntity> = {
        name: 'New Resource',
      };

      // Act
      const result = service.testAssignOwnership(entity, userId, organizationId);

      // Assert
      expect(result).toEqual({
        name: 'New Resource',
        created_by: userId,
        updated_by: userId,
        organization_id: organizationId,
        team_id: undefined,
      });
    });

    it('should preserve existing entity properties', () => {
      // Arrange
      const entity: Partial<TestEntity> = {
        id: 'existing-id',
        name: 'Existing Resource',
      };

      // Act
      const result = service.testAssignOwnership(
        entity,
        userId,
        organizationId,
        teamId,
      );

      // Assert
      expect(result.id).toBe('existing-id');
      expect(result.name).toBe('Existing Resource');
    });

    it('should overwrite existing ownership fields', () => {
      // Arrange
      const entity: Partial<TestEntity> = {
        name: 'Resource',
        created_by: 'old-user',
        organization_id: 'old-org',
      };

      // Act
      const result = service.testAssignOwnership(
        entity,
        userId,
        organizationId,
        teamId,
      );

      // Assert
      expect(result.created_by).toBe(userId);
      expect(result.organization_id).toBe(organizationId);
    });

    describe('organizationId validation', () => {
      it('should throw BadRequestException when organizationId is null', () => {
        // Arrange
        const entity: Partial<TestEntity> = {
          name: 'New Resource',
        };

        // Act & Assert
        expect(() =>
          service.testAssignOwnership(entity, userId, null as unknown as string),
        ).toThrow(BadRequestException);
        expect(() =>
          service.testAssignOwnership(entity, userId, null as unknown as string),
        ).toThrow(
          'Organization ID is required for resource creation. User must belong to at least one organization.',
        );
      });

      it('should throw BadRequestException when organizationId is undefined', () => {
        // Arrange
        const entity: Partial<TestEntity> = {
          name: 'New Resource',
        };

        // Act & Assert
        expect(() =>
          service.testAssignOwnership(entity, userId, undefined as unknown as string),
        ).toThrow(BadRequestException);
        expect(() =>
          service.testAssignOwnership(entity, userId, undefined as unknown as string),
        ).toThrow(
          'Organization ID is required for resource creation. User must belong to at least one organization.',
        );
      });

      it('should throw BadRequestException when organizationId is empty string', () => {
        // Arrange
        const entity: Partial<TestEntity> = {
          name: 'New Resource',
        };

        // Act & Assert
        expect(() => service.testAssignOwnership(entity, userId, '')).toThrow(
          BadRequestException,
        );
        expect(() => service.testAssignOwnership(entity, userId, '')).toThrow(
          'Organization ID is required for resource creation. User must belong to at least one organization.',
        );
      });

      it('should throw BadRequestException when organizationId is whitespace only', () => {
        // Arrange
        const entity: Partial<TestEntity> = {
          name: 'New Resource',
        };

        // Act & Assert
        expect(() => service.testAssignOwnership(entity, userId, '   ')).toThrow(
          BadRequestException,
        );
        expect(() => service.testAssignOwnership(entity, userId, '   ')).toThrow(
          'Organization ID is required for resource creation. User must belong to at least one organization.',
        );
      });

      it('should throw BadRequestException when organizationId is tabs/newlines only', () => {
        // Arrange
        const entity: Partial<TestEntity> = {
          name: 'New Resource',
        };

        // Act & Assert
        expect(() =>
          service.testAssignOwnership(entity, userId, '\t\n'),
        ).toThrow(BadRequestException);
      });

      it('should succeed with valid organizationId after previous validation failure', () => {
        // Arrange
        const entity: Partial<TestEntity> = {
          name: 'New Resource',
        };

        // First verify that empty string throws
        expect(() => service.testAssignOwnership(entity, userId, '')).toThrow(
          BadRequestException,
        );

        // Then verify that valid ID works
        const result = service.testAssignOwnership(entity, userId, organizationId);
        expect(result.organization_id).toBe(organizationId);
      });
    });
  });

  describe('markUpdated', () => {
    it('should update the updated_by field', () => {
      // Arrange
      const entity = createMockResource({
        updated_by: 'old-user-id',
      }) as TestEntity;

      // Act
      const result = service.testMarkUpdated(entity, userId);

      // Assert
      // markUpdated sets updated_by on the OwnedResource interface
      expect(result.updated_by).toBe(userId);
    });

    it('should return the same entity reference', () => {
      // Arrange
      const entity = createMockResource() as TestEntity;

      // Act
      const result = service.testMarkUpdated(entity, userId);

      // Assert
      expect(result).toBe(entity);
    });

    it('should preserve other entity properties', () => {
      // Arrange
      const entity = createMockResource({
        id: 'test-id',
        name: 'Test Name',
        organizationId: organizationId,
      }) as TestEntity;

      // Act
      const result = service.testMarkUpdated(entity, userId);

      // Assert
      expect(result.id).toBe('test-id');
      expect(result.name).toBe('Test Name');
      expect(result.organizationId).toBe(organizationId);
    });
  });

  describe('getDefaultOrganization', () => {
    it('should return the first organization when user has organizations', async () => {
      // Arrange
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue([
        'org-1',
        'org-2',
        'org-3',
      ]);

      // Act
      const result = await service.testGetDefaultOrganization(userId);

      // Assert
      expect(result).toBe('org-1');
      expect(mockAuthzService.getAccessibleOrganizations).toHaveBeenCalledWith(userId);
    });

    it('should return undefined when user has no organizations', async () => {
      // Arrange
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue([]);

      // Act
      const result = await service.testGetDefaultOrganization(userId);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should return single organization when user has only one', async () => {
      // Arrange
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue([organizationId]);

      // Act
      const result = await service.testGetDefaultOrganization(userId);

      // Assert
      expect(result).toBe(organizationId);
    });
  });

  describe('isGlobalAdmin', () => {
    it('should delegate to authzService.isGlobalAdmin', () => {
      // Arrange
      const roles = ['perfana-admin'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(true);

      // Act
      const result = service.testIsGlobalAdmin(roles);

      // Assert
      expect(result).toBe(true);
      expect(mockAuthzService.isGlobalAdmin).toHaveBeenCalledWith(roles);
    });

    it('should return false for non-admin roles', () => {
      // Arrange
      const roles = ['org-member', 'team-viewer'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);

      // Act
      const result = service.testIsGlobalAdmin(roles);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true for admin role', () => {
      // Arrange
      const roles = ['admin'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(true);

      // Act
      const result = service.testIsGlobalAdmin(roles);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('verifyOrganizationAccess', () => {
    it('should not throw for global admin', async () => {
      // Arrange
      const roles = ['perfana-admin'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(true);

      // Act & Assert
      await expect(
        service.testVerifyOrganizationAccess(userId, roles, organizationId),
      ).resolves.not.toThrow();
      expect(mockAuthzService.isOrganizationMember).not.toHaveBeenCalled();
    });

    it('should not throw when user is organization member', async () => {
      // Arrange
      const roles = ['org-member'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.isOrganizationMember.mockResolvedValue(true);

      // Act & Assert
      await expect(
        service.testVerifyOrganizationAccess(userId, roles, organizationId),
      ).resolves.not.toThrow();
      expect(mockAuthzService.isOrganizationMember).toHaveBeenCalledWith(
        userId,
        organizationId,
      );
    });

    it('should throw ForbiddenException when user is not organization member', async () => {
      // Arrange
      const roles = ['some-role'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.isOrganizationMember.mockResolvedValue(false);

      // Act & Assert
      await expect(
        service.testVerifyOrganizationAccess(userId, roles, organizationId),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.testVerifyOrganizationAccess(userId, roles, organizationId),
      ).rejects.toThrow(`User does not have access to organization ${organizationId}`);
    });

    it('should check membership for regular user', async () => {
      // Arrange
      const roles = ['user'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.isOrganizationMember.mockResolvedValue(true);

      // Act
      await service.testVerifyOrganizationAccess(userId, roles, organizationId);

      // Assert
      expect(mockAuthzService.isGlobalAdmin).toHaveBeenCalledWith(roles);
      expect(mockAuthzService.isOrganizationMember).toHaveBeenCalledWith(
        userId,
        organizationId,
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty roles array in applyOrgFilter', async () => {
      // Arrange
      const roles: string[] = [];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue([]);

      // Act
      await service.testApplyOrgFilter(mockQueryBuilder, userId, roles);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('1 = 0');
    });

    it('should handle API key user ID format', async () => {
      // Arrange
      const apiKeyUserId = 'api-key:123e4567-e89b-12d3-a456-426614174000';
      const roles = ['org-member'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue([organizationId]);

      // Act
      await service.testApplyOrgFilter(mockQueryBuilder, apiKeyUserId, roles);

      // Assert
      expect(mockAuthzService.getAccessibleOrganizations).toHaveBeenCalledWith(
        apiKeyUserId,
      );
    });

    it('should handle resource without team in checkAccessPermission', async () => {
      // Arrange
      const roles = ['org-member'];
      const resource = createMockResource({ teamId: undefined });
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User is a member of organization',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckAccessPermission(userId, roles, resource),
      ).resolves.not.toThrow();
    });

    it('should handle resource without organization (legacy data)', async () => {
      // Arrange
      const roles = ['org-member'];
      const resource = createMockResource({ organizationId: undefined });
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'Resource has no organization (legacy data)',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckAccessPermission(userId, roles, resource),
      ).resolves.not.toThrow();
    });

    it('should handle null organization_id in resource', async () => {
      // Arrange
      const roles = ['user'];
      const resource = createMockResource({ organizationId: null as any });
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'Resource has no organization (legacy data)',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckAccessPermission(userId, roles, resource),
      ).resolves.not.toThrow();
    });

    it('should handle concurrent permission checks', async () => {
      // Arrange
      const roles = ['org-member'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'Access granted',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act
      const results = await Promise.all([
        service.testCheckAccessPermission(userId, roles, resource),
        service.testCheckModifyPermission(userId, roles, resource),
        service.testCheckDeletePermission(userId, roles, resource),
      ]);

      // Assert - all should resolve without throwing
      expect(results).toHaveLength(3);
    });

    it('should handle resource owned by current user', async () => {
      // Arrange
      const roles = ['org-member'];
      const resource = createMockResource({ createdBy: userId });
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User is the resource creator',
      };
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act & Assert
      await expect(
        service.testCheckModifyPermission(userId, roles, resource),
      ).resolves.not.toThrow();
    });
  });

  describe('Permission Denied Error Messages', () => {
    it('should include specific reason in ForbiddenException for access denial', async () => {
      // Arrange
      const roles = ['user'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: false,
        reason: 'User user-123 does not have access to this resource',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);

      // Act & Assert
      try {
        await service.testCheckAccessPermission(userId, roles, resource);
        fail('Should have thrown ForbiddenException');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).message).toBe(
          'User user-123 does not have access to this resource',
        );
      }
    });

    it('should include specific reason in ForbiddenException for modify denial', async () => {
      // Arrange
      const roles = ['org-viewer'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: false,
        reason: 'User does not have modification rights for this resource',
      };
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act & Assert
      try {
        await service.testCheckModifyPermission(userId, roles, resource);
        fail('Should have thrown ForbiddenException');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).message).toBe(
          'User does not have modification rights for this resource',
        );
      }
    });

    it('should include organization ID in ForbiddenException for org access denial', async () => {
      // Arrange
      const roles = ['user'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(false);
      mockAuthzService.isOrganizationMember.mockResolvedValue(false);

      // Act & Assert
      try {
        await service.testVerifyOrganizationAccess(userId, roles, organizationId);
        fail('Should have thrown ForbiddenException');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).message).toContain(organizationId);
      }
    });
  });

  describe('Logging Behavior', () => {
    // Note: These tests verify that the service handles various scenarios correctly.
    // Actual logging behavior is internal implementation detail.

    it('should handle permission checks without errors for allowed access', async () => {
      // Arrange
      const roles = ['org-admin'];
      const resource = createMockResource();
      const authResult: AuthorizationResult = {
        allowed: true,
        reason: 'User is an admin of organization',
      };
      mockAuthzService.canAccessResource.mockResolvedValue(authResult);
      mockAuthzService.canModifyResource.mockResolvedValue(authResult);

      // Act & Assert - should complete without errors
      await service.testCheckAccessPermission(userId, roles, resource);
      await service.testCheckModifyPermission(userId, roles, resource);
      await service.testCheckDeletePermission(userId, roles, resource);
    });

    it('should handle global admin bypass in applyOrgFilter', async () => {
      // Arrange
      const roles = ['perfana-admin'];
      mockAuthzService.isGlobalAdmin.mockReturnValue(true);

      // Act
      const result = await service.testApplyOrgFilter(mockQueryBuilder, userId, roles);

      // Assert
      expect(result).toBe(mockQueryBuilder);
      expect(mockAuthzService.isGlobalAdmin).toHaveBeenCalledWith(roles);
    });
  });
});
