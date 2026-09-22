/**
 * `findApplicationDashboardsByUidPattern` is what lets one `performance-metrics` profile
 * benchmark fan out over every perf-test scenario dashboard: a Postgres regex (`~`) over
 * `application_dashboards.dashboard_uid`, scoped to the SUT, environment and organization.
 * SUT names are unique per organization only, so without an organization it fails closed
 * rather than letting a name vouch for another org's SUT. The regex is evaluated by
 * Postgres, so a rejected one must surface as a thrown error rather than an empty result.
 */
import { DashboardFinderService } from './dashboard-finder.service';

function buildQueryBuilder(rows: unknown[] = []) {
  const qb: any = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
}

function build(rows: unknown[] = []) {
  const qb = buildQueryBuilder(rows);
  const applicationDashboardRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
  const service = new DashboardFinderService(
    {} as any,
    {} as any,
    {} as any,
    applicationDashboardRepo as any,
  );
  return { service, qb, applicationDashboardRepo };
}

describe('DashboardFinderService.findApplicationDashboardsByUidPattern', () => {
  it('matches the uid by regex, scoped to SUT, environment and organization', async () => {
    const rows = [{ id: 'ad-1' }, { id: 'ad-2' }];
    const { service, qb, applicationDashboardRepo } = build(rows);

    const result = await service.findApplicationDashboardsByUidPattern(
      '^performance-test-metrics-(?!all-aggregated$|default$)',
      'WERKNL',
      'acceptatie',
      'org-1',
    );

    expect(result).toBe(rows);
    expect(applicationDashboardRepo.createQueryBuilder).toHaveBeenCalledWith('ad');
    expect(qb.innerJoin).toHaveBeenCalledWith('ad.systemUnderTest', 'sut');
    // The regex can only narrow the perf-test set, never reach Grafana/Dynatrace dashboards.
    expect(qb.where).toHaveBeenCalledWith("ad.dashboardUid LIKE 'performance-test-metrics-%'");
    expect(qb.andWhere).toHaveBeenCalledWith('ad.dashboardUid ~ :uidPattern', {
      uidPattern: '^performance-test-metrics-(?!all-aggregated$|default$)',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('sut.name = :application', { application: 'WERKNL' });
    expect(qb.andWhere).toHaveBeenCalledWith('ad.testEnvironment = :testEnvironment', {
      testEnvironment: 'acceptatie',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('ad.organization_id = :organizationId', {
      organizationId: 'org-1',
    });
  });

  it.each([undefined, ''])(
    'fails closed without an organization (%p): [] and no query',
    async (orgId) => {
      const { service, applicationDashboardRepo } = build([{ id: 'would-leak' }]);

      const result = await service.findApplicationDashboardsByUidPattern(
        '^performance-test-metrics-',
        'WERKNL',
        'acceptatie',
        orgId as string | undefined,
      );

      expect(result).toEqual([]);
      expect(applicationDashboardRepo.createQueryBuilder).not.toHaveBeenCalled();
    },
  );

  it('does not swallow a Postgres regex error', async () => {
    const { service, qb } = build();
    qb.getMany.mockRejectedValue(
      new Error('invalid regular expression: parentheses () not balanced'),
    );

    await expect(
      service.findApplicationDashboardsByUidPattern(
        '^performance-test-metrics-(',
        'WERKNL',
        'acceptatie',
        'org-1',
      ),
    ).rejects.toThrow('invalid regular expression');
  });
});
