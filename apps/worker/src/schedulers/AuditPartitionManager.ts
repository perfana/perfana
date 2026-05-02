import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { getDatabaseService } from '../common/database-accessor.js';

const RETENTION_MONTHS = Number.parseInt(process.env.AUDIT_RETENTION_MONTHS ?? '24', 10);

/**
 * AuditPartitionManager (Phase 5a)
 *
 * Daily at 03:00 UTC: ensures partitions exist for current_month + next 2 months
 * and drops partitions older than AUDIT_RETENTION_MONTHS (default 24).
 *
 * Idempotent: safe to re-run within the same day (CREATE TABLE IF NOT EXISTS,
 * date-bounded DROP).
 */
@Injectable()
export class AuditPartitionManager {
  private readonly logger = new Logger(AuditPartitionManager.name);

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

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })
  async cron(): Promise<void> {
    try {
      await this.runOnce({ retentionMonths: RETENTION_MONTHS });
    } catch (err) {
      this.logger.error(
        `partition manager run failed: ${
          err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'unknown'
        }`,
      );
    }
  }

  async runOnce(opts: { retentionMonths: number }): Promise<void> {
    const ds = this.getDataSource();
    const now = new Date();

    // 1) Ensure look-ahead partitions
    for (let offset = 0; offset < 3; offset++) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const part = partitionName(start);
      await ds.query(
        `CREATE TABLE IF NOT EXISTS ${part} PARTITION OF audit_logs FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
      );
      this.logger.debug(`ensured ${part}`);
    }

    // 2) Drop old partitions
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - opts.retentionMonths, 1));
    const rows = await ds.query<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE 'audit_logs_%'`,
    );
    for (const { tablename } of rows) {
      const m = tablename.match(/^audit_logs_(\d{4})_(\d{2})$/);
      if (!m) continue;
      const partStart = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
      if (partStart < cutoff) {
        await ds.query(`DROP TABLE IF EXISTS ${tablename}`);
        this.logger.log(`dropped expired partition ${tablename}`);
      }
    }
  }
}

function partitionName(start: Date): string {
  return `audit_logs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
}
