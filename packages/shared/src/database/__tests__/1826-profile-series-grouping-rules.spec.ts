// Outside src/database/migrations on purpose: that directory is globbed as migrations, and a
// compiled *.spec.js there is require()d as one (see 1819's spec).
import { ProfileSeriesGroupingRules1826000000000 as M } from '../migrations/1826000000000-ProfileSeriesGroupingRules';
import { SERIES_GROUPING_AGGREGATIONS } from '../../utils/series-grouping';

const run = async (direction: 'up' | 'down'): Promise<string> => {
  const queries: string[] = [];
  const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
  await new M()[direction](runner as never);
  return queries.join('\n');
};

describe('migration 1826 — profile series grouping rules', () => {
  it('is safe to repeat: every create and add is IF NOT EXISTS, every drop IF EXISTS', async () => {
    const sql = await run('up');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.profile_series_grouping_rules/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS profile_rule_id uuid NULL;/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_series_grouping_rules_profile_rule/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_origin/);
  });

  // NULLs never collide in a plain btree unique, so two "all panels" rules would coexist.
  it('makes (profile dashboard, panel) unique with NULLS NOT DISTINCT', async () => {
    expect(await run('up')).toMatch(
      /uq_profile_series_grouping_rules_slot UNIQUE NULLS NOT DISTINCT \(profile_dashboard_id, panel_id\)/,
    );
  });

  // A SUT export carries profile_rule_id into environments where the profile rule does not exist.
  it('gives profile_rule_id no foreign key', async () => {
    const sql = await run('up');
    expect(sql).not.toMatch(/profile_rule_id[^;]*REFERENCES/);
  });

  it("widens origin to 'profile' and keeps the workload rule's aggregation CHECK", async () => {
    const sql = await run('up');
    expect(sql).toMatch(/origin IN \('manual', 'suggestion', 'copy', 'profile'\)/);
    expect(sql).toContain(`ARRAY[${SERIES_GROUPING_AGGREGATIONS.map((a) => `'${a}'`).join(', ')}]`);
  });

  // Numbered above 1791, whose COMMIT ends the batch transaction (root CLAUDE.md #64).
  it('uses no SAVEPOINT and restores lock_timeout on both exit paths', async () => {
    for (const direction of ['up', 'down'] as const) {
      const sql = await run(direction);
      expect(sql).not.toMatch(/SAVEPOINT/);
      expect(sql.match(/set_config\('lock_timeout', prev_lock_timeout, true\)/g)).toHaveLength(2);
    }
  });

  it('down() removes only unedited provisioned rows before narrowing origin back', async () => {
    const sql = await run('down');
    const del = sql.indexOf("DELETE FROM public.series_grouping_rules WHERE origin = 'profile' AND updated_by IS NULL");
    const relabel = sql.indexOf("SET origin = 'manual' WHERE origin = 'profile'");
    const narrow = sql.indexOf("CHECK (origin IN ('manual', 'suggestion', 'copy'))");
    expect(del).toBeGreaterThan(-1);
    expect(relabel).toBeGreaterThan(del);
    expect(narrow).toBeGreaterThan(relabel);
  });
});
