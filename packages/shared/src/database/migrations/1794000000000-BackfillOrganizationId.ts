import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings an existing database up to the canonical ownership shape: every owned resource carries
 * an organization_id.
 *
 * Phase 4 declared organization_id NOT NULL on the owned-resource tables, but that declaration
 * only ever existed in the consolidated schema, which runs on a FRESH database. No migration
 * ever added the constraint — or the backfill — to a database that predates it. Those
 * deployments kept nullable columns and rows where the value is NULL.
 *
 * That was survivable while every org filter carried an `OR organization_id IS NULL` escape.
 * v0.2.68.7 deleted those escapes across ~35 sites, correctly reasoning that the column cannot
 * be null — true of a greenfield database, false of every older one. The rows did not go
 * anywhere; they stopped matching any filter, and lists that had always worked came back empty.
 *
 * On a greenfield database this migration finds nothing to do and is a no-op.
 *
 * WHY THIS IS DYNAMIC. A static list of tables would be easier to review, but the shape it must
 * repair is precisely the thing that differs between deployments — that is the whole defect. It
 * reads information_schema and acts only on columns that are actually nullable, so it adapts to
 * whatever the database in front of it happens to be.
 *
 * WHAT IT REFUSES TO TOUCH:
 *   audit_logs*  organization_id is legitimately nullable there (system events with no org).
 *   partitions   repaired through their parent table.
 *   hypertables  ds_metrics, transactions, virtual_users, requests_raw and requests_error carry
 *                organization_id too. They are compressed timeseries of millions of rows and a
 *                bulk UPDATE rewrites compressed chunks. They are not read by the ownership
 *                filters this repairs, so they stay out. ds_metrics has no id column either.
 *
 * WHY IT WARNS INSTEAD OF FAILING. Migrations run during service startup. A row whose parent is
 * itself null-org cannot be repaired mechanically — on a multi-org install, picking an owner
 * would hand one tenant's data to another. Refusing to start the API over that turns a partial
 * data problem into an outage, so the constraint is applied per table only where that table came
 * out clean, and everything else is reported. docs/ops/2026-08-21-org-id-backfill-runbook.md
 * covers finishing the job by hand.
 */
export class BackfillOrganizationId1794000000000 implements MigrationInterface {
  name = 'BackfillOrganizationId1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $migration$
      DECLARE
        -- Above this, a table is data rather than configuration, and repairing it at start-up
        -- costs more than the visibility it buys. Config tables are orders of magnitude smaller;
        -- anything larger is named in a warning and left to the runbook, which can do it in
        -- batches at a time of someone's choosing.
        MAX_ROWS       CONSTANT bigint := 100000;
        t              text;
        est            bigint;
        remaining      bigint;
        repaired       bigint;
        total_repaired bigint := 0;
        unfixed        text[] := ARRAY[]::text[];
        failed         text[] := ARRAY[]::text[];
        oversized      text[] := ARRAY[]::text[];
        has_timescale  boolean := to_regclass('timescaledb_information.hypertables') IS NOT NULL;
      BEGIN
        -- This runs while the worker and grafana-sync are live, and SET NOT NULL needs
        -- ACCESS EXCLUSIVE. The database default is to wait forever: the migration would queue
        -- behind an open worker transaction, every later query would queue behind the migration,
        -- and the API would never finish starting. Fail the table instead, and report it.
        PERFORM set_config('lock_timeout', '5s', true);
        -- Backstop for a table that slips under the row gate but is still slow to rewrite.
        PERFORM set_config('statement_timeout', '120s', true);

        FOR t IN
          SELECT c.table_name
            FROM information_schema.columns c
           WHERE c.table_schema = 'public'
             AND c.column_name  = 'organization_id'
             AND c.is_nullable  = 'YES'
             AND c.table_name NOT LIKE 'audit_logs%'
             AND c.table_name NOT IN (SELECT inhrelid::regclass::text FROM pg_inherits)
             AND (NOT has_timescale
                  OR c.table_name NOT IN (SELECT hypertable_name FROM timescaledb_information.hypertables))
           ORDER BY c.table_name
        LOOP
          repaired := 0;

          -- Size gate. This runs before the API listens, and the ds_* metric tables hold
          -- millions of rows on a real installation: a full-table UPDATE plus the scan that
          -- SET NOT NULL forces under ACCESS EXCLUSIVE would turn a start-up into an outage.
          -- reltuples is free; -1 means never analysed, so probe with a bounded scan that
          -- stops at the threshold rather than counting a table that might be enormous.
          SELECT reltuples::bigint INTO est
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = t;

          IF est < 0 THEN
            EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %I LIMIT %s) probe', t, MAX_ROWS + 1)
              INTO est;
          END IF;

          IF est > MAX_ROWS THEN
            oversized := oversized || format('%s (~%s rows)', t, est);
            CONTINUE;
          END IF;

          -- Each table is isolated. This runs during service startup, so one table that cannot
          -- be repaired must not abort the rest and leave the API refusing to boot: the failure
          -- is recorded and the loop continues.
          BEGIN
            -- Pattern A: inherit from the parent system under test.
            IF EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'system_under_test_id'
            ) THEN
              -- Compared as text on purpose. ds_change_points and ds_control_groups hold the same
              -- SUT id in a character varying column, and uuid = varchar has no operator — an
              -- unguarded join throws and, before this block existed, took the whole migration
              -- (and the service start) down with it.
              EXECUTE format(
                'UPDATE %I x SET organization_id = s.organization_id
                   FROM systems_under_test s
                  WHERE s.id::text = x.system_under_test_id::text
                    AND x.organization_id IS NULL
                    AND s.organization_id IS NOT NULL', t);
              GET DIAGNOSTICS repaired = ROW_COUNT;

            -- grafana_dashboards hangs off an instance, not a SUT. One Grafana dashboard can back
            -- application dashboards in different organizations, so the instance is the only
            -- unambiguous source.
            ELSIF t = 'grafana_dashboards' THEN
              EXECUTE 'UPDATE grafana_dashboards g SET organization_id = i.organization_id
                         FROM grafana_instances i
                        WHERE i.id = g.grafana_instance_id
                          AND g.organization_id IS NULL
                          AND i.organization_id IS NOT NULL';
              GET DIAGNOSTICS repaired = ROW_COUNT;
            END IF;

            total_repaired := total_repaired + repaired;

            EXECUTE format('SELECT count(*) FROM %I WHERE organization_id IS NULL', t) INTO remaining;

            IF remaining = 0 THEN
              -- Safe now, and it is what stops this recurring: the application already believes
              -- this column cannot be null.
              EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
              IF repaired > 0 THEN
                RAISE NOTICE 'organization_id: % rows repaired in %, column set NOT NULL', repaired, t;
              END IF;
            ELSE
              unfixed := unfixed || format('%s (%s rows)', t, remaining);
            END IF;
          EXCEPTION WHEN OTHERS THEN
            failed := failed || format('%s (%s)', t, SQLERRM);
          END;
        END LOOP;

        IF total_repaired > 0 THEN
          RAISE NOTICE 'organization_id backfill: % rows repaired in total', total_repaired;
        END IF;

        IF array_length(unfixed, 1) > 0 THEN
          RAISE WARNING 'organization_id still NULL, column left nullable: %. Those rows are invisible to every org-filtered list. Their parent row has no organization either, so assigning one is a decision rather than a backfill — see docs/ops/2026-08-21-org-id-backfill-runbook.md',
            array_to_string(unfixed, ', ');
        END IF;

        IF array_length(oversized, 1) > 0 THEN
          RAISE WARNING 'organization_id backfill skipped these tables as too large to repair during start-up: %. Rows in them with no organization stay invisible to org-filtered reads. Repair them deliberately, in batches, with docs/ops/2026-08-21-org-id-backfill-runbook.md.',
            array_to_string(oversized, ', ');
        END IF;

        IF array_length(failed, 1) > 0 THEN
          RAISE WARNING 'organization_id backfill could not process: %. The service still starts; those tables keep whatever they had. Investigate before assuming their lists are complete.',
            array_to_string(failed, ', ');
        END IF;
      END
      $migration$;
    `);
  }

  public async down(): Promise<void> {
    // Deliberately empty. Reverting means restoring NULLs, and which rows were NULL is exactly
    // what this migration stops recording — there is nothing left to identify them from.
    // Restoring them would also re-hide the data from every list, which is the bug itself.
    // To undo on a specific database, use the snapshot path in
    // docs/ops/2026-08-21-org-id-backfill-runbook.md, taken before the change.
  }
}
