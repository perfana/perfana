/**
 * TestRunsApdexService — audit logging + ownership inheritance assertions.
 *
 * Scope: Phase 5a audit invariants for workload-level Apdex thresholds.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger, NotFoundException } from '@nestjs/common';
import { TestRunsApdexService } from './test-runs-apdex.service';
import {
  SystemUnderTest as SystemEntity,
  WorkloadApdexThreshold,
  WorkloadTransactionApdexThreshold,
} from '../../../entities';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';

describe('TestRunsApdexService', () => {
  let service: TestRunsApdexService;
  let workloadApdexRepo: jest.Mocked<Repository<WorkloadApdexThreshold>>;
  let transactionApdexRepo: jest.Mocked<Repository<WorkloadTransactionApdexThreshold>>;
  let auditService: jest.Mocked<AuditService>;

  const userId = 'user-1';
  const roles = ['user'];
  const orgId = 'org-1';
  const teamId = 'team-1';
  const sutId = 'sut-1';
  const env = 'acc';
  const workload = 'loadTest';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsApdexService,
        {
          provide: getRepositoryToken(SystemEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: sutId,
              organization_id: orgId,
              team_id: teamId,
              created_by: userId,
            }),
          },
        },
        {
          provide: getRepositoryToken(WorkloadApdexThreshold),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((data) => Object.assign(new WorkloadApdexThreshold(), data)),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WorkloadTransactionApdexThreshold),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data) => Object.assign(new WorkloadTransactionApdexThreshold(), data)),
            save: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            canAccessResource: jest.fn().mockResolvedValue({ allowed: true }),
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

    service = module.get(TestRunsApdexService);
    workloadApdexRepo = module.get(getRepositoryToken(WorkloadApdexThreshold));
    transactionApdexRepo = module.get(getRepositoryToken(WorkloadTransactionApdexThreshold));
    auditService = module.get(AuditService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setWorkloadApdexThreshold', () => {
    it('logs CREATE and inherits ownership when threshold is new', async () => {
      workloadApdexRepo.findOne.mockResolvedValue(null);
      workloadApdexRepo.save.mockImplementation(async (entity) =>
        Object.assign(new WorkloadApdexThreshold(), entity, {
          id: 'wat-1',
          created_at: new Date(),
          updated_at: new Date(),
        }),
      );

      await service.setWorkloadApdexThreshold(sutId, env, workload, { apdex_threshold: 700 }, userId, roles);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logUpdate).not.toHaveBeenCalled();

      const saveArg = workloadApdexRepo.save.mock.calls[0][0] as WorkloadApdexThreshold;
      expect(saveArg.organization_id).toBe(orgId);
      expect(saveArg.team_id).toBe(teamId);
      expect(saveArg.created_by).toBe(userId);
      expect(saveArg.updated_by).toBe(userId);
      expect(saveArg.apdex_threshold).toBe(700);

      const [created, opts] = auditService.logCreate.mock.calls[0];
      expect((created as WorkloadApdexThreshold).apdex_threshold).toBe(700);
      expect(opts).toEqual({ organizationIdOverride: orgId });
    });

    it('logs UPDATE with before/after when threshold exists', async () => {
      const existing = Object.assign(new WorkloadApdexThreshold(), {
        id: 'wat-1',
        system_under_test_id: sutId,
        test_environment: env,
        workload,
        apdex_threshold: 500,
        organization_id: orgId,
        team_id: teamId,
        created_by: 'old-user',
        updated_by: 'old-user',
        created_at: new Date(),
        updated_at: new Date(),
      });
      workloadApdexRepo.findOne.mockResolvedValue(existing);
      workloadApdexRepo.save.mockImplementation(async (entity) => entity as WorkloadApdexThreshold);

      await service.setWorkloadApdexThreshold(sutId, env, workload, { apdex_threshold: 800 }, userId, roles);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).not.toHaveBeenCalled();

      const [before, after, opts] = auditService.logUpdate.mock.calls[0];
      expect((before as WorkloadApdexThreshold).apdex_threshold).toBe(500);
      expect((after as WorkloadApdexThreshold).apdex_threshold).toBe(800);
      expect((after as WorkloadApdexThreshold).updated_by).toBe(userId);
      expect(opts).toEqual({ organizationIdOverride: orgId });
    });

    it('backfills ownership on legacy rows with NULL org', async () => {
      const legacy = Object.assign(new WorkloadApdexThreshold(), {
        id: 'wat-legacy',
        system_under_test_id: sutId,
        test_environment: env,
        workload,
        apdex_threshold: 500,
        organization_id: null as unknown as string,
        team_id: undefined,
        created_by: undefined as unknown as string,
        updated_by: undefined,
        created_at: new Date(),
        updated_at: new Date(),
      });
      workloadApdexRepo.findOne.mockResolvedValue(legacy);
      workloadApdexRepo.save.mockImplementation(async (entity) => entity as WorkloadApdexThreshold);

      await service.setWorkloadApdexThreshold(sutId, env, workload, { apdex_threshold: 600 }, userId, roles);

      const saved = workloadApdexRepo.save.mock.calls[0][0] as WorkloadApdexThreshold;
      expect(saved.organization_id).toBe(orgId);
      expect(saved.team_id).toBe(teamId);
      expect(saved.created_by).toBe(userId);
    });
  });

  describe('setWorkloadTransactionApdexThreshold', () => {
    it('logs CREATE for new transaction threshold', async () => {
      transactionApdexRepo.findOne.mockResolvedValue(null);
      transactionApdexRepo.save.mockImplementation(async (entity) =>
        Object.assign(new WorkloadTransactionApdexThreshold(), entity, {
          id: 'wtat-1',
          created_at: new Date(),
          updated_at: new Date(),
        }),
      );

      await service.setWorkloadTransactionApdexThreshold(
        sutId, env, workload, 'T01_Login', { apdex_threshold: 250 }, userId, roles,
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logUpdate).not.toHaveBeenCalled();

      const saved = transactionApdexRepo.save.mock.calls[0][0] as WorkloadTransactionApdexThreshold;
      expect(saved.transaction_name).toBe('T01_Login');
      expect(saved.apdex_threshold).toBe(250);
      expect(saved.organization_id).toBe(orgId);
      expect(saved.created_by).toBe(userId);
    });

    it('logs UPDATE for existing transaction threshold', async () => {
      const existing = Object.assign(new WorkloadTransactionApdexThreshold(), {
        id: 'wtat-1',
        system_under_test_id: sutId,
        test_environment: env,
        workload,
        transaction_name: 'T01_Login',
        apdex_threshold: 200,
        organization_id: orgId,
        team_id: teamId,
        created_by: 'old-user',
        updated_by: 'old-user',
        created_at: new Date(),
        updated_at: new Date(),
      });
      transactionApdexRepo.findOne.mockResolvedValue(existing);
      transactionApdexRepo.save.mockImplementation(async (entity) => entity as WorkloadTransactionApdexThreshold);

      await service.setWorkloadTransactionApdexThreshold(
        sutId, env, workload, 'T01_Login', { apdex_threshold: 350 }, userId, roles,
      );

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [before, after] = auditService.logUpdate.mock.calls[0];
      expect((before as WorkloadTransactionApdexThreshold).apdex_threshold).toBe(200);
      expect((after as WorkloadTransactionApdexThreshold).apdex_threshold).toBe(350);
      expect((after as WorkloadTransactionApdexThreshold).updated_by).toBe(userId);
    });
  });

  describe('deleteWorkloadTransactionApdexThreshold', () => {
    it('logs DELETE with snapshot when threshold exists', async () => {
      const existing = Object.assign(new WorkloadTransactionApdexThreshold(), {
        id: 'wtat-1',
        system_under_test_id: sutId,
        test_environment: env,
        workload,
        transaction_name: 'T01_Login',
        apdex_threshold: 250,
        organization_id: orgId,
        team_id: teamId,
        created_by: userId,
        updated_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      });
      transactionApdexRepo.findOne.mockResolvedValue(existing);
      transactionApdexRepo.remove.mockResolvedValue(existing);

      await service.deleteWorkloadTransactionApdexThreshold(sutId, env, workload, 'T01_Login', userId, roles);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      const [snapshot, opts] = auditService.logDelete.mock.calls[0];
      expect((snapshot as WorkloadTransactionApdexThreshold).apdex_threshold).toBe(250);
      expect((snapshot as WorkloadTransactionApdexThreshold).transaction_name).toBe('T01_Login');
      expect(opts).toEqual({ organizationIdOverride: orgId });
    });

    it('throws NotFoundException and does not log when threshold missing', async () => {
      transactionApdexRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteWorkloadTransactionApdexThreshold(sutId, env, workload, 'missing', userId, roles),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(auditService.logDelete).not.toHaveBeenCalled();
      expect(transactionApdexRepo.remove).not.toHaveBeenCalled();
    });
  });
});
