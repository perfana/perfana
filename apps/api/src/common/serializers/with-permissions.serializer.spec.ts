import { attachPermissions } from './with-permissions.serializer';

describe('attachPermissions', () => {
  it('adds _permissions to a single resource', () => {
    const r = { id: 'a', label: 'foo' };
    const out = attachPermissions(r, { update: true, delete: false });
    expect(out).toEqual({ id: 'a', label: 'foo', _permissions: { update: true, delete: false } });
  });

  it('adds _permissions to each item in an array', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const out = attachPermissions(list, { update: true });
    expect(out).toEqual([
      { id: 'a', _permissions: { update: true } },
      { id: 'b', _permissions: { update: true } },
    ]);
  });

  it('preserves existing fields without mutation', () => {
    const r = { id: 'a', _permissions: { update: false } };
    const out = attachPermissions(r, { delete: true });
    expect(out._permissions).toEqual({ delete: true });
    expect(r._permissions).toEqual({ update: false });
  });
});
