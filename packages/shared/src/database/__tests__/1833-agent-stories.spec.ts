// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { AgentStories1833000000000 } from '../migrations/1833000000000-AgentStories';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new AgentStories1833000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('AgentStories (1833)', () => {
  it('adds the two nullable published_by columns', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS published_by_id character varying(255)');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS published_by_name character varying(255)');
    expect(sql).not.toMatch(/published_by_\w+ character varying\(255\) NOT NULL/);
  });

  it("lets everyone who can see the run read an agent's draft, and keeps a user's draft author-only", async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain("status = ''published'' OR author_kind = ''agent'' OR author_id = public.current_user_id()");
    expect(sql).toContain('can_access_resource(organization_id, team_id, (author_id)::text)');
  });

  it("restores 1830's SELECT policy and drops the columns on down", async () => {
    const sql = await sqlOf('down');
    expect(sql).toContain("status = ''published'' OR author_id = public.current_user_id()");
    expect(sql).not.toContain('author_kind');
    expect(sql).toContain('DROP COLUMN IF EXISTS published_by_id');
    expect(sql).toContain('DROP COLUMN IF EXISTS published_by_name');
  });

  it.each(['up', 'down'] as const)('bounds its lock wait and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
