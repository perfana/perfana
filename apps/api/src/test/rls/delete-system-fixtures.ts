import type { DataSource } from 'typeorm';

/**
 * Delete a spec's systems under test, together with everything the running worker hung off them.
 *
 * The RLS specs create systems and completed test runs in the shared dev database, and a running
 * worker (the dockerized local stack) picks those runs up on its minute tick: it writes
 * `metrics_sources`, `application_dashboards`, `ds_compare_config` and `ds_metric_statistics` rows
 * for the spec's system. Those reference the system, its metrics sources and its dashboards with
 * NO ACTION foreign keys, so a bare `DELETE FROM systems_under_test` in `afterAll` failed the suite
 * ("Test suite failed to run") whenever a tick landed first, although every test had passed.
 *
 * One transaction, in this order:
 * 1. Lock the system rows FOR UPDATE. A worker insert that references a system takes a KEY SHARE
 *    lock on it, so from here on it waits for this transaction and then fails against the deleted
 *    row, instead of slipping a new child in between the deletes below and the system's own delete.
 * 2. Delete every row that references the systems' metrics sources or dashboards through a NO ACTION
 *    or RESTRICT key, read from the catalog so a table added later is covered too; then the
 *    dashboards, the metrics sources and the remaining direct children of the system; then the
 *    systems. CASCADE children go with their parents. (No such child has NO ACTION children of
 *    its own, checked against the catalog on 2026-11-25.)
 *
 * Test runs are left to the caller, which deletes them first along with its own fixtures.
 */
export async function deleteSystemFixtures(ds: DataSource, systemIds: string[]): Promise<void> {
  if (systemIds.length === 0) return;
  await ds.transaction(async (em) => {
    await em.query(`SELECT 1 FROM systems_under_test WHERE id = ANY($1::uuid[]) FOR UPDATE`, [systemIds]);
    const msIds: string[] = (
      await em.query(`SELECT id FROM metrics_sources WHERE system_under_test_id = ANY($1::uuid[])`, [systemIds])
    ).map((r: { id: string }) => r.id);
    // The spec's own dashboards only: another system's dashboard pointing at one of these metrics
    // sources must make the delete below fail loudly, not be deleted (with its cascades) here.
    const adIds: string[] = (
      await em.query(`SELECT id FROM application_dashboards WHERE system_under_test_id = ANY($1::uuid[])`, [systemIds])
    ).map((r: { id: string }) => r.id);

    // Every NO ACTION / RESTRICT reference into the three parents, as (table, column, parent).
    const refs: Array<{ child: string; col: string; parent: string }> = await em.query(
      `SELECT c.conrelid::regclass::text AS child, a.attname AS col, c.confrelid::regclass::text AS parent
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confdeltype IN ('a', 'r')
          AND c.confrelid IN ('metrics_sources'::regclass, 'application_dashboards'::regclass, 'systems_under_test'::regclass)`,
    );
    const idsFor = (parent: string) =>
      parent === 'metrics_sources' ? msIds : parent === 'application_dashboards' ? adIds : systemIds;
    const ordered = ['application_dashboards', 'metrics_sources', 'test_runs'];
    const del = async (child: string, col: string, ids: string[]) => {
      if (ids.length === 0) return;
      // Identifiers come from the catalog, quoted by Postgres itself.
      const [{ sql }] = await em.query(`SELECT format('DELETE FROM %s WHERE %I = ANY($1::uuid[])', $1::regclass, $2::text) AS sql`, [child, col]);
      await em.query(sql, [ids]);
    };

    for (const r of refs) {
      if (!ordered.includes(r.child)) await del(r.child, r.col, idsFor(r.parent));
    }
    await del('application_dashboards', 'id', adIds);
    await del('metrics_sources', 'id', msIds);
    await em.query(`DELETE FROM systems_under_test WHERE id = ANY($1::uuid[])`, [systemIds]);
  });
}
