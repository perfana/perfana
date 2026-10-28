/**
 * Test helpers for the org-scoped name/id lookups added in v0.2.97.39.
 *
 * Several services used to resolve a system under test with
 * `findOne({ where: { name } })` and now build a query instead, because
 * `uq_system_under_test_name_org` scopes the name per organization and a bare name is
 * ambiguous across tenants. A spec that still stubs `repo.findOne` is stubbing a call
 * that no longer happens — these two helpers stub what does.
 */

/**
 * Stub a repository's `createQueryBuilder` for a scoped lookup.
 *
 * Pass the rows the query should return: `[]` for not-found, one row for the normal
 * case, and TWO rows to exercise the refuse-on-ambiguity branch, which is the branch
 * these lookups exist for.
 *
 * The returned `predicates` captures every `where`/`andWhere` so a test can assert the
 * organization reached the SQL. That matters more than the returned row: a version that
 * fetched every match and filtered in JS would satisfy a result-only assertion while
 * still reading another tenant's rows out of the database.
 */
export function stubScopedLookup(
  repo: { createQueryBuilder?: jest.Mock },
  rows: unknown[],
): { predicates: Array<[string, unknown]>; qb: Record<string, jest.Mock> } {
  // Several repo mocks in this repo predate the query-builder lookups and only stub
  // findOne/save, so install the method rather than requiring every spec to add it.
  if (typeof repo.createQueryBuilder !== 'function') {
    repo.createQueryBuilder = jest.fn();
  }
  const predicates: Array<[string, unknown]> = [];
  const qb: Record<string, jest.Mock> = {
    where: jest.fn(),
    andWhere: jest.fn(),
    leftJoin: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    innerJoin: jest.fn(),
    select: jest.fn(),
    orderBy: jest.fn(),
    take: jest.fn(),
    getOne: jest.fn().mockResolvedValue(rows[0] ?? null),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  for (const key of ['where', 'andWhere'] as const) {
    qb[key]!.mockImplementation((sql: string, params: unknown) => {
      predicates.push([sql, params]);
      return qb;
    });
  }
  for (const key of ['leftJoin', 'leftJoinAndSelect', 'innerJoin', 'select', 'orderBy', 'take'] as const) {
    qb[key]!.mockReturnValue(qb);
  }
  repo.createQueryBuilder!.mockReturnValue(qb as never);
  return { predicates, qb };
}

/**
 * Make an `AuthorizationService` mock answer as a member of `orgIds`.
 *
 * `withOrgFilter` calls `isGlobalAdmin` first and only then
 * `getAccessibleOrganizations`, so a mock that stubs neither returns `undefined` and
 * the caller's `.length` throws — which is how an incomplete mock shows up, as a
 * TypeError rather than as an authorization failure.
 */
export function asOrgMember(
  authz: { isGlobalAdmin: jest.Mock; getAccessibleOrganizations: jest.Mock },
  orgIds: string[] = ['org-1'],
): void {
  authz.isGlobalAdmin.mockReturnValue(false);
  authz.getAccessibleOrganizations.mockResolvedValue(orgIds);
}

/** Make an `AuthorizationService` mock answer as a global admin (no org filter). */
export function asGlobalAdmin(
  authz: { isGlobalAdmin: jest.Mock; getAccessibleOrganizations: jest.Mock },
): void {
  authz.isGlobalAdmin.mockReturnValue(true);
  authz.getAccessibleOrganizations.mockResolvedValue([]);
}
