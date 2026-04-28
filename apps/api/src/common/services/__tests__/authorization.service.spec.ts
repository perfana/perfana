/**
 * AuthorizationService Test Suite
 *
 * Comprehensive tests for authorization service including:
 * - Global admin role checks
 * - Organization membership checks
 * - Team membership checks
 * - Resource access and modification permission checks
 * - Cache integration and invalidation
 * - Edge cases and security scenarios
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AuthorizationService,
  CachedUserContext,
  AuthorizationResult,
} from '../authorization.service';
import { CapabilitiesService } from '../capabilities.service';
import { OrganizationMember, TeamMember, Team, ApiKey } from '@perfana/shared/entities';
import { OwnedResource } from '@perfana/shared/entities';
import { OrganizationRole, TeamRole } from '../../../constants/roles.constants';

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let redis: jest.Mocked<any>;
  let configService: jest.Mocked<ConfigService>;
  let organizationMemberRepository: jest.Mocked<Repository<OrganizationMember>>;
  let teamMemberRepository: jest.Mocked<Repository<TeamMember>>;
  let teamRepository: jest.Mocked<Repository<Team>>;

  // Test UUIDs
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const organizationId = '223e4567-e89b-12d3-a456-426614174001';
  const teamId = '323e4567-e89b-12d3-a456-426614174002';

  // Mock data factory
  const createMockResource = (overrides?: Partial<OwnedResource>): OwnedResource => ({
    created_by: 'other-user-id',
    updated_by: 'other-user-id',
    organization_id: organizationId,
    team_id: teamId,
    ...overrides,
  });

  const createMockOrganizationMember = (
    overrides?: Partial<OrganizationMember>,
  ): OrganizationMember =>
    ({
      id: '423e4567-e89b-12d3-a456-426614174003',
      organization_id: organizationId,
      user_id: userId,
      roles: [OrganizationRole.MEMBER],
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      ...overrides,
    }) as OrganizationMember;

  const createMockTeamMember = (overrides?: Partial<TeamMember>): TeamMember =>
    ({
      id: '523e4567-e89b-12d3-a456-426614174004',
      team_id: teamId,
      user_id: userId,
      roles: [TeamRole.MEMBER],
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      ...overrides,
    }) as TeamMember;

  beforeEach(async () => {
    // Create mock Redis client
    redis = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      scan: jest.fn(),
      incr: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        CapabilitiesService,
        {
          provide: 'REDIS_CLIENT',
          useValue: redis,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'AUTH_CACHE_TTL_SECONDS') return 300;
              if (key === 'AUTH_CACHE_ENABLED') return 'true';
              return defaultValue;
            }),
          },
        },
        {
          provide: getRepositoryToken(OrganizationMember),
          useValue: {
            count: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: {
            count: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Team),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ApiKey),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthorizationService>(AuthorizationService);
    configService = module.get(ConfigService);
    organizationMemberRepository = module.get(getRepositoryToken(OrganizationMember));
    teamMemberRepository = module.get(getRepositoryToken(TeamMember));
    teamRepository = module.get(getRepositoryToken(Team));

    // Default mock behaviors
    redis.get.mockResolvedValue(null);
    redis.setex.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);
    redis.scan.mockResolvedValue(['0', []]);
    redis.incr.mockResolvedValue(1);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isGlobalAdmin', () => {
    it('should return true for perfana-admin role', () => {
      // Arrange
      const roles = ['perfana-admin'];

      // Act
      const result = service.isGlobalAdmin(roles);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for admin role', () => {
      // Arrange
      const roles = ['admin'];

      // Act
      const result = service.isGlobalAdmin(roles);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when admin role is among other roles', () => {
      // Arrange
      const roles = ['org-member', 'team-viewer', 'perfana-admin'];

      // Act
      const result = service.isGlobalAdmin(roles);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for non-admin roles', () => {
      // Arrange
      const roles = ['org-member', 'team-admin'];

      // Act
      const result = service.isGlobalAdmin(roles);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for empty roles array', () => {
      // Arrange
      const roles: string[] = [];

      // Act
      const result = service.isGlobalAdmin(roles);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for null roles', () => {
      // Act
      const result = service.isGlobalAdmin(null);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for undefined roles', () => {
      // Act
      const result = service.isGlobalAdmin(undefined);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('canAccessResource', () => {
    it('should allow access for global admin', async () => {
      // Arrange
      const globalRoles = ['perfana-admin'];
      const resource = createMockResource();

      // Act
      const result = await service.canAccessResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User has global admin privileges');
    });

    it('should allow access for legacy resources without organization', async () => {
      // Arrange
      const globalRoles = ['org-member'];
      const resource = createMockResource({ organization_id: undefined as any });

      // Act
      const result = await service.canAccessResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Resource has no organization (legacy data)');
    });

    it('should allow access for organization member', async () => {
      // Arrange
      const globalRoles = ['org-member'];
      const resource = createMockResource();

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canAccessResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('User is a member of organization');
    });

    it('should allow access for team member when not org member', async () => {
      // Arrange
      const globalRoles = ['team-member'];
      const resource = createMockResource();

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(0);
      teamMemberRepository.count.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canAccessResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('User is a member of team');
    });

    it('should deny access when user has no membership', async () => {
      // Arrange
      const globalRoles = ['some-role'];
      const resource = createMockResource();

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(0);
      teamMemberRepository.count.mockResolvedValue(0);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canAccessResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not have access');
    });

    it('should skip team check when resource has no team', async () => {
      // Arrange
      const globalRoles = ['some-role'];
      const resource = createMockResource({ team_id: undefined });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(0);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canAccessResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(false);
      expect(teamMemberRepository.count).not.toHaveBeenCalled();
    });
  });

  describe('canModifyResource', () => {
    it('should allow modification for global admin', async () => {
      // Arrange
      const globalRoles = ['admin'];
      const resource = createMockResource();

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User has global admin privileges');
    });

    it('should allow modification for legacy resources without organization', async () => {
      // Arrange
      const globalRoles = ['org-member'];
      const resource = createMockResource({ organization_id: undefined as any });

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Resource has no organization (legacy data)');
    });

    it('should allow modification for resource creator', async () => {
      // Arrange
      const globalRoles = ['org-member'];
      const resource = createMockResource({ created_by: userId });

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User is the resource creator');
    });

    it('should allow modification for organization admin', async () => {
      // Arrange
      const globalRoles = ['org-admin'];
      const resource = createMockResource();
      const mockMember = createMockOrganizationMember({
        roles: [OrganizationRole.ADMIN],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(mockMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('User is an admin of organization');
    });

    it('should allow modification for team admin', async () => {
      // Arrange
      const globalRoles = ['team-admin'];
      const resource = createMockResource();
      const mockTeamMember = createMockTeamMember({
        roles: [TeamRole.ADMIN],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(null);
      teamMemberRepository.findOne.mockResolvedValue(mockTeamMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('User is an admin of team');
    });

    it('should deny modification for regular org member', async () => {
      // Arrange
      const globalRoles = ['org-member'];
      const resource = createMockResource();
      const mockMember = createMockOrganizationMember({
        roles: [OrganizationRole.MEMBER],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(mockMember);
      teamMemberRepository.findOne.mockResolvedValue(null);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not have modification rights');
    });

    it('should deny modification for regular team member', async () => {
      // Arrange
      const globalRoles = ['team-member'];
      const resource = createMockResource();
      const mockTeamMember = createMockTeamMember({
        roles: [TeamRole.MEMBER],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(null);
      teamMemberRepository.findOne.mockResolvedValue(mockTeamMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not have modification rights');
    });

    it('should skip team check when resource has no team', async () => {
      // Arrange
      const globalRoles = ['org-member'];
      const resource = createMockResource({ team_id: undefined });
      const mockMember = createMockOrganizationMember({
        roles: [OrganizationRole.MEMBER],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(mockMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(false);
      expect(teamMemberRepository.findOne).not.toHaveBeenCalled();
    });

    it('should not allow modification when created_by is null', async () => {
      // Arrange
      const globalRoles = ['org-member'];
      const resource = createMockResource({
        created_by: undefined as any,
      });
      const mockMember = createMockOrganizationMember({
        roles: [OrganizationRole.MEMBER],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(mockMember);
      teamMemberRepository.findOne.mockResolvedValue(null);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canModifyResource(userId, globalRoles, resource);

      // Assert
      expect(result.allowed).toBe(false);
    });
  });

  describe('isOrganizationMember', () => {
    it('should return true when user is org member (cache miss)', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isOrganizationMember(userId, organizationId);

      // Assert
      expect(result).toBe(true);
      expect(organizationMemberRepository.count).toHaveBeenCalledWith({
        where: {
          user_id: userId,
          organization_id: organizationId,
        },
      });
      expect(redis.setex).toHaveBeenCalled();
    });

    it('should return false when user is not org member (cache miss)', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(0);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isOrganizationMember(userId, organizationId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return cached value (true) on cache hit', async () => {
      // Arrange
      redis.get.mockResolvedValue('1');

      // Act
      const result = await service.isOrganizationMember(userId, organizationId);

      // Assert
      expect(result).toBe(true);
      expect(organizationMemberRepository.count).not.toHaveBeenCalled();
    });

    it('should return cached value (false) on cache hit', async () => {
      // Arrange
      redis.get.mockResolvedValue('0');

      // Act
      const result = await service.isOrganizationMember(userId, organizationId);

      // Assert
      expect(result).toBe(false);
      expect(organizationMemberRepository.count).not.toHaveBeenCalled();
    });

    it('should return false on database error (fail closed)', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockRejectedValue(
        new Error('Database error'),
      );

      // Act
      const result = await service.isOrganizationMember(userId, organizationId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('isOrganizationAdmin', () => {
    it('should return true for org admin', async () => {
      // Arrange
      const mockMember = createMockOrganizationMember({
        roles: [OrganizationRole.ADMIN],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(mockMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isOrganizationAdmin(userId, organizationId);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for org member (non-admin)', async () => {
      // Arrange
      const mockMember = createMockOrganizationMember({
        roles: [OrganizationRole.MEMBER],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(mockMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isOrganizationAdmin(userId, organizationId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for org viewer', async () => {
      // Arrange
      const mockMember = createMockOrganizationMember({
        roles: [OrganizationRole.VIEWER],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(mockMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isOrganizationAdmin(userId, organizationId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user is not a member', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(null);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isOrganizationAdmin(userId, organizationId);

      // Assert
      expect(result).toBe(false);
    });

    it('should use cached admin status', async () => {
      // Arrange
      redis.get.mockResolvedValue('1');

      // Act
      const result = await service.isOrganizationAdmin(userId, organizationId);

      // Assert
      expect(result).toBe(true);
      expect(organizationMemberRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return false on database error', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockRejectedValue(
        new Error('Database error'),
      );

      // Act
      const result = await service.isOrganizationAdmin(userId, organizationId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getAccessibleOrganizations', () => {
    it('should return organizations from database on cache miss', async () => {
      // Arrange
      const mockMemberships = [
        { organization_id: 'org-1' },
        { organization_id: 'org-2' },
        { organization_id: 'org-3' },
      ] as OrganizationMember[];

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.find.mockResolvedValue(mockMemberships);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.getAccessibleOrganizations(userId);

      // Assert
      expect(result).toEqual(['org-1', 'org-2', 'org-3']);
      expect(organizationMemberRepository.find).toHaveBeenCalledWith({
        where: { user_id: userId },
        select: ['organization_id'],
      });
      expect(redis.setex).toHaveBeenCalled();
    });

    it('should return cached organizations on cache hit', async () => {
      // Arrange
      redis.get.mockResolvedValue(JSON.stringify(['cached-org-1', 'cached-org-2']));

      // Act
      const result = await service.getAccessibleOrganizations(userId);

      // Assert
      expect(result).toEqual(['cached-org-1', 'cached-org-2']);
      expect(organizationMemberRepository.find).not.toHaveBeenCalled();
    });

    it('should return empty array when user has no memberships', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.find.mockResolvedValue([]);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.getAccessibleOrganizations(userId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array on database error', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.find.mockRejectedValue(
        new Error('Database error'),
      );

      // Act
      const result = await service.getAccessibleOrganizations(userId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle cache get error gracefully', async () => {
      // Arrange
      const mockMemberships = [
        { organization_id: 'org-1' },
      ] as OrganizationMember[];

      redis.get.mockRejectedValue(new Error('Redis error'));
      organizationMemberRepository.find.mockResolvedValue(mockMemberships);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.getAccessibleOrganizations(userId);

      // Assert
      expect(result).toEqual(['org-1']);
    });

    it('should handle cache set error gracefully', async () => {
      // Arrange
      const mockMemberships = [
        { organization_id: 'org-1' },
      ] as OrganizationMember[];

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.find.mockResolvedValue(mockMemberships);
      redis.setex.mockRejectedValue(new Error('Redis error'));

      // Act
      const result = await service.getAccessibleOrganizations(userId);

      // Assert
      expect(result).toEqual(['org-1']);
    });
  });

  describe('isTeamMember', () => {
    it('should return true when user is team member (cache miss)', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      teamMemberRepository.count.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isTeamMember(userId, teamId);

      // Assert
      expect(result).toBe(true);
      expect(teamMemberRepository.count).toHaveBeenCalledWith({
        where: {
          user_id: userId,
          team_id: teamId,
        },
      });
    });

    it('should return false when user is not team member', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      teamMemberRepository.count.mockResolvedValue(0);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isTeamMember(userId, teamId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return cached value on cache hit', async () => {
      // Arrange
      redis.get.mockResolvedValue('1');

      // Act
      const result = await service.isTeamMember(userId, teamId);

      // Assert
      expect(result).toBe(true);
      expect(teamMemberRepository.count).not.toHaveBeenCalled();
    });

    it('should return false on database error (fail closed)', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      teamMemberRepository.count.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.isTeamMember(userId, teamId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('isTeamAdmin', () => {
    it('should return true for team admin', async () => {
      // Arrange
      const mockMember = createMockTeamMember({
        roles: [TeamRole.ADMIN],
      });

      redis.get.mockResolvedValue(null);
      teamMemberRepository.findOne.mockResolvedValue(mockMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isTeamAdmin(userId, teamId);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for team member (non-admin)', async () => {
      // Arrange
      const mockMember = createMockTeamMember({
        roles: [TeamRole.MEMBER],
      });

      redis.get.mockResolvedValue(null);
      teamMemberRepository.findOne.mockResolvedValue(mockMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isTeamAdmin(userId, teamId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for team viewer', async () => {
      // Arrange
      const mockMember = createMockTeamMember({
        roles: [TeamRole.VIEWER],
      });

      redis.get.mockResolvedValue(null);
      teamMemberRepository.findOne.mockResolvedValue(mockMember);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isTeamAdmin(userId, teamId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user is not a team member', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      teamMemberRepository.findOne.mockResolvedValue(null);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isTeamAdmin(userId, teamId);

      // Assert
      expect(result).toBe(false);
    });

    it('should use cached admin status', async () => {
      // Arrange
      redis.get.mockResolvedValue('1');

      // Act
      const result = await service.isTeamAdmin(userId, teamId);

      // Assert
      expect(result).toBe(true);
      expect(teamMemberRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return false on database error', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      teamMemberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.isTeamAdmin(userId, teamId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getAccessibleTeams', () => {
    it('should return teams from database on cache miss', async () => {
      // Arrange
      const mockMemberships = [
        { team_id: 'team-1' },
        { team_id: 'team-2' },
      ] as TeamMember[];

      redis.get.mockResolvedValue(null);
      teamMemberRepository.find.mockResolvedValue(mockMemberships);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.getAccessibleTeams(userId);

      // Assert
      expect(result).toEqual(['team-1', 'team-2']);
      expect(teamMemberRepository.find).toHaveBeenCalledWith({
        where: { user_id: userId },
        select: ['team_id'],
      });
    });

    it('should return cached teams on cache hit', async () => {
      // Arrange
      redis.get.mockResolvedValue(JSON.stringify(['cached-team-1']));

      // Act
      const result = await service.getAccessibleTeams(userId);

      // Assert
      expect(result).toEqual(['cached-team-1']);
      expect(teamMemberRepository.find).not.toHaveBeenCalled();
    });

    it('should return empty array when user has no team memberships', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      teamMemberRepository.find.mockResolvedValue([]);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.getAccessibleTeams(userId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array on database error', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      teamMemberRepository.find.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.getAccessibleTeams(userId);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('Cache Invalidation', () => {
    describe('invalidateUserCache', () => {
      it('should invalidate all user cache keys', async () => {
        // Arrange
        redis.scan.mockResolvedValueOnce(['0', ['key1', 'key2']])
          .mockResolvedValueOnce(['0', ['key3']]);
        redis.del.mockResolvedValue(4);

        // Act
        await service.invalidateUserCache(userId);

        // Assert
        expect(redis.scan).toHaveBeenCalled();
        expect(redis.del).toHaveBeenCalled();
      });

      it('should handle scan error gracefully', async () => {
        // Arrange
        redis.scan.mockRejectedValue(new Error('Redis error'));

        // Act & Assert - should not throw
        await expect(service.invalidateUserCache(userId)).resolves.not.toThrow();
      });

      it('should still delete accessible keys when scan returns empty', async () => {
        // Arrange - scan returns no keys, but accessible keys are always added
        redis.scan.mockResolvedValue(['0', []]);
        redis.del.mockResolvedValue(2);

        // Act
        await service.invalidateUserCache(userId);

        // Assert - del is still called with the accessible org and team keys
        expect(redis.del).toHaveBeenCalledWith(
          `auth:user-context:orgs:${userId}`,
          `auth:user-context:teams:${userId}`,
        );
      });
    });

    describe('invalidateOrganizationCache', () => {
      it('should invalidate all organization cache keys', async () => {
        // Arrange
        redis.scan.mockResolvedValue(['0', ['org-key-1', 'org-key-2']]);
        redis.del.mockResolvedValue(2);

        // Act
        await service.invalidateOrganizationCache(organizationId);

        // Assert
        expect(redis.scan).toHaveBeenCalled();
        expect(redis.del).toHaveBeenCalledWith('org-key-1', 'org-key-2');
      });

      it('should handle scan error gracefully', async () => {
        // Arrange
        redis.scan.mockRejectedValue(new Error('Redis error'));

        // Act & Assert - should not throw
        await expect(
          service.invalidateOrganizationCache(organizationId),
        ).resolves.not.toThrow();
      });
    });

    describe('invalidateTeamCache', () => {
      it('should invalidate all team cache keys', async () => {
        // Arrange
        redis.scan.mockResolvedValue(['0', ['team-key-1']]);
        redis.del.mockResolvedValue(1);

        // Act
        await service.invalidateTeamCache(teamId);

        // Assert
        expect(redis.scan).toHaveBeenCalled();
        expect(redis.del).toHaveBeenCalledWith('team-key-1');
      });

      it('should handle scan error gracefully', async () => {
        // Arrange
        redis.scan.mockRejectedValue(new Error('Redis error'));

        // Act & Assert - should not throw
        await expect(service.invalidateTeamCache(teamId)).resolves.not.toThrow();
      });
    });

    describe('clearAllCaches', () => {
      it('should clear all authorization caches', async () => {
        // Arrange
        redis.scan
          .mockResolvedValueOnce(['0', ['key1', 'key2']])
          .mockResolvedValueOnce(['0', ['key3']])
          .mockResolvedValueOnce(['0', ['key4']]);
        redis.del.mockResolvedValue(4);

        // Act
        await service.clearAllCaches();

        // Assert
        expect(redis.scan).toHaveBeenCalledTimes(3);
        expect(redis.del).toHaveBeenCalledTimes(3);
      });

      it('should handle scan error gracefully', async () => {
        // Arrange
        redis.scan.mockRejectedValue(new Error('Redis error'));

        // Act & Assert - should not throw
        await expect(service.clearAllCaches()).resolves.not.toThrow();
      });
    });
  });

  describe('Cache Statistics', () => {
    describe('getCacheStats', () => {
      it('should return initial cache statistics', () => {
        // Act
        const stats = service.getCacheStats();

        // Assert
        expect(stats).toEqual({
          hits: 0,
          misses: 0,
          hitRate: '0.00%',
          totalRequests: 0,
        });
      });

      it('should calculate hit rate correctly', async () => {
        // Arrange - cause cache hits and misses
        redis.get.mockResolvedValueOnce('1') // hit
          .mockResolvedValueOnce('1')         // hit
          .mockResolvedValueOnce(null)        // miss
          .mockResolvedValueOnce(null);       // miss
        organizationMemberRepository.count.mockResolvedValue(1);
        redis.setex.mockResolvedValue('OK');

        // Act - trigger cache checks
        await service.isOrganizationMember(userId, organizationId);
        await service.isOrganizationMember(userId, 'org-2');
        await service.isOrganizationMember(userId, 'org-3');
        await service.isOrganizationMember(userId, 'org-4');

        const stats = service.getCacheStats();

        // Assert
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(2);
        expect(stats.totalRequests).toBe(4);
        expect(stats.hitRate).toBe('50.00%');
      });
    });

    describe('resetCacheStats', () => {
      it('should reset cache statistics to zero', async () => {
        // Arrange - cause some cache activity
        redis.get.mockResolvedValue('1');
        await service.isOrganizationMember(userId, organizationId);

        // Verify stats are non-zero
        expect(service.getCacheStats().hits).toBeGreaterThan(0);

        // Act
        service.resetCacheStats();

        // Assert
        const stats = service.getCacheStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
        expect(stats.totalRequests).toBe(0);
      });
    });
  });

  describe('Health Check', () => {
    describe('healthCheck', () => {
      it('should return true when Redis is healthy', async () => {
        // Arrange
        redis.setex.mockResolvedValue('OK');
        redis.get.mockResolvedValue('ok');
        redis.del.mockResolvedValue(1);

        // Act
        const result = await service.healthCheck();

        // Assert
        expect(result).toBe(true);
        expect(redis.setex).toHaveBeenCalledWith('auth:health-check', 10, 'ok');
        expect(redis.get).toHaveBeenCalledWith('auth:health-check');
        expect(redis.del).toHaveBeenCalledWith('auth:health-check');
      });

      it('should return false when Redis value does not match', async () => {
        // Arrange
        redis.setex.mockResolvedValue('OK');
        redis.get.mockResolvedValue('wrong-value');
        redis.del.mockResolvedValue(1);

        // Act
        const result = await service.healthCheck();

        // Assert
        expect(result).toBe(false);
      });

      it('should return false when Redis throws error', async () => {
        // Arrange
        redis.setex.mockRejectedValue(new Error('Redis connection failed'));

        // Act
        const result = await service.healthCheck();

        // Assert
        expect(result).toBe(false);
      });

      it('should return false when Redis get fails', async () => {
        // Arrange
        redis.setex.mockResolvedValue('OK');
        redis.get.mockRejectedValue(new Error('Redis error'));

        // Act
        const result = await service.healthCheck();

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent permission checks', async () => {
      // Arrange
      const resource = createMockResource();
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');

      // Act
      const results = await Promise.all([
        service.canAccessResource(userId, ['org-member'], resource),
        service.canAccessResource(userId, ['org-member'], resource),
        service.canAccessResource(userId, ['org-member'], resource),
      ]);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach((result) => expect(result.allowed).toBe(true));
    });

    it('should handle resource with null organizationId', async () => {
      // Arrange
      const resource = createMockResource({ organization_id: null as any });

      // Act
      const result = await service.canAccessResource(userId, [], resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Resource has no organization (legacy data)');
    });

    it('should handle empty string userId', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(0);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isOrganizationMember('', organizationId);

      // Assert
      expect(result).toBe(false);
      expect(organizationMemberRepository.count).toHaveBeenCalledWith({
        where: {
          user_id: '',
          organization_id: organizationId,
        },
      });
    });

    it('should handle special characters in userId', async () => {
      // Arrange
      const specialUserId = 'api-key:123e4567-e89b-12d3-a456-426614174000';
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.count.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.isOrganizationMember(specialUserId, organizationId);

      // Assert
      expect(result).toBe(true);
    });

    it('should correctly handle resource owned by current user', async () => {
      // Arrange
      const resource = createMockResource({ created_by: userId });

      // Act
      const result = await service.canModifyResource(userId, [], resource);

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User is the resource creator');
    });

    it('should deny modification for different user than creator', async () => {
      // Arrange
      const resource = createMockResource({ created_by: 'different-user' });
      const mockMember = createMockOrganizationMember({
        roles: [OrganizationRole.MEMBER],
      });

      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(mockMember);
      teamMemberRepository.findOne.mockResolvedValue(null);
      redis.setex.mockResolvedValue('OK');

      // Act
      const result = await service.canModifyResource(userId, [], resource);

      // Assert
      expect(result.allowed).toBe(false);
    });
  });

  describe('Cache Disabled Scenarios', () => {
    let noCacheService: AuthorizationService;
    let noCacheRedis: jest.Mocked<any>;

    beforeEach(async () => {
      noCacheRedis = {
        get: jest.fn(),
        setex: jest.fn(),
        del: jest.fn(),
        scan: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthorizationService,
          CapabilitiesService,
          {
            provide: 'REDIS_CLIENT',
            useValue: noCacheRedis,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                if (key === 'AUTH_CACHE_TTL_SECONDS') return 300;
                if (key === 'AUTH_CACHE_ENABLED') return 'false'; // Cache disabled
                return defaultValue;
              }),
            },
          },
          {
            provide: getRepositoryToken(OrganizationMember),
            useValue: {
              count: jest.fn().mockResolvedValue(1),
              findOne: jest.fn(),
              find: jest.fn(),
            },
          },
          {
            provide: getRepositoryToken(TeamMember),
            useValue: {
              count: jest.fn(),
              findOne: jest.fn(),
              find: jest.fn(),
            },
          },
          {
            provide: getRepositoryToken(Team),
            useValue: {
              findOne: jest.fn(),
            },
          },
          {
            provide: getRepositoryToken(ApiKey),
            useValue: {
              findOne: jest.fn(),
            },
          },
        ],
      }).compile();

      noCacheService = module.get<AuthorizationService>(AuthorizationService);
    });

    it('should not use cache when disabled', async () => {
      // Arrange
      const noCacheOrgRepo = (
        await Test.createTestingModule({
          providers: [
            AuthorizationService,
            CapabilitiesService,
            {
              provide: 'REDIS_CLIENT',
              useValue: noCacheRedis,
            },
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string, defaultValue?: any) => {
                  if (key === 'AUTH_CACHE_TTL_SECONDS') return 300;
                  if (key === 'AUTH_CACHE_ENABLED') return 'false';
                  return defaultValue;
                }),
              },
            },
            {
              provide: getRepositoryToken(OrganizationMember),
              useValue: {
                count: jest.fn().mockResolvedValue(1),
                findOne: jest.fn(),
                find: jest.fn().mockResolvedValue([{ organization_id: 'org-1' }]),
              },
            },
            {
              provide: getRepositoryToken(TeamMember),
              useValue: {
                count: jest.fn(),
                findOne: jest.fn(),
                find: jest.fn(),
              },
            },
            {
              provide: getRepositoryToken(Team),
              useValue: {
                findOne: jest.fn(),
              },
            },
            {
              provide: getRepositoryToken(ApiKey),
              useValue: {
                findOne: jest.fn(),
              },
            },
          ],
        }).compile()
      ).get(getRepositoryToken(OrganizationMember)) as jest.Mocked<
        Repository<OrganizationMember>
      >;

      // Act
      await noCacheService.isOrganizationMember(userId, organizationId);

      // Assert - Redis should not be called when cache is disabled
      expect(noCacheRedis.get).not.toHaveBeenCalled();
      expect(noCacheRedis.setex).not.toHaveBeenCalled();
    });

    it('should not invalidate when cache is disabled', async () => {
      // Act
      await noCacheService.invalidateUserCache(userId);

      // Assert
      expect(noCacheRedis.scan).not.toHaveBeenCalled();
      expect(noCacheRedis.del).not.toHaveBeenCalled();
    });

    it('should not clear caches when disabled', async () => {
      // Act
      await noCacheService.clearAllCaches();

      // Assert
      expect(noCacheRedis.scan).not.toHaveBeenCalled();
    });
  });

  describe('getCapabilities', () => {
    // Reuses the test bed already wired up in this file. CapabilitiesService is
    // injected into AuthorizationService and provided in the module below.

    it('returns global-admin capabilities when caller passes perfana-admin', async () => {
      // No DB setup needed — global-admin short-circuits before any DB call.
      const caps = await service.getCapabilities('user-1', ['perfana-admin'], null);
      expect(caps).toContain('integration:dynatrace:update');
      expect(caps).toContain('system:manage-users');
    });

    it('returns org-admin capabilities for an org-admin in the given org', async () => {
      // Arrange: version key returns null (default 1), capabilities cache miss, DB has org-admin
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue({
        user_id: 'user-2',
        organization_id: 'org-a',
        roles: [OrganizationRole.ADMIN],
      } as OrganizationMember);
      teamMemberRepository.findOne.mockResolvedValue(null);

      const caps = await service.getCapabilities('user-2', ['perfana-user'], 'org-a');
      expect(caps).toContain('integration:dynatrace:update');
      expect(caps).toContain('org:manage-members');
      expect(caps).not.toContain('system:manage-users');
    });

    it('returns empty set when user has no membership in the org', async () => {
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue(null);
      teamMemberRepository.findOne.mockResolvedValue(null);

      const caps = await service.getCapabilities('outsider', ['perfana-user'], 'org-a');
      expect(caps).toEqual([]);
    });

    it('caches results: second call hits Redis, not the DB', async () => {
      // Simulate Redis already holding a valid cache entry for this user/org combo.
      // Both the version key and the caps key resolve to a hit.
      const cachedCaps = JSON.stringify(['integration:dynatrace:update', 'org:manage-members']);
      redis.get
        .mockResolvedValueOnce('1')        // getCapabilitiesVersion → version is 1
        .mockResolvedValueOnce(cachedCaps); // getCachedCapabilities → cache hit

      const dbSpy = jest.spyOn(organizationMemberRepository, 'findOne');
      const caps = await service.getCapabilities('user-2', ['perfana-user'], 'org-a');

      expect(dbSpy).not.toHaveBeenCalled();
      expect(caps).toContain('integration:dynatrace:update');
    });

    it('loads team roles when teamId is provided', async () => {
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue({
        user_id: 'user-2',
        organization_id: 'org-a',
        roles: [OrganizationRole.MEMBER],
      } as OrganizationMember);
      teamMemberRepository.findOne.mockResolvedValue({
        user_id: 'user-2',
        team_id: 'team-a',
        roles: [TeamRole.ADMIN],
      } as TeamMember);

      const caps = await service.getCapabilities('user-2', ['perfana-user'], 'org-a', 'team-a');
      expect(caps).toContain('team:manage-members');
    });

    it('does not call team repo when teamId is omitted', async () => {
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue({
        user_id: 'user-2',
        organization_id: 'org-a',
        roles: [OrganizationRole.MEMBER],
      } as OrganizationMember);

      const teamSpy = jest.spyOn(teamMemberRepository, 'findOne');
      await service.getCapabilities('user-2', ['perfana-user'], 'org-a');
      expect(teamSpy).not.toHaveBeenCalled();
    });

    it('falls back to DB when Redis read fails (does not throw)', async () => {
      jest.spyOn(redis, 'get').mockRejectedValue(new Error('Redis down'));
      organizationMemberRepository.findOne.mockResolvedValue({
        user_id: 'user-2',
        organization_id: 'org-a',
        roles: [OrganizationRole.ADMIN],
      } as OrganizationMember);
      teamMemberRepository.findOne.mockResolvedValue(null);
      redis.setex.mockResolvedValue('OK');

      const caps = await service.getCapabilities('user-2', ['perfana-user'], 'org-a');
      expect(caps).toContain('integration:dynatrace:update'); // from DB
    });

    it('still returns the computed result when Redis write fails (cache write is non-fatal)', async () => {
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue({
        user_id: 'user-3',
        organization_id: 'org-a',
        roles: [OrganizationRole.ADMIN],
      } as OrganizationMember);
      teamMemberRepository.findOne.mockResolvedValue(null);
      redis.setex.mockRejectedValue(new Error('Redis down'));

      // First call (cache miss) — DB load + cache write attempt
      const caps = await service.getCapabilities('user-3', ['perfana-user'], 'org-a');
      expect(caps).toBeDefined();
      expect(caps.length).toBeGreaterThan(0);
    });

    it('bubbles up DB errors (caller observes the failure rather than getting empty caps)', async () => {
      redis.get.mockResolvedValue(null);
      jest.spyOn(organizationMemberRepository, 'findOne').mockRejectedValue(new Error('Postgres down'));

      await expect(
        service.getCapabilities('user-4', ['perfana-user'], 'org-a'),
      ).rejects.toThrow('Postgres down');
      // Decision: we do NOT swallow DB errors silently. An empty capability set
      // would let mutations through that should be denied. Better to 500.
    });

    it('invalidates capability cache when membership changes', async () => {
      // Arrange: first call populates cache (cache miss → DB hit → cache write)
      redis.get.mockResolvedValue(null);
      organizationMemberRepository.findOne.mockResolvedValue({
        user_id: 'user-2',
        organization_id: 'org-a',
        roles: [OrganizationRole.ADMIN],
      } as OrganizationMember);
      teamMemberRepository.findOne.mockResolvedValue(null);
      await service.getCapabilities('user-2', ['perfana-user'], 'org-a');

      // Act: simulate a membership change — the version counter must be bumped
      // so that every cached capabilities key for this user becomes unreachable.
      await service.invalidateUserCache('user-2');

      // Assert: invalidateUserCache must have called redis.incr on the
      // per-user capabilities-version key. We don't assert the exact version
      // value — that would couple the test to the version counter's start value.
      expect(redis.incr).toHaveBeenCalledWith('auth:capabilities-version:user-2');
    });
  });

  describe('SCAN Iterator Edge Cases', () => {
    it('should handle multi-iteration scan results', async () => {
      // Arrange - simulate cursor-based iteration
      redis.scan
        .mockResolvedValueOnce(['100', ['key1', 'key2']])   // First iteration
        .mockResolvedValueOnce(['200', ['key3']])           // Second iteration
        .mockResolvedValueOnce(['0', ['key4']]);            // Final iteration
      redis.del.mockResolvedValue(4);

      // Act
      await service.invalidateUserCache(userId);

      // Assert
      expect(redis.scan).toHaveBeenCalled();
      // The scan might be called multiple times due to cursor iteration
    });

    it('should handle empty scan results on all patterns', async () => {
      // Arrange
      redis.scan.mockResolvedValue(['0', []]);

      // Act
      await service.clearAllCaches();

      // Assert
      expect(redis.del).not.toHaveBeenCalled();
    });
  });
});
