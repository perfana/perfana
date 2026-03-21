/**
 * Role Constants Test Suite
 *
 * Comprehensive tests for RBAC role constants, enums, and helper functions.
 *
 * Test Coverage Areas:
 * - SystemRole enum values and their string representations
 * - OrganizationRole enum values and their string representations
 * - TeamRole enum values and their string representations
 * - GLOBAL_ADMIN_ROLES constant array
 * - isGlobalAdminRole() helper function with various inputs
 * - hasGlobalAdminRole() helper function with various inputs
 * - Edge cases: null, undefined, empty strings, case sensitivity
 */

import {
  SystemRole,
  OrganizationRole,
  TeamRole,
  GLOBAL_ADMIN_ROLES,
  isGlobalAdminRole,
  hasGlobalAdminRole,
} from './roles.constants';

describe('Role Constants', () => {
  describe('SystemRole Enum', () => {
    it('should define GLOBAL_ADMIN as "perfana-admin"', () => {
      expect(SystemRole.GLOBAL_ADMIN).toBe('perfana-admin');
    });

    it('should define ADMIN as "admin"', () => {
      expect(SystemRole.ADMIN).toBe('admin');
    });

    it('should have exactly 2 system roles', () => {
      const systemRoleValues = Object.values(SystemRole);
      expect(systemRoleValues).toHaveLength(2);
    });

    it('should contain both expected role values', () => {
      const systemRoleValues = Object.values(SystemRole);
      expect(systemRoleValues).toContain('perfana-admin');
      expect(systemRoleValues).toContain('admin');
    });
  });

  describe('OrganizationRole Enum', () => {
    it('should define ADMIN as "org-admin"', () => {
      expect(OrganizationRole.ADMIN).toBe('org-admin');
    });

    it('should define MEMBER as "org-member"', () => {
      expect(OrganizationRole.MEMBER).toBe('org-member');
    });

    it('should define VIEWER as "org-viewer"', () => {
      expect(OrganizationRole.VIEWER).toBe('org-viewer');
    });

    it('should have exactly 3 organization roles', () => {
      const orgRoleValues = Object.values(OrganizationRole);
      expect(orgRoleValues).toHaveLength(3);
    });

    it('should contain all expected role values', () => {
      const orgRoleValues = Object.values(OrganizationRole);
      expect(orgRoleValues).toContain('org-admin');
      expect(orgRoleValues).toContain('org-member');
      expect(orgRoleValues).toContain('org-viewer');
    });
  });

  describe('TeamRole Enum', () => {
    it('should define ADMIN as "team-admin"', () => {
      expect(TeamRole.ADMIN).toBe('team-admin');
    });

    it('should define MEMBER as "team-member"', () => {
      expect(TeamRole.MEMBER).toBe('team-member');
    });

    it('should define VIEWER as "team-viewer"', () => {
      expect(TeamRole.VIEWER).toBe('team-viewer');
    });

    it('should have exactly 3 team roles', () => {
      const teamRoleValues = Object.values(TeamRole);
      expect(teamRoleValues).toHaveLength(3);
    });

    it('should contain all expected role values', () => {
      const teamRoleValues = Object.values(TeamRole);
      expect(teamRoleValues).toContain('team-admin');
      expect(teamRoleValues).toContain('team-member');
      expect(teamRoleValues).toContain('team-viewer');
    });
  });

  describe('GLOBAL_ADMIN_ROLES Constant', () => {
    it('should contain SystemRole.GLOBAL_ADMIN', () => {
      expect(GLOBAL_ADMIN_ROLES).toContain(SystemRole.GLOBAL_ADMIN);
    });

    it('should contain SystemRole.ADMIN', () => {
      expect(GLOBAL_ADMIN_ROLES).toContain(SystemRole.ADMIN);
    });

    it('should have exactly 2 global admin roles', () => {
      expect(GLOBAL_ADMIN_ROLES).toHaveLength(2);
    });

    it('should be a readonly array', () => {
      // TypeScript enforces this at compile time via "as const"
      // At runtime, we verify the values match expected strings
      expect(GLOBAL_ADMIN_ROLES[0]).toBe('perfana-admin');
      expect(GLOBAL_ADMIN_ROLES[1]).toBe('admin');
    });
  });

  describe('isGlobalAdminRole() Helper', () => {
    describe('Valid Admin Roles', () => {
      it('should return true for "perfana-admin"', () => {
        expect(isGlobalAdminRole('perfana-admin')).toBe(true);
      });

      it('should return true for "admin"', () => {
        expect(isGlobalAdminRole('admin')).toBe(true);
      });

      it('should return true for SystemRole.GLOBAL_ADMIN enum value', () => {
        expect(isGlobalAdminRole(SystemRole.GLOBAL_ADMIN)).toBe(true);
      });

      it('should return true for SystemRole.ADMIN enum value', () => {
        expect(isGlobalAdminRole(SystemRole.ADMIN)).toBe(true);
      });
    });

    describe('Non-Admin Roles', () => {
      it('should return false for "org-admin"', () => {
        expect(isGlobalAdminRole('org-admin')).toBe(false);
      });

      it('should return false for "team-admin"', () => {
        expect(isGlobalAdminRole('team-admin')).toBe(false);
      });

      it('should return false for "user"', () => {
        expect(isGlobalAdminRole('user')).toBe(false);
      });

      it('should return false for "member"', () => {
        expect(isGlobalAdminRole('member')).toBe(false);
      });

      it('should return false for "viewer"', () => {
        expect(isGlobalAdminRole('viewer')).toBe(false);
      });

      it('should return false for OrganizationRole.ADMIN enum value', () => {
        expect(isGlobalAdminRole(OrganizationRole.ADMIN)).toBe(false);
      });

      it('should return false for TeamRole.ADMIN enum value', () => {
        expect(isGlobalAdminRole(TeamRole.ADMIN)).toBe(false);
      });
    });

    describe('Case Sensitivity', () => {
      it('should return false for "Perfana-Admin" (wrong case)', () => {
        expect(isGlobalAdminRole('Perfana-Admin')).toBe(false);
      });

      it('should return false for "PERFANA-ADMIN" (uppercase)', () => {
        expect(isGlobalAdminRole('PERFANA-ADMIN')).toBe(false);
      });

      it('should return false for "Admin" (capitalized)', () => {
        expect(isGlobalAdminRole('Admin')).toBe(false);
      });

      it('should return false for "ADMIN" (uppercase)', () => {
        expect(isGlobalAdminRole('ADMIN')).toBe(false);
      });

      it('should return false for "aDmIn" (mixed case)', () => {
        expect(isGlobalAdminRole('aDmIn')).toBe(false);
      });
    });

    describe('Edge Cases', () => {
      it('should return false for null', () => {
        expect(isGlobalAdminRole(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(isGlobalAdminRole(undefined)).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isGlobalAdminRole('')).toBe(false);
      });

      it('should return false for whitespace-only string', () => {
        expect(isGlobalAdminRole('   ')).toBe(false);
      });

      it('should return false for "admin " (trailing space)', () => {
        expect(isGlobalAdminRole('admin ')).toBe(false);
      });

      it('should return false for " admin" (leading space)', () => {
        expect(isGlobalAdminRole(' admin')).toBe(false);
      });

      it('should return false for " admin " (leading and trailing spaces)', () => {
        expect(isGlobalAdminRole(' admin ')).toBe(false);
      });

      it('should return false for "perfana-admin " (trailing space)', () => {
        expect(isGlobalAdminRole('perfana-admin ')).toBe(false);
      });

      it('should return false for partial match "perfana"', () => {
        expect(isGlobalAdminRole('perfana')).toBe(false);
      });

      it('should return false for partial match "adm"', () => {
        expect(isGlobalAdminRole('adm')).toBe(false);
      });

      it('should return false for superset "perfana-admin-super"', () => {
        expect(isGlobalAdminRole('perfana-admin-super')).toBe(false);
      });

      it('should return false for superset "super-admin"', () => {
        expect(isGlobalAdminRole('super-admin')).toBe(false);
      });
    });

    describe('Special Characters', () => {
      it('should return false for role with special characters "admin@domain"', () => {
        expect(isGlobalAdminRole('admin@domain')).toBe(false);
      });

      it('should return false for role with numbers "admin123"', () => {
        expect(isGlobalAdminRole('admin123')).toBe(false);
      });

      it('should return false for role with underscore "perfana_admin"', () => {
        expect(isGlobalAdminRole('perfana_admin')).toBe(false);
      });

      it('should return false for role with period "perfana.admin"', () => {
        expect(isGlobalAdminRole('perfana.admin')).toBe(false);
      });
    });
  });

  describe('hasGlobalAdminRole() Helper', () => {
    describe('Arrays Containing Admin Roles', () => {
      it('should return true for array containing "perfana-admin"', () => {
        expect(hasGlobalAdminRole(['perfana-admin'])).toBe(true);
      });

      it('should return true for array containing "admin"', () => {
        expect(hasGlobalAdminRole(['admin'])).toBe(true);
      });

      it('should return true for array with multiple roles including "perfana-admin"', () => {
        expect(hasGlobalAdminRole(['user', 'perfana-admin', 'developer'])).toBe(true);
      });

      it('should return true for array with multiple roles including "admin"', () => {
        expect(hasGlobalAdminRole(['org-member', 'admin', 'team-admin'])).toBe(true);
      });

      it('should return true for array with both admin roles', () => {
        expect(hasGlobalAdminRole(['perfana-admin', 'admin'])).toBe(true);
      });

      it('should return true for array with admin role as last element', () => {
        expect(hasGlobalAdminRole(['user', 'member', 'viewer', 'admin'])).toBe(true);
      });

      it('should return true for array with admin role as first element', () => {
        expect(hasGlobalAdminRole(['perfana-admin', 'user', 'member'])).toBe(true);
      });

      it('should return true for array with SystemRole enum values', () => {
        expect(hasGlobalAdminRole([SystemRole.GLOBAL_ADMIN, 'user'])).toBe(true);
      });
    });

    describe('Arrays Without Admin Roles', () => {
      it('should return false for array with only non-admin roles', () => {
        expect(hasGlobalAdminRole(['user', 'member', 'viewer'])).toBe(false);
      });

      it('should return false for array with organization roles only', () => {
        expect(hasGlobalAdminRole(['org-admin', 'org-member', 'org-viewer'])).toBe(false);
      });

      it('should return false for array with team roles only', () => {
        expect(hasGlobalAdminRole(['team-admin', 'team-member', 'team-viewer'])).toBe(false);
      });

      it('should return false for array with mixed non-admin roles', () => {
        expect(
          hasGlobalAdminRole(['org-admin', 'team-admin', 'user', 'developer']),
        ).toBe(false);
      });

      it('should return false for single non-admin role', () => {
        expect(hasGlobalAdminRole(['user'])).toBe(false);
      });
    });

    describe('Edge Cases', () => {
      it('should return false for null', () => {
        expect(hasGlobalAdminRole(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(hasGlobalAdminRole(undefined)).toBe(false);
      });

      it('should return false for empty array', () => {
        expect(hasGlobalAdminRole([])).toBe(false);
      });

      it('should return false for array with only empty strings', () => {
        expect(hasGlobalAdminRole(['', '', ''])).toBe(false);
      });

      it('should return false for array with wrong case admin roles', () => {
        expect(hasGlobalAdminRole(['Admin', 'PERFANA-ADMIN', 'ADMIN'])).toBe(false);
      });

      it('should return false for array with partial admin role matches', () => {
        expect(hasGlobalAdminRole(['perfana', 'adm', 'super-admin'])).toBe(false);
      });

      it('should return false for array with admin role with extra spaces', () => {
        expect(hasGlobalAdminRole([' admin', 'admin ', ' perfana-admin '])).toBe(false);
      });
    });

    describe('Array with Duplicate Roles', () => {
      it('should return true for array with duplicate admin roles', () => {
        expect(hasGlobalAdminRole(['admin', 'admin', 'admin'])).toBe(true);
      });

      it('should return true for array with duplicate admin and non-admin roles', () => {
        expect(hasGlobalAdminRole(['user', 'admin', 'user', 'admin'])).toBe(true);
      });

      it('should return false for array with duplicate non-admin roles', () => {
        expect(hasGlobalAdminRole(['user', 'user', 'member', 'member'])).toBe(false);
      });
    });

    describe('Large Arrays', () => {
      it('should handle large array with admin role at the beginning', () => {
        const roles = ['perfana-admin', ...Array(100).fill('user')];
        expect(hasGlobalAdminRole(roles)).toBe(true);
      });

      it('should handle large array with admin role at the end', () => {
        const roles = [...Array(100).fill('user'), 'admin'];
        expect(hasGlobalAdminRole(roles)).toBe(true);
      });

      it('should handle large array without admin role', () => {
        const roles = Array(100).fill('user');
        expect(hasGlobalAdminRole(roles)).toBe(false);
      });
    });
  });

  describe('Integration: isGlobalAdminRole with hasGlobalAdminRole', () => {
    it('should have consistent behavior between functions', () => {
      const testRoles = [
        'perfana-admin',
        'admin',
        'org-admin',
        'team-admin',
        'user',
        '',
      ];

      for (const role of testRoles) {
        const singleResult = isGlobalAdminRole(role);
        const arrayResult = hasGlobalAdminRole([role]);
        expect(singleResult).toBe(arrayResult);
      }
    });

    it('should return same result for single-element array as direct call', () => {
      expect(hasGlobalAdminRole(['perfana-admin'])).toBe(isGlobalAdminRole('perfana-admin'));
      expect(hasGlobalAdminRole(['admin'])).toBe(isGlobalAdminRole('admin'));
      expect(hasGlobalAdminRole(['user'])).toBe(isGlobalAdminRole('user'));
    });
  });
});
