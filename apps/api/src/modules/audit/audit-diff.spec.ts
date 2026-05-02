import { pickAuditable, diff, truncateOversizedFields, AUDIT_MAX_FIELD_BYTES } from './audit-diff';

describe('pickAuditable', () => {
  it('returns only allowlisted fields', () => {
    const e = { id: '1', name: 'x', secret: 'leaky' };
    expect(pickAuditable(e, ['id', 'name'])).toEqual({ id: '1', name: 'x' });
  });
  it('omits undefined fields', () => {
    expect(pickAuditable({ name: 'x', desc: undefined as unknown as string }, ['name', 'desc']))
      .toEqual({ name: 'x' });
  });
  it('returns {} for null/undefined entity', () => {
    expect(pickAuditable(null as unknown as object, ['x'])).toEqual({});
    expect(pickAuditable(undefined as unknown as object, ['x'])).toEqual({});
  });
});

describe('diff', () => {
  const allow = ['name', 'description'] as const;

  it('returns the changed fields with before/after subsets', () => {
    const a = { name: 'old', description: 'same', secret: 's1' };
    const b = { name: 'new', description: 'same', secret: 's2' };
    const out = diff(a, b, allow);
    expect(out.fields).toEqual(['name']);
    expect(out.before).toEqual({ name: 'old' });
    expect(out.after).toEqual({ name: 'new' });
  });

  it('returns fields=[] when nothing in the allowlist changed', () => {
    const a = { name: 'x', description: 'y', secret: 's1' };
    const b = { name: 'x', description: 'y', secret: 's2' };
    expect(diff(a, b, allow).fields).toEqual([]);
  });

  it('treats null `before` (CREATE) as an after-only diff over all allowlisted fields', () => {
    const b = { name: 'x', description: 'y' };
    const out = diff(null, b, allow);
    expect(out.fields).toEqual(['name', 'description']);
    expect(out.before).toEqual({});
    expect(out.after).toEqual({ name: 'x', description: 'y' });
  });

  it('treats null `after` (DELETE) as a before-only diff over all allowlisted fields', () => {
    const a = { name: 'x', description: 'y' };
    const out = diff(a, null, allow);
    expect(out.fields).toEqual(['name', 'description']);
    expect(out.before).toEqual({ name: 'x', description: 'y' });
    expect(out.after).toEqual({});
  });
});

describe('truncateOversizedFields', () => {
  it('replaces fields above AUDIT_MAX_FIELD_BYTES with a truncation marker', () => {
    const big = 'x'.repeat(AUDIT_MAX_FIELD_BYTES + 100);
    const out = truncateOversizedFields({ small: 'a', big });
    expect(out.small).toBe('a');
    expect(out.big).toEqual({ truncated: true, originalLength: big.length });
  });
  it('leaves fields under the cap unchanged', () => {
    const out = truncateOversizedFields({ a: 1, b: 'short' });
    expect(out).toEqual({ a: 1, b: 'short' });
  });
});
