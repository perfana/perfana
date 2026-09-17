import { describe, it, expect, vi, afterEach } from 'vitest';
import type { EntityManager } from 'typeorm';
import { applyAggregationBudget } from '../../../../pipelines/helpers/aggregation-budget.js';

/**
 * Shared by BasePipelineTypeORM.setAggregationBudget and both perf-metrics writers.
 * The env parsing is the part that has bitten before: an unparseable timeout used
 * to reach Postgres as 'NaN' and abort the transaction.
 */
const manager = () => ({ query: vi.fn().mockResolvedValue([]) }) as unknown as EntityManager & { query: ReturnType<typeof vi.fn> };

describe('applyAggregationBudget', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sets statement_timeout then work_mem, transaction-local, with the 540000 / 128MB defaults', async () => {
    vi.stubEnv('AGGREGATION_STATEMENT_TIMEOUT_MS', '');
    vi.stubEnv('AGGREGATION_WORK_MEM', '');
    const em = manager();
    await applyAggregationBudget(em);
    expect(em.query.mock.calls).toEqual([
      ['SELECT set_config($1, $2, true)', ['statement_timeout', '540000']],
      ['SELECT set_config($1, $2, true)', ['work_mem', '128MB']],
    ]);
  });

  it('honours numeric AGGREGATION_STATEMENT_TIMEOUT_MS and AGGREGATION_WORK_MEM', async () => {
    vi.stubEnv('AGGREGATION_STATEMENT_TIMEOUT_MS', '300000');
    vi.stubEnv('AGGREGATION_WORK_MEM', '256MB');
    const em = manager();
    await applyAggregationBudget(em);
    expect(em.query.mock.calls[0]?.[1]).toEqual(['statement_timeout', '300000']);
    expect(em.query.mock.calls[1]?.[1]).toEqual(['work_mem', '256MB']);
  });

  it('falls back to 540000 (never "NaN") when the timeout is not a number', async () => {
    vi.stubEnv('AGGREGATION_STATEMENT_TIMEOUT_MS', 'ten minutes');
    const em = manager();
    await applyAggregationBudget(em);
    expect(em.query.mock.calls[0]?.[1]).toEqual(['statement_timeout', '540000']);
  });
});
