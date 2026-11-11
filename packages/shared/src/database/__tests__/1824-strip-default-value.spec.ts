// Lives OUTSIDE src/database/migrations: that directory is globbed as migrations.
import { QueryRunner } from 'typeorm';
import { StripDefaultValueIfControlGroupMissing1824000000000 as M } from '../migrations/1824000000000-StripDefaultValueIfControlGroupMissing';

const run = async (dir: 'up' | 'down'): Promise<string[]> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  await (dir === 'up' ? new M().up(runner) : new M().down());
  return out;
};

describe('StripDefaultValueIfControlGroupMissing (1824)', () => {
  it('is one statement, so the disable, both updates and the enable stand or fall together', async () => {
    const sql = await run('up');
    expect(sql).toHaveLength(1);
    const body = sql[0];
    const disable = body.indexOf('DISABLE TRIGGER trigger_mark_stale_on_config_update');
    const enable = body.indexOf('ENABLE TRIGGER trigger_mark_stale_on_config_update');
    expect(disable).toBeGreaterThan(-1);
    expect(enable).toBeGreaterThan(disable);
    expect(body.slice(disable, enable).match(/UPDATE public\.ds_compare_config/g)).toHaveLength(2);
  });

  it('removes only a stored 0, from config_data and from template_base', async () => {
    const [body] = await run('up');
    expect(body).toContain("SET config_data = config_data - 'defaultValueIfControlGroupMissing'");
    expect(body).toContain("AND config_data->'defaultValueIfControlGroupMissing' = '0'::jsonb");
    expect(body).toContain("SET template_base = template_base - 'defaultValueIfControlGroupMissing'");
    expect(body).toContain("AND template_base->'defaultValueIfControlGroupMissing' = '0'::jsonb");
  });

  it('bounds the lock wait and restores lock_timeout on both exit paths', async () => {
    const [body] = await run('up');
    expect(body).toMatch(/set_config\('lock_timeout', '3s', true\)/);
    expect(body.match(/set_config\('lock_timeout', prev_lock_timeout, true\)/g)).toHaveLength(2);
  });

  it('opens no SAVEPOINT, since it runs after 1791 ends the batch transaction', async () => {
    expect([...(await run('up')), ...(await run('down'))].join('\n')).not.toMatch(/\bSAVEPOINT\b/i);
  });

  it('down() puts nothing back: a restored 0 would switch the default on', async () => {
    expect(await run('down')).toEqual([]);
  });
});
