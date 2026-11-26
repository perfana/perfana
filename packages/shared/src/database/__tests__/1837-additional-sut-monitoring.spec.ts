// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { AdditionalSutMonitoring1837000000000 } from '../migrations/1837000000000-AdditionalSutMonitoring';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new AdditionalSutMonitoring1837000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('AdditionalSutMonitoring (1837)', () => {
  it('adds a nullable jsonb column with no default, so the ADD COLUMN is catalog-only', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('ALTER TABLE public.test_runs ADD COLUMN IF NOT EXISTS additional_sut_monitoring jsonb;');
    expect(sql).not.toMatch(/additional_sut_monitoring jsonb (NOT NULL|DEFAULT)/);
  });

  it('drops the column on down', async () => {
    expect(await sqlOf('down')).toContain('DROP COLUMN IF EXISTS additional_sut_monitoring');
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
