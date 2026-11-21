// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { StoryReads1834000000000 } from '../migrations/1834000000000-StoryReads';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new StoryReads1834000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('StoryReads (1834)', () => {
  it('creates the read table keyed (user, story), cascading from the story, with story_id indexed', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.test_run_story_reads');
    expect(sql).toContain('story_id uuid NOT NULL REFERENCES public.test_run_stories(id) ON DELETE CASCADE');
    expect(sql).toContain('PRIMARY KEY (user_id, story_id)');
    // Root CLAUDE.md #57: the PK leads on user_id, so the FK's parent-side check needs its own index.
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_test_run_story_reads_story\s+ON public\.test_run_story_reads \(story_id\)/);
  });

  it('lets a user see and write only their own read rows', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY rls_test_run_story_reads_own ON public.test_run_story_reads FOR ALL');
    expect(sql).toMatch(/WITH CHECK \(user_id = public\.current_user_id\(\)/);
  });

  it('adds activity_at once, with a default, and backfills it only when it was added', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('ADD COLUMN activity_at timestamp with time zone NOT NULL DEFAULT now()');
    expect(sql.indexOf("column_name = 'activity_at'")).toBeLessThan(sql.indexOf('ADD COLUMN activity_at'));
    expect(sql).toContain("CASE WHEN status = 'published' THEN COALESCE(published_at, updated_at) ELSE updated_at END");
  });

  it('drops the table and the column on down', async () => {
    const sql = await sqlOf('down');
    expect(sql).toContain('DROP TABLE IF EXISTS public.test_run_story_reads');
    expect(sql).toContain('DROP COLUMN IF EXISTS activity_at');
  });

  it.each(['up', 'down'] as const)('bounds its lock wait and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
