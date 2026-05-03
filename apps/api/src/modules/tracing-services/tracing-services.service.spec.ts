/**
 * TracingServicesService — Phase 5a audit-logging assertions.
 *
 * Scope: this spec is intentionally scoped to the audit invariants added in
 * PR11. It covers the CREATE / UPDATE branching inside `createOrUpdate`, the
 * dedicated `update` path, and the "log before mutation" ordering on `delete`.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TracingServicesService } from './tracing-services.service';
import { TracingServiceRepository } from '../../repositories/tracing-service.repository';
import { TracingService } from '@perfana/shared';
import { AuditService } from '../audit/audit.service';

type MockRepo = {
  findByExactMatch: jest.Mock;
  createOrUpdate: jest.Mock;
  findById: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

describe('TracingServicesService', () => {
  let service: TracingServicesService;
  let repository: MockRepo;
  let auditService: jest.Mocked<AuditService>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];
  const mockOrgId = 'org-trace-1';

  const createMockEntity = (overrides?: Partial<TracingService>): TracingService => ({
    id: 'ts-1',
    systemUnderTestId: 'sut-1',
    testEnvironment: 'prod',
    workload: 'load',
    tracingInstanceId: 'ti-1',
    serviceNames: ['svc-a'],
    organizationId: mockOrgId,
    teamId: undefined,
    createdBy: mockUserId,
    updatedBy: mockUserId,
    createdAt: new Date('2026-05-03T10:00:00Z'),
    updatedAt: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as unknown as TracingService);

  beforeEach(async () => {
    const repoMock: MockRepo = {
      findByExactMatch: jest.fn(),
      createOrUpdate: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracingServicesService,
        { provide: TracingServiceRepository, useValue: repoMock },
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

    service = module.get<TracingServicesService>(TracingServicesService);
    repository = module.get(TracingServiceRepository) as unknown as MockRepo;
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('audit logging (Phase 5a, PR11)', () => {
    it('createOrUpdate logs CREATE when no row exists for the scope key', async () => {
      const created = createMockEntity({ id: 'ts-new' });
      repository.findByExactMatch.mockResolvedValue(null);
      repository.createOrUpdate.mockResolvedValue(created);

      await service.createOrUpdate(
        {
          systemUnderTestId: 'sut-1',
          testEnvironment: 'prod',
          workload: 'load',
          tracingInstanceId: 'ti-1',
          serviceNames: ['svc-a'],
        } as never,
        mockUserId,
        mockRoles,
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(
        created,
        { organizationIdOverride: mockOrgId },
      );
      expect(auditService.logUpdate).not.toHaveBeenCalled();
    });

    it('createOrUpdate logs UPDATE with cloned before-snapshot when a row already exists', async () => {
      const before = createMockEntity({ id: 'ts-exists', serviceNames: ['svc-old'] });
      const after = createMockEntity({ id: 'ts-exists', serviceNames: ['svc-new'] });
      repository.findByExactMatch.mockResolvedValue(before);
      repository.createOrUpdate.mockResolvedValue(after);

      await service.createOrUpdate(
        {
          systemUnderTestId: 'sut-1',
          testEnvironment: 'prod',
          workload: 'load',
          tracingInstanceId: 'ti-1',
          serviceNames: ['svc-new'],
        } as never,
        mockUserId,
        mockRoles,
      );

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'ts-exists', serviceNames: ['svc-old'] }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'ts-exists', serviceNames: ['svc-new'] }));
      expect(opts).toEqual({ organizationIdOverride: mockOrgId });
      expect(auditService.logCreate).not.toHaveBeenCalled();
    });

    it('update logs UPDATE with the pre-update entity and the post-update reload', async () => {
      const before = createMockEntity({ id: 'ts-up', serviceNames: ['svc-old'] });
      const after = createMockEntity({ id: 'ts-up', serviceNames: ['svc-new'] });
      repository.findById
        .mockResolvedValueOnce(before) // initial existence check
        .mockResolvedValueOnce(after);  // post-update reload
      repository.update.mockResolvedValue(undefined);

      await service.update(
        'ts-up',
        { serviceNames: ['svc-new'] } as never,
        mockUserId,
        mockRoles,
      );

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'ts-up', serviceNames: ['svc-old'] }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'ts-up', serviceNames: ['svc-new'] }));
      expect(opts).toEqual({ organizationIdOverride: mockOrgId });
    });

    it('delete logs DELETE before repository.delete', async () => {
      const entity = createMockEntity({ id: 'ts-del' });
      repository.findById.mockResolvedValue(entity);
      repository.delete.mockResolvedValue(undefined);

      await service.delete('ts-del', mockUserId, mockRoles);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(
        entity,
        { organizationIdOverride: mockOrgId },
      );
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (repository.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });
  });
});
