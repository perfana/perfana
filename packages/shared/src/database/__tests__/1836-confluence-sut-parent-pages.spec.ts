// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { ConfluenceSutParentPages1836000000000 } from '../migrations/1836000000000-ConfluenceSutParentPages';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new ConfluenceSutParentPages1836000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('ConfluenceSutParentPages (1836)', () => {
  it('adds the map once, NOT NULL with a constant default so existing systems read as {}', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain(
      "ALTER TABLE public.systems_under_test ADD COLUMN IF NOT EXISTS confluence_parent_pages jsonb NOT NULL DEFAULT '{}'::jsonb",
    );
  });

  it('drops the column on down', async () => {
    expect(await sqlOf('down')).toContain('DROP COLUMN IF EXISTS confluence_parent_pages');
  });

  // Root CLAUDE.md #64: numbered above 1791, so no SAVEPOINT and a bounded lock wait that restores lock_timeout.
  it.each(['up', 'down'] as const)('bounds its lock wait, restores lock_timeout and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql.match(/set_config\('lock_timeout', prev_lock_timeout, true\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
