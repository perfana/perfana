/**
 * withOrgFilter — resolves accessible organization IDs for list-filtering.
 *
 * Returns `null` for global admins (caller should skip the filter and return all
 * resources).  Returns the array of accessible organization IDs for everyone else
 * (may be empty, which means the caller should return nothing).
 *
 * Usage:
 * ```typescript
 * const orgIds = await withOrgFilter(userId, roles, this.authzService);
 * if (orgIds !== null) {
 *   items = items.filter(i => !i.organizationId || orgIds.includes(i.organizationId));
 * }
 * ```
 */
export async function withOrgFilter(
  userId: string,
  roles: string[],
  authzService: {
    isGlobalAdmin(roles: string[]): boolean;
    getAccessibleOrganizations(userId: string): Promise<string[]>;
  },
): Promise<string[] | null> {
  if (authzService.isGlobalAdmin(roles)) {
    return null;
  }
  return authzService.getAccessibleOrganizations(userId);
}
