import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditPartitionManager } from '../../../schedulers/AuditPartitionManager.js';

function fakeDataSource() {
  const calls: string[] = [];
  const ds: any = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      // Default: SELECT returns []; DDL returns undefined.
      if (sql.startsWith('SELECT')) return [];
      return undefined;
    }),
  };
  ds.calls = calls;
  return ds;
}

describe('AuditPartitionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00Z'));
  });

  it('creates current month + next 2 months idempotently (CREATE TABLE IF NOT EXISTS)', async () => {
    const ds = fakeDataSource();
    const manager = new AuditPartitionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });

    const ddls = ds.calls.filter((s: string) => s.includes('CREATE TABLE') && s.includes('PARTITION OF'));
    expect(ddls).toHaveLength(3);
    expect(ddls[0]).toContain('audit_logs_2026_05');
    expect(ddls[1]).toContain('audit_logs_2026_06');
    expect(ddls[2]).toContain('audit_logs_2026_07');
    // Idempotency: each CREATE uses IF NOT EXISTS
    expect(ddls.every((s: string) => s.includes('IF NOT EXISTS'))).toBe(true);
  });

  it('ensures partitions on boot, not just on the 03:00 cron', async () => {
    const ds = fakeDataSource();
    const manager = new AuditPartitionManager(ds as any);
    await manager.onModuleInit();

    const ddls = ds.calls.filter((s: string) => s.includes('CREATE TABLE') && s.includes('PARTITION OF'));
    expect(ddls).toHaveLength(3);
    expect(ddls[0]).toContain('audit_logs_2026_05');
  });

  it('does not fail boot when the partition run throws', async () => {
    const ds = fakeDataSource();
    ds.query = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const manager = new AuditPartitionManager(ds as any);
    await expect(manager.onModuleInit()).resolves.toBeUndefined();
  });

  it('drops partitions older than retentionMonths', async () => {
    const ds = fakeDataSource();
    // Pretend pg_tables returns three old partitions for 2024-01..2024-03 + a recent one
    ds.query = vi.fn(async (sql: string) => {
      ds.calls.push(sql);
      if (sql.includes('pg_tables') && sql.includes('audit_logs_')) {
        return [
          { tablename: 'audit_logs_2024_01' },
          { tablename: 'audit_logs_2024_02' },
          { tablename: 'audit_logs_2024_03' },
          { tablename: 'audit_logs_2026_05' },
        ];
      }
      return undefined;
    });
    const manager = new AuditPartitionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });

    const drops = ds.calls.filter((s: string) => s.startsWith('DROP TABLE'));
    // Today is 2026-05-15. Cutoff = 2026-05 minus 24 months = 2024-05.
    // So 2024-01..2024-04 are droppable; 2024-05 onward kept.
    expect(drops.some((s: string) => s.includes('audit_logs_2024_01'))).toBe(true);
    expect(drops.some((s: string) => s.includes('audit_logs_2024_02'))).toBe(true);
    expect(drops.some((s: string) => s.includes('audit_logs_2024_03'))).toBe(true);
    expect(drops.some((s: string) => s.includes('audit_logs_2026_05'))).toBe(false);
  });

  it('does not drop partitions when none are old enough', async () => {
    const ds = fakeDataSource();
    ds.query = vi.fn(async (sql: string) => {
      ds.calls.push(sql);
      if (sql.includes('pg_tables') && sql.includes('audit_logs_')) {
        return [{ tablename: 'audit_logs_2026_05' }];
      }
      return undefined;
    });
    const manager = new AuditPartitionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });
    expect(ds.calls.some((s: string) => s.startsWith('DROP TABLE'))).toBe(false);
  });

  it('skips tablenames that do not match the audit_logs_YYYY_MM pattern', async () => {
    const ds = fakeDataSource();
    ds.query = vi.fn(async (sql: string) => {
      ds.calls.push(sql);
      if (sql.includes('pg_tables') && sql.includes('audit_logs_')) {
        return [
          { tablename: 'audit_logs_2024_01' },
          { tablename: 'audit_logs_default' }, // not a date partition
          { tablename: 'audit_logs_archive_2023' }, // wrong format
        ];
      }
      return undefined;
    });
    const manager = new AuditPartitionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });
    const drops = ds.calls.filter((s: string) => s.startsWith('DROP TABLE'));
    // Only the well-formed YYYY_MM one gets dropped (2024_01 is older than 2024_05 cutoff)
    expect(drops.length).toBe(1);
    expect(drops[0]).toContain('audit_logs_2024_01');
  });
});
