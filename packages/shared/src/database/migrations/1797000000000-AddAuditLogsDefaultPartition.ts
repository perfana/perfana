import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give audit_logs a DEFAULT partition so an audit write can never be rejected for want of
 * a partition, and put RLS on every partition so none of them is readable around the parent.
 *
 * audit_logs is RANGE-partitioned by month. The consolidated schema ships whichever months
 * existed when the dump was taken, and the worker scheduler was supposed to roll them
 * forward daily. That only works if the worker's role may CREATE in schema public, and since
 * Phase 5b the worker's pool enters every connection as `perfana_system`, which holds USAGE
 * only. So the look-ahead silently stopped and every insert past the last shipped month
 * failed with "no partition of relation audit_logs found". Observed: 0 rows for August 2026
 * on a deploy whose newest partition was 2026_07.
 *
 * A default partition removes the dependency on runtime DDL entirely — rows always land
 * somewhere. Nothing creates monthly partitions any more and retention is a DELETE
 * (AuditRetentionManager), so the default is where rows live from here on.
 *
 * If you ever hand-create a monthly partition as the owner, two things bite: a new partition
 * does NOT inherit the parent's RLS (`relrowsecurity` comes out false, and the schema-wide
 * GRANT ON ALL TABLES makes it directly readable), so it needs ENABLE + FORCE immediately; and
 * ATTACH has to full-scan audit_logs_default under ACCESS EXCLUSIVE to prove no row belongs to
 * the incoming range, which blocks audit writes for the duration.
 *
 * Greenfield deploys get this from the consolidated schema; this migration is for databases
 * that already exist.
 */
export class AddAuditLogsDefaultPartition1797000000000 implements MigrationInterface {
  name = 'AddAuditLogsDefaultPartition1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create-or-attach, not `CREATE TABLE IF NOT EXISTS ... PARTITION OF`. After a down(), the
    // table still exists but is detached, and IF NOT EXISTS would see the name taken and skip
    // with a NOTICE — leaving audit_logs with no default partition while TypeORM records the
    // migration as applied. The next write past the last monthly range would then fail exactly
    // the way this migration exists to prevent.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.audit_logs_default') IS NULL THEN
          CREATE TABLE public.audit_logs_default PARTITION OF public.audit_logs DEFAULT;
        ELSIF NOT EXISTS (
          SELECT 1 FROM pg_inherits
          WHERE inhrelid = 'public.audit_logs_default'::regclass
            AND inhparent = 'public.audit_logs'::regclass
        ) THEN
          ALTER TABLE public.audit_logs ATTACH PARTITION public.audit_logs_default DEFAULT;
        END IF;
      END $$;
    `);
    // The dump grants each partition explicitly; match it.
    await queryRunner.query(
      `GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_logs_default TO perfana_app`,
    );
    await queryRunner.query(
      `GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_logs_default TO perfana_system`,
    );
    // ...which is why every partition needs RLS of its own. Policies live on the parent and
    // apply to parent-routed queries; a partition with RLS off is readable directly, and
    // `SELECT * FROM audit_logs_2026_07` as perfana_app returned rows that `SELECT * FROM
    // audit_logs` correctly hid. RLS on with no policy of its own = deny-all for direct
    // access, while parent-routed reads and writes keep using the parent's policies.
    //
    // lock_timeout so this cannot form a lock queue in front of audit writes: each ALTER takes
    // ACCESS EXCLUSIVE on its partition, which is instant on its own but waits behind any open
    // transaction reading that partition. Failing fast and being re-run beats stalling writes.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      DO $$
      DECLARE part regclass;
      BEGIN
        FOR part IN
          SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'public.audit_logs'::regclass
        LOOP
          EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', part);
          EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', part);
        END LOOP;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Detach rather than DROP — the default partition holds every audit row written for a month
    // that has no monthly partition of its own, which since this migration is all of them.
    //
    // Detaching alone would preserve the rows and lose access to them: the table keeps the RLS
    // this migration enabled, it no longer has the parent's policies behind it, and it has none
    // of its own, so every app role reads zero rows. Disable RLS on the way out so the preserved
    // data is actually reachable. The ENABLE on the monthly partitions is deliberately NOT
    // reverted — undoing it would reopen the direct-read hole for no benefit.
    await queryRunner.query(
      `ALTER TABLE public.audit_logs DETACH PARTITION public.audit_logs_default`,
    );
    await queryRunner.query(`ALTER TABLE public.audit_logs_default NO FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE public.audit_logs_default DISABLE ROW LEVEL SECURITY`);
  }
}
