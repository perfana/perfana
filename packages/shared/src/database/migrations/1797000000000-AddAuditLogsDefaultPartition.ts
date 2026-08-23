import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give audit_logs a DEFAULT partition so an audit write can never be rejected for want of
 * a partition.
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
 * somewhere. Monthly partitions remain the fast path for retention DROPs; rows that fall
 * into the default stay queryable but are not covered by the monthly drop.
 *
 * Greenfield deploys get this from the consolidated schema; this migration is for databases
 * that already exist.
 */
export class AddAuditLogsDefaultPartition1797000000000 implements MigrationInterface {
  name = 'AddAuditLogsDefaultPartition1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS public.audit_logs_default PARTITION OF public.audit_logs DEFAULT`,
    );
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
    // Detach rather than DROP — the default partition may hold the only copy of audit rows
    // for months whose own partition was never created.
    await queryRunner.query(
      `ALTER TABLE public.audit_logs DETACH PARTITION public.audit_logs_default`,
    );
  }
}
