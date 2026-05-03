/**
 * PyroscopeInstancesService — Phase 5a audit-logging assertions.
 *
 * Scope: this spec is intentionally scoped to the audit invariants added in
 * PR11. Broader CRUD / connection-test coverage is tracked separately.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { PyroscopeInstancesService } from './pyroscope-instances.service';
import { PyroscopeInstance as PyroscopeInstanceEntity } from '../../entities';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

describe('PyroscopeInstancesService', () => {
  let service: PyroscopeInstancesService;
  let repository: jest.Mocked<Repository<PyroscopeInstanceEntity>>;
  let auditService: jest.Mocked<AuditService>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];
  const mockOrgId = 'org-pyro-1';

  const createMockEntity = (overrides?: Partial<PyroscopeInstanceEntity>): PyroscopeInstanceEntity => ({
    id: 'pi-1',
    label: 'Test Pyroscope',
    pyroscopeUrl: 'https://pyro.example.com',
    backendUrl: undefined,
    pyroscopeStandAlone: false,
    organizationId: mockOrgId,
    teamId: undefined,
    createdBy: mockUserId,
    updatedBy: mockUserId,
    createdAt: new Date('2026-05-03T10:00:00Z'),
    updatedAt: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as PyroscopeInstanceEntity);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PyroscopeInstancesService,
        {
          provide: getRepositoryToken(PyroscopeInstanceEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            ...createAuthorizationServiceMock(),
            getAccessibleOrganizations: jest.fn().mockResolvedValue([mockOrgId]),
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

    service = module.get<PyroscopeInstancesService>(PyroscopeInstancesService);
    repository = module.get(getRepositoryToken(PyroscopeInstanceEntity));
    auditService = module.get(AuditService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('audit logging (Phase 5a, PR11)', () => {
    it('logs CREATE with organizationIdOverride from the persisted instance', async () => {
      const created = createMockEntity({ id: 'pi-create', label: 'Created' });
      repository.create.mockReturnValue(created);
      repository.save.mockResolvedValue(created);

      await service.create(
        {
          label: 'Created',
          pyroscopeUrl: 'https://pyro.new.com',
          pyroscopeStandAlone: false,
        } as never,
        mockUserId,
        mockRoles,
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(
        created,
        { organizationIdOverride: mockOrgId },
      );
    });

    it('logs UPDATE with cloned before-snapshot and organizationIdOverride', async () => {
      const before = createMockEntity({ id: 'pi-update', label: 'Original' });
      repository.findOne.mockResolvedValue(before);
      repository.save.mockImplementation(async (e) => e as PyroscopeInstanceEntity);

      await service.update(
        'pi-update',
        { label: 'Renamed' } as never,
        mockUserId,
        mockRoles,
      );

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'pi-update', label: 'Original' }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'pi-update', label: 'Renamed' }));
      expect(opts).toEqual({ organizationIdOverride: mockOrgId });
    });

    it('logs DELETE before repository.remove', async () => {
      const entity = createMockEntity({ id: 'pi-delete' });
      repository.findOne.mockResolvedValue(entity);
      repository.remove.mockResolvedValue(entity);

      await service.remove('pi-delete', mockUserId, mockRoles);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(
        entity,
        { organizationIdOverride: mockOrgId },
      );
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (repository.remove as jest.Mock).mock.invocationCallOrder[0],
      );
    });
  });
});
