// Lives OUTSIDE src/database/migrations for the same reason as consolidated-schema-split.spec.ts:
// that directory is globbed as migrations, and a compiled *.spec.js there gets require()d as one.
import { QueryRunner } from 'typeorm';
import { AllowGeneratedReportWithoutTemplate1821000000000 } from '../migrations/1821000000000-AllowGeneratedReportWithoutTemplate';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new AllowGeneratedReportWithoutTemplate1821000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('AllowGeneratedReportWithoutTemplate (1821)', () => {
  it('drops NOT NULL on up and restores it on down', async () => {
    expect(await sqlOf('up')).toContain('ALTER COLUMN template_id DROP NOT NULL');
    expect(await sqlOf('down')).toContain('ALTER COLUMN template_id SET NOT NULL');
  });

  it.each(['up', 'down'] as const)('bounds its lock wait on %s', async (dir) => {
    // An unbounded ACCESS EXCLUSIVE wait queues every later query on the table behind it.
    const sql = await sqlOf(dir);
    expect(sql).toContain("set_config('lock_timeout', '3s', true)");
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
  });

  it.each(['up', 'down'] as const)('uses no SAVEPOINT on %s', async (dir) => {
    // A migration numbered above 1791 may run outside any transaction, where SAVEPOINT is 25P01.
    expect(await sqlOf(dir)).not.toMatch(/SAVEPOINT/i);
  });

  it('does not delete reports to make the rollback succeed', async () => {
    expect(await sqlOf('down')).not.toMatch(/DELETE|UPDATE/i);
  });
});
