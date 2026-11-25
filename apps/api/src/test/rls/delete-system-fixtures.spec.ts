/**
 * deleteSystemFixtures against a real Postgres.
 *
 * Value: protects=an RLS spec's afterAll can delete its system after the running worker hung its
 * rows off it (metrics source, dashboard, compare config, statistics); fails_when=the helper stops
 * clearing the NO ACTION children or drops the system lock; why_new=test-run-stories.spec.ts and
 * its siblings failed "Test suite failed to run" on FK_41fde009f014dff1c3f4f5396da when a worker
 * tick landed first (TODOS.md P0); seam=none; no_claim=the worker's own timing (its rows are planted).
 *
 * Runs against the local dev DB like its sibling suites; deletes what it creates.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { deleteSystemFixtures } from './delete-system-fixtures';

describe('deleteSystemFixtures against a real database', () => {
  const ds = new DataSource({ ...(AppDataSource.options as Record<string, unknown>), entities: [], migrations: [] } as never);
  const org = randomUUID();
  const sut = randomUUID();
  const ms = randomUUID();
  const ad = randomUUID();

  beforeAll(async () => {
    await ds.initialize();
    await ds.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [org, `fixtures-spec-${org.slice(0, 8)}`]);
    await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, name, description) VALUES ($1, $2, $3, 'spec')`,
      [sut, org, `fixtures-spec-sut-${sut.slice(0, 8)}`],
    );
    // What a worker tick writes for a spec's completed run, attributed as it does.
    await ds.query(
      `INSERT INTO metrics_sources (id, system_under_test_id, test_environment, source_type, display_name, organization_id, created_by)
       VALUES ($1, $2, 'acc', 'performance_test', 'Performance test', $3, 'worker-pipeline')`,
      [ms, sut, org],
    );
    await ds.query(
      `INSERT INTO application_dashboards (id, system_under_test_id, test_environment, dashboard_name, dashboard_label, organization_id, metrics_source_id, created_by)
       VALUES ($1, $2, 'acc', 'perf', 'perf', $3, $4, 'worker-pipeline')`,
      [ad, sut, org, ms],
    );
    await ds.query(
      `INSERT INTO ds_compare_config (application_dashboard_id, panel_id, config_data, system_under_test_id, test_environment, workload, organization_id, metrics_source_id, created_by)
       VALUES ($1, 1, '{}'::jsonb, $2, 'acc', 'load', $3, $4, 'worker-pipeline')`,
      [ad, sut, org, ms],
    );
    await ds.query(
      `INSERT INTO ds_metric_statistics (test_run_id, application_dashboard_id, panel_id, metrics_source_id) VALUES ('fixtures-spec-run', $1, 1, $2)`,
      [ad, ms],
    );
  });

  afterAll(async () => {
    await deleteSystemFixtures(ds, [sut]); // a no-op once the test deleted it; cleans up if it failed
    await ds.query(`DELETE FROM organizations WHERE id = $1`, [org]);
    await ds.destroy();
  });

  it('deletes a system whose worker-written rows a bare delete trips over', async () => {
    // The pre-fix cleanup: refused by the metrics source's NO ACTION key, as in the flaky suites.
    await expect(ds.query(`DELETE FROM systems_under_test WHERE id = $1`, [sut])).rejects.toThrow(/foreign key/);

    await deleteSystemFixtures(ds, [sut]);

    const left = await ds.query(
      `SELECT (SELECT count(*) FROM systems_under_test WHERE id = $1)::int AS systems,
              (SELECT count(*) FROM metrics_sources WHERE id = $2)::int AS sources,
              (SELECT count(*) FROM application_dashboards WHERE id = $3)::int AS dashboards,
              (SELECT count(*) FROM ds_compare_config WHERE application_dashboard_id = $3)::int AS configs,
              (SELECT count(*) FROM ds_metric_statistics WHERE application_dashboard_id = $3)::int AS statistics`,
      [sut, ms, ad],
    );
    expect(left[0]).toEqual({ systems: 0, sources: 0, dashboards: 0, configs: 0, statistics: 0 });
  });

  // Value: protects=the helper never deletes another system's dashboard; fails_when=dashboards are again
  // selected through the metrics source as well as the system; why_new=red-team review of the helper;
  // seam=none; no_claim=none beyond protects
  it("refuses, deleting nothing, when another system's dashboard points at the spec's metrics source", async () => {
    const otherSut = randomUUID();
    const otherAd = randomUUID();
    const mine = randomUUID();
    const myMs = randomUUID();
    await ds.query(`INSERT INTO systems_under_test (id, organization_id, name, description) VALUES ($1, $2, $3, 'spec'), ($4, $2, $5, 'spec')`,
      [mine, org, `fixtures-spec-sut-${mine.slice(0, 8)}`, otherSut, `fixtures-spec-sut-${otherSut.slice(0, 8)}`]);
    await ds.query(`INSERT INTO metrics_sources (id, system_under_test_id, test_environment, source_type, display_name, organization_id)
                    VALUES ($1, $2, 'acc', 'performance_test', 'p', $3)`, [myMs, mine, org]);
    await ds.query(`INSERT INTO application_dashboards (id, system_under_test_id, test_environment, dashboard_name, dashboard_label, organization_id, metrics_source_id)
                    VALUES ($1, $2, 'acc', 'other', 'other', $3, $4)`, [otherAd, otherSut, org, myMs]);
    try {
      await expect(deleteSystemFixtures(ds, [mine])).rejects.toThrow(/foreign key/);
      const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM application_dashboards WHERE id = $1`, [otherAd]);
      expect(n).toBe(1);
    } finally {
      await ds.query(`DELETE FROM application_dashboards WHERE id = $1`, [otherAd]);
      await deleteSystemFixtures(ds, [mine, otherSut]);
    }
  });

  it('is a no-op for no systems', async () => {
    await expect(deleteSystemFixtures(ds, [])).resolves.toBeUndefined();
  });
});
