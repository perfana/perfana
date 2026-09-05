import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UpdateAnalysisTimeRangeHandler } from './update-analysis-time-range.handler';
import { TestRun as TestRunEntity, getAuditableFields } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';

const mockTestRun = (overrides = {}) => ({
  id: 'uuid-1',
  testRunId: 'run-001',
  analysisStartOffset: 60,
  analysisEndOffset: 0,
  completed: true,
  organizationId: 'org-1',
  systemUnderTest: { team_id: null },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('UpdateAnalysisTimeRangeHandler', () => {
  let handler: UpdateAnalysisTimeRangeHandler;
  let mockRepo: { findOne: jest.Mock; find: jest.Mock };
  let mockDataSource: { query: jest.Mock; manager: { query: jest.Mock } };
  let mockGateway: { emitTestRunUpdated: jest.Mock };
  let mockAudit: { logUpdate: jest.Mock };

  beforeEach(async () => {
    // create() must behave like TypeORM's: a real entity instance, not a literal.
    // AuditService.dispatch reads ref.constructor to find auditableFields.
    mockRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((plain) => Object.assign(new TestRunEntity(), plain)),
    };
    const dsQuery = jest.fn().mockResolvedValue(undefined);
    // Outside an RLS request, withRequestQuery falls through to the DataSource manager.
    mockDataSource = { query: dsQuery, manager: { query: dsQuery } };
    mockGateway = { emitTestRunUpdated: jest.fn() };
    mockAudit = { logUpdate: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        UpdateAnalysisTimeRangeHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: TestRunsGateway, useValue: mockGateway },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    handler = module.get(UpdateAnalysisTimeRangeHandler);
  });

  it('updates both ramp_up and ramp_down columns atomically', async () => {
    const pre = mockTestRun({ analysisStartOffset: 60, analysisEndOffset: 0 });
    const post = mockTestRun({ analysisStartOffset: 30, analysisEndOffset: 60 });
    mockRepo.findOne.mockResolvedValueOnce(pre).mockResolvedValueOnce(post);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60 });

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('ramp_up'),
      expect.arrayContaining([30, 60, ['uuid-1']]),
    );
  });

  it('throws ResourceNotFoundException when test run not found', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    await expect(
      handler.execute({ id: 'missing', analysisStartOffset: 0, analysisEndOffset: 0 }),
    ).rejects.toThrow();
  });

  it('calls auditService.logUpdate with pre and post entities', async () => {
    const pre = mockTestRun();
    const post = mockTestRun({ analysisStartOffset: 30, analysisEndOffset: 60 });
    mockRepo.findOne.mockResolvedValueOnce(pre).mockResolvedValueOnce(post);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60 });

    expect(mockAudit.logUpdate).toHaveBeenCalledWith(pre, post, expect.any(Object));
  });

  it('emits a WebSocket UPDATED event', async () => {
    const entity = mockTestRun();
    mockRepo.findOne.mockResolvedValue(entity);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 0, analysisEndOffset: 0 });

    expect(mockGateway.emitTestRunUpdated).toHaveBeenCalled();
  });

  it('writes only the target run when applyToAll is not set', async () => {
    const entity = mockTestRun();
    mockRepo.findOne.mockResolvedValue(entity);

    const result = await handler.execute({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60 });

    expect(mockRepo.find).not.toHaveBeenCalled();
    expect(result.affectedTestRunIds).toEqual(['run-001']);
  });

  it('writes every sibling of the same system/environment/workload when applyToAll is set', async () => {
    const entity = mockTestRun({
      systemUnderTestId: 'sut-1',
      testEnvironment: 'acc',
      workload: 'loadtest',
    });
    mockRepo.findOne.mockResolvedValue(entity);
    mockRepo.find.mockResolvedValue([
      entity,
      mockTestRun({ id: 'uuid-2', testRunId: 'run-002' }),
      mockTestRun({ id: 'uuid-3', testRunId: 'run-003' }),
    ]);

    const result = await handler.execute({
      id: 'uuid-1',
      analysisStartOffset: 30,
      analysisEndOffset: 60,
      applyToAll: true,
    });

    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { systemUnderTestId: 'sut-1', testEnvironment: 'acc', workload: 'loadtest' },
    });
    // Scoped by the ids that were read, not by (sut, environment, workload) again.
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('id = ANY'),
      [30, 60, ['uuid-1', 'uuid-2', 'uuid-3']],
    );
    // One audit entry per mutated run, not just the target.
    expect(mockAudit.logUpdate).toHaveBeenCalledTimes(3);
    expect(result.affectedTestRunIds).toEqual(['run-001', 'run-002', 'run-003']);
  });

  it('gives each sibling an audit "after" the AuditService can actually diff', async () => {
    // Two failure modes this guards, both silent in production:
    //  1. a plain `{ ...before }` has constructor Object, so getAuditableFields returns
    //     null and the row is written with action+actor only, no diff.
    //  2. rampUp/rampDown are COLUMN names; the entity properties are
    //     analysisStartOffset/analysisEndOffset, and those are what auditableFields lists.
    //     Writing the column names leaves the audited fields at their old values.
    const target = mockTestRun({ analysisStartOffset: 0, analysisEndOffset: 0 });
    const sibling = mockTestRun({ id: 'uuid-2', testRunId: 'run-002', analysisStartOffset: 0, analysisEndOffset: 0 });
    mockRepo.findOne.mockResolvedValue(target);
    mockRepo.find.mockResolvedValue([target, sibling]);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60, applyToAll: true });

    const siblingCall = mockAudit.logUpdate.mock.calls.find(([before]) => before.id === 'uuid-2');
    expect(siblingCall).toBeDefined();
    const [before, after] = siblingCall!;

    // (1) prototype survives, so the field list resolves the way dispatch resolves it.
    const auditable = getAuditableFields(after.constructor as never);
    expect(auditable).not.toBeNull();

    // (2) the audited properties actually moved, so the diff is non-empty.
    expect(after.analysisStartOffset).toBe(30);
    expect(after.analysisEndOffset).toBe(60);
    expect(before.analysisStartOffset).toBe(0);
    const changed = (auditable as readonly string[]).filter(
      (f) => (before as Record<string, unknown>)[f] !== (after as Record<string, unknown>)[f],
    );
    expect(changed).toEqual(expect.arrayContaining(['analysisStartOffset', 'analysisEndOffset']));
  });
});
