import { Logger } from '@nestjs/common';
import { resolveGrafanaInstanceByLabel } from './grafana-instance-resolver';

/**
 * `grafana_instances.label` has no unique constraint and grafana-sync sets no RLS
 * context, so a label alone does not identify an instance on a multi-organization
 * deploy. These cases pin the three answers that matter:
 *
 *  - scoped: the organization reaches the SQL, not just the result
 *  - ambiguous: refuse, rather than hand back an arbitrary tenant's Grafana
 *  - single-org: an unscoped call with exactly one match still works, which is what
 *    keeps every existing deploy running
 */
describe('resolveGrafanaInstanceByLabel', () => {
  const instanceA = { id: 'a', label: 'prod', organizationId: 'org-1' };
  const instanceB = { id: 'b', label: 'prod', organizationId: 'org-2' };

  let logger: Logger;
  let errorSpy: jest.Mock;

  const repoFor = (rows: unknown[]) => {
    const predicates: Array<[string, unknown]> = [];
    const qb: Record<string, jest.Mock> = {
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    for (const key of ['where', 'andWhere'] as const) {
      qb[key]!.mockImplementation((sql: string, params: unknown) => {
        predicates.push([sql, params]);
        return qb;
      });
    }
    qb.orderBy!.mockReturnValue(qb);
    qb.take!.mockReturnValue(qb);
    return {
      repo: { createQueryBuilder: jest.fn().mockReturnValue(qb) } as never,
      predicates,
      qb,
    };
  };

  beforeEach(() => {
    errorSpy = jest.fn();
    logger = { error: errorSpy } as unknown as Logger;
  });

  it('puts the organization in the query, not just in the filtering', async () => {
    const { repo, predicates } = repoFor([instanceA]);

    const result = await resolveGrafanaInstanceByLabel(repo, logger, 'prod', 'org-1');

    expect(result).toBe(instanceA);
    // Asserting on the emitted predicate rather than the returned row: a version that
    // fetched every label match and filtered in JS would pass a result-only assertion
    // while still reading another tenant's rows out of the database.
    expect(predicates).toEqual([
      ['gi.label = :label', { label: 'prod' }],
      ['gi.organizationId = :orgId', { orgId: 'org-1' }],
    ]);
  });

  it('refuses to guess when a label matches two organizations', async () => {
    const { repo } = repoFor([instanceA, instanceB]);

    const result = await resolveGrafanaInstanceByLabel(repo, logger, 'prod');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('refusing to guess'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no organization was supplied'));
  });

  it('refuses even WITHIN one organization — two instances, one label is still ambiguous', async () => {
    const { repo } = repoFor([instanceA, { ...instanceA, id: 'c' }]);

    const result = await resolveGrafanaInstanceByLabel(repo, logger, 'prod', 'org-1');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('in organization org-1'));
  });

  it('still resolves an unscoped single match, so a single-org deploy is unaffected', async () => {
    const { repo, predicates } = repoFor([instanceA]);

    const result = await resolveGrafanaInstanceByLabel(repo, logger, 'prod');

    expect(result).toBe(instanceA);
    expect(predicates).toEqual([['gi.label = :label', { label: 'prod' }]]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null without logging when nothing matches', async () => {
    const { repo } = repoFor([]);

    expect(await resolveGrafanaInstanceByLabel(repo, logger, 'nope', 'org-1')).toBeNull();
    // Not found is an ordinary outcome the callers already handle; only ambiguity is
    // an operator error worth an ERROR line.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('asks for two rows, so the ambiguity is visible at all', async () => {
    const { repo, qb } = repoFor([instanceA]);

    await resolveGrafanaInstanceByLabel(repo, logger, 'prod', 'org-1');

    // getOne() / take(1) would hide a second match behind the same arbitrary pick this
    // function exists to remove, and every ambiguity case above would pass vacuously.
    expect(qb.take).toHaveBeenCalledWith(2);
  });

  it('treats an empty-string organization as unscoped rather than matching on it', async () => {
    const { repo, predicates } = repoFor([instanceA]);

    await resolveGrafanaInstanceByLabel(repo, logger, 'prod', '');

    expect(predicates).toHaveLength(1);
  });
});
