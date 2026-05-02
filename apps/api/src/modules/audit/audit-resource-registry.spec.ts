import { AuditResourceRegistry } from './audit-resource-registry';

class ApiKey { static auditableFields = ['name'] as const; }
class TestRun { static auditableFields = ['status'] as const; }

describe('AuditResourceRegistry', () => {
  it('registers and resolves by string', () => {
    const r = new AuditResourceRegistry();
    r.register('api-keys', ApiKey);
    r.register('test-runs', TestRun);
    expect(r.resolve('api-keys')).toBe(ApiKey);
    expect(r.resolve('test-runs')).toBe(TestRun);
  });

  it('returns null for unknown type', () => {
    const r = new AuditResourceRegistry();
    expect(r.resolve('unknown')).toBeNull();
  });

  it('lists all registered types in sorted order', () => {
    const r = new AuditResourceRegistry();
    r.register('zebra', ApiKey);
    r.register('alpha', TestRun);
    expect(r.knownTypes()).toEqual(['alpha', 'zebra']);
  });

  it('overwrites prior registration for the same key', () => {
    const r = new AuditResourceRegistry();
    r.register('api-keys', ApiKey);
    r.register('api-keys', TestRun);
    expect(r.resolve('api-keys')).toBe(TestRun);
  });
});
