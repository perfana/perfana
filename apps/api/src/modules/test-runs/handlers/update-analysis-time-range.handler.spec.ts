import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  UpdateAnalysisTimeRangeHandler,
  offsetsFitRun,
  partitionAnalysisTimeRangeScope,
} from './update-analysis-time-range.handler';
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

  // ---- Finding 5: the write honours the partition -------------------------------
  //
  // The partition is only worth computing if the UPDATE is bound to it. Writing the
  // whole workload and reporting a `skipped` list would be worse than not partitioning
  // at all: the caller is told a run was left alone while its offsets moved anyway.
  describe('applyToAll write scope', () => {
    const sibling = (overrides: Record<string, unknown>) =>
      mockTestRun({ organizationId: 'org-1', teamId: 'team-1', duration: 3600, ...overrides });

    const mixedWorkload = () => {
      const target = sibling({ id: 'uuid-1', testRunId: 'run-001' });
      const candidates = [
        target,
        sibling({ id: 'uuid-2', testRunId: 'run-002' }),
        sibling({ id: 'uuid-3', testRunId: 'run-003', completed: false }),
        sibling({ id: 'uuid-4', testRunId: 'run-004', organizationId: 'org-2' }),
        sibling({ id: 'uuid-5', testRunId: 'run-005', duration: 60 }),
      ];
      mockRepo.findOne.mockResolvedValue(target);
      mockRepo.find.mockResolvedValue(candidates);
      return { target, candidates };
    };

    it('updates only the applicable ids, never the whole workload', async () => {
      mixedWorkload();

      await handler.execute({
        id: 'uuid-1',
        analysisStartOffset: 30,
        analysisEndOffset: 60,
        applyToAll: true,
      });

      expect(mockDataSource.query).toHaveBeenCalledTimes(1);
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('id = ANY'),
        [30, 60, ['uuid-1', 'uuid-2']],
      );
    });

    it('returns every skipped run with its reason', async () => {
      mixedWorkload();

      const result = await handler.execute({
        id: 'uuid-1',
        analysisStartOffset: 30,
        analysisEndOffset: 60,
        applyToAll: true,
      });

      expect(result.affectedTestRunIds).toEqual(['run-001', 'run-002']);
      expect(result.skipped).toEqual([
        { testRunId: 'run-003', completed: false, skipped: 'running' },
        { testRunId: 'run-004', completed: true, skipped: 'not-writable' },
        { testRunId: 'run-005', completed: true, skipped: 'too-short' },
      ]);
    });

    it('audits only the runs it wrote', async () => {
      mixedWorkload();

      await handler.execute({
        id: 'uuid-1',
        analysisStartOffset: 30,
        analysisEndOffset: 60,
        applyToAll: true,
      });

      expect(mockAudit.logUpdate).toHaveBeenCalledTimes(2);
      expect(mockAudit.logUpdate.mock.calls.map(([before]) => before.id)).toEqual([
        'uuid-1',
        'uuid-2',
      ]);
    });

    it('reports only the completed runs it wrote as needing a rollup', async () => {
      // completedTestRunIds drives enqueueTransactionStatsRollup. A skipped run must not
      // appear there — its numbers were never recomputed, so re-rolling it would rebuild
      // the SAME window at real cost.
      const target = sibling({ id: 'uuid-1', testRunId: 'run-001', completed: false });
      mockRepo.findOne.mockResolvedValue(target);
      mockRepo.find.mockResolvedValue([
        target,
        sibling({ id: 'uuid-2', testRunId: 'run-002' }),
        sibling({ id: 'uuid-3', testRunId: 'run-003', completed: false }),
      ]);

      const result = await handler.execute({
        id: 'uuid-1',
        analysisStartOffset: 30,
        analysisEndOffset: 60,
        applyToAll: true,
      });

      // The target is applicable even though it is running, so it IS written...
      expect(result.affectedTestRunIds).toEqual(['run-001', 'run-002']);
      // ...but it has no rollup to refresh.
      expect(result.completedTestRunIds).toEqual(['run-002']);
    });

    it('returns an empty skipped list when the whole workload is applicable', async () => {
      const target = sibling({ id: 'uuid-1', testRunId: 'run-001' });
      mockRepo.findOne.mockResolvedValue(target);
      mockRepo.find.mockResolvedValue([target, sibling({ id: 'uuid-2', testRunId: 'run-002' })]);

      const result = await handler.execute({
        id: 'uuid-1',
        analysisStartOffset: 30,
        analysisEndOffset: 60,
        applyToAll: true,
      });

      expect(result.skipped).toEqual([]);
      expect(result.completedTestRunIds).toEqual(['run-001', 'run-002']);
    });
  });
});

// ---------------------------------------------------------------------------------
// Finding 4: the scope partition is pure, exported, and shared by the preview endpoint
// and the write. Two implementations would drift, and the drift is invisible — the
// dialog would promise a count the write does not honour.
// ---------------------------------------------------------------------------------

describe('offsetsFitRun', () => {
  it('fits when the run is longer than the two exclusions combined', () => {
    expect(offsetsFitRun(3600, 300, 300)).toBe(true);
  });

  it('does NOT fit when the two exclusions exactly consume the run', () => {
    // The boundary is the whole point. [start+30, end-60] on a 90s run is an EMPTY
    // window, not a degenerate-but-usable one: every sample is excluded, statistics come
    // out empty, and ADAPT reports INSUFFICIENT_DATA against a run that plainly has data.
    // `>` not `>=`.
    expect(offsetsFitRun(90, 30, 60)).toBe(false);
  });

  it('does not fit when the exclusions overrun the run', () => {
    expect(offsetsFitRun(60, 30, 60)).toBe(false);
  });

  it('fits by one second past the boundary', () => {
    expect(offsetsFitRun(91, 30, 60)).toBe(true);
  });

  it('fits when no offsets are requested', () => {
    expect(offsetsFitRun(3600, 0, 0)).toBe(true);
  });

  it('treats a run with no recorded duration as applicable', () => {
    // Refusing on missing data would exclude runs that are probably fine, and the
    // pipeline's own "analyse the whole run" fallback still covers it.
    expect(offsetsFitRun(null, 300, 300)).toBe(true);
    expect(offsetsFitRun(undefined, 300, 300)).toBe(true);
  });
});

describe('partitionAnalysisTimeRangeScope', () => {
  const run = (overrides: Record<string, unknown>) =>
    ({
      id: 'uuid-x',
      testRunId: 'run-x',
      completed: true,
      duration: 3600,
      organizationId: 'org-1',
      teamId: 'team-1',
      ...overrides,
    }) as never;

  const target = run({ id: 'uuid-1', testRunId: 'run-001' });

  it('always includes the target, even when it is still running', () => {
    // The user edited THAT run. Refusing it would make the single-run and bulk paths
    // disagree about the same click.
    const running = run({ id: 'uuid-1', testRunId: 'run-001', completed: false });
    const { applicable, skipped } = partitionAnalysisTimeRangeScope([running], running, 30, 60);

    expect(applicable.map((r) => r.testRunId)).toEqual(['run-001']);
    expect(skipped).toEqual([]);
  });

  it('always includes the target, even when the offsets do not fit it', () => {
    const short = run({ id: 'uuid-1', testRunId: 'run-001', duration: 10 });
    const { applicable, skipped } = partitionAnalysisTimeRangeScope([short], short, 30, 60);

    expect(applicable.map((r) => r.testRunId)).toEqual(['run-001']);
    expect(skipped).toEqual([]);
  });

  it('skips a sibling in another organization as not-writable', () => {
    // The caller proved write permission on the target's (org, team) pair only; RLS is a
    // coarse backstop that grants modify to any org member.
    const sibling = run({ id: 'uuid-2', testRunId: 'run-002', organizationId: 'org-2' });
    const { applicable, skipped } = partitionAnalysisTimeRangeScope([target, sibling], target, 30, 60);

    expect(applicable.map((r) => r.testRunId)).toEqual(['run-001']);
    expect(skipped).toEqual([{ testRunId: 'run-002', completed: true, skipped: 'not-writable' }]);
  });

  it('skips a sibling on another team as not-writable', () => {
    // team_id is a per-row nullable column, NOT derived from the system under test, so a
    // workload can span teams.
    const sibling = run({ id: 'uuid-2', testRunId: 'run-002', teamId: 'team-2' });
    const { applicable, skipped } = partitionAnalysisTimeRangeScope([target, sibling], target, 30, 60);

    expect(applicable.map((r) => r.testRunId)).toEqual(['run-001']);
    expect(skipped).toEqual([{ testRunId: 'run-002', completed: true, skipped: 'not-writable' }]);
  });

  it('skips a sibling that has not completed as running', () => {
    // MetricsPipeline bakes ds_metrics.ramp_up at INGESTION, so moving the offsets
    // mid-run leaves rows flagged under two different settings.
    const sibling = run({ id: 'uuid-2', testRunId: 'run-002', completed: false });
    const { applicable, skipped } = partitionAnalysisTimeRangeScope([target, sibling], target, 30, 60);

    expect(applicable.map((r) => r.testRunId)).toEqual(['run-001']);
    expect(skipped).toEqual([{ testRunId: 'run-002', completed: false, skipped: 'running' }]);
  });

  it('skips a sibling shorter than the two exclusions as too-short', () => {
    const sibling = run({ id: 'uuid-2', testRunId: 'run-002', duration: 90 });
    const { applicable, skipped } = partitionAnalysisTimeRangeScope([target, sibling], target, 30, 60);

    expect(applicable.map((r) => r.testRunId)).toEqual(['run-001']);
    expect(skipped).toEqual([{ testRunId: 'run-002', completed: true, skipped: 'too-short' }]);
  });

  it('keeps a sibling with no recorded duration', () => {
    const noDuration = run({ id: 'uuid-2', testRunId: 'run-002', duration: null });
    const undef = run({ id: 'uuid-3', testRunId: 'run-003', duration: undefined });
    const { applicable, skipped } = partitionAnalysisTimeRangeScope(
      [target, noDuration, undef],
      target,
      30,
      60,
    );

    expect(applicable.map((r) => r.testRunId)).toEqual(['run-001', 'run-002', 'run-003']);
    expect(skipped).toEqual([]);
  });

  it('reports not-writable ahead of the other reasons for a sibling that is both', () => {
    // Ordering matters for the message the user sees: "on another team" is actionable,
    // "still running" would be a lie about a run they cannot touch either way.
    const sibling = run({
      id: 'uuid-2',
      testRunId: 'run-002',
      organizationId: 'org-2',
      completed: false,
      duration: 10,
    });
    const { skipped } = partitionAnalysisTimeRangeScope([target, sibling], target, 30, 60);

    expect(skipped).toEqual([{ testRunId: 'run-002', completed: false, skipped: 'not-writable' }]);
  });

  it('partitions a mixed workload in one pass', () => {
    const candidates = [
      target,
      run({ id: 'uuid-2', testRunId: 'run-002' }),
      run({ id: 'uuid-3', testRunId: 'run-003', completed: false }),
      run({ id: 'uuid-4', testRunId: 'run-004', organizationId: 'org-2' }),
      run({ id: 'uuid-5', testRunId: 'run-005', duration: 60 }),
    ];

    const { applicable, skipped } = partitionAnalysisTimeRangeScope(candidates, target, 30, 60);

    expect(applicable.map((r) => r.testRunId)).toEqual(['run-001', 'run-002']);
    expect(skipped.map((s) => [s.testRunId, s.skipped])).toEqual([
      ['run-003', 'running'],
      ['run-004', 'not-writable'],
      ['run-005', 'too-short'],
    ]);
    // Every candidate is accounted for exactly once — nothing is silently dropped.
    expect(applicable.length + skipped.length).toBe(candidates.length);
  });
});
