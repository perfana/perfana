import { describe, it, expect, vi } from 'vitest';
import {
  AuditRetentionManager,
  parseRetentionMonths,
} from '../../../schedulers/AuditRetentionManager.js';

/**
 * Fake DataSource. `deletedPerCall` is consumed one entry per query; the last entry repeats,
 * which is how a multi-batch run is simulated.
 */
function fakeDataSource(...deletedPerCall: number[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const queue = deletedPerCall.length > 0 ? [...deletedPerCall] : [0];
  const ds: any = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const deleted = queue.length > 1 ? queue.shift() : queue[0];
      return [{ deleted }];
    }),
  };
  ds.calls = calls;
  return ds;
}

/** Let the not-awaited onModuleInit work reach the fake driver. */
const flush = () => new Promise(resolve => setImmediate(resolve));

describe('AuditRetentionManager', () => {
  it('deletes rows older than retentionMonths, in one batch, with no DDL', async () => {
    const ds = fakeDataSource(7);
    const manager = new AuditRetentionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });

    expect(ds.calls).toHaveLength(1);
    const { sql, params } = ds.calls[0];
    expect(sql).toContain('DELETE FROM audit_logs');
    expect(sql).toContain('make_interval(months => $1)');
    expect(params).toEqual([24, 10_000]);
    // The system pool runs as perfana_system, which may not CREATE or DROP in public.
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE/);
    // ctid is only unique within a partition — deletion must key on the primary key.
    expect(sql).not.toContain('ctid');
    expect(sql).toContain('a.id = v.id');
  });

  it('keeps going while a batch comes back full, and stops on the first short one', async () => {
    const ds = fakeDataSource(2, 2, 1);
    const manager = new AuditRetentionManager(ds as any);
    const logs: string[] = [];
    vi.spyOn((manager as any).logger, 'log').mockImplementation((m: string) => logs.push(m));

    await manager.runOnce({ retentionMonths: 24, batchSize: 2 });

    // Two full batches then a short one — the short batch ends the loop.
    expect(ds.calls).toHaveLength(3);
    expect(ds.calls[0].params).toEqual([24, 2]);
    expect(logs.join()).toContain('deleted 5 audit rows older than 24 months');
  });

  it('makes exactly one pass when the first batch is short', async () => {
    const ds = fakeDataSource(3);
    const manager = new AuditRetentionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24, batchSize: 10 });
    expect(ds.calls).toHaveLength(1);
  });

  it('logs the row count it deleted', async () => {
    const ds = fakeDataSource(7);
    const manager = new AuditRetentionManager(ds as any);
    const logs: string[] = [];
    vi.spyOn((manager as any).logger, 'log').mockImplementation((m: string) => logs.push(m));

    await manager.runOnce({ retentionMonths: 24 });
    expect(logs.join()).toContain('deleted 7 audit rows older than 24 months');
  });

  it('does not claim a deletion when nothing was expired', async () => {
    const ds = fakeDataSource(0);
    const manager = new AuditRetentionManager(ds as any);
    const logs: string[] = [];
    vi.spyOn((manager as any).logger, 'log').mockImplementation((m: string) => logs.push(m));

    await manager.runOnce({ retentionMonths: 24 });
    expect(logs).toHaveLength(0);
  });

  it('honours a custom retention window', async () => {
    const ds = fakeDataSource();
    const manager = new AuditRetentionManager(ds as any);
    await manager.runOnce({ retentionMonths: 3 });
    expect(ds.calls[0].params?.[0]).toBe(3);
  });

  it('runs on boot without blocking module init', async () => {
    const ds = fakeDataSource();
    const manager = new AuditRetentionManager(ds as any);
    // Returns void, not a promise — awaiting worker boot on a retention pass would delay
    // BullMQ worker registration.
    expect(manager.onModuleInit()).toBeUndefined();
    await flush();
    expect(ds.calls.some((c: any) => c.sql.includes('DELETE FROM audit_logs'))).toBe(true);
  });

  it('does not fail boot when the retention run throws', async () => {
    const ds = fakeDataSource();
    ds.query = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const manager = new AuditRetentionManager(ds as any);
    const errors: string[] = [];
    vi.spyOn((manager as any).logger, 'error').mockImplementation((m: string) => errors.push(m));

    expect(() => manager.onModuleInit()).not.toThrow();
    await flush();
    expect(errors.join()).toContain('connection refused');
  });

  it('tolerates a driver that returns no count row', async () => {
    const ds = fakeDataSource();
    ds.query = vi.fn(async () => []);
    const manager = new AuditRetentionManager(ds as any);
    await expect(manager.runOnce({ retentionMonths: 24 })).resolves.toBeUndefined();
  });

  describe('parseRetentionMonths', () => {
    it('accepts a positive integer', () => {
      expect(parseRetentionMonths('6')).toBe(6);
    });

    it.each(['forever', '', 'two years'])('falls back to 24 for %o', raw => {
      // NaN would be bound into make_interval and fail every night inside cron()'s catch.
      expect(parseRetentionMonths(raw)).toBe(24);
    });

    it.each(['0', '-1'])('refuses %o, which would delete the entire audit trail', raw => {
      expect(parseRetentionMonths(raw)).toBe(24);
    });

    it('defaults when unset', () => {
      expect(parseRetentionMonths(undefined)).toBe(24);
    });
  });
});
