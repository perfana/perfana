import { GLOBAL_ADMIN_CAPABILITIES } from '../../src/constants/capabilities.constants';

/**
 * Mock for AuthorizationService used in unit tests
 *
 * This mock provides default implementations that allow all operations
 * (isGlobalAdmin returns true) to simplify testing. Individual tests can
 * override specific methods as needed.
 */
export const createAuthorizationServiceMock = () => ({
  /**
   * Check if user has global admin role
   * Default: returns true (allows all operations in tests)
   */
  isGlobalAdmin: jest.fn().mockReturnValue(true),

  /**
   * Get list of organization IDs the user can access
   * Default: returns empty array (can be overridden per test)
   */
  getAccessibleOrganizations: jest.fn().mockResolvedValue([]),

  /**
   * Check if user is a member of an organization
   * Default: returns true (allows access in tests)
   */
  isOrganizationMember: jest.fn().mockResolvedValue(true),

  /**
   * Check if user is an admin of an organization
   * Default: returns true (allows admin operations in tests)
   */
  isOrganizationAdmin: jest.fn().mockResolvedValue(true),

  /**
   * Check if user is a member of a team
   * Default: returns true (allows access in tests)
   */
  isTeamMember: jest.fn().mockResolvedValue(true),

  /**
   * Check if user is an admin of a team
   * Default: returns true (allows admin operations in tests)
   */
  isTeamAdmin: jest.fn().mockResolvedValue(true),

  /**
   * Check if user can access a specific resource
   * Default: returns { allowed: true, reason: ... } — matches the real
   * AuthorizationService return shape (AuthorizationResult).
   */
  canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'Mock: access allowed' }),

  /**
   * Check if user can modify a specific resource
   * Default: returns { allowed: true, reason: ... } — matches the real
   * AuthorizationService return shape (AuthorizationResult).
   */
  canModifyResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'Mock: modify allowed' }),

  /**
   * Get list of team IDs the user can access
   * Default: returns empty array (can be overridden per test)
   */
  getAccessibleTeams: jest.fn().mockResolvedValue([]),

  /**
   * Check if user can view resources belonging to a team
   * Default: returns allowed (allows access in tests)
   */
  canViewTeamResources: jest.fn().mockResolvedValue({ allowed: true, reason: 'Mock: access allowed' }),

  /**
   * Check if user is an org-admin in any organization
   * Default: returns true (allows admin operations in tests)
   */
  isOrgAdminInAnyOrganization: jest.fn().mockResolvedValue(true),

  /**
   * Check if user can administer any organization (global admin or any-org admin).
   * Default: returns { allowed: true, reason: ... } — matches the real
   * AuthorizationService return shape (AuthorizationResult).
   */
  canAdministerAnyOrganization: jest.fn().mockResolvedValue({ allowed: true, reason: 'Mock: admin allowed' }),

  /**
   * Get capabilities for a user in an org/team scope.
   * Default: returns the global-admin capability set so most tests pass without
   * per-test overrides. Tests that exercise capability denial should swap in
   * `createRestrictiveAuthorizationServiceMock` or override `getCapabilities`.
   */
  getCapabilities: jest.fn().mockResolvedValue(GLOBAL_ADMIN_CAPABILITIES),

  /**
   * Drop a principal's cached org/team membership. Services call this after a
   * membership or credential change, so it must be stubbed here or those code
   * paths throw a TypeError that the caller's catch block silently swallows.
   */
  invalidateUserCache: jest.fn().mockResolvedValue(undefined),
});

/**
 * Create a mock that denies all operations (for testing authorization failures)
 */
export const createRestrictiveAuthorizationServiceMock = () => ({
  isGlobalAdmin: jest.fn().mockReturnValue(false),
  getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
  isOrganizationMember: jest.fn().mockResolvedValue(false),
  isOrganizationAdmin: jest.fn().mockResolvedValue(false),
  isTeamMember: jest.fn().mockResolvedValue(false),
  isTeamAdmin: jest.fn().mockResolvedValue(false),
  canAccessResource: jest.fn().mockResolvedValue({ allowed: false, reason: 'Mock: access denied' }),
  canModifyResource: jest.fn().mockResolvedValue({ allowed: false, reason: 'Mock: modify denied' }),
  getAccessibleTeams: jest.fn().mockResolvedValue([]),
  canViewTeamResources: jest.fn().mockResolvedValue({ allowed: false, reason: 'Mock: access denied' }),
  isOrgAdminInAnyOrganization: jest.fn().mockResolvedValue(false),
  canAdministerAnyOrganization: jest.fn().mockResolvedValue({ allowed: false, reason: 'Mock: admin denied' }),
  getCapabilities: jest.fn().mockResolvedValue([]),
  invalidateUserCache: jest.fn().mockResolvedValue(undefined),
});
