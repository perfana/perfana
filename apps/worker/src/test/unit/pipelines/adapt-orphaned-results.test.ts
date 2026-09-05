import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EntityManager } from 'typeorm';
import { ResultsProcessor } from '../../../pipelines/helpers/adapt/results-processor.js';

/**
 * Regression cover for the stale-ADAPT-result bug.
 *
 * `processAdaptResults` is a pure `INSERT ... ON CONFLICT DO UPDATE` sourced from
 * `ds_metric_statistics`. When a user narrows a run's analysis time range,
 * StatisticsPipeline rewrites `ds_metric_statistics` from the new offsets and the
 * metrics that fall outside the window disappear from it — but their old
 * `ds_adapt_results` rows survived the upsert untouched, still labelled
 * `regression`. `buildConclusionSQL` counts every row in that table with no
 * freshness predicate, so the run stayed at REGRESSION on transactions that no
 * longer have a single sample inside the window.
 */
describe('ResultsProcessor.deleteOrphanedResults', () => {
  let processor: ResultsProcessor;
  let manager: { query: ReturnType<typeof vi.fn> };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new ResultsProcessor(logger as never);
    manager = { query: vi.fn().mockResolvedValue([[], 0]) };
  });

  const sqlOf = () => manager.query.mock.calls[0]![0] as string;
  const paramsOf = () => manager.query.mock.calls[0]![1] as unknown[];

  it('deletes results whose metric has no ds_metric_statistics row', async () => {
    manager.query.mockResolvedValue([[], 4]);

    const deleted = await processor.deleteOrphanedResults(
      manager as unknown as EntityManager,
      ['run-1', 'run-2'],
    );

    expect(deleted).toBe(4);
    expect(sqlOf()).toContain('DELETE FROM ds_adapt_results');
    expect(sqlOf()).toContain('NOT EXISTS');
    expect(sqlOf()).toContain('ds_metric_statistics');
    expect(paramsOf()).toEqual(['run-1', 'run-2']);
  });

  it('matches on the full group key, so a metric present under another panel is not deleted', async () => {
    await processor.deleteOrphanedResults(manager as unknown as EntityManager, ['run-1']);

    const sql = sqlOf();
    expect(sql).toContain('ms.test_run_id = ar.test_run_id');
    expect(sql).toContain('ms.application_dashboard_id = ar.application_dashboard_id');
    expect(sql).toContain('ms.panel_id = ar.panel_id');
    expect(sql).toContain('ms.metric_name = ar.metric_name');
  });

  it('stays inside the metric filter, so a single-metric re-analysis cannot wipe the rest', async () => {
    await processor.deleteOrphanedResults(manager as unknown as EntityManager, ['run-1'], {
      applicationDashboardId: 'dash-uuid',
      panelId: 42,
      metricName: 'checkout.duration',
    });

    const sql = sqlOf();
    expect(sql).toContain('ar.application_dashboard_id = $2');
    expect(sql).toContain('ar.panel_id = $3');
    expect(sql).toContain('ar.metric_name = $4');
    expect(paramsOf()).toEqual(['run-1', 'dash-uuid', 42, 'checkout.duration']);
  });

  it('adds no filter conditions when no metric filter is given', async () => {
    await processor.deleteOrphanedResults(manager as unknown as EntityManager, ['run-1']);

    expect(sqlOf()).not.toContain('ar.metric_name =');
    expect(paramsOf()).toEqual(['run-1']);
  });

  it('refuses to delete anything for a run that has no statistics at all', async () => {
    // "Every metric is orphaned" is not a real state — it means the statistics
    // computation produced nothing. StatisticsPipeline reaches it while returning
    // success (org-scoping drops every dashboard), its batch-wide EXISTS probe lets one
    // live run authorise deleting statistics for aged-out runs beside it, and
    // checkEmptyControlGroups cannot screen those runs out because it groups over the
    // very table that is empty. Without this guard the run loses its whole ADAPT
    // history, unrebuildable once ds_metrics has aged out.
    await processor.deleteOrphanedResults(manager as unknown as EntityManager, ['run-1']);

    const sql = sqlOf();
    const guard = sql.indexOf('AND EXISTS');
    const orphanTest = sql.indexOf('AND NOT EXISTS');
    expect(guard).toBeGreaterThan(-1);
    // The guard must be a separate whole-run probe, not the anti-join itself.
    expect(guard).toBeLessThan(orphanTest);
    expect(sql).toContain('ms_any.test_run_id = ar.test_run_id');
    // ...and it must be keyed on the run alone — adding any group-key column back would
    // collapse it into the anti-join and reopen the hole.
    const guardClause = sql.slice(guard, orphanTest);
    expect(guardClause).not.toContain('application_dashboard_id');
    expect(guardClause).not.toContain('panel_id');
    expect(guardClause).not.toContain('metric_name');
  });

  it('reports zero rather than throwing when the driver returns no row count', async () => {
    manager.query.mockResolvedValue(undefined);

    await expect(
      processor.deleteOrphanedResults(manager as unknown as EntityManager, ['run-1']),
    ).resolves.toBe(0);
  });
});
