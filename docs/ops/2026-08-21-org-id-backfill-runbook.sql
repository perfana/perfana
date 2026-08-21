-- ============================================================================
-- PRODUCTION RUNBOOK
-- Restore data hidden by the null-org filter removal in v0.2.68.7
--
-- CAUSE. The NOT NULL constraint and backfill for organization_id exist ONLY in
-- 1700000000000-ConsolidatedSchema.ts, which runs on a NEW database. A
-- deployment older than that migration still has a nullable organization_id and
-- rows where it IS NULL. Those rows stayed visible through the
-- `OR organization_id IS NULL` escape in every org filter, until v0.2.68.7
-- deleted it on the premise that the column "cannot be null since Phase 4" --
-- true on greenfield, false here.
--
-- NOTHING WAS DELETED. The rows exist and are filtered out of every list.
--
-- Fastest mitigation if you want the UI back before doing any of this:
-- roll back to 0.2.68.6, which touches no data.
--
-- Run the phases in order. Do not skip 0 or 1.
-- ============================================================================


-- ============================================================================
-- PHASE 0 -- STATUS. Read-only, safe to run any time.
-- ============================================================================

-- 0.1 Can this session write through RLS?
-- These tables are FORCE ROW LEVEL SECURITY. A role without bypass reports
-- "UPDATE 0" and you will misread it as "already clean". Both false => STOP.
SELECT current_user,
       (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS is_superuser,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS can_bypass_rls;

-- 0.2 Is this database pre-Phase-4? Any row = the constraint never landed here.
SELECT table_name, is_nullable
  FROM information_schema.columns
 WHERE column_name = 'organization_id'
   AND table_schema = 'public'
   AND is_nullable = 'YES'
   AND table_name NOT LIKE 'audit_logs%'   -- intentionally nullable: system events
 ORDER BY table_name;
-- Hypertables (ds_metrics, transactions, virtual_users, requests_raw,
-- requests_error) may appear. Leave them alone -- see the note in phase 1.2.

-- 0.3 How many organizations? Decides whether the backfill is mechanical.
SELECT o.id, o.name,
       (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id) AS members,
       (SELECT count(*) FROM systems_under_test  s WHERE s.organization_id = o.id)  AS suts
  FROM organizations o
 ORDER BY o.created_at;

-- 0.4 Exactly how many rows are invisible, per table.
-- This GENERATES the count query. Copy the single output value and run it.
SELECT string_agg(
         format('SELECT %L AS table_name, count(*) AS total, count(*) FILTER (WHERE organization_id IS NULL) AS invisible FROM %I',
                table_name, table_name),
         E'\nUNION ALL ' ORDER BY table_name)
  FROM information_schema.columns
 WHERE column_name = 'organization_id'
   AND table_schema = 'public'
   AND is_nullable = 'YES'
   AND table_name NOT LIKE 'audit_logs%'
   AND table_name NOT IN (SELECT inhrelid::regclass::text FROM pg_inherits)
   AND table_name NOT IN (SELECT hypertable_name FROM timescaledb_information.hypertables);

-- 0.5 Can every orphan inherit from its parent SUT, or are parents null too?
SELECT count(*) FILTER (WHERE d.organization_id IS NULL)                                   AS null_dashboards,
       count(*) FILTER (WHERE d.organization_id IS NULL AND s.organization_id IS NOT NULL) AS fixable_from_sut,
       count(*) FILTER (WHERE d.organization_id IS NULL AND s.organization_id IS NULL)     AS parent_also_null
  FROM application_dashboards d
  JOIN systems_under_test s ON s.id = d.system_under_test_id;
-- parent_also_null > 0 => decide those SUTs' organization_id FIRST. On a
-- multi-org install that is a human decision: guessing hands one tenant's data
-- to another.


-- ============================================================================
-- PHASE 1 -- BACKUP. Do both; they serve different purposes.
-- ============================================================================

-- 1.1 Full dump. From a SHELL, not psql. This is the real safety net.
--   pg_dump -h <host> -U <user> -d <db> -Fc -f perfana-$(date +%Y%m%d-%H%M).dump
--   pg_restore -l perfana-YYYYMMDD-HHMM.dump | head    # verify it is readable

-- 1.2 In-database snapshot of only the rows being changed, so phase 5 can revert
-- exactly without a full restore.
--
-- Excluded on purpose:
--   audit_logs*  -- organization_id is legitimately nullable there
--   partitions   -- covered via their parent table
--   hypertables  -- compressed timeseries, millions of rows, and ds_metrics has
--                   no `id` column. A bulk UPDATE rewrites compressed chunks and
--                   can take the database down. They are not what the dashboard
--                   lists read, so they are out of scope for this repair.
CREATE SCHEMA IF NOT EXISTS org_backfill_backup;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.column_name = 'organization_id'
       AND c.table_schema = 'public'
       AND c.is_nullable = 'YES'
       AND c.table_name NOT LIKE 'audit_logs%'
       AND c.table_name NOT IN (SELECT inhrelid::regclass::text FROM pg_inherits)
       AND c.table_name NOT IN (SELECT hypertable_name FROM timescaledb_information.hypertables)
       AND EXISTS (SELECT 1 FROM information_schema.columns i
                    WHERE i.table_name = c.table_name AND i.table_schema = 'public'
                      AND i.column_name = 'id')
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS org_backfill_backup.%I AS SELECT id, organization_id FROM public.%I WHERE organization_id IS NULL',
      t, t);
    RAISE NOTICE 'snapshot %', t;
  END LOOP;
END $$;

-- 1.3 Confirm the snapshot is populated BEFORE changing anything.
SELECT table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM org_backfill_backup.%I', table_name),
                           false, true, '')))[1]::text::int AS rows_snapshotted
  FROM information_schema.tables
 WHERE table_schema = 'org_backfill_backup'
 ORDER BY table_name;


-- ============================================================================
-- PHASE 2 -- BACKFILL. One transaction, verified before COMMIT.
-- ============================================================================

BEGIN;

-- 2.1 Everything hanging off a SUT inherits from it (Pattern A in CLAUDE.md).
-- GENERATES the UPDATE statements. Read the output, then run it in THIS
-- transaction.
SELECT string_agg(
         format('UPDATE %I x SET organization_id = s.organization_id FROM systems_under_test s WHERE s.id = x.system_under_test_id AND x.organization_id IS NULL AND s.organization_id IS NOT NULL;',
                c1.table_name),
         E'\n' ORDER BY c1.table_name)
  FROM information_schema.columns c1
 WHERE c1.column_name = 'system_under_test_id'
   AND c1.table_schema = 'public'
   AND c1.table_name NOT LIKE 'audit_logs%'
   AND c1.table_name NOT IN (SELECT inhrelid::regclass::text FROM pg_inherits)
   AND c1.table_name NOT IN (SELECT hypertable_name FROM timescaledb_information.hypertables)
   AND EXISTS (SELECT 1 FROM information_schema.columns c2
                WHERE c2.table_name = c1.table_name AND c2.table_schema = 'public'
                  AND c2.column_name = 'organization_id' AND c2.is_nullable = 'YES');

-- 2.2 No SUT link: inherit from the row's own parent.
UPDATE grafana_dashboards g
   SET organization_id = i.organization_id
  FROM grafana_instances i
 WHERE i.id = g.grafana_instance_id
   AND g.organization_id IS NULL
   AND i.organization_id IS NOT NULL;

-- 2.3 Re-run the generated count query from 0.4 HERE, inside the transaction.
-- Expect invisible = 0 everywhere. Anything left has a null-org parent:
-- ROLLBACK, fix the parent, start again.

-- COMMIT;    -- only once the counts are 0
-- ROLLBACK;  -- otherwise


-- ============================================================================
-- PHASE 3 -- MAKE THE CODE'S PREMISE TRUE. After a clean COMMIT.
-- ============================================================================
-- Without this, production still disagrees with what the application asserts and
-- the next "this column cannot be null, delete the dead check" cleanup repeats
-- this incident. Each statement fails loudly if a NULL remains -- that is the
-- point. One line per table from 0.2, minus audit_logs and the hypertables.
--
-- ALTER TABLE application_dashboards ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE grafana_dashboards     ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE metrics_sources        ALTER COLUMN organization_id SET NOT NULL;


-- ============================================================================
-- PHASE 4 -- VERIFY IN THE APPLICATION
-- ============================================================================
-- SUT configuration view lists Grafana dashboards again.
-- Compare card dropdown shows performance-metrics dashboards again.
-- Check profiles, benchmarks and events too: the same escape was removed from
-- roughly 35 filter sites, not just dashboards.


-- ============================================================================
-- PHASE 5 -- REVERT. If the app looks worse, not better.
-- ============================================================================
-- Restores exactly the NULLs that were there and nothing else.
-- Drop phase 3's constraints first if you got that far, or this fails.
--
-- DO $$
-- DECLARE t text;
-- BEGIN
--   FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'org_backfill_backup'
--   LOOP
--     EXECUTE format('UPDATE public.%I p SET organization_id = NULL FROM org_backfill_backup.%I b WHERE b.id = p.id', t, t);
--   END LOOP;
-- END $$;
--
-- Cleanup once you are satisfied:  DROP SCHEMA org_backfill_backup CASCADE;
