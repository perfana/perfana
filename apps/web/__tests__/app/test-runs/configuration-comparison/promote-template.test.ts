import {
  buildPromotedDefinition,
  buildPromoteTargets,
  defaultDashboardScope,
  type PromotedConfig,
  type PromoteSource,
} from '@/app/test-runs/[id]/components/configuration-comparison/promote-template';

const source: PromoteSource = {
  dashboardUid: 'jvm-overview',
  dashboardLabel: 'JVM',
  panelId: '7',
  panelTitle: 'Heap used',
  metricName: 'heap used',
};

const config: PromotedConfig = {
  ignore: false,
  classification: 'USE_saturation',
  higherIsBetter: false,
  aggregation: 'q95',
  percentageThreshold: 15,
  iqrThreshold: 2,
  absoluteThreshold: null,
  defaultValueIfControlGroupMissing: null,
};

describe('buildPromotedDefinition', () => {
  it('this dashboard: exact uid, panel id, title as a label, percent stored as a fraction', () => {
    expect(buildPromotedDefinition(source, config, { dashboard: 'uid', metric: false })).toEqual({
      dashboardUid: 'jvm-overview',
      dashboardLabel: 'JVM',
      panelId: 7,
      panelTitle: 'Heap used',
      metricClassification: 'USE_saturation',
      higherIsBetter: false,
      aggregation: 'q95',
      percentageThreshold: 0.15,
      iqrThreshold: 2,
      absThreshold: null,
    });
  });

  it('every dashboard with this panel title: no uid, no panel id, the title is the identity', () => {
    const def = buildPromotedDefinition(source, config, { dashboard: 'title', metric: false });
    expect(def).not.toHaveProperty('dashboardUid');
    expect(def).not.toHaveProperty('panelId');
    expect(def).not.toHaveProperty('dashboardLabel');
    expect(def.panelTitle).toBe('Heap used');
  });

  it('a row with no uid can only match by title, whatever was asked', () => {
    const def = buildPromotedDefinition({ ...source, dashboardUid: null }, config, { dashboard: 'uid', metric: false });
    expect(def).not.toHaveProperty('dashboardUid');
    expect(def).not.toHaveProperty('panelId');
  });

  it('takes the metric only for a metric-level template', () => {
    expect(buildPromotedDefinition(source, config, { dashboard: 'uid', metric: true }).metricName).toBe('heap used');
    expect(buildPromotedDefinition(source, config, { dashboard: 'uid', metric: false })).not.toHaveProperty('metricName');
  });

  it('names ignore and the no-baseline value only when set, and empty thresholds not at all', () => {
    const off = buildPromotedDefinition(source, { ...config, percentageThreshold: null, iqrThreshold: null }, { dashboard: 'uid', metric: false });
    expect(off).not.toHaveProperty('ignore');
    expect(off).not.toHaveProperty('defaultValueIfControlGroupMissing');
    expect(off).not.toHaveProperty('percentageThreshold');
    expect(off).not.toHaveProperty('iqrThreshold');

    const on = buildPromotedDefinition(source, { ...config, ignore: true, defaultValueIfControlGroupMissing: 0, absoluteThreshold: 5 }, { dashboard: 'uid', metric: false });
    expect(on).toMatchObject({ ignore: true, defaultValueIfControlGroupMissing: 0, absThreshold: 5 });
  });
});

describe('defaultDashboardScope', () => {
  it('defaults to the title for per-host and per-scenario uids, for the all-dashboards radio and without a uid', () => {
    expect(defaultDashboardScope(source, 'panel')).toBe('uid');
    expect(defaultDashboardScope({ ...source, dashboardUid: 'dynatrace-dynatrace-host-metrics-web1' }, 'panel')).toBe('title');
    expect(defaultDashboardScope({ ...source, dashboardUid: 'performance-test-metrics-checkout' }, 'metric')).toBe('title');
    expect(defaultDashboardScope(source, 'all-dashboards')).toBe('title');
    expect(defaultDashboardScope({ ...source, dashboardUid: undefined }, 'panel')).toBe('title');
  });
});

describe('buildPromoteTargets', () => {
  const orgs = [{ id: 'org-a', name: 'Acme' }];
  const profiles = [
    { id: 'p2', name: 'zeta', tags: ['jvm'] },
    { id: 'p1', name: 'alpha', tags: ['jvm', 'k8s'] },
    { id: 'p3', name: 'other', tags: ['dotnet'] },
  ];

  it('offers the matching profiles by name, then the organization, then the install for an admin', () => {
    const targets = buildPromoteTargets({ organizationId: 'org-a', tags: ['jvm'] }, orgs, profiles, true);
    expect(targets.map((t) => t.label)).toEqual(['Profile alpha', 'Profile zeta', 'All runs in Acme', 'All runs on this install']);
    expect(targets[0].scope).toEqual({ kind: 'profile', profileId: 'p1' });
  });

  it('offers no install scope to a non-admin and no profile to an untagged run', () => {
    expect(buildPromoteTargets({ organizationId: 'org-a', tags: [] }, orgs, profiles, false).map((t) => t.key)).toEqual(['org-a']);
  });

  it('fails closed without the run organization: neither profiles nor an organization', () => {
    expect(buildPromoteTargets({ organizationId: null, tags: ['jvm'] }, orgs, profiles, false)).toEqual([]);
  });
});
