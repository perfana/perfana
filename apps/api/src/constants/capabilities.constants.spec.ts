import {
  Capability,
  ROLE_CAPABILITIES,
  GLOBAL_ADMIN_CAPABILITIES,
} from './capabilities.constants';
import {
  OrganizationRole,
  TeamRole,
  GLOBAL_ADMIN_ROLES,
} from './roles.constants';

describe('capabilities.constants', () => {
  it('defines distinct capability strings', () => {
    const values = Object.values(Capability);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('uses <resource>:<action> or <resource>:<sub>:<action> format', () => {
    for (const cap of Object.values(Capability)) {
      expect(cap).toMatch(/^[a-z][a-z0-9-]*(:[a-z0-9-]+){1,2}$/);
    }
  });

  it('maps every OrganizationRole to a capability set', () => {
    for (const role of Object.values(OrganizationRole)) {
      expect(ROLE_CAPABILITIES.organization[role]).toBeDefined();
    }
  });

  it('maps every TeamRole to a capability set', () => {
    for (const role of Object.values(TeamRole)) {
      expect(ROLE_CAPABILITIES.team[role]).toBeDefined();
    }
  });

  it('global admin capabilities are a superset of org-admin capabilities', () => {
    const orgAdmin = ROLE_CAPABILITIES.organization[OrganizationRole.ADMIN];
    for (const cap of orgAdmin) {
      expect(GLOBAL_ADMIN_CAPABILITIES).toContain(cap);
    }
  });

  it('GLOBAL_ADMIN_ROLES includes perfana-admin and admin', () => {
    expect(GLOBAL_ADMIN_ROLES).toEqual(
      expect.arrayContaining(['perfana-admin', 'admin']),
    );
  });
});
