/**
 * TeamMembersService Test Suite
 *
 * Comprehensive tests for team membership management service including:
 * - CRUD operations for team members
 * - Role checking and management
 * - Authorization helpers (isMember, hasRole, isTeamAdmin)
 * - Edge cases and error handling
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import {
  TeamMembersService,
  AddTeamMemberDto,
  UpdateTeamMemberRolesDto,
} from '../team-members.service';
import { Team, TeamMember } from '@perfana/shared';
import { TeamRole } from '../../../constants/roles.constants';
import { KeycloakAdminService } from '../../auth/keycloak-admin.service';

describe('TeamMembersService', () => {
  let service: TeamMembersService;
  let memberRepository: jest.Mocked<Repository<TeamMember>>;
  let teamRepository: jest.Mocked<Repository<Team>>;

  // Mock data factory for Team
  const createMockTeam = (overrides?: Partial<Team>): Team =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174000',
      organization_id: '123e4567-e89b-12d3-a456-426614174999',
      name: 'Test Team',
      description: 'A test team',
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      members: [],
      ...overrides,
    }) as Team;

  // Mock data factory for TeamMember
  const createMockMember = (overrides?: Partial<TeamMember>): TeamMember =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174001',
      team_id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: 'user-123',
      roles: [TeamRole.MEMBER],
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      team: createMockTeam(),
      ...overrides,
    }) as TeamMember;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamMembersService,
        {
          provide: getRepositoryToken(TeamMember),
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
          provide: getRepositoryToken(Team),
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
      ],
    }).compile();

    service = module.get<TeamMembersService>(TeamMembersService);
    memberRepository = module.get(getRepositoryToken(TeamMember));
    teamRepository = module.get(getRepositoryToken(Team));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByTeam', () => {
    it('should return all members of a team sorted by creation date', async () => {
      // Arrange
      const teamId = '123e4567-e89b-12d3-a456-426614174000';
      const mockMembers = [
        createMockMember({ id: '1', user_id: 'user-1' }),
        createMockMember({ id: '2', user_id: 'user-2' }),
      ];
      memberRepository.find.mockResolvedValue(mockMembers);

      // Act
      const result = await service.findByTeam(teamId);

      // Assert
      expect(result).toEqual(mockMembers);
      expect(memberRepository.find).toHaveBeenCalledWith({
        where: { team_id: teamId },
        relations: ['team'],
        order: { created_at: 'DESC' },
      });
    });

    it('should return empty array when team has no members', async () => {
      // Arrange
      const teamId = 'empty-team-id';
      memberRepository.find.mockResolvedValue([]);

      // Act
      const result = await service.findByTeam(teamId);

      // Assert
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      const teamId = 'team-id';
      const dbError = new Error('Database connection failed');
      memberRepository.find.mockRejectedValue(dbError);

      // Act & Assert
      await expect(service.findByTeam(teamId)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('findByUser', () => {
    it('should return all teams a user belongs to', async () => {
      // Arrange
      const userId = 'user-123';
      const mockMembers = [
        createMockMember({
          id: '1',
          team_id: 'team-1',
          team: createMockTeam({ id: 'team-1', name: 'Team 1' }),
        }),
        createMockMember({
          id: '2',
          team_id: 'team-2',
          team: createMockTeam({ id: 'team-2', name: 'Team 2' }),
        }),
      ];
      memberRepository.find.mockResolvedValue(mockMembers);

      // Act
      const result = await service.findByUser(userId);

      // Assert
      expect(result).toEqual(mockMembers);
      expect(memberRepository.find).toHaveBeenCalledWith({
        where: { user_id: userId },
        relations: ['team'],
        order: { created_at: 'DESC' },
      });
    });

    it('should return empty array when user has no memberships', async () => {
      // Arrange
      const userId = 'user-no-teams';
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
        relations: ['team'],
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
        `Team membership with ID ${nonExistentId} not found`,
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

  describe('findByTeamAndUser', () => {
    it('should find membership by team and user', async () => {
      // Arrange
      const teamId = 'team-123';
      const userId = 'user-123';
      const mockMember = createMockMember({
        team_id: teamId,
        user_id: userId,
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.findByTeamAndUser(teamId, userId);

      // Assert
      expect(result).toEqual(mockMember);
      expect(memberRepository.findOne).toHaveBeenCalledWith({
        where: { team_id: teamId, user_id: userId },
        relations: ['team'],
      });
    });

    it('should return null when membership not found', async () => {
      // Arrange
      memberRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findByTeamAndUser('team-id', 'user-id');

      // Assert
      expect(result).toBeNull();
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.findByTeamAndUser('team-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('addMember', () => {
    const createAddMemberDto = (
      overrides?: Partial<AddTeamMemberDto>,
    ): AddTeamMemberDto => ({
      teamId: '123e4567-e89b-12d3-a456-426614174000',
      userId: 'new-user-123',
      roles: [TeamRole.MEMBER],
      ...overrides,
    });

    it('should add a new member to a team', async () => {
      // Arrange
      const dto = createAddMemberDto();
      const mockTeam = createMockTeam({ id: dto.teamId });
      const savedMember = createMockMember({
        id: 'new-member-id',
        team_id: dto.teamId,
        user_id: dto.userId,
        roles: dto.roles,
      });

      teamRepository.findOne.mockResolvedValue(mockTeam);
      memberRepository.findOne.mockResolvedValueOnce(null); // findByTeamAndUser - no existing member
      memberRepository.create.mockReturnValue(savedMember);
      memberRepository.save.mockResolvedValue(savedMember);
      memberRepository.findOne.mockResolvedValueOnce(savedMember); // findOne after save

      // Act
      const result = await service.addMember(dto);

      // Assert
      expect(result).toEqual(savedMember);
      expect(teamRepository.findOne).toHaveBeenCalledWith({
        where: { id: dto.teamId },
      });
      expect(memberRepository.create).toHaveBeenCalledWith({
        team_id: dto.teamId,
        user_id: dto.userId,
        roles: dto.roles,
      });
      expect(memberRepository.save).toHaveBeenCalledWith(savedMember);
    });

    it('should throw NotFoundException when team does not exist', async () => {
      // Arrange
      const dto = createAddMemberDto({ teamId: 'non-existent-team' });
      teamRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.addMember(dto)).rejects.toThrow(NotFoundException);
      await expect(service.addMember(dto)).rejects.toThrow(
        `Team with ID ${dto.teamId} not found`,
      );
    });

    it('should throw ConflictException when membership already exists', async () => {
      // Arrange
      const dto = createAddMemberDto();
      const mockTeam = createMockTeam({ id: dto.teamId });
      const existingMember = createMockMember({
        team_id: dto.teamId,
        user_id: dto.userId,
      });

      teamRepository.findOne.mockResolvedValue(mockTeam);
      memberRepository.findOne.mockResolvedValue(existingMember);

      // Act & Assert
      await expect(service.addMember(dto)).rejects.toThrow(ConflictException);
      await expect(service.addMember(dto)).rejects.toThrow(
        `User ${dto.userId} is already a member of team ${dto.teamId}`,
      );
    });

    it('should add member with multiple roles', async () => {
      // Arrange
      const dto = createAddMemberDto({
        roles: [TeamRole.ADMIN, TeamRole.MEMBER],
      });
      const mockTeam = createMockTeam({ id: dto.teamId });
      const savedMember = createMockMember({
        id: 'new-member-id',
        team_id: dto.teamId,
        user_id: dto.userId,
        roles: dto.roles,
      });

      teamRepository.findOne.mockResolvedValue(mockTeam);
      memberRepository.findOne.mockResolvedValueOnce(null);
      memberRepository.create.mockReturnValue(savedMember);
      memberRepository.save.mockResolvedValue(savedMember);
      memberRepository.findOne.mockResolvedValueOnce(savedMember);

      // Act
      const result = await service.addMember(dto);

      // Assert
      expect(result.roles).toEqual([TeamRole.ADMIN, TeamRole.MEMBER]);
    });

    it('should add member with admin role', async () => {
      // Arrange
      const dto = createAddMemberDto({ roles: [TeamRole.ADMIN] });
      const mockTeam = createMockTeam({ id: dto.teamId });
      const savedMember = createMockMember({
        team_id: dto.teamId,
        user_id: dto.userId,
        roles: dto.roles,
      });

      teamRepository.findOne.mockResolvedValue(mockTeam);
      memberRepository.findOne.mockResolvedValueOnce(null);
      memberRepository.create.mockReturnValue(savedMember);
      memberRepository.save.mockResolvedValue(savedMember);
      memberRepository.findOne.mockResolvedValueOnce(savedMember);

      // Act
      const result = await service.addMember(dto);

      // Assert
      expect(result.roles).toContain(TeamRole.ADMIN);
    });

    it('should rethrow non-conflict/not-found errors', async () => {
      // Arrange
      const dto = createAddMemberDto();
      teamRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.addMember(dto)).rejects.toThrow('Database error');
    });
  });

  describe('updateMemberRoles', () => {
    it('should update member roles successfully', async () => {
      // Arrange
      const memberId = 'member-123';
      const dto: UpdateTeamMemberRolesDto = {
        roles: [TeamRole.ADMIN],
      };
      const existingMember = createMockMember({
        id: memberId,
        roles: [TeamRole.MEMBER],
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
      expect(result.roles).toEqual([TeamRole.ADMIN]);
      expect(memberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ roles: dto.roles }),
      );
    });

    it('should throw NotFoundException when member not found', async () => {
      // Arrange
      const dto: UpdateTeamMemberRolesDto = {
        roles: [TeamRole.ADMIN],
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
      const dto: UpdateTeamMemberRolesDto = {
        roles: [TeamRole.ADMIN, TeamRole.MEMBER],
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
      expect(result.roles).toEqual([TeamRole.ADMIN, TeamRole.MEMBER]);
    });

    it('should update to empty roles array', async () => {
      // Arrange
      const memberId = 'member-123';
      const dto: UpdateTeamMemberRolesDto = { roles: [] };
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
      const dto: UpdateTeamMemberRolesDto = { roles: [] };
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

  describe('removeMemberByTeamAndUser', () => {
    it('should remove a member by team and user', async () => {
      // Arrange
      const teamId = 'team-123';
      const userId = 'user-123';
      const mockMember = createMockMember({
        team_id: teamId,
        user_id: userId,
      });
      memberRepository.findOne.mockResolvedValue(mockMember);
      memberRepository.remove.mockResolvedValue(mockMember);

      // Act
      await service.removeMemberByTeamAndUser(teamId, userId);

      // Assert
      expect(memberRepository.remove).toHaveBeenCalledWith(mockMember);
    });

    it('should throw NotFoundException when membership not found', async () => {
      // Arrange
      const teamId = 'team-123';
      const userId = 'user-123';
      memberRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.removeMemberByTeamAndUser(teamId, userId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeMemberByTeamAndUser(teamId, userId),
      ).rejects.toThrow(`User ${userId} is not a member of team ${teamId}`);
    });

    it('should rethrow non-NotFoundException errors', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.removeMemberByTeamAndUser('team-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('isMember', () => {
    it('should return true when user is a member', async () => {
      // Arrange
      const teamId = 'team-123';
      const userId = 'user-123';
      memberRepository.count.mockResolvedValue(1);

      // Act
      const result = await service.isMember(teamId, userId);

      // Assert
      expect(result).toBe(true);
      expect(memberRepository.count).toHaveBeenCalledWith({
        where: { team_id: teamId, user_id: userId },
      });
    });

    it('should return false when user is not a member', async () => {
      // Arrange
      const teamId = 'team-123';
      const userId = 'user-not-member';
      memberRepository.count.mockResolvedValue(0);

      // Act
      const result = await service.isMember(teamId, userId);

      // Assert
      expect(result).toBe(false);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.count.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.isMember('team-id', 'user-id')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('hasRole', () => {
    it('should return true when user has the specified role', async () => {
      // Arrange
      const teamId = 'team-123';
      const userId = 'user-123';
      const mockMember = createMockMember({
        team_id: teamId,
        user_id: userId,
        roles: [TeamRole.ADMIN, TeamRole.MEMBER],
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.hasRole(teamId, userId, TeamRole.ADMIN);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when user does not have the specified role', async () => {
      // Arrange
      const teamId = 'team-123';
      const userId = 'user-123';
      const mockMember = createMockMember({
        team_id: teamId,
        user_id: userId,
        roles: [TeamRole.MEMBER],
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.hasRole(teamId, userId, TeamRole.ADMIN);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user is not a member', async () => {
      // Arrange
      memberRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.hasRole('team-id', 'user-id', TeamRole.MEMBER);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle string roles', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: ['custom-role'] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.hasRole('team-id', 'user-id', 'custom-role');

      // Assert
      expect(result).toBe(true);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.hasRole('team-id', 'user-id', TeamRole.MEMBER),
      ).rejects.toThrow('Database error');
    });
  });

  describe('isTeamAdmin', () => {
    it('should return true when user is admin', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [TeamRole.ADMIN] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.isTeamAdmin('team-id', 'user-id');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when user is only member', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [TeamRole.MEMBER] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.isTeamAdmin('team-id', 'user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user is only viewer', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [TeamRole.VIEWER] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.isTeamAdmin('team-id', 'user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user is not a member', async () => {
      // Arrange
      memberRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.isTeamAdmin('team-id', 'user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when user has empty roles', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.isTeamAdmin('team-id', 'user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.isTeamAdmin('team-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getUserRoles', () => {
    it('should return user roles when user is a member', async () => {
      // Arrange
      const mockMember = createMockMember({
        roles: [TeamRole.ADMIN, TeamRole.MEMBER],
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.getUserRoles('team-id', 'user-id');

      // Assert
      expect(result).toEqual([TeamRole.ADMIN, TeamRole.MEMBER]);
    });

    it('should return empty array when user is not a member', async () => {
      // Arrange
      memberRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.getUserRoles('team-id', 'user-id');

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when member has no roles', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const result = await service.getUserRoles('team-id', 'user-id');

      // Assert
      expect(result).toEqual([]);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.getUserRoles('team-id', 'user-id'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('countMembers', () => {
    it('should return the number of members in a team', async () => {
      // Arrange
      const teamId = 'team-123';
      memberRepository.count.mockResolvedValue(5);

      // Act
      const result = await service.countMembers(teamId);

      // Assert
      expect(result).toBe(5);
      expect(memberRepository.count).toHaveBeenCalledWith({
        where: { team_id: teamId },
      });
    });

    it('should return 0 when team has no members', async () => {
      // Arrange
      memberRepository.count.mockResolvedValue(0);

      // Act
      const result = await service.countMembers('empty-team');

      // Assert
      expect(result).toBe(0);
    });

    it('should rethrow errors from repository', async () => {
      // Arrange
      memberRepository.count.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.countMembers('team-id')).rejects.toThrow(
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
      const result = await service.findByTeamAndUser('team-id', apiKeyUserId);

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
      const result = await service.findByTeamAndUser('team-id', uuidUserId);

      // Assert
      expect(result).toEqual(mockMember);
    });

    it('should handle concurrent membership checks', async () => {
      // Arrange
      memberRepository.count.mockResolvedValue(1);

      // Act
      const results = await Promise.all([
        service.isMember('team-1', 'user-1'),
        service.isMember('team-2', 'user-2'),
        service.isMember('team-3', 'user-3'),
      ]);

      // Assert
      expect(results).toEqual([true, true, true]);
      expect(memberRepository.count).toHaveBeenCalledTimes(3);
    });

    it('should handle special characters in team/user IDs', async () => {
      // Arrange
      const specialTeamId = 'team-with-special-chars_123';
      const specialUserId = 'user+test@example.com';
      memberRepository.count.mockResolvedValue(1);

      // Act
      const result = await service.isMember(specialTeamId, specialUserId);

      // Assert
      expect(result).toBe(true);
      expect(memberRepository.count).toHaveBeenCalledWith({
        where: { team_id: specialTeamId, user_id: specialUserId },
      });
    });
  });

  describe('Role Combinations', () => {
    it('should correctly identify admin with additional roles', async () => {
      // Arrange
      const mockMember = createMockMember({
        roles: [TeamRole.ADMIN, TeamRole.MEMBER],
      });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const isAdmin = await service.isTeamAdmin('team-id', 'user-id');
      const hasAdminRole = await service.hasRole('team-id', 'user-id', TeamRole.ADMIN);
      const hasMember = await service.hasRole('team-id', 'user-id', TeamRole.MEMBER);

      // Assert
      expect(isAdmin).toBe(true);
      expect(hasAdminRole).toBe(true);
      expect(hasMember).toBe(true);
    });

    it('should correctly handle viewer-only access', async () => {
      // Arrange
      const mockMember = createMockMember({ roles: [TeamRole.VIEWER] });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const isAdmin = await service.isTeamAdmin('team-id', 'user-id');
      const hasViewer = await service.hasRole('team-id', 'user-id', TeamRole.VIEWER);
      const hasAdminRole = await service.hasRole('team-id', 'user-id', TeamRole.ADMIN);

      // Assert
      expect(isAdmin).toBe(false);
      expect(hasViewer).toBe(true);
      expect(hasAdminRole).toBe(false);
    });

    it('should handle all team roles', async () => {
      // Arrange
      const allRoles = [
        TeamRole.ADMIN,
        TeamRole.MEMBER,
        TeamRole.VIEWER,
      ];
      const mockMember = createMockMember({ roles: allRoles });
      memberRepository.findOne.mockResolvedValue(mockMember);

      // Act
      const roles = await service.getUserRoles('team-id', 'user-id');

      // Assert
      expect(roles).toEqual(allRoles);
      expect(roles).toContain(TeamRole.ADMIN);
      expect(roles).toContain(TeamRole.MEMBER);
      expect(roles).toContain(TeamRole.VIEWER);
    });
  });

  describe('Error Logging', () => {
    it('should log errors and rethrow for findByTeam', async () => {
      // Arrange
      const error = new Error('Database connection lost');
      memberRepository.find.mockRejectedValue(error);

      // Act & Assert
      await expect(service.findByTeam('team-id')).rejects.toThrow(error);
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
      await expect(service.countMembers('team-id')).rejects.toThrow(error);
    });
  });
});
