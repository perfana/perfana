/**
 * `scenarioMetricTime` decides where a run's single scenario-level point lands, and the only
 * thing that makes that point reach `ds_metric_statistics` is landing inside the analysis
 * window. `RAMP_UP_EXPR` (StatisticsPipeline) is the other half of the contract, so these cases
 * assert the boundary against the SAME arithmetic it uses rather than against a literal.
 */
import { describe, it, expect } from 'vitest';
import { scenarioMetricTime } from '../../../pipelines/helpers/scenario-processors.js';
import type { TestRunMetadata } from '../../../types/performance-metrics.js';

const START = new Date('2026-10-13T19:17:51.773Z');

function run(overrides: Partial<TestRunMetadata> = {}): TestRunMetadata {
  return {
    test_run_id: 'run-1',
    system_under_test_id: 'sut-1',
    test_environment: 'acc',
    workload: 'loadTest',
    start_time: START,
    ramp_up_time: 60,
    ramp_down_time: 30,
    end_time: new Date(START.getTime() + 360_000),
    completed: true,
    ...overrides,
  };
}

/** `RAMP_UP_EXPR`, in TypeScript: true means "outside the analysis window". */
function flaggedRampUp(testRun: TestRunMetadata, time: Date): boolean {
  const rampUp = testRun.ramp_up_time ?? 0;
  const rampDown = testRun.ramp_down_time ?? 0;
  const durationSeconds = (testRun.end_time!.getTime() - testRun.start_time.getTime()) / 1000;
  if (durationSeconds <= rampUp + rampDown) return false; // offsets do not fit: whole run analysed
  const offset = (time.getTime() - testRun.start_time.getTime()) / 1000;
  return offset < rampUp || (rampDown > 0 && offset > durationSeconds - rampDown);
}

describe('scenarioMetricTime', () => {
  it('lands inside the analysis window on a run with a ramp-down offset', () => {
    const testRun = run();
    const time = scenarioMetricTime(testRun);

    expect(time).toEqual(new Date(testRun.end_time!.getTime() - 30_000));
    expect(flaggedRampUp(testRun, time)).toBe(false);
  });

  it('regression: end_time itself IS flagged, which is the bug this shape exists to avoid', () => {
    const testRun = run();
    expect(flaggedRampUp(testRun, testRun.end_time!)).toBe(true);
  });

  it('stays at end_time when there is no ramp-down', () => {
    const testRun = run({ ramp_down_time: 0 });
    expect(scenarioMetricTime(testRun)).toBe(testRun.end_time);
    expect(flaggedRampUp(testRun, testRun.end_time!)).toBe(false);
  });

  it('stays at end_time when the offsets do not fit the run', () => {
    // 360s run, 300 + 120 of offsets: RAMP_UP_EXPR analyses the whole run, and subtracting the
    // ramp-down would put the point 60s before it started.
    const testRun = run({ ramp_up_time: 300, ramp_down_time: 120 });
    expect(scenarioMetricTime(testRun)).toBe(testRun.end_time);
    expect(flaggedRampUp(testRun, testRun.end_time!)).toBe(false);
  });

  it('treats a missing ramp_down_time as zero', () => {
    const testRun = run({ ramp_down_time: undefined });
    expect(scenarioMetricTime(testRun)).toBe(testRun.end_time);
  });

  it('writes the interim point at start_time while the run is live', () => {
    expect(scenarioMetricTime(run({ completed: false }))).toBe(START);
    expect(scenarioMetricTime(run({ end_time: null }))).toBe(START);
  });
});
