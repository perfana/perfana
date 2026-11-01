/**
 * Which runs a series grouping rule is judged against and recalculated for.
 *
 * `resolveBaselineRunIds` mirrors how ADAPT itself picks a baseline (the latest conclusion's
 * control group), and `planRecalculation` is the bulk re-evaluate partition shared with the
 * analysis-window apply.
 */

import { MAX_BULK_ANALYSIS_TIME_RANGE_RUNS } from '../test-runs/services/test-runs-mutation.service';
import { partitionWritableCompletedRuns } from '../test-runs/handlers/update-analysis-time-range.handler';
import {
  BASELINE_FALLBACK_RUN_COUNT,
  planRecalculation,
  resolveBaselineRunIds,
  type RecalculationTarget,
} from './run-scope';

const run = (overrides: Record<string, unknown>) =>
  ({
    id: 'uuid-x',
    testRunId: 'run-x',
    completed: true,
    organizationId: 'org-1',
    teamId: 'team-1',
    ...overrides,
  }) as never;

describe('partitionWritableCompletedRuns', () => {
  const target = run({ id: 'uuid-1', testRunId: 'run-001' });

  it('always keeps the target, even when it is still running', () => {
    const running = run({ id: 'uuid-1', testRunId: 'run-001', completed: false });
    const { applicable, skipped } = partitionWritableCompletedRuns([running], running);

    expect(applicable.map((r: { testRunId: string }) => r.testRunId)).toEqual(['run-001']);
    expect(skipped).toEqual([]);
  });

  it('skips a run in another organization or on another team as not-writable', () => {
    const otherOrg = run({ id: 'uuid-2', testRunId: 'run-002', organizationId: 'org-2' });
    const otherTeam = run({ id: 'uuid-3', testRunId: 'run-003', teamId: 'team-2' });
    const { applicable, skipped } = partitionWritableCompletedRuns([target, otherOrg, otherTeam], target);

    expect(applicable.map((r: { testRunId: string }) => r.testRunId)).toEqual(['run-001']);
    expect(skipped).toEqual([
      { testRunId: 'run-002', completed: true, skipped: 'not-writable' },
      { testRunId: 'run-003', completed: true, skipped: 'not-writable' },
    ]);
  });

  it('skips a run that has not completed as running, after the not-writable check', () => {
    const running = run({ id: 'uuid-2', testRunId: 'run-002', completed: false });
    const both = run({ id: 'uuid-3', testRunId: 'run-003', completed: false, organizationId: 'org-2' });
    const { skipped } = partitionWritableCompletedRuns([target, running, both], target);

    expect(skipped).toEqual([
      { testRunId: 'run-002', completed: false, skipped: 'running' },
      { testRunId: 'run-003', completed: false, skipped: 'not-writable' },
    ]);
  });

  it('knows nothing about run length: the too-short reason belongs to the analysis window', () => {
    const short = run({ id: 'uuid-2', testRunId: 'run-002', duration: 1 });
    const { applicable, skipped } = partitionWritableCompletedRuns([target, short], target);

    expect(applicable).toHaveLength(2);
    expect(skipped).toEqual([]);
  });

  it('reports skipped runs in candidate order, one entry per skipped candidate', () => {
    const candidates = [
      target,
      run({ id: 'uuid-2', testRunId: 'run-002', completed: false }),
      run({ id: 'uuid-3', testRunId: 'run-003' }),
      run({ id: 'uuid-4', testRunId: 'run-004', organizationId: 'org-2' }),
    ];
    const { applicable, skipped } = partitionWritableCompletedRuns(candidates, target);

    expect(skipped.map((s) => s.testRunId)).toEqual(['run-002', 'run-004']);
    expect(applicable.length + skipped.length).toBe(candidates.length);
  });
});

describe('resolveBaselineRunIds', () => {
  const query = jest.fn();
  const q = { query };

  beforeEach(() => query.mockReset());

  it('reads the control group of the latest conclusion', async () => {
    query.mockResolvedValueOnce([{ test_runs: ['b-1', 'b-2', 'b-3'] }]);

    await expect(resolveBaselineRunIds(q, 'run-001')).resolves.toEqual(['b-1', 'b-2', 'b-3']);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ds_adapt_conclusion/);
    expect(sql).toMatch(/ds_control_groups/);
    expect(sql).toMatch(/ORDER BY[^)]*updated_at DESC/i);
    expect(params).toEqual(['run-001']);
  });

  it('never lists the run itself as its own baseline', async () => {
    query.mockResolvedValueOnce([{ test_runs: ['run-001', 'b-1'] }]);

    await expect(resolveBaselineRunIds(q, 'run-001')).resolves.toEqual(['b-1']);
  });

  it('falls back to the most recent completed runs that started before it, when there is no conclusion', async () => {
    query
      .mockResolvedValueOnce([]) // no conclusion row at all
      .mockResolvedValueOnce([{ test_run_id: 'p-1' }, { test_run_id: 'p-2' }]);

    await expect(resolveBaselineRunIds(q, 'run-001')).resolves.toEqual(['p-1', 'p-2']);

    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/completed = true/);
    expect(sql).toMatch(/start_time <\s/);
    expect(sql).toMatch(/ORDER BY r\.start_time DESC/);
    expect(params).toEqual(['run-001', BASELINE_FALLBACK_RUN_COUNT]);
    expect(BASELINE_FALLBACK_RUN_COUNT).toBe(5);
  });

  it('does not invent a baseline when a conclusion exists but its control group is empty', async () => {
    // A conclusion with no usable baseline is a finding in itself (NO_BASELINES_FOUND):
    // substituting recent runs would show the user a baseline ADAPT never used.
    query.mockResolvedValueOnce([{ test_runs: null }]);

    await expect(resolveBaselineRunIds(q, 'run-001')).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('is bounded to the bulk cap', async () => {
    const many = Array.from({ length: MAX_BULK_ANALYSIS_TIME_RANGE_RUNS + 20 }, (_, i) => `b-${i}`);
    query.mockResolvedValueOnce([{ test_runs: many }]);

    await expect(resolveBaselineRunIds(q, 'run-001')).resolves.toHaveLength(MAX_BULK_ANALYSIS_TIME_RANGE_RUNS);
  });
});

describe('planRecalculation', () => {
  const query = jest.fn();
  const q = { query };
  const target: RecalculationTarget = {
    id: 'uuid-1',
    testRunId: 'run-001',
    completed: true,
    organizationId: 'org-1',
    teamId: 'team-1',
    systemUnderTestId: 'sut-1',
    testEnvironment: 'acc',
    workload: 'peak',
  };

  beforeEach(() => query.mockReset());

  it('baseline: the run plus its control group, newest first, canonical ids only', async () => {
    query
      .mockResolvedValueOnce([{ test_runs: ['b-1', 'b-2'] }]) // resolveBaselineRunIds
      .mockResolvedValueOnce([run({ id: 'uuid-b1', testRunId: 'b-1' }), run({ id: 'uuid-b2', testRunId: 'b-2' })]);

    const plan = await planRecalculation(q, target, 'baseline');

    expect(plan.enqueue).toEqual(['run-001', 'b-1', 'b-2']);
    expect(plan.skipped).toEqual([]);
    // The candidate read is pinned to the target's own workload: one batch job is one workload.
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/system_under_test_id = \$2/);
    expect(sql).toMatch(/workload = \$4/);
    expect(params).toEqual([['b-1', 'b-2'], 'sut-1', 'acc', 'peak']);
    for (const id of plan.enqueue) expect(id).not.toMatch(/^uuid-/);
  });

  it('reports runs that are still running or belong to another organization', async () => {
    query
      .mockResolvedValueOnce([{ test_runs: ['b-1', 'b-2', 'b-3'] }])
      .mockResolvedValueOnce([
        run({ id: 'uuid-b1', testRunId: 'b-1' }),
        run({ id: 'uuid-b2', testRunId: 'b-2', completed: false }),
        run({ id: 'uuid-b3', testRunId: 'b-3', organizationId: 'org-2' }),
      ]);

    const plan = await planRecalculation(q, target, 'baseline');

    expect(plan.enqueue).toEqual(['run-001', 'b-1']);
    expect(plan.skipped).toEqual([
      { testRunId: 'b-2', completed: false, skipped: 'running' },
      { testRunId: 'b-3', completed: true, skipped: 'not-writable' },
    ]);
  });

  it('a still-running target is reported and left out, but its baseline is still recalculated', async () => {
    // Re-evaluating a live run is wrong (its own analysis picks the rule up on completion), yet
    // the baselines it will be compared against are worth recalculating now.
    query
      .mockResolvedValueOnce([{ test_runs: ['b-1'] }])
      .mockResolvedValueOnce([run({ id: 'uuid-b1', testRunId: 'b-1' })]);

    const plan = await planRecalculation(q, { ...target, completed: false }, 'baseline');

    expect(plan.enqueue).toEqual(['b-1']);
    expect(plan.skipped).toEqual([{ testRunId: 'run-001', completed: false, skipped: 'running' }]);
  });

  it('recent: reads at most the cap, completed and not being deleted, newest first', async () => {
    query.mockResolvedValueOnce([run({ id: 'uuid-9', testRunId: 'r-9' }), run({ id: 'uuid-8', testRunId: 'r-8' })]);

    const plan = await planRecalculation(q, target, 'recent');

    expect(plan.enqueue).toEqual(['run-001', 'r-9', 'r-8']);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/completed = true/);
    expect(sql).toMatch(/deletion_status IS NULL/);
    expect(sql).toMatch(/ORDER BY r\.start_time DESC NULLS LAST/);
    expect(params).toEqual(['sut-1', 'acc', 'peak', MAX_BULK_ANALYSIS_TIME_RANGE_RUNS]);
  });

  it('recent: never lists the target twice when it is one of the newest runs', async () => {
    query.mockResolvedValueOnce([run({ id: 'uuid-1', testRunId: 'run-001' }), run({ id: 'uuid-9', testRunId: 'r-9' })]);

    const plan = await planRecalculation(q, target, 'recent');

    expect(plan.enqueue).toEqual(['run-001', 'r-9']);
  });

  it('honours MAX_BULK_ANALYSIS_TIME_RANGE_RUNS by truncating, keeping the target and the newest', async () => {
    const newest = Array.from({ length: MAX_BULK_ANALYSIS_TIME_RANGE_RUNS }, (_, i) =>
      run({ id: `uuid-n${i}`, testRunId: `n-${i}` }),
    );
    query.mockResolvedValueOnce(newest);

    const plan = await planRecalculation(q, target, 'recent');

    expect(plan.enqueue).toHaveLength(MAX_BULK_ANALYSIS_TIME_RANGE_RUNS);
    expect(plan.enqueue[0]).toBe('run-001');
    expect(plan.enqueue[1]).toBe('n-0');
    expect(plan.enqueue[MAX_BULK_ANALYSIS_TIME_RANGE_RUNS - 1]).toBe(`n-${MAX_BULK_ANALYSIS_TIME_RANGE_RUNS - 2}`);
  });
});
