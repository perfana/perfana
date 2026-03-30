/**
 * OrganizationMembersService Test Suite
 *
 * Comprehensive tests for organization membership management service including:
 * - CRUD operations for organization members
 * - Role checking and management
 * - Authorization helpers (isMember, hasRole, isOrgAdmin)
 * - Edge cases and error handling
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import {
  OrganizationMembersService,
  AddOrganizationMemberDto,
  UpdateOrganizationMemberRolesDto,
} from '../organization-members.service';
import { Organization, OrganizationMember } from '@perfana/shared';
import { OrganizationRole } from '../../../constants/roles.constants';
import { KeycloakAdminService } from '../../auth/keycloak-admin.service';
import { AuthorizationService } from '../../../common/services/authorization.service';

describe('OrganizationMembersService', () => {
  let service: OrganizationMembersService;
  let memberRepository: jest.Mocked<Repository<OrganizationMember>>;
  let organizationRepository: jest.Mocked<Repository<Organization>>;

  // Mock data factory for OrganizationMember
  const createMockMember = (
    overrides?: Partial<OrganizationMember>,
  ): OrganizationMember =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174001',
      organization_id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: 'user-123',
      roles: [OrganizationRole.MEMBER],
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      organization: createMockOrganization(),
      ...overrides,
    }) as OrganizationMember;

  // Mock data factory for Organization
  const createMockOrganization = (
    overrides?: Partial<Organization>,
  ): Organization =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Test Organization',
      description: 'A test organization',
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      teams: [],
      members: [],
      ...overrides,
    }) as Organization;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationMembersService,
        {
          provide: getRepositoryToken(OrganizationMember),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Organization),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: KeycloakAdminService,
          useValue: {
            getUserById: jest.fn(),
          },
        },
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn().mockResolvedValue([null, 0]) },
        },
        {
          provide: AuthorizationService,
          useValue: {
            invalidateUserCache: jest.fn().mockResolvedValue(undefined),
            invalidateOrganizationCache: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<OrganizationMembersService>(
      OrganizationMembersService,
    );
    memberRepository = module.get(getRepositoryToken(OrganizationMember));
    organizationRepository = module.get(getRepositoryToken(Organization));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByOrganization', () => {
    it('should return all members of an organization sorted by creation date', async () => {
      // Arrange
      const organizationId = '123e4567-e89b-12d3-a456-426614174000';
      const mockMembers = [
        createMockMember({ id: '1', user_id: 'user-1' }),
        createMockMember({ id: '2', user_id: 'user-2' }),
      ];
      memberRepository.find.mockResolvedValue(mockMembers);

      // Act
      const result = await service.findByOrganization(organizationId);

      // Assert
      expect(result).toEqual(mockMembers);
      expect(memberRepository.find).toHaveBeenCalledWith({
        where: { organization_id: organizationId },
        relations: ['organization'],
        order: { created_at: 'DESC' },
      });
    });

    it('should return empty array when organization has no members', async () => {
      // Arrange
      const organizationId = 'empty-org-id';
      memberRepository.find.mockResolvedValue([]);

      // Act
      const result = await service.findByOrganization(organizationId);

      // Assert
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      const organizationId = 'org-id';
      const dbError = new Error('Database connection failed');
      memberRepository.find.mockRejectedValue(dbError);

      // Act & Assert
      await expect(service.findByOrganization(organizationId)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('findByUser', () => {
    it('should return all organizations a user belongs to', async () => {
      // Arrange
      const userId = 'user-123';
      const mockMembers = [
        createMockMember({
          id: '1',
          organization_id: 'org-1',
          organization: createMockOrganization({ id: 'org-1', name: 'Org 1' }),
        }),
        createMockMember({
          id: '2',
          organization_id: 'org-2',
          organization: createMockOrganization({ id: 'org-2', name: 'Org 2' }),
        }),
      ];
      memberRepository.find.mockResolvedValue(mockMembers);

      // Act
      const result = await service.findByUser(userId);

      // Assert
      expect(result).toEqual(mockMembers);
      expect(memberRepository.find).toHaveBeenCalledWith({
        where: { user_id: userId },
        relations: ['organization'],
        order: { created_at: 'DESC' },
      });
    });

    it('should return empty array when user has no memberships', async () => {
      // Arrange
      const userId = 'user-no-orgs';
      memberRepository.find.mockResolvedValue([]);

      // Act
      const result = await service.findByUser(userId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      const userId = 'user-id';
      memberRepository.find.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.findByUser(userId)).rejects.toThrow('Database error');
    });
  });

  describe('findOne', () => {
    it('should find a membership by ID', async () => {
      // Arrange
      const mockMember = createMockMember();
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.findOne(mockMember.id);

      // Assert
      expect(result).toEqual(mockMember);
      expect(memberRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockMember.id },
        relations: ['organization'],
      });
    });

    it('should throw NotFoundException when membership not found', async () => {
      // Arrange
      const nonExistentId = 'non-existent-id';
      memberRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne(nonExistentId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(nonExistentId)).rejects.toThrow(
        `Organization membership with ID ${nonExistentId} not found`,
      );
    });

    it('should rethrow non-NotFoundException errors', async () => {
      // Arrange
      const id = 'some-id';
      memberRepository.findOne.mockRejectedValue(
        new Error('Database connection failed'),
      );

      // Act & Assert
      await expect(service.findOne(id)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should rethrow NotFoundException as-is', async () => {
      // Arrange
      const id = 'some-id';
      const notFoundError = new NotFoundException('Custom not found');
      memberRepository.findOne.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(service.findOne(id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByOrganizationAndUser', () => {
    it('should find membership by organization and user', async () => {
      // Arrange
      const organizationId = 'org-123';
      const userId = 'user-123';
      const mockMember = createMockMember({
        organization_id: organizationId,
        user_id: userId,
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.findByOrganizationAndUser(
        organizationId,
        userId,
      );

      // Assert
      expect(result).toEqual(mockMember);
      expect(memberRepository.findOne).toHaveBeenCalledWith({
        where: { organization_id: organizationId, user_id: userId },
        relations: ['organization'],
      });
    });

    it('should return null when membership not found', async () => {
      // Arrange
      memberRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findByOrganizationAndUser(
        'org-id',
        'user-id',
      );

      // Assert
      expect(result).toBeNull();
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.findByOrganizationAndUser('org-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('addMember', () => {
    const createAddMemberDto = (
      overrides?: Partial<AddOrganizationMemberDto>,
    ): AddOrganizationMemberDto => ({
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      userId: 'new-user-123',
      roles: [OrganizationRole.MEMBER],
      ...overrides,
    });

    it('should add a new member to an organization', async () => {
      // Arrange
      const dto = createAddMemberDto();
      const mockOrganization = createMockOrganization({ id: dto.organizationId });
      const savedMember = createMockMember({
        id: 'new-member-id',
        organization_id: dto.organizationId,
        user_id: dto.userId,
        roles: dto.roles,
      });

      organizationRepository.findOne.mockResolvedValue(mockOrganization);
      memberRepository.findOne.mockResolvedValueOnce(null); // findByOrganizationAndUser - no existing member
      memberRepository.create.mockReturnValue(savedMember);
      memberRepository.save.mockResolvedValue(savedMember);
      memberRepository.findOne.mockResolvedValueOnce(savedMember); // findOne after save

      // Act
      const result = await service.addMember(dto);

      // Assert
      expect(result).toEqual(savedMember);
      expect(organizationRepository.findOne).toHaveBeenCalledWith({
        where: { id: dto.organizationId },
      });
      expect(memberRepository.create).toHaveBeenCalledWith({
        organization_id: dto.organizationId,
        user_id: dto.userId,
        roles: dto.roles,
      });
      expect(memberRepository.save).toHaveBeenCalledWith(savedMember);
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      // Arrange
      const dto = createAddMemberDto({ organizationId: 'non-existent-org' });
      organizationRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.addMember(dto)).rejects.toThrow(NotFoundException);
      await expect(service.addMember(dto)).rejects.toThrow(
        `Organization with ID ${dto.organizationId} not found`,
      );
    });

    it('should throw ConflictException when membership already exists', async () => {
      // Arrange
      const dto = createAddMemberDto();
      const mockOrganization = createMockOrganization({ id: dto.organizationId });
      const existingMember = createMockMember({
        organization_id: dto.organizationId,
        user_id: dto.userId,
      });

      organizationRepository.findOne.mockResolvedValue(mockOrganization);
      memberRepository.findOne.mockResolvedValue(existingMember);

      // Act & Assert
      await expect(service.addMember(dto)).rejects.toThrow(ConflictException);
      await expect(service.addMember(dto)).rejects.toThrow(
        `User ${dto.userId} is already a member of organization ${dto.organizationId}`,
      );
    });

    it('should add member with multiple roles', async () => {
      // Arrange
      const dto = createAddMemberDto({
        roles: [OrganizationRole.ADMIN, OrganizationRole.MEMBER],
      });
      const mockOrganization = createMockOrganization({ id: dto.organizationId });
      const savedMember = createMockMember({
        id: 'new-member-id',
        organization_id: dto.organizationId,
        user_id: dto.userId,
        roles: dto.roles,
      });

      organizationRepository.findOne.mockResolvedValue(mockOrganization);
      memberRepository.findOne.mockResolvedValueOnce(null);
      memberRepository.create.mockReturnValue(savedMember);
      memberRepository.save.mockResolvedValue(savedMember);
      memberRepository.findOne.mockResolvedValueOnce(savedMember);

      // Act
      const result = await service.addMember(dto);

      // Assert
      expect(result.roles).toEqual([OrganizationRole.ADMIN, OrganizationRole.MEMBER]);
    });

    it('should add member with admin role', async () => {
      // Arrange
      const dto = createAddMemberDto({ roles: [OrganizationRole.ADMIN] });
      const mockOrganization = createMockOrganization({ id: dto.organizationId });
      const savedMember = createMockMember({
        organization_id: dto.organizationId,
        user_id: dto.userId,
        roles: dto.roles,
      });

      organizationRepository.findOne.mockResolvedValue(mockOrganization);
      memberRepository.findOne.mockResolvedValueOnce(null);
      memberRepository.create.mockReturnValue(savedMember);
      memberRepository.save.mockResolvedValue(savedMember);
      memberRepository.findOne.mockResolvedValueOnce(savedMember);

      // Act
      const result = await service.addMember(dto);

      // Assert
      expect(result.roles).toContain(OrganizationRole.ADMIN);
    });

    it('should rethrow non-conflict/not-found errors', async () => {
      // Arrange
      const dto = createAddMemberDto();
      organizationRepository.findOne.mockRejectedValue(
        new Error('Database error'),
      );

      // Act & Assert
      await expect(service.addMember(dto)).rejects.toThrow('Database error');
    });
  });

  describe('updateMemberRoles', () => {
    it('should update member roles successfully', async () => {
      // Arrange
      const memberId = 'member-123';
      const dto: UpdateOrganizationMemberRolesDto = {
        roles: [OrganizationRole.ADMIN],
      };
      const existingMember = createMockMember({
        id: memberId,
        roles: [OrganizationRole.MEMBER],
      });
      const updatedMember = createMockMember({
        id: memberId,
        roles: dto.roles,
      });

      memberRepository.findOne.mockResolvedValueOnce(existingMember);
      memberRepository.save.mockResolvedValue(updatedMember);
      memberRepository.findOne.mockResolvedValueOnce(updatedMember);

      // Act
      const result = await service.updateMemberRoles(memberId, dto);

      // Assert
      expect(result.roles).toEqual([OrganizationRole.ADMIN]);
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ roles: dto.roles }),
      );
    });

    it('should throw NotFoundException when member not found', async () => {
      // Arrange
      const dto: UpdateOrganizationMemberRolesDto = {
        roles: [OrganizationRole.ADMIN],
      };
      memberRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateMemberRoles('non-existent-id', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update to multiple roles', async () => {
      // Arrange
      const memberId = 'member-123';
      const dto: UpdateOrganizationMemberRolesDto = {
        roles: [OrganizationRole.ADMIN, OrganizationRole.MEMBER],
      };
      const existingMember = createMockMember({ id: memberId });
      const updatedMember = createMockMember({
        id: memberId,
        roles: dto.roles,
      });

      memberRepository.findOne.mockResolvedValueOnce(existingMember);
      memberRepository.save.mockResolvedValue(updatedMember);
      memberRepository.findOne.mockResolvedValueOnce(updatedMember);

      // Act
      const result = await service.updateMemberRoles(memberId, dto);

      // Assert
      expect(result.roles).toEqual([OrganizationRole.ADMIN, OrganizationRole.MEMBER]);
    });

    it('should update to empty roles array', async () => {
      // Arrange
      const memberId = 'member-123';
      const dto: UpdateOrganizationMemberRolesDto = { roles: [] };
      const existingMember = createMockMember({ id: memberId });
      const updatedMember = createMockMember({ id: memberId, roles: [] });

      memberRepository.findOne.mockResolvedValueOnce(existingMember);
      memberRepository.save.mockResolvedValue(updatedMember);
      memberRepository.findOne.mockResolvedValueOnce(updatedMember);

      // Act
      const result = await service.updateMemberRoles(memberId, dto);

      // Assert
      expect(result.roles).toEqual([]);
    });

    it('should rethrow non-NotFoundException errors', async () => {
      // Arrange
      const dto: UpdateOrganizationMemberRolesDto = { roles: [] };
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.updateMemberRoles('member-id', dto),
      ).rejects.toThrow('Database error');
    });
  });

  describe('removeMember', () => {
    it('should remove a member successfully', async () => {
      // Arrange
      const memberId = 'member-123';
      const mockMember = createMockMember({ id: memberId });
      memberRepository.findOne.mockResolvedValue(mockMember);
      memberRepository.remove.mockResolvedValue(mockMember);

      // Act
      await service.removeMember(memberId);

      // Assert
      expect(memberRepository.remove).toHaveBeenCalledWith(mockMember);
    });

    it('should throw NotFoundException when member not found', async () => {
      // Arrange
      const memberId = 'non-existent-id';
      memberRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.removeMember(memberId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should rethrow non-NotFoundException errors', async () => {
      // Arrange
      const memberId = 'member-id';
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.removeMember(memberId)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('removeMemberByOrganizationAndUser', () => {
    it('should remove a member by organization and user', async () => {
      // Arrange
      const organizationId = 'org-123';
      const userId = 'user-123';
      const mockMember = createMockMember({
        organization_id: organizationId,
        user_id: userId,
      });
      memberRepository.findOne.mockResolvedValue(mockMember);
      memberRepository.remove.mockResolvedValue(mockMember);

      // Act
      await service.removeMemberByOrganizationAndUser(organizationId, userId);

      // Assert
      expect(memberRepository.remove).toHaveBeenCalledWith(mockMember);
    });

    it('should throw NotFoundException when membership not found', async () => {
      // Arrange
      const organizationId = 'org-123';
      const userId = 'user-123';
      memberRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.removeMemberByOrganizationAndUser(organizationId, userId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeMemberByOrganizationAndUser(organizationId, userId),
      ).rejects.toThrow(
        `User ${userId} is not a member of organization ${organizationId}`,
      );
    });

    it('should rethrow non-NotFoundException errors', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.removeMemberByOrganizationAndUser('org-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('isMember', () => {
    it('should return true when user is a member', async () => {
      // Arrange
      const organizationId = 'org-123';
      const userId = 'user-123';
      memberRepository.count.mockResolvedValue(1);

      // Act
      const result = await service.isMember(organizationId, userId);

      // Assert
      expect(result).toBe(true);
      expect(memberRepository.count).toHaveBeenCalledWith({
        where: { organization_id: organizationId, user_id: userId },
      });
    });

    it('should return false when user is not a member', async () => {
      // Arrange
      const organizationId = 'org-123';
      const userId = 'user-not-member';
      memberRepository.count.mockResolvedValue(0);

      // Act
      const result = await service.isMember(organizationId, userId);

      // Assert
      expect(result).toBe(false);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.count.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.isMember('org-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('hasRole', () => {
    it('should return true when user has the specified role', async () => {
      // Arrange
      const organizationId = 'org-123';
      const userId = 'user-123';
      const mockMember = createMockMember({
        organization_id: organizationId,
        user_id: userId,
        roles: [OrganizationRole.ADMIN, OrganizationRole.MEMBER],
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.hasRole(
        organizationId,
        userId,
        OrganizationRole.ADMIN,
      );

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when user does not have the specified role', async () => {
      // Arrange
      const organizationId = 'org-123';
      const userId = 'user-123';
      const mockMember = createMockMember({
        organization_id: organizationId,
        user_id: userId,
        roles: [OrganizationRole.MEMBER],
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.hasRole(
        organizationId,
        userId,
        OrganizationRole.ADMIN,
      );

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user is not a member', async () => {
      // Arrange
      memberRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.hasRole('org-id', 'user-id', OrganizationRole.MEMBER);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle string roles', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: ['custom-role'] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.hasRole('org-id', 'user-id', 'custom-role');

      // Assert
      expect(result).toBe(true);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.hasRole('org-id', 'user-id', OrganizationRole.MEMBER),
      ).rejects.toThrow('Database error');
    });
  });

  describe('isOrgAdmin', () => {
    it('should return true when user is admin', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [OrganizationRole.ADMIN] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.isOrgAdmin('org-id', 'user-id');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when user is only member', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [OrganizationRole.MEMBER] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.isOrgAdmin('org-id', 'user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user is only viewer', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [OrganizationRole.VIEWER] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.isOrgAdmin('org-id', 'user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user is not a member', async () => {
      // Arrange
      memberRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.isOrgAdmin('org-id', 'user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user has empty roles', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.isOrgAdmin('org-id', 'user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.isOrgAdmin('org-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getUserRoles', () => {
    it('should return user roles when user is a member', async () => {
      // Arrange
      const mockMember = createMockMember({
        roles: [OrganizationRole.ADMIN, OrganizationRole.MEMBER],
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.getUserRoles('org-id', 'user-id');

      // Assert
      expect(result).toEqual([OrganizationRole.ADMIN, OrganizationRole.MEMBER]);
    });

    it('should return empty array when user is not a member', async () => {
      // Arrange
      memberRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.getUserRoles('org-id', 'user-id');

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when member has no roles', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.getUserRoles('org-id', 'user-id');

      // Assert
      expect(result).toEqual([]);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.getUserRoles('org-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('countMembers', () => {
    it('should return the number of members in an organization', async () => {
      // Arrange
      const organizationId = 'org-123';
      memberRepository.count.mockResolvedValue(5);

      // Act
      const result = await service.countMembers(organizationId);

      // Assert
      expect(result).toBe(5);
      expect(memberRepository.count).toHaveBeenCalledWith({
        where: { organization_id: organizationId },
      });
    });

    it('should return 0 when organization has no members', async () => {
      // Arrange
      memberRepository.count.mockResolvedValue(0);

      // Act
      const result = await service.countMembers('empty-org');

      // Assert
      expect(result).toBe(0);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.count.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.countMembers('org-id')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle API key user IDs (format: api-key:{id})', async () => {
      // Arrange
      const apiKeyUserId = 'api-key:abc123';
      const mockMember = createMockMember({ user_id: apiKeyUserId });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.findByOrganizationAndUser(
        'org-id',
        apiKeyUserId,
      );

      // Assert
      expect(result).toEqual(mockMember);
      expect(result?.user_id).toBe(apiKeyUserId);
    });

    it('should handle UUID user IDs', async () => {
      // Arrange
      const uuidUserId = '550e8400-e29b-41d4-a716-446655440000';
      const mockMember = createMockMember({ user_id: uuidUserId });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.findByOrganizationAndUser(
        'org-id',
        uuidUserId,
      );

      // Assert
      expect(result).toEqual(mockMember);
    });

    it('should handle concurrent membership checks', async () => {
      // Arrange
      memberRepository.count.mockResolvedValue(1);

      // Act
      const results = await Promise.all([
        service.isMember('org-1', 'user-1'),
        service.isMember('org-2', 'user-2'),
        service.isMember('org-3', 'user-3'),
      ]);

      // Assert
      expect(results).toEqual([true, true, true]);
      expect(memberRepository.count).toHaveBeenCalledTimes(3);
    });

    it('should handle special characters in organization/user IDs', async () => {
      // Arrange
      const specialOrgId = 'org-with-special-chars_123';
      const specialUserId = 'user+test@example.com';
      memberRepository.count.mockResolvedValue(1);

      // Act
      const result = await service.isMember(specialOrgId, specialUserId);

      // Assert
      expect(result).toBe(true);
      expect(memberRepository.count).toHaveBeenCalledWith({
        where: { organization_id: specialOrgId, user_id: specialUserId },
      });
    });
  });

  describe('Role Combinations', () => {
    it('should correctly identify admin with additional roles', async () => {
      // Arrange
      const mockMember = createMockMember({
        roles: [OrganizationRole.ADMIN, OrganizationRole.MEMBER],
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const isAdmin = await service.isOrgAdmin('org-id', 'user-id');
      const hasAdminRole = await service.hasRole('org-id', 'user-id', OrganizationRole.ADMIN);
      const hasMember = await service.hasRole('org-id', 'user-id', OrganizationRole.MEMBER);

      // Assert
      expect(isAdmin).toBe(true);
      expect(hasAdminRole).toBe(true);
      expect(hasMember).toBe(true);
    });

    it('should correctly handle viewer-only access', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [OrganizationRole.VIEWER] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const isAdmin = await service.isOrgAdmin('org-id', 'user-id');
      const hasViewer = await service.hasRole('org-id', 'user-id', OrganizationRole.VIEWER);
      const hasAdminRole = await service.hasRole('org-id', 'user-id', OrganizationRole.ADMIN);

      // Assert
      expect(isAdmin).toBe(false);
      expect(hasViewer).toBe(true);
      expect(hasAdminRole).toBe(false);
    });

    it('should handle all organization roles', async () => {
      // Arrange
      const allRoles = [
        OrganizationRole.ADMIN,
        OrganizationRole.MEMBER,
        OrganizationRole.VIEWER,
      ];
      const mockMember = createMockMember({ roles: allRoles });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const roles = await service.getUserRoles('org-id', 'user-id');

      // Assert
      expect(roles).toEqual(allRoles);
      expect(roles).toContain(OrganizationRole.ADMIN);
      expect(roles).toContain(OrganizationRole.MEMBER);
      expect(roles).toContain(OrganizationRole.VIEWER);
    });
  });

  describe('Error Logging', () => {
    it('should log errors and rethrow for findByOrganization', async () => {
      // Arrange
      const error = new Error('Database connection lost');
      memberRepository.find.mockRejectedValue(error);

      // Act & Assert
      await expect(service.findByOrganization('org-id')).rejects.toThrow(error);
    });

    it('should log errors and rethrow for findByUser', async () => {
      // Arrange
      const error = new Error('Query timeout');
      memberRepository.find.mockRejectedValue(error);

      // Act & Assert
      await expect(service.findByUser('user-id')).rejects.toThrow(error);
    });

    it('should log errors and rethrow for countMembers', async () => {
      // Arrange
      const error = new Error('Connection pool exhausted');
      memberRepository.count.mockRejectedValue(error);

      // Act & Assert
      await expect(service.countMembers('org-id')).rejects.toThrow(error);
    });
  });
});
