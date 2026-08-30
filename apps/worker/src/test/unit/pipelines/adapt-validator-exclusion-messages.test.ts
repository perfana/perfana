/**
 * Regression tests for #552.
 *
 * `writeExclusionConclusions` used to branch only on `ds_control_group_statistics`,
 * so an empty control group always produced "they may have been too short or aborted"
 * — even for a baseline holding 12,370 `ds_metric_statistics` rows whose aggregation
 * had simply timed out. That message pointed the user at a remedy that cannot work.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { AdaptValidator } from '../../../pipelines/helpers/adapt/adapt-validator.js';
import type { EntityManager } from 'typeorm';
import type { Logger } from 'pino';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

/**
 * Route each query to a canned answer by matching on the SQL, so the assertions
 * don't depend on call ordering.
 */
function makeManager(metricStatCount: number): { manager: EntityManager; conclusions: unknown[][] } {
  const conclusions: unknown[][] = [];

  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM test_runs')) {
      return [{ test_run_id: 'run-3', organization_id: 'org-1', team_id: null, ramp_up: 1800, duration: 3740 }];
    }
    if (sql.includes('FROM ds_control_groups cg')) {
      return metricStatCount > 0 ? [{ control_group_id: 'run-3', metric_stat_count: metricStatCount }] : [];
    }
    if (sql.includes('FROM ds_control_groups')) {
      return [{ control_group_id: 'run-3', test_runs: ['run-1'] }];
    }
    if (sql.includes('FROM ds_control_group_statistics')) {
      return []; // the symptom: no pooled baseline stats
    }
    if (sql.includes('INSERT INTO ds_adapt_conclusion')) {
      conclusions.push(params);
      return [];
    }
    return [];
  });

  return { manager: { query } as unknown as EntityManager, conclusions };
}

const messageOf = (conclusions: unknown[][]): string =>
  JSON.parse(conclusions[0]?.[1] as string).message;

describe('writeExclusionConclusions (#552)', () => {
  let validator: AdaptValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new AdaptValidator(mockLogger);
  });

  test('does not blame the baseline when the control runs have metric statistics', async () => {
    const { manager, conclusions } = makeManager(12370);

    await validator.writeExclusionConclusions(manager, [], [], ['run-3']);

    const message = messageOf(conclusions);
    expect(message).not.toContain('too short or aborted');
    expect(message).toContain('Recalculate statistics');
  });

  test('still prefers the metrics-source explanation when control-group statistics exist', async () => {
    // `ds_control_group_statistics` having rows means the aggregation succeeded and the
    // mismatch is elsewhere — that diagnosis must win over the #552 message.
    const conclusions: unknown[][] = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM test_runs')) {
        return [{ test_run_id: 'run-3', organization_id: 'org-1', team_id: null, ramp_up: 1800, duration: 3740 }];
      }
      if (sql.includes('FROM ds_control_group_statistics')) {
        return [{ control_group_id: 'run-3', stat_count: 640 }];
      }
      if (sql.includes('FROM ds_control_groups cg')) {
        return [{ control_group_id: 'run-3', metric_stat_count: 12370 }];
      }
      if (sql.includes('FROM ds_control_groups')) {
        return [{ control_group_id: 'run-3', test_runs: ['run-1'] }];
      }
      if (sql.includes('INSERT INTO ds_adapt_conclusion')) {
        conclusions.push(params);
        return [];
      }
      return [];
    });

    await validator.writeExclusionConclusions(
      { query } as unknown as EntityManager,
      [],
      [],
      ['run-3']
    );

    const message = messageOf(conclusions);
    expect(message).toContain('different metrics sources');
    expect(message).not.toContain('Recalculate statistics');
  });

  test('still reports a genuinely empty baseline as too short or aborted', async () => {
    const { manager, conclusions } = makeManager(0);

    await validator.writeExclusionConclusions(manager, [], [], ['run-3']);

    expect(messageOf(conclusions)).toContain('too short or aborted');
  });
});
