import { withOrgFilter } from './with-org-filter';

describe('withOrgFilter', () => {
  const make = (isAdmin: boolean, orgs: string[] = []) => ({
    isGlobalAdmin: () => isAdmin,
    getAccessibleOrganizations: jest.fn().mockResolvedValue(orgs),
  });

  it('returns null for global admin (caller skips filter)', async () => {
    const authz = make(true);
    expect(await withOrgFilter('u1', ['admin'], authz)).toBeNull();
    expect(authz.getAccessibleOrganizations).not.toHaveBeenCalled();
  });

  it('returns accessible orgs for non-admin user', async () => {
    const authz = make(false, ['org-a', 'org-b']);
    expect(await withOrgFilter('u1', ['user'], authz)).toEqual(['org-a', 'org-b']);
    expect(authz.getAccessibleOrganizations).toHaveBeenCalledWith('u1');
  });

  it('returns empty array for non-admin with no memberships', async () => {
    const authz = make(false, []);
    expect(await withOrgFilter('u1', ['user'], authz)).toEqual([]);
  });
});
