// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, apps/api/src/data-source.ts and the RLS test
// harness — a compiled *.spec.js there gets require()d as a migration and dies on
// describe() ("Cannot add a test after tests have started" / "describe is not defined").
import { AddAuditLogsDefaultPartition1797000000000 } from '../migrations/1797000000000-AddAuditLogsDefaultPartition';

/**
 * The DB behaviour (a write outside every monthly range lands in the default partition, direct
 * partition reads are deny-all, the worker role can still delete expired rows) is covered by
 * apps/api/src/test/rls/rls-audit-logs-partitions.spec.ts, which runs against a real database in
 * `npm run preflight`. These tests pin the SHAPE of the migration, where the two dangerous
 * refactors are invisible to any DB test that only ever runs up():
 *
 *  - `CREATE TABLE IF NOT EXISTS ... PARTITION OF` instead of create-or-attach. After a down()
 *    the table exists but is detached, so IF NOT EXISTS skips with a NOTICE and the migration
 *    reports success while audit_logs has no default partition at all.
 *  - down() DROPping instead of DETACHing. Since nothing creates monthly partitions any more,
 *    the default partition holds every audit row there is.
 */
describe('AddAuditLogsDefaultPartition1797000000000', () => {
  const makeRunner = () => ({ query: jest.fn().mockResolvedValue(undefined) });

  const callsFor = async (direction: 'up' | 'down') => {
    const qr = makeRunner();
    await new AddAuditLogsDefaultPartition1797000000000()[direction](qr as never);
    return qr.query.mock.calls.map(([sql]) => sql as string);
  };

  it('up() creates the default partition when absent and re-attaches it when detached', async () => {
    const [create] = await callsFor('up');

    expect(create).toContain(`to_regclass('public.audit_logs_default') IS NULL`);
    expect(create).toContain('CREATE TABLE public.audit_logs_default PARTITION OF public.audit_logs DEFAULT');
    expect(create).toContain('ATTACH PARTITION public.audit_logs_default DEFAULT');
    // The trap: IF NOT EXISTS finds a detached table by name and skips, leaving no default.
    expect(create).not.toContain('CREATE TABLE IF NOT EXISTS');
  });

  it('up() grants the default partition to both app roles', async () => {
    const calls = await callsFor('up');
    const grants = calls.filter(sql => sql.startsWith('GRANT'));

    expect(grants).toHaveLength(2);
    expect(grants[0]).toContain('perfana_app');
    expect(grants[1]).toContain('perfana_system');
    for (const grant of grants) {
      expect(grant).toContain('ON TABLE public.audit_logs_default');
    }
  });

  it('up() enables AND forces RLS on every partition, not a hardcoded list', async () => {
    const calls = await callsFor('up');
    const rlsBlock = calls.find(sql => sql.includes('ENABLE ROW LEVEL SECURITY'));

    expect(rlsBlock).toBeDefined();
    // Driven off the catalog: the month set differs per database, and a partition missed here
    // is directly readable by any role holding the schema-wide grants.
    expect(rlsBlock).toContain(`FROM pg_inherits WHERE inhparent = 'public.audit_logs'::regclass`);
    expect(rlsBlock).toContain('ENABLE ROW LEVEL SECURITY');
    // FORCE as well, or the table owner still bypasses its own policies.
    expect(rlsBlock).toContain('FORCE ROW LEVEL SECURITY');
    expect(rlsBlock).not.toMatch(/audit_logs_\d{4}_\d{2}/);
  });

  it('up() bounds the lock wait so it cannot queue in front of audit writes', async () => {
    const calls = await callsFor('up');
    const lockTimeout = calls.findIndex(sql => sql.includes('lock_timeout'));
    const rlsBlock = calls.findIndex(sql => sql.includes('ENABLE ROW LEVEL SECURITY'));

    expect(lockTimeout).toBeGreaterThanOrEqual(0);
    expect(lockTimeout).toBeLessThan(rlsBlock);
  });

  it('down() detaches and never drops — the default partition holds every audit row', async () => {
    const calls = await callsFor('down');

    expect(calls[0]).toContain('DETACH PARTITION public.audit_logs_default');
    expect(calls.join('\n')).not.toContain('DROP TABLE');
    expect(calls.join('\n')).not.toContain('DROP PARTITION');
  });

  it('down() leaves the detached rows readable', async () => {
    const calls = await callsFor('down');

    // Detaching alone preserves the rows and loses access to them: the table keeps the RLS this
    // migration enabled, no longer has the parent's policies behind it, and has none of its own.
    expect(calls.some(sql => sql.includes('DISABLE ROW LEVEL SECURITY'))).toBe(true);
    expect(calls.some(sql => sql.includes('NO FORCE ROW LEVEL SECURITY'))).toBe(true);
  });
});
