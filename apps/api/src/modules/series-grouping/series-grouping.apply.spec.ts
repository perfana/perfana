/**
 * POST /series-grouping-rules/apply: re-evaluate with recalculated statistics so a rule takes effect.
 */

import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { MAX_BULK_ANALYSIS_TIME_RANGE_RUNS } from '../test-runs/services/test-runs-mutation.service';
import { ORG_A, ORG_B, RUN, makeService, type Route } from '../../test/series-grouping-insights-helpers';

// `runAfterRequestCommit` is the seam under test: capture the hook instead of running it, so a
// spec can prove nothing is enqueued before the request's transaction commits.
const hooks: Array<() => void | Promise<void>> = [];
jest.mock('../../common/db/request-em', () => ({
  ...jest.requireActual('../../common/db/request-em'),
  runAfterRequestCommit: (fn: () => void | Promise<void>) => {
    hooks.push(fn);
  },
}));

const candidate = (testRunId: string, overrides: Record<string, unknown> = {}) => ({
  id: `uuid-${testRunId}`,
  testRunId,
  completed: true,
  organizationId: ORG_A,
  teamId: null,
  ...overrides,
});

const baselineRoutes = (...candidates: ReturnType<typeof candidate>[]): Route[] => [
  [/sg:baseline \*\//, () => [{ test_runs: candidates.map((c) => c.testRunId) }]],
  [/sg:recalc-baseline-runs/, () => candidates],
];

const body = (overrides: Record<string, unknown> = {}) => ({ testRunId: 'run-001', scope: 'baseline', ...overrides }) as never;

describe('SeriesGroupingInsightsService.apply', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    hooks.length = 0;
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A re-evaluate rewrites stored statistics and verdicts for up to 100 runs: it needs
  // test-run:update on the target, exactly as the analysis-window apply does.
  describe('write capability', () => {
    it('refuses with 403 without test-run:update, and enqueues nothing', async () => {
      const { service, bullmq, authz } = makeService(baselineRoutes(candidate('base-1')));
      authz.getCapabilities.mockResolvedValue(['test-run:read']);
      await expect(service.apply(body(), 'viewer', ['user'], [ORG_A])).rejects.toThrow(ForbiddenException);
      expect(hooks).toHaveLength(0);
      expect(bullmq.reevaluateBatch).not.toHaveBeenCalled();
    });

    it('checks the capability against the target run\'s organization and team', async () => {
      const { service, authz } = makeService(baselineRoutes(candidate('base-1')));
      await service.apply(body(), 'user-1', ['user'], [ORG_A]);
      expect(authz.getCapabilities).toHaveBeenCalledWith('user-1', ['user'], RUN.organizationId, RUN.teamId ?? null);
    });

    it('lets an API-key principal through without a capability lookup', async () => {
      const { service, authz } = makeService(baselineRoutes(candidate('base-1')));
      await service.apply(body(), 'api-key:abc', [], [ORG_A]);
      expect(authz.getCapabilities).not.toHaveBeenCalled();
    });
  });

  describe('enqueueing', () => {
    it('enqueues only after the request transaction commits: nothing runs inline', async () => {
      const { service, bullmq } = makeService(baselineRoutes(candidate('base-1'), candidate('base-2')));

      const result = await service.apply(body(), 'user-1', ['user'], [ORG_A]);

      expect(result.enqueued).toEqual(['run-001', 'base-1', 'base-2']);
      expect(hooks).toHaveLength(1);
      expect(bullmq.reevaluateBatch).not.toHaveBeenCalled();

      await hooks[0]!();

      expect(bullmq.reevaluateBatch).toHaveBeenCalledTimes(1);
    });

    it('re-evaluates with recalculated statistics, checks and ADAPT, as ONE batch of canonical test_run_id strings', async () => {
      const { service, bullmq } = makeService(baselineRoutes(candidate('base-1')));

      await service.apply(body(), 'user-1', ['user'], [ORG_A]);
      await hooks[0]!();

      // One job: the orchestrator's scope lock is keyed on sut:env:workload, so a second job
      // for the workload would be refused rather than queued.
      expect(bullmq.reevaluateBatch).toHaveBeenCalledWith(['run-001', 'base-1'], {
        checks: true,
        adapt: true,
        recalculateStatistics: true,
      });
      const ids = bullmq.reevaluateBatch.mock.calls[0]![0] as string[];
      expect(ids).not.toContain(RUN.id);
      for (const id of ids) expect(id).not.toMatch(/^uuid-|^[0-9a-f]{8}-/);
    });

    it('answers with canonical ids even when the run is named by its entity UUID', async () => {
      const { service, bullmq } = makeService(baselineRoutes());

      const result = await service.apply(body({ testRunId: RUN.id }), 'user-1', ['user'], [ORG_A]);
      await hooks[0]!();

      expect(result.enqueued).toEqual(['run-001']);
      expect(bullmq.reevaluateBatch).toHaveBeenCalledWith(['run-001'], expect.any(Object));
    });

    it('a failing enqueue is logged and swallowed: the hook must never reject', async () => {
      const { service, bullmq } = makeService(baselineRoutes(candidate('base-1')));
      bullmq.reevaluateBatch.mockRejectedValueOnce(new Error('redis down'));

      await service.apply(body(), 'user-1', ['user'], [ORG_A]);

      await expect(hooks[0]!()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('run-001'), expect.anything());
    });

    it('registers no hook when there is nothing to re-evaluate', async () => {
      // A running target with no baseline: nothing is left to re-evaluate.
      const { service, bullmq } = makeService([
        ...baselineRoutes(),
        [/sg:run \*\//, () => [{ ...RUN, completed: false }]],
      ]);

      const result = await service.apply(body(), 'user-1', ['user'], [ORG_A]);

      expect(result.enqueued).toEqual([]);
      expect(result.skipped).toEqual([{ testRunId: 'run-001', completed: false, skipped: 'running' }]);
      expect(hooks).toHaveLength(0);
      expect(bullmq.reevaluateBatch).not.toHaveBeenCalled();
    });
  });

  describe('which runs', () => {
    it('reports runs that are still running or on another team or organization, and does not enqueue them', async () => {
      const { service } = makeService(
        baselineRoutes(
          candidate('base-1'),
          candidate('base-2', { completed: false }),
          candidate('base-3', { organizationId: ORG_B }),
          candidate('base-4', { teamId: 'team-2' }),
        ),
      );

      const result = await service.apply(body(), 'user-1', ['user'], [ORG_A]);

      expect(result.enqueued).toEqual(['run-001', 'base-1']);
      expect(result.skipped).toEqual([
        { testRunId: 'base-2', completed: false, skipped: 'running' },
        { testRunId: 'base-3', completed: true, skipped: 'not-writable' },
        { testRunId: 'base-4', completed: true, skipped: 'not-writable' },
      ]);
    });

    it('scope "recent" takes the workload\'s most recent completed runs', async () => {
      const { service, db } = makeService([
        [/sg:recalc-recent-runs/, () => [candidate('r-9'), candidate('r-8')]],
      ]);

      const result = await service.apply(body({ scope: 'recent' }), 'user-1', ['user'], [ORG_A]);

      expect(result.enqueued).toEqual(['run-001', 'r-9', 'r-8']);
      const q = db.calls.find((c) => /sg:recalc-recent-runs/.test(c.sql))!;
      expect(q.params).toEqual(['sut-1', 'acc', 'peak', MAX_BULK_ANALYSIS_TIME_RANGE_RUNS]);
    });

    it('honours the cap by truncating to the target and the newest runs, never refusing', async () => {
      const many = Array.from({ length: MAX_BULK_ANALYSIS_TIME_RANGE_RUNS + 50 }, (_, i) => candidate(`r-${i}`));
      const { service } = makeService([[/sg:recalc-recent-runs/, () => many]]);

      const result = await service.apply(body({ scope: 'recent' }), 'user-1', ['user'], [ORG_A]);

      expect(result.enqueued).toHaveLength(MAX_BULK_ANALYSIS_TIME_RANGE_RUNS);
      expect(result.enqueued.slice(0, 3)).toEqual(['run-001', 'r-0', 'r-1']);
    });
  });

  describe('tenancy', () => {
    it('answers 404 for a run outside the caller\'s organizations and enqueues nothing', async () => {
      const { service, bullmq } = makeService(baselineRoutes(candidate('base-1')));

      await expect(service.apply(body(), 'user-1', ['user'], [ORG_B])).rejects.toBeInstanceOf(NotFoundException);
      expect(hooks).toHaveLength(0);
      expect(bullmq.reevaluateBatch).not.toHaveBeenCalled();
    });

    it('answers 404 for an empty organization list without touching the database', async () => {
      const { service, db } = makeService(baselineRoutes());

      await expect(service.apply(body(), 'user-1', ['user'], [])).rejects.toBeInstanceOf(NotFoundException);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('lets a global admin through', async () => {
      const { service } = makeService(baselineRoutes(candidate('base-1')));

      await expect(service.apply(body(), 'user-1', ['user'], null)).resolves.toMatchObject({ enqueued: ['run-001', 'base-1'] });
    });
  });
});
