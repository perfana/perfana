// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { COMMENT_TAG_CHECK_VALUES, CommentTags1829000000000 } from '../migrations/1829000000000-CommentTags';
import { COMMENT_TAGS } from '../../constants/comment-cards';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new CommentTags1829000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('CommentTags (1829)', () => {
  it('keeps the CHECK vocabulary equal to COMMENT_TAGS, in order', () => {
    // A tag the API accepts but the CHECK refuses is a 500; one the CHECK allows but the API
    // refuses is dead. A new tag is a new migration replacing ck_test_run_comments_tag.
    expect([...COMMENT_TAG_CHECK_VALUES]).toEqual([...COMMENT_TAGS]);
  });

  it('writes every tag into the emitted CHECK', async () => {
    const sql = await sqlOf('up');
    const check = sql.match(/ck_test_run_comments_tag CHECK \(([^)]*)\)/)?.[1] ?? '';
    const values = [...check.matchAll(/''([a-z-]+)''/g)].map((m) => m[1]);
    expect(values).toEqual([...COMMENT_TAGS]);
  });

  it('restricts tags to root comments', async () => {
    expect(await sqlOf('up')).toMatch(/ck_test_run_comments_tag_root CHECK \(\s*tag IS NULL OR parent_id IS NULL\s*\)/);
  });

  it('drops the column and both constraints on down', async () => {
    const sql = await sqlOf('down');
    expect(sql).toContain('DROP COLUMN IF EXISTS tag');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS ck_test_run_comments_tag_root');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS ck_test_run_comments_tag'/);
  });

  it.each(['up', 'down'] as const)('bounds its lock wait and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
