// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { AddLokiIntegration1838000000000 } from '../migrations/1838000000000-AddLokiIntegration';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new AddLokiIntegration1838000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

const TABLES = ['loki_configs', 'loki_stream_mappings', 'loki_queries', 'loki_run_patterns', 'loki_run_samples'];

describe('AddLokiIntegration (1838)', () => {
  it('creates the five tables idempotently, each with the four RLS policies', async () => {
    const sql = await sqlOf('up');
    for (const t of TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
      expect(sql).toContain(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`);
      for (const op of ['select', 'insert', 'update', 'delete']) expect(sql).toContain(`CREATE POLICY rls_${t}_${op}`);
    }
  });

  it('indexes every foreign key column on the child side (root CLAUDE.md #57)', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('ON public.loki_configs (grafana_instance_id)');
    expect(sql).toContain('ON public.loki_stream_mappings (loki_config_id)');
    expect(sql).toContain('ON public.loki_queries (loki_config_id)');
    expect(sql).toContain('ON public.loki_run_patterns (system_under_test_id)');
    expect(sql).toContain('ON public.loki_run_samples (system_under_test_id)');
  });

  it('drops the tables children first on down', async () => {
    const sql = await sqlOf('down');
    expect(sql.indexOf('loki_queries')).toBeLessThan(sql.indexOf('DROP TABLE IF EXISTS public.loki_configs'));
  });

  it.each(['up', 'down'] as const)('bounds its lock wait, restores lock_timeout and uses no SAVEPOINT on %s', async (dir) => {
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql.match(/set_config\('lock_timeout', prev_lock_timeout, true\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/SAVEPOINT/i);
  });
});
