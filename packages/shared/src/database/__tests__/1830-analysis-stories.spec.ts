// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { AnalysisStories1830000000000 } from '../migrations/1830000000000-AnalysisStories';
import {
  STORY_AUTHOR_KINDS,
  STORY_STATUSES,
  STORY_STEP_NOTE_MAX_LENGTH,
  STORY_SUMMARY_MAX_LENGTH,
  STORY_TITLE_MAX_LENGTH,
  suggestStoryOrder,
} from '../../constants/comment-cards';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new AnalysisStories1830000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('AnalysisStories (1830)', () => {
  it('keeps the CHECKs and widths equal to the shared constants', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain(`title character varying(${STORY_TITLE_MAX_LENGTH}) NOT NULL`);
    expect(sql).toContain(`char_length(summary) <= ${STORY_SUMMARY_MAX_LENGTH}`);
    expect(sql).toContain(`char_length(note) <= ${STORY_STEP_NOTE_MAX_LENGTH}`);
    expect(sql).toContain(`status IN (${STORY_STATUSES.map((s) => `'${s}'`).join(', ')})`);
    expect(sql).toContain(`author_kind IN (${STORY_AUTHOR_KINDS.map((s) => `'${s}'`).join(', ')})`);
  });

  it('keys steps on (story, comment), keeps positions unique per story and indexes comment_id', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('PRIMARY KEY (story_id, comment_id)');
    expect(sql).toContain('UNIQUE (story_id, position)');
    expect(sql).toMatch(/ON public\.test_run_story_steps \(comment_id\)/);
    // Deferred: an immediate check refuses every run delete (the comments cascade runs first).
    expect(sql).toMatch(/REFERENCES public\.test_run_comments\(id\) ON DELETE NO ACTION\s+DEFERRABLE INITIALLY DEFERRED/);
    expect(sql).toMatch(/REFERENCES public\.test_runs\(id\) ON DELETE CASCADE/);
  });

  it('hides another user\'s draft in the SELECT policy', async () => {
    expect(await sqlOf('up')).toMatch(/status = 'published' OR author_id = public\.current_user_id\(\)/);
  });

  it('drops both tables on down, steps first', async () => {
    const sql = await sqlOf('down');
    expect(sql.indexOf('test_run_story_steps')).toBeLessThan(sql.indexOf('DROP TABLE IF EXISTS public.test_run_stories'));
  });

  it.each(['up', 'down'] as const)('bounds its lock wait and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});

describe('suggestStoryOrder', () => {
  it('orders by tag vocabulary, untagged last, then by creation time', () => {
    const s = (id: string, tag: string | null, createdAt: string) => ({ id, tag, createdAt }) as never;
    const out = suggestStoryOrder([
      s('a', null, '2026-01-01T00:00:00Z'),
      s('b', 'root-cause', '2026-01-01T00:00:00Z'),
      s('c', 'symptom', '2026-01-02T00:00:00Z'),
      s('d', 'symptom', '2026-01-01T00:00:00Z'),
      s('e', 'action', '2026-01-01T00:00:00Z'),
    ]) as unknown as { id: string }[];
    expect(out.map((x) => x.id)).toEqual(['d', 'c', 'b', 'e', 'a']);
  });
});
