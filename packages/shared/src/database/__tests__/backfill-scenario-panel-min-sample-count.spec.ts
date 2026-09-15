// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, ormconfig.ts and apps/api/src/data-source.ts —
// a compiled *.spec.js there gets require()d as a migration and dies on describe().
import { BackfillScenarioPanelMinSampleCount1806000000000 as M } from '../migrations/1806000000000-BackfillScenarioPanelMinSampleCount';

describe('migration 1806 backfill of thresholds.minSampleCount on scenario panels', () => {
  const sql = M.SQL;

  it('targets exactly the three scenario-level panels, panel-level rows only', () => {
    expect(M.SCENARIO_PANEL_IDS).toEqual([301, 302, 303]);
    expect(sql).toContain('c.panel_id IN (301, 302, 303)');
    expect(sql).toContain('c.metric_name IS NULL');
  });

  it('is idempotent and never overwrites a user override', () => {
    // The only write is gated on the key being absent; the second run updates 0 rows
    // (verified on the dev DB: UPDATE 210, then UPDATE 0).
    expect(sql).toContain("jsonb_typeof(c.config_data->'thresholds'->'minSampleCount') IS DISTINCT FROM 'number'");
    expect(sql).toContain('\'{"minSampleCount": 1}\'::jsonb');
  });

  it('recognises a perf-test dashboard by source type OR uid prefix (imported rows have no source)', () => {
    expect(sql).toContain("ms.source_type = 'performance_test'");
    expect(sql).toContain("ad.dashboard_uid LIKE 'performance-test-metrics-%'");
    expect(sql).toContain('LEFT JOIN metrics_sources ms');
  });

  it('holds off the stale-marking trigger around the one UPDATE and has a no-op down', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new M().up({ query } as never);
    expect(query.mock.calls.map((c) => c[0])).toEqual([
      'ALTER TABLE ds_compare_config DISABLE TRIGGER trigger_mark_stale_on_config_update',
      M.SQL,
      'ALTER TABLE ds_compare_config ENABLE TRIGGER trigger_mark_stale_on_config_update',
    ]);
    await expect(new M().down()).resolves.toBeUndefined();
  });
});
