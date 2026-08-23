import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditRetentionManager } from '../../../schedulers/AuditRetentionManager.js';

function fakeDataSource(deleted = 0) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const ds: any = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return [{ deleted }];
    }),
  };
  ds.calls = calls;
  return ds;
}

describe('AuditRetentionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-23T12:00:00Z'));
  });

  it('deletes rows older than retentionMonths, in one statement, with no DDL', async () => {
    const ds = fakeDataSource(7);
    const manager = new AuditRetentionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });

    expect(ds.calls).toHaveLength(1);
    const { sql, params } = ds.calls[0];
    expect(sql).toContain('DELETE FROM audit_logs');
    expect(sql).toContain('make_interval(months => $1)');
    expect(params).toEqual([24]);
    // The system pool runs as perfana_system, which may not CREATE or DROP in public.
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE/);
  });

  it('honours a custom retention window', async () => {
    const ds = fakeDataSource();
    const manager = new AuditRetentionManager(ds as any);
    await manager.runOnce({ retentionMonths: 3 });
    expect(ds.calls[0].params).toEqual([3]);
  });

  it('runs on boot, not just on the 03:00 cron', async () => {
    const ds = fakeDataSource();
    const manager = new AuditRetentionManager(ds as any);
    await manager.onModuleInit();
    expect(ds.calls.some((c: any) => c.sql.includes('DELETE FROM audit_logs'))).toBe(true);
  });

  it('does not fail boot when the retention run throws', async () => {
    const ds = fakeDataSource();
    ds.query = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const manager = new AuditRetentionManager(ds as any);
    await expect(manager.onModuleInit()).resolves.toBeUndefined();
  });

  it('tolerates a driver that returns no count row', async () => {
    const ds = fakeDataSource();
    ds.query = vi.fn(async () => []);
    const manager = new AuditRetentionManager(ds as any);
    await expect(manager.runOnce({ retentionMonths: 24 })).resolves.toBeUndefined();
  });
});
