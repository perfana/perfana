/**
 * TestRunsConfigService — Phase 5a audit-logging assertions.
 *
 * Scope: this spec is intentionally scoped to the audit invariants added in
 * PR13 for `ExpectedConfigChange` and `SparseMetricExclusion`. Broader
 * coverage of test_run_configs ingestion (raw-SQL upserts) is bucket-2
 * deferred and is not exercised here.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { TestRunsConfigService } from './test-runs-config.service';
import {
  TestRun as TestRunEntity,
  SystemUnderTest as SystemEntity,
  ExpectedConfigChange,
  TestRunConfiguration as TestRunConfigEntity,
  SparseMetricExclusion,
} from '../../../entities';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';

describe('TestRunsConfigService — audit invariants (Phase 5a, PR13)', () => {
  let service: TestRunsConfigService;
  let systemRepo: jest.Mocked<Repository<SystemEntity>>;
  let expectedRepo: jest.Mocked<Repository<ExpectedConfigChange>>;
  let sparseRepo: jest.Mocked<Repository<SparseMetricExclusion>>;
  let auditService: jest.Mocked<AuditService>;

  const sutId = 'sut-cfg-1';
  const orgId = 'org-cfg-1';

  const buildExpected = (overrides?: Partial<ExpectedConfigChange>): ExpectedConfigChange => ({
    id: 'ecc-1',
    system_under_test_id: sutId,
    test_environment: 'production',
    workload: 'loadTest',
    config_key: 'jvm.heap',
    expected_value: '4G',
    description: 'Bumped heap for new release',
    organizationId: orgId,
    teamId: undefined,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    created_at: new Date('2026-05-03T10:00:00Z'),
    updated_at: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as ExpectedConfigChange);

  const buildSparse = (overrides?: Partial<SparseMetricExclusion>): SparseMetricExclusion => ({
    id: 'sme-1',
    system_under_test_id: sutId,
    test_environment: 'production',
    workload: 'loadTest',
    dashboard_label: 'JVM',
    metric_name: 'gc.pauses',
    reason: 'Bursty metric',
    organizationId: orgId,
    teamId: undefined,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    created_at: new Date('2026-05-03T10:00:00Z'),
    updated_at: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as SparseMetricExclusion);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsConfigService,
        { provide: getRepositoryToken(TestRunEntity), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(SystemEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue({ id: sutId }),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ExpectedConfigChange),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        { provide: getRepositoryToken(TestRunConfigEntity), useValue: {} },
        {
          provide: getRepositoryToken(SparseMetricExclusion),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        { provide: DataSource, useValue: { query: jest.fn() } },
        { provide: AuthorizationService, useValue: {} },
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

    service = module.get(TestRunsConfigService);
    systemRepo = module.get(getRepositoryToken(SystemEntity));
    expectedRepo = module.get(getRepositoryToken(ExpectedConfigChange));
    sparseRepo = module.get(getRepositoryToken(SparseMetricExclusion));
    auditService = module.get(AuditService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createExpectedConfigChange', () => {
    it('logs CREATE on the new-row branch', async () => {
      const created = buildExpected({ id: 'ecc-create' });
      expectedRepo.findOne.mockResolvedValue(null);
      expectedRepo.create.mockReturnValue(created);
      expectedRepo.save.mockResolvedValue(created);

      await service.createExpectedConfigChange({
        system: 'sut',
        environment: 'production',
        workload: 'loadTest',
        configKey: 'jvm.heap',
        reason: 'Bumped heap',
      } as never);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(created, { organizationIdOverride: orgId });
    });

    it('logs UPDATE on the existing-row branch with cloned before-snapshot', async () => {
      const existing = buildExpected({ description: 'Old reason' });
      const saved = buildExpected({ description: 'New reason' });
      expectedRepo.findOne.mockResolvedValue(existing);
      expectedRepo.save.mockResolvedValue(saved);

      await service.createExpectedConfigChange({
        system: 'sut',
        environment: 'production',
        workload: 'loadTest',
        configKey: 'jvm.heap',
        reason: 'New reason',
      } as never);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ description: 'Old reason' }));
      expect(afterArg).toEqual(expect.objectContaining({ description: 'New reason' }));
      expect(opts).toEqual({ organizationIdOverride: orgId });
    });
  });

  describe('deleteExpectedConfigChange', () => {
    it('logs DELETE before repository.delete', async () => {
      const existing = buildExpected({ id: 'ecc-delete' });
      expectedRepo.findOne.mockResolvedValue(existing);
      expectedRepo.delete.mockResolvedValue({ affected: 1 } as never);

      await service.deleteExpectedConfigChange('sut', 'production', 'loadTest', 'jvm.heap');

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(existing, { organizationIdOverride: orgId });
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (expectedRepo.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('skips audit log when no row matches the composite key', async () => {
      expectedRepo.findOne.mockResolvedValue(null);
      expectedRepo.delete.mockResolvedValue({ affected: 0 } as never);

      await service.deleteExpectedConfigChange('sut', 'production', 'loadTest', 'missing.key');

      expect(auditService.logDelete).not.toHaveBeenCalled();
    });
  });

  describe('createSparseMetricExclusion', () => {
    it('logs CREATE on the new-row branch', async () => {
      const created = buildSparse({ id: 'sme-create' });
      sparseRepo.findOne.mockResolvedValue(null);
      sparseRepo.create.mockReturnValue(created);
      sparseRepo.save.mockResolvedValue(created);

      await service.createSparseMetricExclusion({
        system: 'sut',
        environment: 'production',
        workload: 'loadTest',
        dashboardLabel: 'JVM',
        metricName: 'gc.pauses',
        reason: 'Bursty metric',
      } as never);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(created, { organizationIdOverride: orgId });
    });

    it('logs UPDATE on the existing-row branch', async () => {
      const existing = buildSparse({ reason: 'Old reason' });
      const saved = buildSparse({ reason: 'New reason' });
      sparseRepo.findOne.mockResolvedValue(existing);
      sparseRepo.save.mockResolvedValue(saved);

      await service.createSparseMetricExclusion({
        system: 'sut',
        environment: 'production',
        workload: 'loadTest',
        dashboardLabel: 'JVM',
        metricName: 'gc.pauses',
        reason: 'New reason',
      } as never);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ reason: 'Old reason' }));
      expect(afterArg).toEqual(expect.objectContaining({ reason: 'New reason' }));
      expect(opts).toEqual({ organizationIdOverride: orgId });
    });
  });

  describe('deleteSparseMetricExclusion', () => {
    it('logs DELETE before repository.delete', async () => {
      const existing = buildSparse({ id: 'sme-delete' });
      sparseRepo.findOne.mockResolvedValue(existing);
      sparseRepo.delete.mockResolvedValue({ affected: 1 } as never);

      await service.deleteSparseMetricExclusion('sut', 'production', 'loadTest', 'JVM', 'gc.pauses');

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(existing, { organizationIdOverride: orgId });
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (sparseRepo.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('skips audit log when no row matches the composite key', async () => {
      // re-stub system lookup so the delete branch reaches the findOne audit guard
      systemRepo.findOne.mockResolvedValueOnce({ id: sutId } as SystemEntity);
      sparseRepo.findOne.mockResolvedValue(null);
      sparseRepo.delete.mockResolvedValue({ affected: 0 } as never);

      await service.deleteSparseMetricExclusion('sut', 'production', 'loadTest', 'JVM', 'missing');

      expect(auditService.logDelete).not.toHaveBeenCalled();
    });
  });
});
