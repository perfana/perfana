/**
 * OrganizationsService — audit-logging assertions (Phase 5a, PR6).
 *
 * Focused spec covering the new `auditService.log{Create,Update,Delete}` calls
 * wired into create / update / remove. The Organization entity is itself the
 * root of the access-control hierarchy and has no `organization_id` column,
 * so every audit envelope is set via `organizationIdOverride: <org.id>`.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Organization } from '@perfana/shared';
import { OrganizationsService } from '../organizations.service';
import { OrganizationMembersService } from '../organization-members.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';

describe('OrganizationsService — audit logging (Phase 5a)', () => {
  let service: OrganizationsService;
  let organizationRepository: jest.Mocked<Repository<Organization>>;
  let auditService: jest.Mocked<AuditService>;
  let dataSource: jest.Mocked<Pick<DataSource, 'transaction'>>;

  const mockOrg = (overrides?: Partial<Organization>): Organization =>
    ({
      id: 'org-1',
      name: 'Acme',
      description: 'desc',
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
      teams: [],
      ...overrides,
    }) as Organization;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: getRepositoryToken(Organization),
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
          },
        },
        {
          provide: OrganizationMembersService,
          useValue: { addMember: jest.fn() },
        },
        {
          provide: getDataSourceToken(),
          useValue: {
            transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) =>
              fn({
                query: jest.fn().mockResolvedValue([]),
                getRepository: jest.fn(() => ({
                  remove: jest.fn().mockResolvedValue(undefined),
                })),
              }),
            ),
          },
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

    service = module.get(OrganizationsService);
    organizationRepository = module.get(getRepositoryToken(Organization));
    auditService = module.get(AuditService);
    dataSource = module.get(getDataSourceToken());
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('logs CREATE with the org id as organizationIdOverride', async () => {
      const saved = mockOrg({ id: 'new-org', name: 'New' });
      organizationRepository.create.mockReturnValue(saved);
      organizationRepository.save.mockResolvedValue(saved);
      organizationRepository.findOne.mockResolvedValue(saved);

      await service.create({ name: 'New' }, 'user-1', true);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(saved, {
        organizationIdOverride: saved.id,
      });
    });

    it('does NOT log CREATE if persist throws', async () => {
      organizationRepository.create.mockReturnValue(mockOrg());
      organizationRepository.save.mockRejectedValue(new Error('boom'));

      await expect(service.create({ name: 'New' }, 'user-1', true)).rejects.toThrow('boom');
      expect(auditService.logCreate).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('logs UPDATE with before/after snapshots and organizationIdOverride', async () => {
      const before = mockOrg({ name: 'Old', description: 'old desc' });
      const after = mockOrg({ name: 'New', description: 'new desc' });
      organizationRepository.findOne
        .mockResolvedValueOnce(before) // initial existence check
        .mockResolvedValueOnce(after); // findOne after save
      organizationRepository.save.mockResolvedValue(after);

      await service.update(
        before.id,
        { name: 'New', description: 'new desc' },
        'user-1',
        true,
      );

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg.name).toBe('Old');
      expect(beforeArg.description).toBe('old desc');
      expect(afterArg.name).toBe('New');
      expect(afterArg.description).toBe('new desc');
      expect(opts).toEqual({ organizationIdOverride: before.id });
    });

    it('does NOT log UPDATE when caller is not authorized', async () => {
      organizationRepository.findOne.mockResolvedValue(mockOrg());
      const authz = (service as unknown as { authzService: AuthorizationService }).authzService;
      (authz.isOrganizationAdmin as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.update('org-1', { name: 'X' }, 'unauth-user', false),
      ).rejects.toThrow(ForbiddenException);

      expect(auditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('logs DELETE before the cascade transaction runs', async () => {
      const org = mockOrg({ id: 'org-del' });
      organizationRepository.findOne.mockResolvedValue(org);

      await service.remove(org.id, 'user-1', true);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(org, {
        organizationIdOverride: org.id,
      });

      // logDelete must be invoked before dataSource.transaction.
      const logDeleteOrder = (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0];
      const txOrder = (dataSource.transaction as jest.Mock).mock.invocationCallOrder[0];
      expect(logDeleteOrder).toBeLessThan(txOrder);
    });

    it('does NOT log DELETE when org is not found', async () => {
      organizationRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('missing', 'user-1', true)).rejects.toThrow(
        NotFoundException,
      );
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it('does NOT log DELETE when caller is not authorized', async () => {
      organizationRepository.findOne.mockResolvedValue(mockOrg());
      const authz = (service as unknown as { authzService: AuthorizationService }).authzService;
      (authz.isOrganizationAdmin as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.remove('org-1', 'unauth', false)).rejects.toThrow(
        ForbiddenException,
      );
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });
  });
});
