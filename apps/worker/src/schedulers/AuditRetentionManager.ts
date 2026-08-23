import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { getDatabaseService } from '../common/database-accessor.js';

const DEFAULT_RETENTION_MONTHS = 24;
const DEFAULT_BATCH_SIZE = 10_000;

/**
 * Validated, not just parsed. The value is bound into `make_interval(months => $1)`, so a typo
 * has teeth in both directions: `forever` or `24m` yields NaN and every run throws into cron()'s
 * catch (one ERROR line a day, retention silently never happens — the failure shape this file
 * exists to end), while `0` makes the predicate `timestamp < now()` and erases the whole audit
 * trail on the next boot. The partition manager this replaced only ever DROPped whole months
 * strictly older than the cutoff, so it survived the same typo.
 */
export function parseRetentionMonths(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_RETENTION_MONTHS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    new Logger(`AuditRetentionManager`).warn(
      `AUDIT_RETENTION_MONTHS='${raw}' is not a positive integer, falling back to ${DEFAULT_RETENTION_MONTHS}`,
    );
    return DEFAULT_RETENTION_MONTHS;
  }
  return parsed;
}

const RETENTION_MONTHS = parseRetentionMonths(process.env.AUDIT_RETENTION_MONTHS);

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
 * Any monthly partitions left over from before are empty once their rows age out. Dropping them
 * is an owner-only chore and not free: now that audit_logs_default holds rows, re-introducing a
 * monthly range means ATTACH PARTITION full-scans the default under ACCESS EXCLUSIVE.
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

  onModuleInit(): void {
    // Deliberately not awaited. Nest awaits onModuleInit before worker.ts registers the BullMQ
    // workers, so awaiting a retention pass would hold job consumption for as long as it takes —
    // and the first pass after a long gap is the big one. Retention is never urgent. cron()
    // catches its own errors, so this cannot reject unhandled.
    void this.cron();
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

  async runOnce(opts: { retentionMonths: number; batchSize?: number }): Promise<void> {
    const ds = this.getDataSource();
    const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    let total = 0;

    // Batched, because what this replaced was O(1) metadata (DROP TABLE on a whole month) and a
    // row-level DELETE is not: each row costs a heap kill plus one kill per index — audit_logs
    // carries seven — all WAL-logged. A single unbounded statement over a first-run backlog would
    // hold locks and grow WAL for as long as it ran.
    //
    // Deleting by primary key (id, timestamp) rather than ctid: ctid is only unique within a
    // partition, so `WHERE ctid IN (...)` against the parent can match an unrelated row in a
    // sibling partition.
    for (;;) {
      // Counted via CTE: TypeORM's query() returns rows, not an affected-row count, and a
      // retention pass that silently deletes nothing is the bug this file is replacing.
      const rows = await ds.query<{ deleted: number }[]>(
        `WITH victims AS (
           SELECT id, "timestamp" FROM audit_logs
           WHERE "timestamp" < now() - make_interval(months => $1)
           ORDER BY "timestamp"
           LIMIT $2
         ), expired AS (
           DELETE FROM audit_logs a
           USING victims v
           WHERE a.id = v.id AND a."timestamp" = v."timestamp"
           RETURNING 1
         )
         SELECT count(*)::int AS deleted FROM expired`,
        [opts.retentionMonths, batchSize],
      );
      const deleted = rows?.[0]?.deleted ?? 0;
      total += deleted;
      if (deleted < batchSize) {
        break;
      }
    }

    if (total > 0) {
      this.logger.log(`deleted ${total} audit rows older than ${opts.retentionMonths} months`);
    } else {
      this.logger.debug(`no audit rows older than ${opts.retentionMonths} months`);
    }
  }
}
