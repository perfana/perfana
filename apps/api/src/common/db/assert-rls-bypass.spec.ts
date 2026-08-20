import { DataSource } from 'typeorm';
import { assertRlsBypass } from './assert-rls-bypass';

const ds = (rows: unknown[]) => ({ query: jest.fn().mockResolvedValue(rows) }) as unknown as DataSource;

describe('assertRlsBypass', () => {
  it.each([
    ['superuser', { rolname: 'perfana', rolsuper: true, rolbypassrls: false }],
    ['bypassrls', { rolname: 'perfana', rolsuper: false, rolbypassrls: true }],
  ])('passes for a %s role', async (_label, role) => {
    await expect(assertRlsBypass(ds([role]))).resolves.toBeUndefined();
  });

  it('refuses to boot under a least-privilege role, naming the failure it prevents', async () => {
    // The exact deploy the TODO describes: perfana_app or an RDS master user.
    const promise = assertRlsBypass(
      ds([{ rolname: 'perfana_app', rolsuper: false, rolbypassrls: false }]),
    );

    await expect(promise).rejects.toThrow(/perfana_app/);
    await expect(promise).rejects.toThrow(/api_keys/);
    await expect(promise).rejects.toThrow(/BYPASSRLS/);
  });

  it('refuses to boot rather than assume, when the role cannot be resolved', async () => {
    await expect(assertRlsBypass(ds([]))).rejects.toThrow(/could not resolve/);
  });
});
