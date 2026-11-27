// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
// Value: protects=1840 adds level_parser with a constant default and its CHECK, bounded and SAVEPOINT-free; fails_when=the default, the CHECK values or the lock bound change; why_new=no spec named 1840; seam=none; no_claim=execution against Postgres (the SQL is captured, not run)
import { QueryRunner } from 'typeorm';
import { LokiLevelParser1840000000000 } from '../migrations/1840000000000-LokiLevelParser';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new LokiLevelParser1840000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('LokiLevelParser (1840)', () => {
  it('adds level_parser with a constant default and a CHECK naming the three parsers', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS level_parser character varying(10) NOT NULL DEFAULT 'none'");
    expect(sql).toContain("CHECK (level_parser IN ('none', 'json', 'logfmt'))");
  });

  it('drops the constraint before the column on down', async () => {
    const sql = await sqlOf('down');
    expect(sql.indexOf('DROP CONSTRAINT IF EXISTS ck_loki_configs_level_parser')).toBeLessThan(sql.indexOf('DROP COLUMN IF EXISTS level_parser'));
  });

  it.each(['up', 'down'] as const)('bounds its lock wait, restores lock_timeout and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql.match(/set_config\('lock_timeout', prev_lock_timeout, true\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
