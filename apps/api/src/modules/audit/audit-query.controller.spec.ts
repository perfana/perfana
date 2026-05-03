import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AuditQueryController } from './audit-query.controller';
import { AuditService } from './audit.service';
import { AuditResourceRegistry } from './audit-resource-registry';
import { AuthorizationService } from '../../common/services/authorization.service';
import { Capability } from '../../constants/capabilities.constants';

describe('AuditQueryController', () => {
  let ctl: AuditQueryController;
  let svc: jest.Mocked<AuditService>;
  let reg: jest.Mocked<AuditResourceRegistry>;
  let authz: jest.Mocked<AuthorizationService>;

  const mockUserCtx = (overrides: Partial<{ userId: string; roles: string[] }> = {}) => ({
    userId: 'kc-1',
    roles: [] as string[],
    organizations: [],
    teams: [],
    ...overrides,
  } as unknown as Parameters<AuditQueryController['findByFilter']>[1]);

  beforeEach(async () => {
    svc = {
      findByFilter: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findByResource: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<AuditService>;

    reg = {
      register: jest.fn(),
      resolve: jest.fn(),
      knownTypes: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<AuditResourceRegistry>;

    authz = {
      // Default: caller does not hold SystemAuditRead (i.e. is not a global
      // admin). Tests that exercise the cross-org branch override this to
      // include Capability.SystemAuditRead.
      getCapabilities: jest.fn().mockResolvedValue([]),
      getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
      canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'ok' }),
    } as unknown as jest.Mocked<AuthorizationService>;

    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue(null),
      }),
    };

    const m = await Test.createTestingModule({
      controllers: [AuditQueryController],
      providers: [
        { provide: AuditService, useValue: svc },
        { provide: AuditResourceRegistry, useValue: reg },
        { provide: AuthorizationService, useValue: authz },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    ctl = m.get(AuditQueryController);
  });

  describe('GET /api/audit-logs (admin filter)', () => {
    it('super-admin sees cross-org rows (no organizationIds filter)', async () => {
      authz.getCapabilities.mockResolvedValue([Capability.SystemAuditRead]);
      await ctl.findByFilter({}, mockUserCtx({ roles: ['super-admin'] }));
      expect(svc.findByFilter).toHaveBeenCalledWith(
        expect.objectContaining({ organizationIds: undefined }),
      );
    });

    it('non-admin (org-admin) is filtered to accessible orgs', async () => {
      authz.getAccessibleOrganizations.mockResolvedValue(['o1', 'o2']);
      await ctl.findByFilter({}, mockUserCtx({ roles: ['org-admin'] }));
      expect(svc.findByFilter).toHaveBeenCalledWith(
        expect.objectContaining({ organizationIds: ['o1', 'o2'] }),
      );
    });

    it('non-admin requesting an org they cannot see → empty result', async () => {
      authz.getAccessibleOrganizations.mockResolvedValue(['o1']);
      const out = await ctl.findByFilter(
        { organizationId: 'o2' },
        mockUserCtx({ roles: ['org-admin'] }),
      );
      expect(out).toEqual({ rows: [], total: 0 });
      expect(svc.findByFilter).not.toHaveBeenCalled();
    });

    it('non-admin requesting an accessible org → narrow to that one', async () => {
      authz.getAccessibleOrganizations.mockResolvedValue(['o1', 'o2']);
      await ctl.findByFilter({ organizationId: 'o2' }, mockUserCtx({ roles: ['org-admin'] }));
      expect(svc.findByFilter).toHaveBeenCalledWith(
        expect.objectContaining({ organizationIds: ['o2'] }),
      );
    });

    it('passes through pagination and date filters', async () => {
      authz.getCapabilities.mockResolvedValue([Capability.SystemAuditRead]);
      await ctl.findByFilter(
        { limit: 50, offset: 100, startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z' },
        mockUserCtx({ roles: ['super-admin'] }),
      );
      const arg = svc.findByFilter.mock.calls[0][0];
      expect(arg.limit).toBe(50);
      expect(arg.offset).toBe(100);
      expect(arg.startDate).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(arg.endDate).toEqual(new Date('2026-02-01T00:00:00Z'));
    });
  });

  describe('GET /api/audit-logs/resource/:resourceType/:resourceId', () => {
    class FakeEntity {
      static auditableFields = ['id'] as const;
      id!: string;
      organization_id!: string;
      created_by!: string;
    }

    it('returns 404 for unknown resourceType', async () => {
      reg.resolve.mockReturnValue(null);
      await expect(
        ctl.findByResource('unknown', 'r-1', mockUserCtx()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when the resource itself does not exist', async () => {
      reg.resolve.mockReturnValue(FakeEntity as never);
      // Override loadResource to return null
      const ctlAny = ctl as unknown as { loadResource: () => Promise<unknown> };
      ctlAny.loadResource = jest.fn().mockResolvedValue(null);
      reg.resolve.mockReturnValue(FakeEntity as never);
      await expect(
        ctl.findByResource('api-keys', 'r-missing', mockUserCtx()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 403 when caller lacks read access to the resource', async () => {
      reg.resolve.mockReturnValue(FakeEntity as never);
      const entity = Object.assign(new FakeEntity(), { id: 'r-1', organization_id: 'o-1', created_by: 'kc-9' });
      const ctlAny = ctl as unknown as { loadResource: () => Promise<unknown> };
      ctlAny.loadResource = jest.fn().mockResolvedValue(entity);
      authz.canAccessResource.mockResolvedValue({ allowed: false, reason: 'No org access' });

      await expect(
        ctl.findByResource('api-keys', 'r-1', mockUserCtx()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns history when caller has read access', async () => {
      reg.resolve.mockReturnValue(FakeEntity as never);
      const entity = Object.assign(new FakeEntity(), { id: 'r-1', organization_id: 'o-1', created_by: 'kc-9' });
      const ctlAny = ctl as unknown as { loadResource: () => Promise<unknown> };
      ctlAny.loadResource = jest.fn().mockResolvedValue(entity);
      authz.canAccessResource.mockResolvedValue({ allowed: true, reason: 'org-member' });
      svc.findByResource.mockResolvedValue([{ id: 'a-1' }] as never);

      const out = await ctl.findByResource('api-keys', 'r-1', mockUserCtx());
      expect(out).toEqual([{ id: 'a-1' }]);
      expect(svc.findByResource).toHaveBeenCalledWith('api-keys', 'r-1', expect.any(Object));
    });
  });
});
