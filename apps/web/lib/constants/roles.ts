/**
 * Role constants for RBAC (Role-Based Access Control)
 *
 * This file mirrors the backend role enums for use in the frontend.
 * Keep in sync with apps/api/src/constants/roles.constants.ts
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
 */
export const GLOBAL_ADMIN_ROLES = [
  SystemRole.GLOBAL_ADMIN,
  SystemRole.ADMIN,
] as const;

/**
 * All organization role values for iteration.
 */
export const ORGANIZATION_ROLES = [
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;

/**
 * All team role values for iteration.
 */
export const TEAM_ROLES = [
  TeamRole.ADMIN,
  TeamRole.MEMBER,
  TeamRole.VIEWER,
] as const;

/**
 * Human-readable labels for organization roles.
 */
export const ORGANIZATION_ROLE_LABELS: Record<OrganizationRole, string> = {
  [OrganizationRole.ADMIN]: 'Admin',
  [OrganizationRole.MEMBER]: 'Member',
  [OrganizationRole.VIEWER]: 'Viewer',
};

/**
 * Human-readable labels for team roles.
 */
export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  [TeamRole.ADMIN]: 'Admin',
  [TeamRole.MEMBER]: 'Member',
  [TeamRole.VIEWER]: 'Viewer',
};

/**
 * Role descriptions for tooltips and help text.
 */
export const ORGANIZATION_ROLE_DESCRIPTIONS: Record<OrganizationRole, string> = {
  [OrganizationRole.ADMIN]: 'Full control over organization settings, members, and all resources',
  [OrganizationRole.MEMBER]: 'Can view and contribute to organization resources',
  [OrganizationRole.VIEWER]: 'Can only view organization resources (read-only)',
};

export const TEAM_ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  [TeamRole.ADMIN]: 'Full control over team settings, members, and all resources',
  [TeamRole.MEMBER]: 'Can view and contribute to team resources',
  [TeamRole.VIEWER]: 'Can only view team resources (read-only)',
};

/**
 * Check if a role grants global admin privileges.
 */
export function isGlobalAdminRole(role: string | null | undefined): boolean {
  if (!role) {
    return false;
  }
  return (GLOBAL_ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * Check if any role in an array grants global admin privileges.
 */
export function hasGlobalAdminRole(roles: string[] | null | undefined): boolean {
  if (!roles || roles.length === 0) {
    return false;
  }
  return roles.some((role) => isGlobalAdminRole(role));
}

/**
 * Check if a user has org admin privileges.
 */
export function isOrgAdmin(roles: string[] | null | undefined): boolean {
  if (!roles || roles.length === 0) {
    return false;
  }
  return roles.includes(OrganizationRole.ADMIN);
}

/**
 * Check if a user has team admin privileges.
 */
export function isTeamAdmin(roles: string[] | null | undefined): boolean {
  if (!roles || roles.length === 0) {
    return false;
  }
  return roles.includes(TeamRole.ADMIN);
}

/**
 * Aliases for iteration arrays (used by member dialogs).
 */
export const ALL_ORGANIZATION_ROLES = ORGANIZATION_ROLES;
export const ALL_TEAM_ROLES = TEAM_ROLES;

/**
 * Get the display label for an organization role.
 */
export function getOrganizationRoleLabel(role: OrganizationRole | string): string {
  return ORGANIZATION_ROLE_LABELS[role as OrganizationRole] || role;
}

/**
 * Get the display label for a team role.
 */
export function getTeamRoleLabel(role: TeamRole | string): string {
  return TEAM_ROLE_LABELS[role as TeamRole] || role;
}

/**
 * Get MUI color for an organization role chip.
 */
export function getOrganizationRoleColor(role: string): 'primary' | 'success' | 'info' | 'default' {
  switch (role) {
    case OrganizationRole.ADMIN:
      return 'primary';
    case OrganizationRole.MEMBER:
      return 'success';
    case OrganizationRole.VIEWER:
      return 'info';
    default:
      return 'default';
  }
}

/**
 * Get MUI color for a team role chip.
 */
export function getTeamRoleColor(role: string): 'secondary' | 'success' | 'info' | 'default' {
  switch (role) {
    case TeamRole.ADMIN:
      return 'secondary';
    case TeamRole.MEMBER:
      return 'success';
    case TeamRole.VIEWER:
      return 'info';
    default:
      return 'default';
  }
}
