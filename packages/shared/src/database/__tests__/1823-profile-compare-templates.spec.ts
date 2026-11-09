// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import {
  COMPARE_TEMPLATE_KEY_SQL,
  ProfileCompareTemplates1823000000000,
} from '../migrations/1823000000000-ProfileCompareTemplates';
import { COMPARE_TEMPLATE_KEY_SQL as KEY_1822 } from '../migrations/1822000000000-CompareTemplateOwnership';

const run = async (dir: 'up' | 'down'): Promise<string[]> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new ProfileCompareTemplates1823000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out;
};

describe('ProfileCompareTemplates (1823)', () => {
  it('adds profile_id as a cascading foreign key to profiles', async () => {
    const sql = (await run('up')).join('\n');
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS profile_id uuid NULL .*REFERENCES public\.profiles\(id\) ON DELETE CASCADE/,
    );
  });

  it('keys a profile template on its profile alone, everything else on organization or install', () => {
    const [scope, ...rest] = COMPARE_TEMPLATE_KEY_SQL.split(',\n').map((t) => t.trim());
    expect(scope).toBe(
      "(CASE WHEN profile_id IS NOT NULL THEN 'profile:' || profile_id::text ELSE 'org:' || COALESCE(organization_id::text, 'install') END)",
    );
    // Only the scope term changes from 1822.
    expect(rest).toEqual(KEY_1822.split(',\n').map((t) => t.trim()).slice(1));
  });

  it('swaps the index in one statement, and only when it lacks the profile term', async () => {
    const swap = (await run('up')).find((q) => q.includes('CREATE UNIQUE INDEX'))!;
    expect(swap).toMatch(/DROP INDEX IF EXISTS public\.uq_provisioned_template_ds_compare_configs_key/);
    expect(swap).toContain("indexdef LIKE '%profile:%'");
    expect(swap).toContain('WHERE system_under_test_id IS NULL');
    // The CREATE is passed to EXECUTE as a quoted literal, so its own quotes are doubled.
    expect(swap).toContain("''profile:'' || profile_id::text");
  });

  it('takes every table lock with a bounded wait and restores lock_timeout', async () => {
    for (const q of await run('up')) {
      expect(q).toMatch(/set_config\('lock_timeout', '3s', true\)/);
      expect(q.match(/set_config\('lock_timeout', prev_lock_timeout, true\)/g)).toHaveLength(2);
    }
  });

  it('opens no SAVEPOINT in either direction, since it runs after 1791 ends the batch transaction', async () => {
    const sql = [...(await run('up')), ...(await run('down'))].join('\n');
    expect(sql).not.toMatch(/\bSAVEPOINT\b/i);
  });

  it('every DDL statement is safe to repeat', async () => {
    const sql = await run('up');
    expect(sql[0]).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(sql[1]).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(sql[2]).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_indexes/);
  });

  it('down() deletes profile templates before restoring the 1822 key, then drops the column', async () => {
    const sql = await run('down');
    expect(sql[0]).toMatch(/DELETE FROM public\.provisioned_template_ds_compare_configs WHERE profile_id IS NOT NULL/);
    expect(sql[1]).toContain("COALESCE(organization_id::text, ''install'')");
    expect(sql[1]).not.toContain('profile_id::text');
    expect(sql.join('\n')).toMatch(/DROP COLUMN IF EXISTS profile_id/);
  });

  /**
   * Value: protects=down() actually restores 1822's key before dropping profile_id;
   *   fails_when=the swap's condition is inverted, so it is skipped on a 1823-shaped index and DROP COLUMN
   *   silently drops the key index with it (Postgres drops an index whose expression uses the column);
   *   why_new=the down() case above checks the CREATE text, which is present whichever way the IF points;
   *   seam=none; no_claim=a live run (the /ship QA probe ran up/down/up on Postgres in a rolled-back transaction).
   */
  it('down() swaps only when the index HAS the profile term', async () => {
    const swap = (await run('down')).find((q) => q.includes('CREATE UNIQUE INDEX'))!;
    expect(swap).toMatch(/IF EXISTS \(SELECT 1 FROM pg_indexes/);
    expect(swap).not.toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_indexes/);
  });
});
