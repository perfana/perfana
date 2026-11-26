import {
  GroupingRuleProcessorService,
  PROFILE_GROUPING_ACTOR,
  type ProfileGroupingRuleRow,
} from './grouping-rule-processor.service';

const rule = (over: Partial<ProfileGroupingRuleRow> = {}): ProfileGroupingRuleRow => ({
  id: 'rule-1',
  profile: 'k8s',
  dashboard_uid: 'tmpl-uid',
  panel_id: 7,
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregations: ['avg', 'count'],
  enabled: true,
  ...over,
});

const testRun = (over: Record<string, unknown> = {}) =>
  ({
    testRunId: 'run-1',
    testEnvironment: 'acc',
    workload: 'peak',
    organizationId: 'org-1',
    systemUnderTest: { name: 'shop' },
    ...over,
  }) as never;

function setup(
  dashboards = [{ id: 'ad-1', systemUnderTestId: 'sut-1', organizationId: 'org-1', teamId: null }],
) {
  const query = jest.fn().mockResolvedValue([{ inserted: true }]);
  const finder = {
    findApplicationDashboardsByTemplateDashboardUid: jest.fn().mockResolvedValue(dashboards),
  };
  const service = new GroupingRuleProcessorService({ query } as never, finder as never);
  return { service, query, finder };
}

describe('GroupingRuleProcessorService', () => {
  it('upserts a matching profile rule onto each application dashboard of the template, in the run workload', async () => {
    const { service, query, finder } = setup();
    await service.processProfileGroupingRules(
      testRun(),
      ['k8s'],
      [rule(), rule({ id: 'other', profile: 'not-matched' })],
    );

    expect(finder.findApplicationDashboardsByTemplateDashboardUid).toHaveBeenCalledWith(
      'tmpl-uid',
      'shop',
      'acc',
      'org-1',
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT uq_series_grouping_rules_slot DO UPDATE');
    // Only a row this profile rule owns, and nobody edited, is re-synced.
    expect(sql).toContain('s.profile_rule_id = EXCLUDED.profile_rule_id AND s.updated_by IS NULL');
    // The rule's fields come from profile_series_grouping_rules at write time, not from this
    // pass's in-memory copy, so a rule deleted mid-pass inserts nothing (verified against Postgres).
    expect(sql).toContain('FROM profile_series_grouping_rules r');
    expect(sql).toContain('WHERE r.id = $5');
    expect(params).toEqual([
      'sut-1',
      'acc',
      'peak',
      'ad-1',
      'rule-1',
      'org-1',
      null,
      PROFILE_GROUPING_ACTOR,
      'tmpl-uid',
    ]);
    // Waits for an API delete or re-point, re-checks the template, and copies only enabled rules.
    expect(sql).toContain('FOR SHARE OF r, d');
    expect(sql).toContain('r.enabled AND d.dashboard_uid = $9');
  });

  it('looks each template up once per run, however many of its panels carry a rule', async () => {
    const { service, finder } = setup();
    await service.processProfileGroupingRules(
      testRun(),
      ['k8s'],
      [rule(), rule({ id: 'rule-2', panel_id: 8 })],
    );
    expect(finder.findApplicationDashboardsByTemplateDashboardUid).toHaveBeenCalledTimes(1);
  });

  it('reports a row nobody had to change as unchanged, and a re-synced one as updated', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ inserted: false }]);
    const log = jest
      .spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
      .mockImplementation(() => undefined);
    await service.processProfileGroupingRules(
      testRun(),
      ['k8s'],
      [rule(), rule({ id: 'rule-2', panel_id: 8 })],
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('0 created, 1 re-synced'));
  });

  it('writes nothing for a run without a workload', async () => {
    const { service, query } = setup();
    await service.processProfileGroupingRules(testRun({ workload: '' }), ['k8s'], [rule()]);
    expect(query).not.toHaveBeenCalled();
  });

  // Value: protects=a SQL-written invalid rule never reaches the INSERT; fails_when=the compile guard is removed;
  // why_new=the old combined case passed without it (its only dashboard had no org); seam=none; no_claim=none beyond protects
  it('skips a rule that does not compile but still provisions the valid one', async () => {
    const { service, query } = setup();
    await service.processProfileGroupingRules(
      testRun(),
      ['k8s'],
      [rule({ id: 'bad', preset: 'custom', pattern: null }), rule()],
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1][4]).toBe('rule-1');
  });

  it('skips an application dashboard with no organization', async () => {
    const { service, query } = setup([
      { id: 'ad-1', systemUnderTestId: 'sut-1', organizationId: null as never, teamId: null },
    ]);
    await service.processProfileGroupingRules(testRun(), ['k8s'], [rule()]);
    expect(query).not.toHaveBeenCalled();
  });

  // Value: protects=a template that cannot be looked up fails only the rules on it; fails_when=the lookup is
  //   awaited outside a try again, so one bad template aborts every rule of the run; why_new=no rejected-lookup
  //   case existed; seam=none; no_claim=none beyond protects
  it('keeps provisioning other templates when one template lookup fails', async () => {
    const { service, query, finder } = setup();
    finder.findApplicationDashboardsByTemplateDashboardUid.mockImplementation(
      async (uid: string) => {
        if (uid === 'broken') throw new Error('lookup failed');
        return [{ id: 'ad-1', systemUnderTestId: 'sut-1', organizationId: 'org-1', teamId: null }];
      },
    );
    jest
      .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    await service.processProfileGroupingRules(
      testRun(),
      ['k8s'],
      [rule({ id: 'b', dashboard_uid: 'broken' }), rule()],
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1][4]).toBe('rule-1');
  });

  it('keeps going after one dashboard fails', async () => {
    const { service, query } = setup([
      { id: 'ad-1', systemUnderTestId: 'sut-1', organizationId: 'org-1', teamId: null },
      { id: 'ad-2', systemUnderTestId: 'sut-1', organizationId: 'org-1', teamId: null },
    ]);
    query.mockRejectedValueOnce(new Error('boom'));
    await service.processProfileGroupingRules(testRun(), ['k8s'], [rule()]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  // Value: protects=an org-scoped auto-config pass reads only its organizations' profile rules;
  //   fails_when=the WHERE or its [orgIds] param is dropped, or an empty list is sent as ANY('{}');
  // why_new=only the pre-1826 error path was tested; seam=none; no_claim=the SQL against Postgres (query mocked)
  it("reads only the given organizations' rules, and every rule when none are given", async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([rule()]);
    await expect(service.findProfileGroupingRules(['org-1', 'org-2'])).resolves.toEqual([rule()]);
    expect(query.mock.calls[0][0]).toContain('WHERE r.organization_id = ANY($1::uuid[])');
    expect(query.mock.calls[0][1]).toEqual([['org-1', 'org-2']]);

    for (const orgs of [undefined, []]) {
      query.mockClear();
      query.mockResolvedValueOnce([]);
      await service.findProfileGroupingRules(orgs);
      expect(query.mock.calls[0][0]).not.toContain('WHERE');
      expect(query.mock.calls[0][1]).toEqual([]);
    }
  });

  it('reads no rules, rather than failing the pass, before migration 1826', async () => {
    const { service, query } = setup();
    const warn = jest
      .spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    query.mockRejectedValueOnce(
      Object.assign(new Error('relation "profile_series_grouping_rules" does not exist'), {
        code: '42P01',
      }),
    );
    await expect(service.findProfileGroupingRules(['org-1'])).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('migration 1826 not applied'));
  });

  // Value: protects=an unrelated read failure is logged as itself, not blamed on the migration;
  // fails_when=every error is reported as a missing migration again; why_new=only 42P01 was tested;
  // seam=none; no_claim=none beyond protects
  it('logs any other read failure as an error without blaming the migration', async () => {
    const { service, query } = setup();
    const logger = (
      service as unknown as { logger: { warn: (m: string) => void; error: (m: string) => void } }
    ).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    query.mockRejectedValueOnce(
      Object.assign(new Error('Connection terminated'), { code: '57P01' }),
    );
    await expect(service.findProfileGroupingRules(['org-1'])).resolves.toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Connection terminated'));
    expect(warn).not.toHaveBeenCalled();
  });

  // Value: protects=a grouping rule pass writes only onto its own combination's dashboards (target) or the run's own (master); fails_when=the .then(dashboardsForCombination) filter is dropped; why_new=existing cases never set a label or target; seam=none; no_claim=SQL text
  it('keeps each pass to its own combination of the template dashboards', async () => {
    const rows = [
      {
        id: 'ad-own',
        dashboardLabel: 'K8s',
        systemUnderTestId: 'sut-1',
        organizationId: 'org-1',
        teamId: null,
      },
      {
        id: 'ad-db',
        dashboardLabel: 'K8s - db acc',
        variables: [
          { name: 'system_under_test', values: ['db'] },
          { name: 'test_environment', values: ['acc'] },
        ],
        systemUnderTestId: 'sut-1',
        organizationId: 'org-1',
        teamId: null,
      },
    ];
    const run = testRun({
      additionalSutMonitoring: [{ systemUnderTest: 'db', testEnvironment: 'acc' }],
    });
    const a = setup(rows as never);
    await a.service.processProfileGroupingRules(run, ['k8s'], [rule()], {
      systemUnderTest: 'db',
      testEnvironment: 'acc',
    });
    expect(a.query.mock.calls.map((c) => c[1][3])).toEqual(['ad-db']);
    const b = setup(rows as never);
    await b.service.processProfileGroupingRules(run, ['k8s'], [rule()]);
    expect(b.query.mock.calls.map((c) => c[1][3])).toEqual(['ad-own']);
  });
});
