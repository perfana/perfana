// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { StoryNotifications1832000000000 } from '../migrations/1832000000000-StoryNotifications';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new StoryNotifications1832000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('StoryNotifications (1832)', () => {
  it('adds the claim column and stamps existing stories announced only when the column is new', async () => {
    const sql = await sqlOf('up');
    const gate = sql.indexOf("column_name = 'notified_at'");
    const add = sql.indexOf('ADD COLUMN notified_at timestamp with time zone');
    const stamp = sql.indexOf('UPDATE public.test_run_stories SET notified_at = now()');
    expect(gate).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(gate);
    expect(stamp).toBeGreaterThan(add);
    expect(sql.indexOf('END IF')).toBeGreaterThan(stamp);
  });

  it('adds the retry backoff and the sweep\'s partial index, both repeatable', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS notify_after timestamp with time zone');
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_test_run_stories_unnotified\s+ON public\.test_run_stories \(published_at\)\s+WHERE status = 'published' AND notified_at IS NULL/);
  });

  it('drops the index and both columns on down', async () => {
    const sql = await sqlOf('down');
    expect(sql).toContain('DROP INDEX IF EXISTS public.idx_test_run_stories_unnotified');
    expect(sql).toContain('DROP COLUMN IF EXISTS notify_after');
    expect(sql).toContain('DROP COLUMN IF EXISTS notified_at');
  });

  it.each(['up', 'down'] as const)('bounds its lock wait and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql).toContain('set_config(\'lock_timeout\', prev_lock_timeout, true)');
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
