jest.mock('@perfana/shared/entities', () => ({
  AuditLog: class AuditLog {},
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  getAuditableFields: (klass: any) => klass?.auditableFields ?? null,
}));

import { GrafanaSyncAuditService, GRAFANA_SYNC_ACTOR_ID } from './grafana-sync-audit.service';

class FakeBenchmark {
  static auditableFields = ['requirement_value', 'enabled'] as const;
  id?: string;
  organizationId?: string;
  systemUnderTestId?: string;
  requirement_value?: number;
  enabled?: boolean;
}

function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('GrafanaSyncAuditService', () => {
  let repo: { insert: jest.Mock };
  let service: GrafanaSyncAuditService;

  beforeEach(() => {
    repo = { insert: jest.fn().mockResolvedValue(undefined) };
    service = new GrafanaSyncAuditService(repo as any);
  });

  it('logCreate inserts a CREATE row stamped with the system actor', async () => {
    const entity = Object.assign(new FakeBenchmark(), {
      id: 'b-1',
      organizationId: 'org-1',
      systemUnderTestId: 'sut-1',
      requirement_value: 1024,
      enabled: true,
    });

    service.logCreate(entity as any);
    await flushSetImmediate();

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const row = repo.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      action: 'CREATE',
      userId: GRAFANA_SYNC_ACTOR_ID,
      organizationId: 'org-1',
      systemUnderTestId: 'sut-1',
      resourceId: 'b-1',
      resourceType: 'fake-benchmarks',
      success: true,
    });
    expect(row.changes.fields).toEqual(['requirement_value', 'enabled']);
    expect(row.changes.after).toEqual({ requirement_value: 1024, enabled: true });
    expect(row.metadata).toEqual({ auth_type: 'system' });
  });

  it('logUpdate emits a diff over auditableFields and skips no-op updates', async () => {
    const before = Object.assign(new FakeBenchmark(), {
      id: 'b-1',
      organizationId: 'org-1',
      requirement_value: 1024,
      enabled: true,
    });
    const after = Object.assign(new FakeBenchmark(), {
      id: 'b-1',
      organizationId: 'org-1',
      requirement_value: 2048,
      enabled: true,
    });

    service.logUpdate(before as any, after as any);
    await flushSetImmediate();

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const row = repo.insert.mock.calls[0][0];
    expect(row.action).toBe('UPDATE');
    expect(row.changes.fields).toEqual(['requirement_value']);
    expect(row.changes.before).toEqual({ requirement_value: 1024 });
    expect(row.changes.after).toEqual({ requirement_value: 2048 });

    repo.insert.mockClear();

    // No-op update — must NOT write a row
    service.logUpdate(before as any, before as any);
    await flushSetImmediate();
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('respects organizationIdOverride when the entity has no org column', async () => {
    const entity = Object.assign(new FakeBenchmark(), {
      id: 'b-1',
      requirement_value: 1024,
    });

    service.logCreate(entity as any, { organizationIdOverride: 'org-override' });
    await flushSetImmediate();

    expect(repo.insert.mock.calls[0][0].organizationId).toBe('org-override');
  });

  it('still inserts an action+actor row when the entity has no auditableFields', async () => {
    class FakeNoAudit {
      id?: string;
      organizationId?: string;
    }
    const entity = Object.assign(new FakeNoAudit(), { id: 'x', organizationId: 'org-1' });

    service.logCreate(entity as any);
    await flushSetImmediate();

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const row = repo.insert.mock.calls[0][0];
    expect(row.action).toBe('CREATE');
    expect(row.changes).toBeUndefined();
    expect(row.userId).toBe(GRAFANA_SYNC_ACTOR_ID);
  });
});
