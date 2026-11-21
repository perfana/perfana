// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { AgentComments1831000000000, COMMENT_AUTHOR_KIND_CHECK_VALUES } from '../migrations/1831000000000-AgentComments';
import { COMMENT_AUTHOR_KINDS } from '../../constants/comment-cards';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new AgentComments1831000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('AgentComments (1831)', () => {
  it('keeps the author_kind CHECK equal to COMMENT_AUTHOR_KINDS', () => {
    expect([...COMMENT_AUTHOR_KIND_CHECK_VALUES]).toEqual([...COMMENT_AUTHOR_KINDS]);
  });

  it("adds author_kind NOT NULL DEFAULT 'user' with its CHECK", async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain("author_kind character varying(16) NOT NULL DEFAULT ''user''");
    const check = sql.match(/ck_test_run_comments_author_kind CHECK \(([^)]*)\)/)?.[1] ?? '';
    expect([...check.matchAll(/''([a-z]+)''/g)].map((m) => m[1])).toEqual([...COMMENT_AUTHOR_KINDS]);
  });

  it('adds client_ref with a partial unique index per run and author', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('client_ref character varying(64)');
    expect(sql).toMatch(/uq_test_run_comments_client_ref\s+ON public\.test_run_comments \(test_run_id, author_id, client_ref\) WHERE client_ref IS NOT NULL/);
  });

  it('drops everything on down', async () => {
    const sql = await sqlOf('down');
    expect(sql).toContain('DROP INDEX IF EXISTS public.uq_test_run_comments_client_ref');
    expect(sql).toContain('DROP COLUMN IF EXISTS client_ref');
    expect(sql).toContain('DROP COLUMN IF EXISTS author_kind');
  });

  it.each(['up', 'down'] as const)('bounds its lock wait and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
