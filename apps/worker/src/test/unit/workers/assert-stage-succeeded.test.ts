/**
 * Regression test for #552.
 *
 * `control-group-statistics` is registered with `softFail`, so a failed aggregation
 * returns `{ status: 'failed' }` and BullMQ still marks the job completed. The
 * orchestrator used to log "✅ Control group statistics completed" unconditionally and
 * run ADAPT against an empty baseline.
 */

import { describe, test, expect } from 'vitest';
import { assertStageSucceeded } from '../../../workers/simple-orchestrate-reevaluate-batch.js';

describe('assertStageSucceeded (#552)', () => {
  test('throws with the pipeline error when a soft-failing stage reported failure', () => {
    expect(() =>
      assertStageSucceeded('Control group statistics', {
        status: 'failed',
        message: 'Control group statistics failed',
        errors: [{ message: 'canceling statement due to statement timeout' }],
      })
    ).toThrow('Control group statistics failed: canceling statement due to statement timeout');
  });

  test('throws even when the failed result carries no error detail', () => {
    expect(() => assertStageSucceeded('Control group statistics', { status: 'failed' })).toThrow(
      'Control group statistics failed: unknown error'
    );
  });

  test('passes for a successful stage, and for a job with no return value', () => {
    expect(() => assertStageSucceeded('Control group statistics', { status: 'success' })).not.toThrow();
    expect(() => assertStageSucceeded('Control group statistics', undefined)).not.toThrow();
  });
});
