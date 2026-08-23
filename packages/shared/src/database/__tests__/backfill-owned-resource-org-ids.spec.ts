// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, apps/api/src/data-source.ts and the RLS test
// harness — a compiled *.spec.js there gets require()d as a migration and dies on
// describe() ("Cannot add a test after tests have started" / "describe is not defined").
import { BackfillOwnedResourceOrgIds1796000000000 } from '../migrations/1796000000000-BackfillOwnedResourceOrgIds';

/**
 * The DB-integration behaviour (backfill correctness, lock retry, orphan guard)
 * was verified against cloned production databases; these tests pin the SHAPE of
 * the migration so refactors cannot silently drop a table, reorder the backfill
 * after the constraint, or lose the fail-loud / lock-retry / re-sweep plumbing.
 *
 * up() call layout:
 *   [0]     SET statement_timeout = 0   (bulk UPDATE must survive deploy-level timeouts)
 *   [1..3]  org backfills, one per table
 *   [4..6]  team_id best-effort backfills, one per table
 *   [7..9]  constrain DO blocks (lock → re-sweep → orphan guard → ALTER), one per table
 *   [10]    ANALYZE
 *   [11,12] RESET statement_timeout / lock_timeout (runMigrations() uses transaction:'all',
 *           so anything left set would leak into later migrations in the same deploy)
 */
const TABLES = ['check_results', 'ds_metric_collection_status', 'ds_compare_config'];

describe('BackfillOwnedResourceOrgIds1796000000000', () => {
  const makeRunner = () => ({ query: jest.fn().mockResolvedValue(undefined) });

  const upCalls = async () => {
    const qr = makeRunner();
    await new BackfillOwnedResourceOrgIds1796000000000().up(qr as never);
    return qr.query.mock.calls.map(([sql]) => sql as string);
  };

  it('up() backfills all three tables (org then team) before constraining any of them', async () => {
    const calls = await upCalls();
    expect(calls).toHaveLength(13);

    expect(calls[0]).toContain('statement_timeout');

    // org backfills, one per table — never rewriting rows that already have an org
    expect(calls[1]).toContain('UPDATE check_results');
    expect(calls[2]).toContain('UPDATE ds_metric_collection_status');
    expect(calls[3]).toContain('UPDATE ds_compare_config');
    for (const backfill of calls.slice(1, 4)) {
      expect(backfill).toContain('organization_id IS NULL');
    }

    // team backfills stay best-effort: only NULL targets, only non-NULL sources
    for (const teamFill of calls.slice(4, 7)) {
      expect(teamFill).toContain('team_id IS NULL');
      expect(teamFill).toContain('team_id IS NOT NULL');
    }

    // constrain blocks per table, only after every backfill ran
    TABLES.forEach((table, i) => {
      expect(calls[7 + i]).toContain(`'${table}'`);
      expect(calls[7 + i]).toContain('SET NOT NULL');
    });

    expect(calls[10]).toContain('ANALYZE');
    expect(calls[11]).toContain('RESET statement_timeout');
    expect(calls[12]).toContain('RESET lock_timeout');
  });

  it('up() inherits check_results org from the SUT, never from the FK-less test_run_id', async () => {
    const calls = await upCalls();
    // check_results.test_run_id has no FK — a deleted run whose id string is re-created under
    // another org would adopt the rows cross-tenant. The SUT (real FK, NOT NULL org, and the
    // service layer's per-resource authority) is the only safe parent.
    expect(calls[1]).toContain('systems_under_test');
    expect(calls[1]).not.toContain('test_runs');
    // ds_metric_collection_status.test_run_id HAS a real FK — test_runs is correct there
    expect(calls[2]).toContain('test_runs');
    // ds_compare_config falls back from dashboard to SUT
    expect(calls[3]).toContain('COALESCE');
    expect(calls[3]).toContain('application_dashboards');
    expect(calls[3]).toContain('systems_under_test');
  });

  it('up() constrain blocks lock, re-sweep, guard, then alter — surviving racing old writers', async () => {
    const calls = await upCalls();
    const constrainBlocks = calls.slice(7, 10);

    expect(constrainBlocks).toHaveLength(3);
    for (const sql of constrainBlocks) {
      // explicit lock first, so the orphan guard cannot be bypassed by a
      // concurrent NULL insert landing after its snapshot
      expect(sql).toContain('LOCK TABLE');
      expect(sql.indexOf('LOCK TABLE')).toBeLessThan(sql.indexOf('organization_id IS NULL'));
      // re-sweep under the lock
      expect(sql).toContain('UPDATE');
      // orphan guard refuses instead of pretending
      expect(sql).toContain('RAISE EXCEPTION');
      // bounded lock wait with in-plpgsql retry, deadlock losses retried like timeouts
      expect(sql).toContain('lock_timeout');
      expect(sql).toContain('lock_not_available OR deadlock_detected');
    }
  });

  it('down() only drops the constraint and never touches the backfilled data', async () => {
    const qr = makeRunner();
    await new BackfillOwnedResourceOrgIds1796000000000().down(qr as never);

    const calls = qr.query.mock.calls.map(([sql]) => sql as string);
    // fail-fast lock guard, three DROPs, reset
    expect(calls).toHaveLength(5);
    expect(calls[0]).toContain('lock_timeout');
    TABLES.forEach((table, i) => {
      expect(calls[1 + i]).toContain(
        `ALTER TABLE ${table} ALTER COLUMN organization_id DROP NOT NULL`,
      );
    });
    expect(calls[4]).toContain('RESET lock_timeout');
    for (const sql of calls) {
      expect(sql).not.toMatch(/UPDATE|DELETE/);
    }
  });
});
