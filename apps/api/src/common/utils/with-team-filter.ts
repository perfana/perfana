/**
 * withTeamFilter — resolves accessible team IDs for list-filtering.
 *
 * Returns `null` for global admins (caller should skip the team filter).  Returns the
 * array of accessible team IDs for everyone else (may be empty, which means the user
 * has no team-scoped access — caller decides whether that means "no team filter" or
 * "exclude team-scoped rows" depending on the query).
 *
 * Mirror of `withOrgFilter`, used wherever a list query needs the same admin-bypass
 * shape on team membership. See `apps/api/src/modules/test-runs/services/test-runs-query.service.ts`
 * for an example call site (`resolveTeamIds`).
 */
export async function withTeamFilter(
  userId: string,
  roles: string[],
  authzService: {
    isGlobalAdmin(roles: string[]): boolean;
    getAccessibleTeams(userId: string): Promise<string[]>;
  },
): Promise<string[] | null> {
  if (authzService.isGlobalAdmin(roles)) {
    return null;
  }
  return authzService.getAccessibleTeams(userId);
}
