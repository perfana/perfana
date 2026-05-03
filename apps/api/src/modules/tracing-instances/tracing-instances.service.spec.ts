/**
 * TracingInstancesService — Phase 5a audit-logging assertions.
 *
 * Scope: this spec is intentionally scoped to the audit invariants added in
 * PR11. Broader CRUD / connection-test coverage is tracked separately.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { TracingInstancesService } from './tracing-instances.service';
import { TracingInstance as TracingInstanceEntity } from '@perfana/shared';
import { TracingUI } from '@perfana/shared/entities';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

describe('TracingInstancesService', () => {
  let service: TracingInstancesService;
  let repository: jest.Mocked<Repository<TracingInstanceEntity>>;
  let auditService: jest.Mocked<AuditService>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];
  const mockOrgId = 'org-tracing-1';

  const createMockEntity = (overrides?: Partial<TracingInstanceEntity>): TracingInstanceEntity => ({
    id: 'ti-1',
    label: 'Test Tracing',
    tracingUrl: 'https://tracing.example.com',
    tracingApiUrl: undefined,
    tracingUi: TracingUI.JAEGER,
    tracingIframeAllowed: false,
    organizationId: mockOrgId,
    teamId: undefined,
    createdBy: mockUserId,
    updatedBy: mockUserId,
    createdAt: new Date('2026-05-03T10:00:00Z'),
    updatedAt: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as TracingInstanceEntity);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracingInstancesService,
        {
          provide: getRepositoryToken(TracingInstanceEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
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

    service = module.get<TracingInstancesService>(TracingInstancesService);
    repository = module.get(getRepositoryToken(TracingInstanceEntity));
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
      const created = createMockEntity({ id: 'ti-create', label: 'Created' });
      repository.create.mockReturnValue(created);
      repository.save.mockResolvedValue(created);

      await service.create(
        {
          label: 'Created',
          tracingUrl: 'https://tracing.new.com',
          tracingUi: TracingUI.JAEGER,
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
      const before = createMockEntity({ id: 'ti-update', label: 'Original' });
      repository.findOne.mockResolvedValue(before);
      repository.save.mockImplementation(async (e) => e as TracingInstanceEntity);

      await service.update(
        'ti-update',
        { label: 'Renamed' } as never,
        mockUserId,
        mockRoles,
      );

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'ti-update', label: 'Original' }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'ti-update', label: 'Renamed' }));
      expect(opts).toEqual({ organizationIdOverride: mockOrgId });
    });

    it('logs DELETE before repository.remove', async () => {
      const entity = createMockEntity({ id: 'ti-delete' });
      repository.findOne.mockResolvedValue(entity);
      repository.remove.mockResolvedValue(entity);

      await service.remove('ti-delete', mockUserId, mockRoles);

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
