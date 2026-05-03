/**
 * TeamsService — audit-logging assertions (Phase 5a, PR7).
 *
 * Focused spec covering the new `auditService.log{Create,Update,Delete}` calls
 * wired into create / update / remove. Team rows carry `organization_id`
 * natively, so the audit dispatch resolves the org without any
 * `organizationIdOverride` at the call site.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Team } from '@perfana/shared';
import { TeamsService } from '../teams.service';
import { TeamMembersService } from '../team-members.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';

describe('TeamsService — audit logging (Phase 5a)', () => {
  let service: TeamsService;
  let teamRepository: jest.Mocked<Repository<Team>>;
  let auditService: jest.Mocked<AuditService>;

  const mockTeam = (overrides?: Partial<Team>): Team =>
    ({
      id: 'team-1',
      organization_id: 'org-1',
      name: 'Team Alpha',
      description: 'desc',
      restrict_to_team_members: false,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
      ...overrides,
    }) as Team;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        {
          provide: getRepositoryToken(Team),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            isOrganizationMember: jest.fn().mockResolvedValue(true),
            isOrganizationAdmin: jest.fn().mockResolvedValue(true),
            isTeamMember: jest.fn().mockResolvedValue(true),
            isTeamAdmin: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: TeamMembersService,
          useValue: { addMember: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(TeamsService);
    teamRepository = module.get(getRepositoryToken(Team));
    auditService = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('logs CREATE after persist (no organizationIdOverride — Team has org_id natively)', async () => {
      const saved = mockTeam({ id: 'new-team', name: 'New' });
      teamRepository.create.mockReturnValue(saved);
      teamRepository.save.mockResolvedValue(saved);
      teamRepository.findOne.mockResolvedValue(saved);

      await service.create(
        { name: 'New', organization_id: 'org-1' },
        'user-1',
        true,
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(saved);
    });

    it('does NOT log CREATE if persist throws', async () => {
      teamRepository.create.mockReturnValue(mockTeam());
      teamRepository.save.mockRejectedValue(new Error('boom'));

      await expect(
        service.create({ name: 'New', organization_id: 'org-1' }, 'user-1', true),
      ).rejects.toThrow('boom');
      expect(auditService.logCreate).not.toHaveBeenCalled();
    });

    it('does NOT log CREATE when caller is not authorized', async () => {
      const authz = (service as unknown as { authzService: AuthorizationService }).authzService;
      (authz.isOrganizationAdmin as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.create({ name: 'X', organization_id: 'org-1' }, 'unauth', false),
      ).rejects.toThrow(ForbiddenException);

      expect(auditService.logCreate).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('logs UPDATE with before/after snapshots', async () => {
      const before = mockTeam({ name: 'Old', description: 'old desc' });
      const after = mockTeam({ name: 'New', description: 'new desc' });
      teamRepository.findOne
        .mockResolvedValueOnce(before) // initial existence check
        .mockResolvedValueOnce(after); // findOne after save
      teamRepository.save.mockResolvedValue(after);

      await service.update(
        before.id,
        { name: 'New', description: 'new desc' },
        'user-1',
        true,
      );

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg.name).toBe('Old');
      expect(beforeArg.description).toBe('old desc');
      expect(afterArg.name).toBe('New');
      expect(afterArg.description).toBe('new desc');
    });

    it('does NOT log UPDATE when team is not found', async () => {
      teamRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing', { name: 'X' }, 'user-1', true),
      ).rejects.toThrow(NotFoundException);

      expect(auditService.logUpdate).not.toHaveBeenCalled();
    });

    it('does NOT log UPDATE when caller is not authorized', async () => {
      teamRepository.findOne.mockResolvedValue(mockTeam());
      const authz = (service as unknown as { authzService: AuthorizationService }).authzService;
      (authz.isOrganizationAdmin as jest.Mock).mockResolvedValueOnce(false);
      (authz.isTeamAdmin as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.update('team-1', { name: 'X' }, 'unauth-user', false),
      ).rejects.toThrow(ForbiddenException);

      expect(auditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('logs DELETE before repo.remove', async () => {
      const team = mockTeam({ id: 'team-del' });
      teamRepository.findOne.mockResolvedValue(team);
      teamRepository.remove.mockResolvedValue(team);

      await service.remove(team.id, 'user-1', true);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(team);

      // logDelete must be invoked before repo.remove.
      const logDeleteOrder = (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0];
      const removeOrder = (teamRepository.remove as jest.Mock).mock.invocationCallOrder[0];
      expect(logDeleteOrder).toBeLessThan(removeOrder);
    });

    it('does NOT log DELETE when team is not found', async () => {
      teamRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('missing', 'user-1', true)).rejects.toThrow(
        NotFoundException,
      );
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it('does NOT log DELETE when caller is not authorized', async () => {
      teamRepository.findOne.mockResolvedValue(mockTeam());
      const authz = (service as unknown as { authzService: AuthorizationService }).authzService;
      (authz.isOrganizationAdmin as jest.Mock).mockResolvedValueOnce(false);
      (authz.isTeamAdmin as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.remove('team-1', 'unauth', false)).rejects.toThrow(
        ForbiddenException,
      );
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });
  });
});
