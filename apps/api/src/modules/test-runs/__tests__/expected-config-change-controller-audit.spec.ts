/**
 * TestRunsComparisonController — controller-level audit chain verification
 * for `expected-config-changes` (Phase 5a, PR19, no-op verification).
 *
 * Background. The repository class `ExpectedConfigChangeRepository` is
 * exported but never injected anywhere in production — its `createMany` /
 * `deleteBySystemId` / `deleteByContext` methods have no callers. Every
 * real `ExpectedConfigChange` mutation flows through
 * `TestRunsComparisonController` → `TestRunsService` (facade) →
 * `TestRunsConfigService.{create,delete}ExpectedConfigChange`, which PR13
 * already audits. PR19 adds zero new `auditService.log*` call sites; this
 * spec locks in the chain by exercising the controller-level methods
 * through the real facade + real config-service (with the four repos /
 * `AuthorizationService` / `DataSource` / `AuditService` mocked, and the
 * six unused sibling sub-services stubbed) and asserting the expected
 * audit call materializes.
 *
 * Mirrors the PR18 `BenchmarksController` audit-chain pattern — see
 * `apps/api/src/modules/benchmarks/__tests__/controller-audit.spec.ts`.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TestRunsComparisonController } from '../controllers/test-runs-comparison.controller';
import { TestRunsService } from '../test-runs.service';
import { TestRunsQueryService } from '../services/test-runs-query.service';
import { TestRunsMutationService } from '../services/test-runs-mutation.service';
import { TestRunsConfigService } from '../services/test-runs-config.service';
import { TestRunsAnomalyService } from '../services/test-runs-anomaly.service';
import { TestRunsChangepointService } from '../services/test-runs-changepoint.service';
import { TestRunsMetricsService } from '../services/test-runs-metrics.service';
import { TestRunsApdexService } from '../services/test-runs-apdex.service';
import {
  TestRun as TestRunEntity,
  SystemUnderTest as SystemEntity,
  ExpectedConfigChange,
  TestRunConfiguration as TestRunConfigEntity,
  SparseMetricExclusion,
} from '../../../entities';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';
import { UserContext } from '../../../common/decorators/user-context.decorator';

const ORG_ID = 'org-ecc-int';
const USER_ID = 'user-ecc-int';
const ROLES = ['admin'];
const SUT_ID = 'sut-ecc-int';
const SUT_NAME = 'production-api';

const ctx: UserContext = {
  userId: USER_ID,
  roles: ROLES,
  organizations: [ORG_ID],
  teams: [],
  organizationId: ORG_ID,
  teamId: undefined,
};

const buildExpected = (
  overrides?: Partial<ExpectedConfigChange>,
): ExpectedConfigChange =>
  ({
    id: 'ecc-int-1',
    system_under_test_id: SUT_ID,
    test_environment: 'production',
    workload: 'loadTest',
    config_key: 'jvm.heap',
    expected_value: '4G',
    description: 'Bumped heap for new release',
    organizationId: ORG_ID,
    teamId: undefined,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    created_at: new Date('2026-05-04T10:00:00Z'),
    updated_at: new Date('2026-05-04T10:00:00Z'),
    ...overrides,
  } as ExpectedConfigChange);

describe('TestRunsComparisonController — expected-config-change audit chain (Phase 5a, PR19)', () => {
  let controller: TestRunsComparisonController;
  let expectedRepo: jest.Mocked<Repository<ExpectedConfigChange>>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestRunsComparisonController],
      providers: [
        TestRunsService,
        TestRunsConfigService,
        // Real config-service repos (the four it injects): only the system
        // and ExpectedConfigChange repos see traffic on this audit path.
        { provide: getRepositoryToken(TestRunEntity), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(SystemEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue({ id: SUT_ID }),
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
        // Sibling sub-services — TestRunsService injects them but the
        // expected-config-change path never touches them.
        { provide: TestRunsQueryService, useValue: {} },
        { provide: TestRunsMutationService, useValue: {} },
        { provide: TestRunsAnomalyService, useValue: {} },
        { provide: TestRunsChangepointService, useValue: {} },
        { provide: TestRunsMetricsService, useValue: {} },
        { provide: TestRunsApdexService, useValue: {} },
      ],
    }).compile();

    controller = module.get(TestRunsComparisonController);
    expectedRepo = module.get(getRepositoryToken(ExpectedConfigChange));
    auditService = module.get(AuditService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POST /test-runs/expected-config-changes (new) → logCreate fires through controller → facade → config-service', async () => {
    const created = buildExpected({ id: 'ecc-int-create' });
    expectedRepo.findOne.mockResolvedValue(null); // no existing row
    expectedRepo.create.mockReturnValue(created);
    expectedRepo.save.mockResolvedValue(created);

    await controller.createExpectedConfigChange(
      {
        system: SUT_NAME,
        environment: 'production',
        workload: 'loadTest',
        configKey: 'jvm.heap',
        reason: 'Bumped heap for new release',
      },
      ctx,
    );

    expect(auditService.logCreate).toHaveBeenCalledTimes(1);
    expect(auditService.logCreate).toHaveBeenCalledWith(created, {
      organizationIdOverride: ORG_ID,
    });
    expect(auditService.logUpdate).not.toHaveBeenCalled();
    expect(auditService.logDelete).not.toHaveBeenCalled();
  });

  it('POST /test-runs/expected-config-changes (existing) → logUpdate fires with before/after through full chain', async () => {
    const before = buildExpected({
      id: 'ecc-int-update',
      description: 'Old reason',
    });
    const after = buildExpected({
      id: 'ecc-int-update',
      description: 'New reason',
    });
    expectedRepo.findOne.mockResolvedValue(before);
    expectedRepo.save.mockResolvedValue(after);

    await controller.createExpectedConfigChange(
      {
        system: SUT_NAME,
        environment: 'production',
        workload: 'loadTest',
        configKey: 'jvm.heap',
        reason: 'New reason',
      },
      ctx,
    );

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const [beforeArg, afterArg, opts] = (
      auditService.logUpdate as jest.Mock
    ).mock.calls[0];
    expect(beforeArg).toEqual(
      expect.objectContaining({ id: 'ecc-int-update', description: 'Old reason' }),
    );
    expect(afterArg).toEqual(
      expect.objectContaining({ id: 'ecc-int-update', description: 'New reason' }),
    );
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
    expect(auditService.logCreate).not.toHaveBeenCalled();
    expect(auditService.logDelete).not.toHaveBeenCalled();
  });

  it('DELETE /test-runs/expected-config-changes (existing) → logDelete fires before repository.delete', async () => {
    const existing = buildExpected({ id: 'ecc-int-delete' });
    expectedRepo.findOne.mockResolvedValue(existing);
    expectedRepo.delete.mockResolvedValue({ affected: 1 } as never);

    await controller.deleteExpectedConfigChange(
      SUT_NAME,
      'production',
      'loadTest',
      'jvm.heap',
      ctx,
    );

    expect(auditService.logDelete).toHaveBeenCalledTimes(1);
    const [refArg, opts] = (auditService.logDelete as jest.Mock).mock.calls[0];
    expect(refArg).toEqual(expect.objectContaining({ id: 'ecc-int-delete' }));
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
    expect(
      (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (expectedRepo.delete as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(auditService.logCreate).not.toHaveBeenCalled();
    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });

  it('DELETE /test-runs/expected-config-changes (no match) → no audit emitted', async () => {
    expectedRepo.findOne.mockResolvedValue(null);
    expectedRepo.delete.mockResolvedValue({ affected: 0 } as never);

    await controller.deleteExpectedConfigChange(
      SUT_NAME,
      'production',
      'loadTest',
      'jvm.heap',
      ctx,
    );

    expect(auditService.logCreate).not.toHaveBeenCalled();
    expect(auditService.logUpdate).not.toHaveBeenCalled();
    expect(auditService.logDelete).not.toHaveBeenCalled();
  });
});
