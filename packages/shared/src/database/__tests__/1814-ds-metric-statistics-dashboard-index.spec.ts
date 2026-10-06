// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, ormconfig.ts and apps/api/src/data-source.ts —
// a compiled *.spec.js there gets require()d as a migration and dies on describe().
import { AddDsMetricStatisticsDashboardIndex1814000000000 as M } from '../migrations/1814000000000-AddDsMetricStatisticsDashboardIndex';

const run = async (direction: 'up' | 'down'): Promise<string[]> => {
  const queries: string[] = [];
  const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
  await new M()[direction](runner as never);
  return queries;
};

describe('migration 1814 — ds_metric_statistics (application_dashboard_id)', () => {
  it('creates the one index the hasData probe needs, idempotently', async () => {
    const queries = await run('up');

    expect(queries).toHaveLength(1);
    const sql = queries[0]!;
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_ds_metric_statistics_app_dashboard/i);
    expect(sql).toMatch(/ON\s+public\.ds_metric_statistics\s*\(application_dashboard_id\)/i);
  });

  it('builds it plainly, inside the migration transaction', async () => {
    const [sql] = await run('up');

    // CONCURRENTLY cannot run inside a transaction, and the COMMIT escape that would let it
    // ends the whole migration batch (see 1813, which pays that price deliberately for a
    // hypertable). This table is not a hypertable, so none of 1813's per-chunk machinery
    // applies and a plain build that fails fast is safe.
    expect(sql).not.toMatch(/CONCURRENTLY/i);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
    // Not a covering index: the probe stops at the first row per id, so there is nothing
    // for an index-only scan's heap fetches to save.
    expect(sql).not.toMatch(/\bINCLUDE\b/i);
  });

  // The lock discipline is the load-bearing half, and it is 1809's on this same table —
  // not 1807's, which has no long-running writer. CREATE INDEX needs SHARE, the statistics
  // pipelines hold ROW EXCLUSIVE for up to AGGREGATION_STATEMENT_TIMEOUT_MS (540 s), and
  // Postgres' lock queue is FIFO, so an unbounded wait parks a SHARE request in front of
  // every writer that arrives behind it — for minutes, with the whole batch transaction
  // open. Nothing stops the worker during a migration.
  it.each(['up', 'down'] as const)('bounds the %s lock wait and retries instead of queueing', async (dir) => {
    const [sql] = await run(dir);

    expect(sql).toMatch(/set_config\('lock_timeout',\s*'3s',\s*true\)/i);
    expect(sql).toMatch(/EXCEPTION WHEN lock_not_available/i);
    expect(sql).toMatch(/pg_sleep\(3\)/i);
    expect(sql).toMatch(/attempt >= 10/i);
    // The bound is useless if the failure is swallowed: TypeORM only records a migration
    // whose up() resolved, so throwing is what makes the next deploy retry for free.
    expect(sql).toMatch(/RAISE EXCEPTION/i);
  });

  it('drops it by the same name, idempotently', async () => {
    const queries = await run('down');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/DROP INDEX IF EXISTS\s+idx_ds_metric_statistics_app_dashboard/i);
  });

  it('names itself exactly as its filename, or TypeORM records the wrong row', async () => {
    expect(new M().name).toBe('AddDsMetricStatisticsDashboardIndex1814000000000');
  });
});
