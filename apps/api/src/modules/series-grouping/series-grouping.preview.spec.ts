/**
 * POST /series-grouping-rules/preview: what a rule would do to a run's names, before it is saved.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DASHBOARD,
  ORG_A,
  ORG_B,
  POD_A1,
  POD_A2,
  POD_B1,
  POD_B2,
  RUN,
  expectNoDsMetricsRead,
  makeService,
  nameRow,
  type Route,
} from '../../test/series-grouping-insights-helpers';

const K8S_AVG = { preset: 'k8s-pod', aggregation: 'avg', trackMemberCount: false } as const;

const body = (overrides: Record<string, unknown> = {}) =>
  ({ testRunId: 'run-001', applicationDashboardId: DASHBOARD.id, panelId: 1, rule: K8S_AVG, ...overrides }) as never;

/** Baseline = control group of two runs; names for the run and for those runs. */
function baselineRoutes(names: ReturnType<typeof nameRow>[], extra: Route[] = []): Route[] {
  // The router takes the first match, so a caller's override has to come first.
  return [
    ...extra,
    [/sg:baseline \*\//, () => [{ test_runs: ['base-1', 'base-2'] }]],
    [/sg:names/, () => names],
    [/sg:benchmarks/, () => []],
    [/sg:alignment/, () => []],
  ];
}

const podNames = [
  nameRow('run-001', 1, POD_A1),
  nameRow('run-001', 1, POD_A2),
  nameRow('base-1', 1, POD_B1),
  nameRow('base-2', 1, POD_B2),
];

describe('SeriesGroupingInsightsService.preview', () => {
  describe('baseline and names', () => {
    it('uses the control group of the run and reads names for the run plus those baseline runs', async () => {
      const { service, db } = makeService(baselineRoutes(podNames));

      const result = await service.preview(body(), [ORG_A]);

      expect(result.testRunId).toBe('run-001');
      expect(result.baselineRunIds).toEqual(['base-1', 'base-2']);
      const names = db.calls.find((c) => /sg:names/.test(c.sql))!;
      expect(names.params[0]).toEqual(['run-001', 'base-1', 'base-2']);
    });

    it('falls back to the most recent completed runs when the run has no conclusion yet', async () => {
      const { service } = makeService(
        baselineRoutes(podNames, [
          [/sg:baseline \*\//, () => []],
          [/sg:baseline-fallback/, () => [{ test_run_id: 'base-1' }, { test_run_id: 'base-2' }]],
        ]),
      );

      const result = await service.preview(body(), [ORG_A]);

      expect(result.baselineRunIds).toEqual(['base-1', 'base-2']);
    });

    it('separates the run\'s raw names from the baseline\'s, sorted and de-duplicated', async () => {
      const { service } = makeService(
        baselineRoutes([
          nameRow('run-001', 1, POD_A2),
          nameRow('run-001', 1, POD_A1),
          nameRow('run-001', 1, POD_A1, 'Panel 1 renamed'),
          nameRow('base-1', 1, POD_B1),
          nameRow('base-2', 1, POD_B1),
        ]),
      );

      const { panels } = await service.preview(body(), [ORG_A]);

      expect(panels).toEqual([
        { panelId: 1, panelTitle: 'Panel 1', currentNames: [POD_A1, POD_A2], baselineNames: [POD_B1] },
      ]);
    });

    it('never reads ds_metrics: names come from the statistics and membership tables', async () => {
      const { service, db } = makeService(baselineRoutes(podNames));

      await service.preview(body(), [ORG_A]);

      const names = db.calls.find((c) => /sg:names/.test(c.sql))!;
      expect(names.sql).toMatch(/\bds_metric_series_groups\b/);
      expect(names.sql).toMatch(/\bds_metric_statistics\b/);
      // The statistics side must defer to membership: a grouped panel's statistics hold GROUP
      // names, so its raw names are only in the membership table.
      expect(names.sql).toMatch(/NOT EXISTS[\s\S]*ds_metric_series_groups/);
      expectNoDsMetricsRead(db.calls);
    });

    it('a dashboard-wide preview covers every panel the run has and skips panels the run lacks', async () => {
      const { service, db } = makeService(
        baselineRoutes([
          nameRow('run-001', 1, POD_A1),
          nameRow('run-001', 2, 'db-0'),
          nameRow('base-1', 3, 'only-in-baseline'),
        ]),
      );

      const { panels } = await service.preview(body({ panelId: undefined }), [ORG_A]);

      expect(panels.map((p) => p.panelId)).toEqual([1, 2]);
      const names = db.calls.find((c) => /sg:names/.test(c.sql))!;
      expect(names.sql).not.toMatch(/panel_id = \$3/);
    });

    it('a dashboard-wide preview leaves out a panel that has its own enabled rule: that rule overrides it', async () => {
      const panelRule = {
        id: 'rule-p2',
        application_dashboard_id: DASHBOARD.id,
        panel_id: 2,
        preset: 'trailing-id',
        pattern: null,
        replacement: '',
        aggregation: 'avg',
        track_member_count: false,
      };
      const { service } = makeService(
        baselineRoutes([nameRow('run-001', 1, POD_A1), nameRow('run-001', 2, 'x-abcd1')], [
          [/sg:rules/, () => [panelRule]],
        ]),
      );

      const dashboardWide = await service.preview(body({ panelId: null }), [ORG_A]);
      const forThatPanel = await service.preview(body({ panelId: 2 }), [ORG_A]);

      expect(dashboardWide.panels.map((p) => p.panelId)).toEqual([1]);
      expect(forThatPanel.panels.map((p) => p.panelId)).toEqual([2]);
    });
  });

  describe('without a test run (the system configuration entry point)', () => {
    it('uses the workload\'s most recent completed run', async () => {
      const { service, db } = makeService(
        baselineRoutes(podNames, [
          [/sg:workload-run/, () => [RUN]],
        ]),
      );

      const result = await service.preview(
        body({ testRunId: undefined, systemId: 'sut-1', environment: 'acc', workload: 'peak' }),
        [ORG_A],
      );

      expect(result.testRunId).toBe('run-001');
      const lookup = db.calls.find((c) => /sg:workload-run/.test(c.sql))!;
      expect(lookup.sql).toMatch(/completed = true/);
      expect(lookup.sql).toMatch(/ORDER BY tr\.start_time DESC NULLS LAST/);
      expect(lookup.params.slice(0, 3)).toEqual(['sut-1', 'acc', 'peak']);
    });

    it('is scoped to the caller\'s organizations: another tenant\'s workload answers 404', async () => {
      const { service, db } = makeService(
        baselineRoutes(podNames, [
          [/sg:workload-run/, (params, sql) => (sql.includes('sut.organization_id = ANY') && !(params[params.length - 1] as string[]).includes(RUN.sutOrganizationId) ? [] : [RUN])],
        ]),
      );

      await expect(
        service.preview(body({ testRunId: undefined, systemId: 'sut-1', environment: 'acc', workload: 'peak' }), [ORG_B]),
      ).rejects.toBeInstanceOf(NotFoundException);
      const lookup = db.calls.find((c) => /sg:workload-run/.test(c.sql))!;
      expect(lookup.params[lookup.params.length - 1]).toEqual([ORG_B]);
    });

    it('answers 400 when neither a run nor the whole system, environment and workload is named', async () => {
      const { service, db } = makeService(baselineRoutes(podNames));

      await expect(
        service.preview(body({ testRunId: undefined, systemId: 'sut-1', environment: 'acc' }), [ORG_A]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('SLO warnings', () => {
    const benchmark = (overrides: Record<string, unknown> = {}) => ({
      id: 'bm-1',
      config_title: 'API response time',
      panel_title: 'Response time',
      match_pattern: null,
      config_match_pattern: '^api-',
      invert_match_pattern: null,
      panel_key: '1',
      ...overrides,
    });

    it('warns when an SLO pattern matches raw names but no group name', async () => {
      const { service } = makeService(baselineRoutes(podNames, [[/sg:benchmarks/, () => [benchmark()]]]));

      const { sloWarnings } = await service.preview(body(), [ORG_A]);

      expect(sloWarnings).toEqual([{ benchmarkId: 'bm-1', name: 'API response time', matchPattern: '^api-' }]);
    });

    it('does not warn when the pattern still matches a group name', async () => {
      const { service } = makeService(
        baselineRoutes(podNames, [[/sg:benchmarks/, () => [benchmark({ config_match_pattern: '^api' })]]]),
      );

      expect((await service.preview(body(), [ORG_A])).sloWarnings).toEqual([]);
    });

    it('does not warn about an SLO whose pattern matched nothing to begin with', async () => {
      const { service } = makeService(
        baselineRoutes(podNames, [[/sg:benchmarks/, () => [benchmark({ config_match_pattern: '^nothing' })]]]),
      );

      expect((await service.preview(body(), [ORG_A])).sloWarnings).toEqual([]);
    });

    it('reads the pattern from the column when the configuration carries none, and the configuration wins otherwise', async () => {
      const { service } = makeService(
        baselineRoutes(podNames, [
          [
            /sg:benchmarks/,
            () => [
              benchmark({ id: 'col', config_match_pattern: null, match_pattern: '^api-' }),
              benchmark({ id: 'both', config_match_pattern: '^api', match_pattern: '^api-' }),
            ],
          ],
        ]),
      );

      const { sloWarnings } = await service.preview(body(), [ORG_A]);

      expect(sloWarnings.map((w) => w.benchmarkId)).toEqual(['col']);
    });

    it('skips a stored pattern that is invalid or unsafe instead of failing the preview', async () => {
      const { service } = makeService(
        baselineRoutes(podNames, [
          [
            /sg:benchmarks/,
            () => [
              benchmark({ id: 'bad-syntax', config_match_pattern: '(' }),
              benchmark({ id: 'redos', config_match_pattern: '(a+)+' }),
              benchmark({ id: 'ok' }),
            ],
          ],
        ]),
      );

      const { sloWarnings } = await service.preview(body(), [ORG_A]);

      expect(sloWarnings.map((w) => w.benchmarkId)).toEqual(['ok']);
    });

    it('honours an inverted pattern: it names the series to EXCLUDE', async () => {
      // Inverted `^api-`: judged = names that do NOT match. Raw pod names all match, so nothing
      // was judged before; the group `api` does not match, so it is judged after. No warning.
      const { service } = makeService(
        baselineRoutes(podNames, [
          [/sg:benchmarks/, () => [benchmark({ invert_match_pattern: 'true' })]],
        ]),
      );

      expect((await service.preview(body(), [ORG_A])).sloWarnings).toEqual([]);
    });

    it('only considers enabled, valid metric SLOs of this dashboard and workload, and the system\'s own organization', async () => {
      const { service, db } = makeService(baselineRoutes(podNames));

      await service.preview(body(), [ORG_A]);

      const q = db.calls.find((c) => /sg:benchmarks/.test(c.sql))!;
      expect(q.sql).toMatch(/b\.enabled = true/);
      expect(q.sql).toMatch(/b\.valid = true/);
      expect(q.sql).toMatch(/COALESCE\(b\.benchmark_type, 'metric'\) = 'metric'/);
      expect(q.sql).toMatch(/application_dashboard_id = \$4/);
      expect(q.params).toEqual(['sut-1', 'acc', 'peak', DASHBOARD.id, ORG_A]);
    });

    it('ignores an SLO bound to a panel the preview does not cover', async () => {
      const { service } = makeService(
        baselineRoutes(podNames, [[/sg:benchmarks/, () => [benchmark({ panel_key: '99' }), benchmark({ id: 'nan', panel_key: 'abc' })]]]),
      );

      expect((await service.preview(body(), [ORG_A])).sloWarnings).toEqual([]);
    });
  });

  describe('raw name collisions', () => {
    it('lists a raw baseline name that equals a group name the rule produces', async () => {
      // A legend that was already `{{container}}` in an older run: its raw `api` would pool into
      // the new group `api` unless the older run is recalculated.
      const { service } = makeService(
        baselineRoutes([
          nameRow('run-001', 1, POD_A1),
          nameRow('run-001', 1, POD_A2),
          nameRow('base-1', 1, 'api'),
          nameRow('base-2', 1, 'unrelated'),
        ]),
      );

      expect((await service.preview(body(), [ORG_A])).rawNameCollisions).toEqual(['api']);
    });

    it('is not a collision when the run\'s own series is simply called that already', async () => {
      // `db` is not renamed by the rule, so baseline `db` matching it is an ordinary same-series match.
      const { service } = makeService(
        baselineRoutes([nameRow('run-001', 1, 'db'), nameRow('base-1', 1, 'db')]),
      );

      expect((await service.preview(body(), [ORG_A])).rawNameCollisions).toEqual([]);
    });
  });

  describe('alignment', () => {
    it('reports the average members per timestamp of groups an earlier rule already formed', async () => {
      const { service, db } = makeService(
        baselineRoutes(podNames, [
          [/sg:alignment/, () => [{ panel_id: 1, group_name: 'api', members: 2, avg_members: 1.100000023841858 }]],
        ]),
      );

      const { alignment } = await service.preview(body(), [ORG_A]);

      expect(alignment).toEqual([{ panelId: 1, group: 'api', members: 2, avgMembers: 1.1 }]);
      const q = db.calls.find((c) => /sg:alignment/.test(c.sql))!;
      expect(q.sql).toMatch(/\bds_metric_series_groups\b/);
      expect(q.params[0]).toBe('run-001');
    });

    it('drops alignment rows of panels the preview does not cover', async () => {
      const { service } = makeService(
        baselineRoutes(podNames, [
          [/sg:alignment/, () => [{ panel_id: 7, group_name: 'x', members: 3, avg_members: 1 }]],
        ]),
      );

      expect((await service.preview(body({ panelId: undefined }), [ORG_A])).alignment).toEqual([]);
    });
  });

  describe('validation', () => {
    it('refuses a performance test dashboard with 400: those never get rules', async () => {
      const { service } = makeService(baselineRoutes(podNames), {
        dashboard: { ...DASHBOARD, dashboardUid: 'performance-test-metrics-abc' },
      });

      await expect(service.preview(body(), [ORG_A])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an unsafe custom regex with the guard\'s reason', async () => {
      const { service } = makeService(baselineRoutes(podNames));

      await expect(
        service.preview(body({ rule: { preset: 'custom', pattern: '(a+)+', aggregation: 'avg', trackMemberCount: false } }), [ORG_A]),
      ).rejects.toThrow(/ReDoS/);
    });

    it('refuses a custom rule with no pattern', async () => {
      const { service } = makeService(baselineRoutes(podNames));

      await expect(
        service.preview(body({ rule: { preset: 'custom', aggregation: 'avg', trackMemberCount: false } }), [ORG_A]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('tenancy', () => {
    it('answers 404 for a run outside the caller\'s organizations, the same as for a missing run', async () => {
      const { service, db } = makeService(baselineRoutes(podNames));

      const denied = await service.preview(body(), [ORG_B]).catch((e) => e);
      const missing = await makeService(baselineRoutes(podNames, [[/sg:run \*\//, () => []]])).service
        .preview(body({ testRunId: 'no-such-run' }), [ORG_B])
        .catch((e) => e);

      expect(denied).toBeInstanceOf(NotFoundException);
      expect(denied.message).toBe(missing.message);
      // The org predicate is in the statement, not only in a post-filter.
      const lookup = db.calls.find((c) => /sg:run \*\//.test(c.sql))!;
      expect(lookup.sql).toMatch(/sut\.organization_id = ANY\(\$2::uuid\[\]\)/);
      expect(lookup.params).toEqual(['run-001', [ORG_B]]);
      expect(db.calls.some((c) => /sg:names/.test(c.sql))).toBe(false);
    });

    it('still refuses when a misbehaving lookup hands back another tenant\'s run', async () => {
      const { service } = makeService(baselineRoutes(podNames, [[/sg:run \*\//, () => [RUN]]]));

      await expect(service.preview(body(), [ORG_B])).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 404 for an empty organization list without touching the database', async () => {
      const { service, db } = makeService(baselineRoutes(podNames));

      await expect(service.preview(body(), [])).rejects.toBeInstanceOf(NotFoundException);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('lets a global admin (null) through with no organization predicate', async () => {
      const { service, db } = makeService(baselineRoutes(podNames));

      await expect(service.preview(body(), null)).resolves.toBeDefined();
      const lookup = db.calls.find((c) => /sg:run \*\//.test(c.sql))!;
      expect(lookup.sql).not.toMatch(/organization_id = ANY/);
    });

    it('answers 404 for a dashboard in another organization, with the missing-dashboard message', async () => {
      const foreign = makeService(baselineRoutes(podNames), { dashboard: { ...DASHBOARD, organizationId: ORG_B } });
      const missing = makeService(baselineRoutes(podNames), { dashboard: null });

      const a = await foreign.service.preview(body(), [ORG_A]).catch((e) => e);
      const b = await missing.service.preview(body(), [ORG_A]).catch((e) => e);

      expect(a).toBeInstanceOf(NotFoundException);
      expect(a.message).toBe(b.message);
    });

    it.each([
      ['another system', { systemUnderTestId: 'sut-2' }],
      ['another environment', { testEnvironment: 'prod' }],
    ])('answers 404 for a dashboard of %s than the run', async (_label, patch) => {
      const { service, db } = makeService(baselineRoutes(podNames), { dashboard: { ...DASHBOARD, ...patch } });

      await expect(service.preview(body(), [ORG_A])).rejects.toBeInstanceOf(NotFoundException);
      expect(db.calls.some((c) => /sg:names/.test(c.sql))).toBe(false);
    });

    it('resolves a run named by its entity UUID to the canonical test_run_id', async () => {
      const { service, db } = makeService(baselineRoutes(podNames));

      const result = await service.preview(body({ testRunId: RUN.id }), [ORG_A]);

      expect(result.testRunId).toBe('run-001');
      const lookup = db.calls.find((c) => /sg:run \*\//.test(c.sql))!;
      expect(lookup.sql).toMatch(/tr\.id = \$1::uuid/);
    });
  });
});
