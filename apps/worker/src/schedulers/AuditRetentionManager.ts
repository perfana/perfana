import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { getDatabaseService } from '../common/database-accessor.js';

const RETENTION_MONTHS = Number.parseInt(process.env.AUDIT_RETENTION_MONTHS ?? '24', 10);

/**
 * AuditRetentionManager (Phase 5a)
 *
 * On boot and daily at 03:00 UTC: deletes audit_logs rows older than
 * AUDIT_RETENTION_MONTHS (default 24).
 *
 * This used to manage the monthly partitions of audit_logs — create the next three,
 * DROP the expired ones. Both are DDL, and since Phase 5b the worker's pool enters every
 * connection as `perfana_system` (see createSystemDataSource), which holds USAGE but not
 * CREATE on schema public and owns no table. So every run failed with "permission denied
 * for schema public", the look-ahead stopped at the last partition the consolidated schema
 * shipped, and audit writes past that month had nowhere to land — 0 rows for August 2026 on
 * a deploy whose newest partition was 2026_07. Granting the RLS-restricted system role
 * schema-level DDL to fix that is the wrong trade; audit_logs now has a DEFAULT partition
 * (1797000000000-AddAuditLogsDefaultPartition) so writes never depend on runtime DDL, and
 * retention is a DELETE, which this role is granted and which RLS permits (the system pool
 * carries a super-admin GUC, so rls_audit_logs_delete passes).
 *
 * ponytail: one unbatched DELETE. Fine while audit volume is modest; if the first run after
 * a long retention gap holds locks too long, chunk it with a LIMIT-ed CTE loop.
 * Any monthly partitions left over from before are empty once their rows age out and can be
 * dropped by hand as the table owner.
 */
@Injectable()
export class AuditRetentionManager implements OnModuleInit {
  private readonly logger = new Logger(AuditRetentionManager.name);

  /**
   * An optional DataSource override — used by unit tests to inject a fake.
   * When undefined, the runtime resolves it lazily from WorkerDatabaseService.
   */
  constructor(private readonly dataSourceOverride?: DataSource) {}

  private getDataSource(): DataSource {
    if (this.dataSourceOverride) {
      return this.dataSourceOverride;
    }
    return getDatabaseService().dataSource;
  }

  async onModuleInit(): Promise<void> {
    await this.cron();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })
  async cron(): Promise<void> {
    try {
      await this.runOnce({ retentionMonths: RETENTION_MONTHS });
    } catch (err) {
      this.logger.error(
        `audit retention run failed: ${
          err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'unknown'
        }`,
      );
    }
  }

  async runOnce(opts: { retentionMonths: number }): Promise<void> {
    const ds = this.getDataSource();
    // Counted via CTE: TypeORM's query() returns rows, not an affected-row count, and a
    // retention pass that silently deletes nothing is the bug this file is replacing.
    const rows = await ds.query<{ deleted: number }[]>(
      `WITH expired AS (
         DELETE FROM audit_logs
         WHERE "timestamp" < now() - make_interval(months => $1)
         RETURNING 1
       )
       SELECT count(*)::int AS deleted FROM expired`,
      [opts.retentionMonths],
    );
    const deleted = rows?.[0]?.deleted ?? 0;
    if (deleted > 0) {
      this.logger.log(`deleted ${deleted} audit rows older than ${opts.retentionMonths} months`);
    } else {
      this.logger.debug(`no audit rows older than ${opts.retentionMonths} months`);
    }
  }
}
