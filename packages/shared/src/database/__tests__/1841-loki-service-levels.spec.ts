// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
// Value: protects=1841 adds a nullable level_lines jsonb, bounded and SAVEPOINT-free; fails_when=the column type or the lock bound change; why_new=new migration; seam=none; no_claim=execution against Postgres (the SQL is captured, not run)
import { QueryRunner } from 'typeorm';
import { LokiServiceLevels1841000000000 } from '../migrations/1841000000000-LokiServiceLevels';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new LokiServiceLevels1841000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('LokiServiceLevels (1841)', () => {
  it('adds a nullable level_lines jsonb column, and drops it on down', async () => {
    expect(await sqlOf('up')).toContain('ADD COLUMN IF NOT EXISTS level_lines jsonb;');
    expect(await sqlOf('down')).toContain('DROP COLUMN IF EXISTS level_lines;');
  });

  it.each(['up', 'down'] as const)('bounds its lock wait, restores lock_timeout and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql.match(/set_config\('lock_timeout', prev_lock_timeout, true\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
