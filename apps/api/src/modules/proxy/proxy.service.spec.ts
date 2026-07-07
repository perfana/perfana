import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProxyService } from './proxy.service';
import { ProxyServer } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';
import { UpsertProxyDto } from './dto/proxy.dto';

const mockUserId = 'user-abc';
const mockRoles = ['user'];
const mockOrgId = 'org-xyz';

const buildRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

const buildAuthzService = () => ({
  getAccessibleOrganizations: jest.fn().mockResolvedValue([mockOrgId]),
  isGlobalAdmin: jest.fn().mockReturnValue(false),
});

const buildAuditService = () => ({
  logCreate: jest.fn(),
  logUpdate: jest.fn(),
  logDelete: jest.fn(),
});

describe('ProxyService', () => {
  let service: ProxyService;
  let repo: ReturnType<typeof buildRepo>;
  let authzService: ReturnType<typeof buildAuthzService>;
  let auditService: ReturnType<typeof buildAuditService>;

  beforeEach(async () => {
    repo = buildRepo();
    authzService = buildAuthzService();
    auditService = buildAuditService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyService,
        { provide: getRepositoryToken(ProxyServer), useValue: repo },
        { provide: AuthorizationService, useValue: authzService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<ProxyService>(ProxyService);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------- getForOrg

  describe('getForOrg', () => {
    it('returns null when no proxy is configured for the org', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await service.getForOrg(mockUserId, mockRoles);
      expect(result).toBeNull();
    });

    it('returns a response DTO (no password) when a proxy exists', async () => {
      const row: Partial<ProxyServer> = {
        id: 'proxy-1',
        organizationId: mockOrgId,
        proxyUrl: 'http://proxy:3128',
        username: 'alice',
        password: 's3cr3t',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.findOne.mockResolvedValue(row);

      const result = await service.getForOrg(mockUserId, mockRoles);
      expect(result).not.toBeNull();
      expect(result!.hasPassword).toBe(true);
      expect(result!.username).toBe('alice');
      expect((result as Record<string, unknown>)['password']).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------- upsert

  describe('upsert', () => {
    it('creates a new row with camelCase organizationId when none exists', async () => {
      const dto: UpsertProxyDto = { proxyUrl: 'http://proxy:3128', username: 'bob', password: 'pass1' };

      repo.findOne.mockResolvedValue(null);
      const created: Partial<ProxyServer> = {
        id: 'new-1',
        organizationId: mockOrgId,
        proxyUrl: dto.proxyUrl,
        username: dto.username,
        password: dto.password,
        createdBy: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.create.mockReturnValue(created);
      repo.save.mockResolvedValue(created);

      const result = await service.upsert(mockUserId, mockRoles, dto);

      // repo.create must have been called with camelCase organizationId (not organization_id)
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrgId,
          createdBy: mockUserId,
          proxyUrl: dto.proxyUrl,
        }),
      );
      // No second row — save called once
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(result.hasPassword).toBe(true);
      expect((result as Record<string, unknown>)['password']).toBeUndefined();
    });

    it('updates the existing row without creating a second one', async () => {
      const dto: UpsertProxyDto = { proxyUrl: 'http://newproxy:3128' };

      const existing: Partial<ProxyServer> = {
        id: 'existing-1',
        organizationId: mockOrgId,
        proxyUrl: 'http://oldproxy:3128',
        password: 'existingPass',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockResolvedValue({ ...existing, proxyUrl: dto.proxyUrl, updatedBy: mockUserId });

      const result = await service.upsert(mockUserId, mockRoles, dto);

      // Should NOT call create for an existing row
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      expect(result.proxyUrl).toBe('http://newproxy:3128');
    });

    it('keeps the existing password when dto.password is blank', async () => {
      const dto: UpsertProxyDto = { proxyUrl: 'http://proxy:3128', password: '' };

      const existing: Partial<ProxyServer> = {
        id: 'existing-2',
        organizationId: mockOrgId,
        proxyUrl: 'http://oldproxy:3128',
        password: 'keepMe',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.findOne.mockResolvedValue(existing);

      let savedEntity: Partial<ProxyServer> | undefined;
      repo.save.mockImplementation((e: Partial<ProxyServer>) => {
        savedEntity = e;
        return Promise.resolve(e);
      });

      await service.upsert(mockUserId, mockRoles, dto);

      expect(savedEntity?.password).toBe('keepMe');
    });

    it('keeps the existing password when dto.password is undefined', async () => {
      const dto: UpsertProxyDto = { proxyUrl: 'http://proxy:3128' };

      const existing: Partial<ProxyServer> = {
        id: 'existing-3',
        organizationId: mockOrgId,
        proxyUrl: 'http://old:3128',
        password: 'dontOverwrite',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockImplementation((e: Partial<ProxyServer>) => Promise.resolve(e));

      const result = await service.upsert(mockUserId, mockRoles, dto);

      const saved = repo.save.mock.calls[0]?.[0] as Partial<ProxyServer>;
      expect(saved.password).toBe('dontOverwrite');
      expect(result.hasPassword).toBe(true);
    });

    it('throws ForbiddenException when user has no accessible organization', async () => {
      authzService.getAccessibleOrganizations.mockResolvedValue([]);
      const dto: UpsertProxyDto = { proxyUrl: 'http://proxy:3128' };

      await expect(service.upsert(mockUserId, mockRoles, dto)).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------- remove

  describe('remove', () => {
    it('deletes the proxy and calls logDelete', async () => {
      const existing: Partial<ProxyServer> = {
        id: 'del-1',
        organizationId: mockOrgId,
        proxyUrl: 'http://proxy:3128',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.findOne.mockResolvedValue(existing);
      repo.delete.mockResolvedValue({ affected: 1 });

      await service.remove(mockUserId, mockRoles);

      expect(repo.delete).toHaveBeenCalledWith({ organizationId: mockOrgId });
      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
    });

    it('does nothing (no error) when no proxy exists for the org', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove(mockUserId, mockRoles)).resolves.toBeUndefined();
      expect(repo.delete).not.toHaveBeenCalled();
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- toResponse

  describe('toResponse (via upsert)', () => {
    it('never returns the password field', async () => {
      const dto: UpsertProxyDto = { proxyUrl: 'http://proxy:3128', password: 'secret' };
      repo.findOne.mockResolvedValue(null);
      const created: Partial<ProxyServer> = {
        id: 'r-1',
        organizationId: mockOrgId,
        proxyUrl: dto.proxyUrl,
        password: 'secret',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.create.mockReturnValue(created);
      repo.save.mockResolvedValue(created);

      const result = await service.upsert(mockUserId, mockRoles, dto);

      expect('password' in result).toBe(false);
      expect(result.hasPassword).toBe(true);
    });

    it('sets hasPassword=false when no password stored', async () => {
      const dto: UpsertProxyDto = { proxyUrl: 'http://proxy:3128' };
      repo.findOne.mockResolvedValue(null);
      const created: Partial<ProxyServer> = {
        id: 'r-2',
        organizationId: mockOrgId,
        proxyUrl: dto.proxyUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.create.mockReturnValue(created);
      repo.save.mockResolvedValue(created);

      const result = await service.upsert(mockUserId, mockRoles, dto);

      expect(result.hasPassword).toBe(false);
    });
  });
});
