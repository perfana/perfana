// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { LokiApplications1839000000000 } from '../migrations/1839000000000-LokiApplications';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new LokiApplications1839000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('LokiApplications (1839)', () => {
  it('adds the columns without a rewrite: nullable, or a constant default', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS service_label character varying(100) NOT NULL DEFAULT 'service_name'");
    expect(sql).toContain('ALTER TABLE public.loki_run_patterns ADD COLUMN IF NOT EXISTS service character varying(255);');
    expect(sql).toContain('ALTER TABLE public.loki_run_samples ADD COLUMN IF NOT EXISTS service character varying(255);');
  });

  it('creates loki_run_services with RLS and a child-side FK index', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.loki_run_services (');
    expect(sql).toContain('ON public.loki_run_services (system_under_test_id)');
    for (const op of ['select', 'insert', 'update', 'delete']) expect(sql).toContain(`CREATE POLICY rls_loki_run_services_${op}`);
  });

  it.each(['up', 'down'] as const)('bounds its lock wait, restores lock_timeout and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql.match(/set_config\('lock_timeout', prev_lock_timeout, true\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
