/**
 * ProgressReporter — the current-test-run field on a batch job.
 *
 * The orchestrator builds one reporter per batch from `testRunIds[0]` and keeps it
 * for every stage, so `testRunId` on the payload is the batch anchor, not the run
 * being worked on. `currentTestRunId` is what actually moves.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ProgressReporter } from '../../../services/ProgressReporter.js';
import type { JobProgress } from '@perfana/shared/types';

describe('ProgressReporter current test run', () => {
  let redis: { setex: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> };
  let job: { id: string; updateProgress: ReturnType<typeof vi.fn> };
  let reporter: ProgressReporter;

  /** The most recently published payload — publishProgress writes it to both sinks. */
  const lastPublished = (): JobProgress => {
    const calls = redis.setex.mock.calls;
    return JSON.parse(String(calls[calls.length - 1]?.[2])) as JobProgress;
  };

  beforeEach(() => {
    redis = { setex: vi.fn().mockResolvedValue('OK'), publish: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) };
    job = { id: '176', updateProgress: vi.fn().mockResolvedValue(undefined) };
    reporter = new ProgressReporter(
      redis as never,
      job as never,
      {
        // The batch anchor: testRunIds[0], fixed for the whole job.
        testRunId: 'SONAR-acceptatie-loadtest_perfana-00001',
        systemUnderTestId: 'sut-1',
        testEnvironment: 'acceptatie',
        workload: 'loadtest_perfana',
      },
      'reevaluate' as never,
      ['force-refetch', 'adapt-analysis']
    );
  });

  test('reports the run a looping stage is on, alongside the unchanged batch anchor', async () => {
    await reporter.startStage('force-refetch');
    await reporter.updateStageProgress(57, {
      testRunId: 'SONAR-acceptatie-loadtest_perfana-00004',
      index: 4,
      total: 7,
    });
    // completeStage publishes without waiting out the 500ms debounce.
    await reporter.completeStage();

    const p = lastPublished();
    expect(p.currentTestRunId).toBe('SONAR-acceptatie-loadtest_perfana-00004');
    expect(p.currentTestRunIndex).toBe(4);
    expect(p.totalTestRuns).toBe(7);
    // The anchor still names run 1 — which is exactly why the new field is needed.
    expect(p.testRunId).toBe('SONAR-acceptatie-loadtest_perfana-00001');
  });

  test('clears it when the next stage starts', async () => {
    await reporter.startStage('force-refetch');
    await reporter.updateStageProgress(57, {
      testRunId: 'SONAR-acceptatie-loadtest_perfana-00004',
      index: 4,
      total: 7,
    });
    await reporter.completeStage();

    // ADAPT takes the whole batch in one job. Carrying run 4 over would tell the
    // user ADAPT is working on one run when it is working on all of them.
    await reporter.startStage('adapt-analysis');

    const p = lastPublished();
    expect(p.currentTestRunId).toBeUndefined();
    expect(p.currentTestRunIndex).toBeUndefined();
    expect(p.totalTestRuns).toBeUndefined();
  });

  test('leaves it unset for a stage that never reports a run', async () => {
    await reporter.startStage('adapt-analysis');
    await reporter.completeStage();

    expect(lastPublished().currentTestRunId).toBeUndefined();
  });
});
