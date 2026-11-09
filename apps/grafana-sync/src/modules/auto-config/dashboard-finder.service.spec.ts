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

describe('DashboardFinderService.findDynatraceHostPanelsByUidPattern', () => {
  function buildHosts(raw: unknown[], entities: unknown[]) {
    const ctx = build();
    Object.assign(ctx.qb, {
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({ raw, entities }),
    });
    return ctx;
  }

  it('scopes to Dynatrace dashboards, the run workload and enabled queries of that panel', async () => {
    const { service, qb } = buildHosts([], []);

    // A bare '.' must still be confined to the Dynatrace set by the LIKE guard.
    await service.findDynatraceHostPanelsByUidPattern(
      '.',
      'CPU Usage',
      'SHOP',
      'acc',
      'load',
      'org-1',
    );

    expect(qb.innerJoin).toHaveBeenCalledWith(
      'dynatrace_queries',
      'dq',
      'dq.application_dashboard_id = ad.id AND dq.system_under_test_id = sut.id',
    );
    expect(qb.where).toHaveBeenCalledWith("ad.dashboardUid LIKE 'dynatrace-%'");
    expect(qb.andWhere).toHaveBeenCalledWith('ad.dashboardUid ~ :uidPattern', { uidPattern: '.' });
    expect(qb.andWhere).toHaveBeenCalledWith('sut.name = :application', { application: 'SHOP' });
    expect(qb.andWhere).toHaveBeenCalledWith('ad.organization_id = :organizationId', {
      organizationId: 'org-1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('dq.test_environment = :testEnvironment', {
      testEnvironment: 'acc',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('dq.workload = :workload', { workload: 'load' });
    expect(qb.andWhere).toHaveBeenCalledWith('dq.panel_title = :panelTitle', {
      panelTitle: 'CPU Usage',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('dq.enabled = true');
  });

  it.each([undefined, ''])(
    'fails closed without an organization (%p): [] and no query',
    async (orgId) => {
      const { service, applicationDashboardRepo } = buildHosts(
        [{ ad_id: 'x', dq_panel_id: 1 }],
        [{ id: 'x' }],
      );

      const result = await service.findDynatraceHostPanelsByUidPattern(
        '^dynatrace-',
        'CPU Usage',
        'SHOP',
        'acc',
        'load',
        orgId as string | undefined,
      );

      expect(result).toEqual([]);
      expect(applicationDashboardRepo.createQueryBuilder).not.toHaveBeenCalled();
    },
  );

  it("returns one row per host with that host's own numeric panel id", async () => {
    const a = { id: 'ad-a' };
    const b = { id: 'ad-b' };
    const { service } = buildHosts(
      [
        { ad_id: 'ad-a', dq_panel_id: '41234' },
        { ad_id: 'ad-a', dq_panel_id: '41234' }, // host added twice: one SLO
        { ad_id: 'ad-b', dq_panel_id: 'not-a-number' }, // dropped
        { ad_id: 'ad-b', dq_panel_id: 7 },
        { ad_id: 'ad-gone', dq_panel_id: 9 }, // no entity: dropped
      ],
      [a, b],
    );

    const result = await service.findDynatraceHostPanelsByUidPattern(
      '^dynatrace-',
      'CPU Usage',
      'SHOP',
      'acc',
      'load',
      'org-1',
    );

    expect(result).toEqual([
      { applicationDashboard: a, panelId: 41234 },
      { applicationDashboard: b, panelId: 7 },
    ]);
  });
});
