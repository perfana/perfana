import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfills `organization_id` on three tables the worker and API wrote without it, then makes the
 * column NOT NULL so the omission cannot come back silently. Also best-effort backfills `team_id`
 * (nullable by design) so the RLS team arm works for legacy rows.
 *
 * `check_results`, `ds_metric_collection_status` and `ds_compare_config` are all `organization_id
 * uuid` (nullable) in `schema-sql.ts`, and several write paths never supplied a value:
 * `ChecksPipeline.saveApdexCheckResult` / `saveAggregatedCheckResult`,
 * `RequirementChecker.saveCheckResult`, the three `WorkerDatabaseService` collection-status
 * upserts, `DynatraceRepository`'s and `TestRunsMetricsService`'s ds_compare_config writes, and
 * `PerformanceTestMetricsPipeline`'s batch writer when metadata was absent. Fixed in the same
 * release as this migration.
 *
 * Why it mattered, and why nobody saw an error: `can_access_resource()` fails closed —
 *
 *     IF resource_org_id IS NULL THEN RETURN FALSE;
 *
 * so every row written this way is invisible under RLS to anyone who is not a global admin. The
 * symptom is an empty SLO/checks view, not a stack trace. (A database that had the Phase 4
 * tightening applied — e.g. by the stale 1794 migration baked into some published images — DID
 * reject the insert outright, which is how this was found.)
 *
 * Fixing the code stops new NULLs; it does not repair rows already written. Hence this backfill.
 * It is state-blind by design: nullable+NULLs → repair+constrain; already-constrained (a 1794-era
 * database) → the UPDATEs match nothing and SET NOT NULL no-ops; mixed partial states converge
 * per table; NULL rows whose parents are also org-less fail loud with an actionable message.
 *
 * Source-parent choices:
 *   - check_results inherits from `systems_under_test` (system_under_test_id is NOT NULL with a
 *     real FK, and the service layer's per-resource check reads the SUT's org). Deliberately NOT
 *     from test_runs: check_results.test_run_id has no FK, so a deleted run whose id string is
 *     later re-created under a different org would adopt the stale rows cross-tenant.
 *   - ds_metric_collection_status inherits from `test_runs` (test_run_id has a real FK here).
 *   - ds_compare_config inherits from `application_dashboards`, falling back to
 *     `systems_under_test` (both FK-guaranteed NOT NULL).
 *
 * Locking strategy (the order of operations inside setNotNull matters):
 *   1. Bulk backfill FIRST, outside any ACCESS EXCLUSIVE lock — the slow row-rewriting work
 *      happens while readers and writers still flow.
 *   2. Then, per table: take ACCESS EXCLUSIVE explicitly (3s lock_timeout, retried — a deadlock
 *      loss retries too, since acquiring three tables sequentially opposite concurrent worker
 *      transactions can raise 40P01 before 55P03), RE-RUN the backfill inside the lock to sweep
 *      rows a still-running old writer slipped in after step 1 (without this, the orphan guard
 *      reads a pre-lock snapshot and a racing NULL insert aborts the ALTER with a raw 23502
 *      instead of the curated message), THEN check for orphans, THEN alter.
 *   3. Timeouts are reset at the end: the migration image runs `runMigrations()` with TypeORM's
 *      default `transaction: "all"`, so a SET LOCAL here would otherwise leak into every later
 *      migration in the same deploy batch.
 */
export class BackfillOwnedResourceOrgIds1796000000000 implements MigrationInterface {
  name = 'BackfillOwnedResourceOrgIds1796000000000';

  /** Per-table backfill statements. Run in bulk up front, and re-run under the table lock. */
  private static readonly BACKFILL: Record<string, string> = {
    check_results: `
      UPDATE check_results c
         SET organization_id = (SELECT s.organization_id FROM systems_under_test s WHERE s.id = c.system_under_test_id)
       WHERE c.organization_id IS NULL`,
    ds_metric_collection_status: `
      UPDATE ds_metric_collection_status m
         SET organization_id = t.organization_id
        FROM test_runs t
       WHERE t.test_run_id = m.test_run_id
         AND m.organization_id IS NULL`,
    ds_compare_config: `
      UPDATE ds_compare_config d
         SET organization_id = COALESCE(
               (SELECT a.organization_id FROM application_dashboards a WHERE a.id = d.application_dashboard_id),
               (SELECT s.organization_id FROM systems_under_test s WHERE s.id = d.system_under_test_id)
             )
       WHERE d.organization_id IS NULL`,
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The bulk backfill rewrites potentially every row of check_results (no writer ever supplied
    // the column). A deployment-level statement_timeout must not kill the migration halfway.
    await queryRunner.query(`SET statement_timeout = 0`);

    // ── Bulk backfill (no exclusive locks held) ───────────────────────────
    for (const sql of Object.values(BackfillOwnedResourceOrgIds1796000000000.BACKFILL)) {
      await queryRunner.query(sql);
    }

    // team_id is nullable by design, but the RLS team arm
    // (resource_team_id = ANY(current_user_teams())) grants visibility independently of org
    // membership — a team-only member sees the SUT but zero check results unless team_id is set.
    // Best-effort, idempotent, and deliberately also covers rows whose org was already set by a
    // 1794-era image (those backfilled org but never team).
    await queryRunner.query(`
      UPDATE check_results c
         SET team_id = s.team_id
        FROM systems_under_test s
       WHERE s.id = c.system_under_test_id
         AND c.team_id IS NULL AND s.team_id IS NOT NULL`);
    await queryRunner.query(`
      UPDATE ds_metric_collection_status m
         SET team_id = t.team_id
        FROM test_runs t
       WHERE t.test_run_id = m.test_run_id
         AND m.team_id IS NULL AND t.team_id IS NOT NULL`);
    await queryRunner.query(`
      UPDATE ds_compare_config d
         SET team_id = s.team_id
        FROM systems_under_test s
       WHERE s.id = d.system_under_test_id
         AND d.team_id IS NULL AND s.team_id IS NOT NULL`);

    // ── Lock, re-sweep, guard, constrain — per table ──────────────────────
    // The retry lives in plpgsql: TypeORM runs migrations in ONE transaction, so a lock_timeout
    // error in the outer transaction would poison every later statement, while an EXCEPTION block
    // sets an implicit savepoint and can actually recover.
    const setNotNull = async (table: string) => {
      const rebackfill = BackfillOwnedResourceOrgIds1796000000000.BACKFILL[table]
        .replace(/'/g, "''");
      await queryRunner.query(`
        DO $set_not_null$
        DECLARE
          orphans bigint;
          attempt int := 0;
        BEGIN
          PERFORM set_config('lock_timeout', '3s', true);
          LOOP
            attempt := attempt + 1;
            BEGIN
              EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', '${table}');
              EXIT;
            EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
              IF attempt >= 10 THEN
                RAISE EXCEPTION
                  'could not constrain %.organization_id: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', '${table}', attempt;
              END IF;
              PERFORM pg_sleep(3);
            END;
          END LOOP;

          -- Re-sweep under the lock: rows committed by still-running old writers between the bulk
          -- backfill and this lock would otherwise bypass the orphan guard's snapshot and abort
          -- the ALTER with a raw 23502.
          EXECUTE '${rebackfill}';

          EXECUTE format('SELECT count(*) FROM %I WHERE organization_id IS NULL', '${table}')
            INTO orphans;
          IF orphans > 0 THEN
            RAISE EXCEPTION
              '%: % row(s) still have a NULL organization_id after backfill — no reachable parent carries an organization. Backfill the parent (test run / system under test) organization_id first, or delete the rows (they are invisible under RLS regardless), then retry the deploy.', '${table}', orphans;
          END IF;

          EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', '${table}');
        END
        $set_not_null$;
      `);
    };

    await setNotNull('check_results');
    await setNotNull('ds_metric_collection_status');
    await setNotNull('ds_compare_config');

    // Planner stats after the mass rewrite, and no timeout leakage into later migrations in the
    // same runMigrations() transaction.
    await queryRunner.query(`ANALYZE check_results, ds_metric_collection_status, ds_compare_config`);
    await queryRunner.query(`RESET statement_timeout`);
    await queryRunner.query(`RESET lock_timeout`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the constraint comes off. The backfilled values stay: they are correct, and a row
    // reverted to NULL would silently vanish from every non-admin's view again.
    // lock_timeout so a revert against a live system fails fast instead of queueing an ACCESS
    // EXCLUSIVE request that stalls all readers behind it.
    await queryRunner.query(`SET lock_timeout = '3s'`);
    for (const table of ['check_results', 'ds_metric_collection_status', 'ds_compare_config']) {
      await queryRunner.query(
        `ALTER TABLE ${table} ALTER COLUMN organization_id DROP NOT NULL`,
      );
    }
    await queryRunner.query(`RESET lock_timeout`);
  }
}
