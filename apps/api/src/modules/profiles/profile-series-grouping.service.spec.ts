import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProfileSeriesGroupingService } from './profile-series-grouping.service';

jest.mock('../../common/db/request-em', () => ({
  withRequestEm: (repo: unknown) => repo,
  withRequestQuery: (ds: unknown) => ds,
}));

const stored = () => ({
  id: 'rule-1',
  profileDashboardId: 'pd-1',
  panelId: 7,
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregations: ['avg'],
  enabled: true,
  organizationId: 'org-1',
  createdAt: new Date(),
  updatedAt: new Date(),
});

function setup() {
  const repo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(stored()),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...stored(), ...x })),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const profiles = {
    requireProfileDashboard: jest.fn().mockResolvedValue({
      profile: { id: 'p-1', organizationId: 'org-1' },
      dashboard: { id: 'pd-1', organizationId: 'org-1', teamId: undefined },
    }),
  };
  const audit = { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() };
  const calls: string[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      calls.push(sql.trim().split(/\s+/)[0]!);
      return [[], 2];
    }),
  };
  repo.remove.mockImplementation(async () => {
    calls.push('REMOVE');
  });
  const service = new ProfileSeriesGroupingService(repo as never, profiles as never, audit as never, dataSource as never);
  return { service, repo, profiles, dataSource, calls };
}

describe('ProfileSeriesGroupingService', () => {
  it('requires write access before creating, and stores canonical aggregations', async () => {
    const { service, repo, profiles } = setup();
    await service.create('p-1', 'pd-1', { preset: 'k8s-pod', aggregations: ['count', 'avg'] } as never, 'u', ['org-1']);
    expect(profiles.requireProfileDashboard).toHaveBeenCalledWith('p-1', 'pd-1', 'u', ['org-1'], true);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ aggregations: ['avg', 'count'], organizationId: 'org-1', panelId: null }));
  });

  it('refuses an unsafe custom rule with a 400', async () => {
    const { service } = setup();
    await expect(
      service.create('p-1', 'pd-1', { preset: 'custom', pattern: '(a+)+$', aggregations: ['avg'] } as never, 'u', null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps an occupied slot to 409', async () => {
    const { service, repo } = setup();
    repo.save.mockRejectedValueOnce({ code: '23505', constraint: 'uq_profile_series_grouping_rules_slot' });
    await expect(
      service.create('p-1', 'pd-1', { preset: 'k8s-pod', aggregations: ['avg'] } as never, 'u', null),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('carries an edit to the provisioned rules it still owns, in the profile organization', async () => {
    const { service, dataSource } = setup();
    await service.update('p-1', 'pd-1', 'rule-1', { preset: 'ip-port', enabled: false }, 'u', null);
    const [sql, params] = dataSource.query.mock.calls[0]!;
    expect(sql).toContain('WHERE profile_rule_id = $1 AND organization_id = $2 AND updated_by IS NULL');
    expect(params).toEqual(['rule-1', 'org-1', 'ip-port', null, '', ['avg'], false]);
  });

  // A copy is found by its rule id only after the rule is gone: grafana-sync's insert locks the rule
  // FOR SHARE, so a racing insert either waits and copies nothing or is seen by this later DELETE.
  it('deletes the rule first, then its owned provisioned copies by id', async () => {
    const { service, calls, dataSource } = setup();
    await service.remove('p-1', 'pd-1', 'rule-1', 'u', null);
    expect(calls).toEqual(['REMOVE', 'DELETE']);
    expect(dataSource.query.mock.calls[0]![1]).toEqual([['rule-1'], 'org-1']);
  });

  // Value: protects=reading a profile dashboard's rules needs read scope only, and lists that dashboard's rules alone;
  //   fails_when=findAll passes write=true (403 for org members who can see the profile) or drops the dashboard filter;
  // why_new=findAll was untested; seam=none; no_claim=ordering in SQL (repo mocked; unit only)
  it('lists the resolved dashboard\'s rules with read access only', async () => {
    const { service, repo, profiles } = setup();
    repo.find.mockResolvedValueOnce([stored()]);
    const rules = await service.findAll('p-1', 'pd-1', 'u', ['org-1']);
    expect(profiles.requireProfileDashboard).toHaveBeenCalledWith('p-1', 'pd-1', 'u', ['org-1'], false);
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { profileDashboardId: 'pd-1' } }));
    expect(rules).toEqual([expect.objectContaining({ id: 'rule-1', profileDashboardId: 'pd-1', panelId: 7 })]);
  });

  it("answers 404 for another dashboard's rule", async () => {
    const { service, repo } = setup();
    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.update('p-1', 'pd-1', 'x', {}, 'u', null)).rejects.toBeInstanceOf(NotFoundException);
  });
});
