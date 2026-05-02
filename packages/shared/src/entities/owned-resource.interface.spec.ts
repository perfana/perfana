import { getAuditableFields } from './owned-resource.interface';

describe('getAuditableFields', () => {
  it('returns null when not declared', () => {
    class Bare {
      organization_id!: string;
      created_by!: string;
    }
    expect(getAuditableFields(Bare as any)).toBeNull();
  });

  it('returns the declared array', () => {
    class WithFields {
      static auditableFields = ['organization_id'] as const;
      organization_id!: string;
      created_by!: string;
    }
    expect(getAuditableFields(WithFields as any)).toEqual(['organization_id']);
  });
});
