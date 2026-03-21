/**
 * Role constants for RBAC (Role-Based Access Control)
 *
 * This file defines the role enums used throughout the application
 * and helper functions for role checking.
 */

/**
 * System-wide roles that grant global permissions.
 * These roles bypass organization/team-level role checks.
 */
export enum SystemRole {
  /** Full administrative access across all resources */
  GLOBAL_ADMIN = 'perfana-admin',
  /** Administrative access (backward compatibility) */
  ADMIN = 'admin',
}

/**
 * Organization-level roles for scoped permissions.
 * These roles grant permissions within a specific organization.
 */
export enum OrganizationRole {
  /** Can manage organization resources and members */
  ADMIN = 'org-admin',
  /** Can view and use organization resources */
  MEMBER = 'org-member',
  /** Can only view organization resources */
  VIEWER = 'org-viewer',
}

/**
 * Team-level roles for fine-grained permissions.
 * These roles grant permissions within a specific team.
 */
export enum TeamRole {
  /** Can manage team resources and members */
  ADMIN = 'team-admin',
  /** Can contribute to team resources */
  MEMBER = 'team-member',
  /** Can only view team resources */
  VIEWER = 'team-viewer',
}

/**
 * Global admin role values for quick reference.
 * These are the role strings that grant system-wide admin privileges.
 */
export const GLOBAL_ADMIN_ROLES = [
  SystemRole.GLOBAL_ADMIN,
  SystemRole.ADMIN,
] as const;

/**
 * Check if a role grants global admin privileges.
 *
 * @param role - The role string to check
 * @returns true if the role is a global admin role, false otherwise
 *
 * @example
 * isGlobalAdminRole('perfana-admin') // true
 * isGlobalAdminRole('admin') // true
 * isGlobalAdminRole('org-admin') // false
 * isGlobalAdminRole('') // false
 * isGlobalAdminRole(null) // false
 */
export function isGlobalAdminRole(role: string | null | undefined): boolean {
  if (!role) {
    return false;
  }
  return (GLOBAL_ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * Check if any role in an array grants global admin privileges.
 *
 * @param roles - Array of role strings to check
 * @returns true if any role is a global admin role, false otherwise
 *
 * @example
 * hasGlobalAdminRole(['org-member', 'perfana-admin']) // true
 * hasGlobalAdminRole(['org-member', 'team-admin']) // false
 * hasGlobalAdminRole([]) // false
 */
export function hasGlobalAdminRole(
  roles: string[] | null | undefined,
): boolean {
  if (!roles || roles.length === 0) {
    return false;
  }
  return roles.some((role) => isGlobalAdminRole(role));
}
