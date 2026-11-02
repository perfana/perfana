/**
 * GET /test-runs/:id/series-grouping-suggestions: panels where a preset would fix `incomparable`.
 */

import { Logger, NotFoundException } from '@nestjs/common';
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

const incomparablePanel = (panelId: number, count: number, overrides: Record<string, unknown> = {}) => ({
  application_dashboard_id: DASHBOARD.id,
  dashboard_label: 'Kubernetes pods',
  panel_id: panelId,
  panel_title: `Panel ${panelId}`,
  incomparable_count: count,
  ...overrides,
});

const controlName = (panelId: number, metricName: string) => ({
  application_dashboard_id: DASHBOARD.id,
  panel_id: panelId,
  metric_name: metricName,
});

function routes(opts: {
  panels?: ReturnType<typeof incomparablePanel>[];
  current?: ReturnType<typeof nameRow>[];
  baseline?: ReturnType<typeof controlName>[];
  controlGroupId?: string | null;
  extra?: Route[];
}): Route[] {
  return [
    [/sg:incomparable/, () => opts.panels ?? []],
    [/sg:control-group/, () => [{ control_group_id: opts.controlGroupId === undefined ? 'cg-1' : opts.controlGroupId }]],
    [/sg:names/, () => opts.current ?? []],
    [/sg:control-names/, () => opts.baseline ?? []],
    ...(opts.extra ?? []),
  ];
}

const podsPanel = {
  panels: [incomparablePanel(1, 3)],
  current: [nameRow('run-001', 1, POD_A1), nameRow('run-001', 1, POD_A2)],
  baseline: [controlName(1, POD_B1), controlName(1, POD_B2)],
};

/** `n` services with a pod each: `svcN-<hash>-<suffix>`, in the run or in the baseline. */
const podsOfServices = (n: number, hash: string, suffix: string) =>
  Array.from({ length: n }, (_, i) => `svc${i + 1}-${hash}-${suffix}`);

describe('SeriesGroupingInsightsService.suggestions', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('suggests the preset that makes a panel\'s names line up with its baseline', async () => {
    const { service, db } = makeService(routes(podsPanel));

    const result = await service.suggestions('run-001', [ORG_A]);

    expect(result).toEqual([
      {
        applicationDashboardId: DASHBOARD.id,
        dashboardLabel: 'Kubernetes pods',
        panelId: 1,
        panelTitle: 'Panel 1',
        incomparableCount: 3,
        preset: 'k8s-pod',
        matchedBefore: 0,
        matchedAfter: 1,
      },
    ]);
    expectNoDsMetricsRead(db.calls);
  });

  it('logs every served suggestion at info in the agreed shape', async () => {
    const { service } = makeService(routes(podsPanel));

    await service.suggestions('run-001', [ORG_A]);

    expect(logSpy).toHaveBeenCalledWith(
      `series-grouping suggestion run-001 ${DASHBOARD.id}/1 preset=k8s-pod matched 0% -> 100% incomparable=3`,
    );
  });

  it('logs percentages as integers', async () => {
    // current: 3 raw names, 1 of which the baseline has (33%); after grouping 3 of 3 groups match.
    const { service } = makeService(
      routes({
        panels: [incomparablePanel(1, 2)],
        current: [
          nameRow('run-001', 1, 'db'),
          nameRow('run-001', 1, 'api-7d9f8c6b5-x2k4p'),
          nameRow('run-001', 1, 'web-7d9f8c6b5-z9w2t'),
        ],
        baseline: [controlName(1, 'db'), controlName(1, 'api'), controlName(1, 'web')],
      }),
    );

    await service.suggestions('run-001', [ORG_A]);

    expect(logSpy).toHaveBeenCalledWith(
      `series-grouping suggestion run-001 ${DASHBOARD.id}/1 preset=k8s-pod matched 33% -> 100% incomparable=2`,
    );
  });

  describe('which panels qualify', () => {
    it('asks only for non-ignored incomparable results, at least two per panel, outside performance test dashboards', async () => {
      const { service, db } = makeService(routes(podsPanel));

      await service.suggestions('run-001', [ORG_A]);

      const q = db.calls.find((c) => /sg:incomparable/.test(c.sql))!;
      expect(q.sql).toMatch(/r\.conclusion->>'label' = 'incomparable'/);
      expect(q.sql).toMatch(/NOT COALESCE\(\(r\.conclusion->>'ignore'\)::boolean, false\)/);
      expect(q.sql).toMatch(/HAVING COUNT\(\*\) >= 2/);
      expect(q.sql).toMatch(/NOT LIKE 'performance-test-metrics-%'/);
      expect(q.params).toEqual(['run-001']);
    });

    it('leaves out a panel an enabled panel rule already covers', async () => {
      const { service, db } = makeService(
        routes({
          ...podsPanel,
          extra: [
            [
              /sg:rules/,
              () => [{ id: 'r1', application_dashboard_id: DASHBOARD.id, panel_id: 1, preset: 'k8s-pod', pattern: null, replacement: '', aggregation: 'avg', track_member_count: false }],
            ],
          ],
        }),
      );

      expect(await service.suggestions('run-001', [ORG_A])).toEqual([]);
      const rules = db.calls.find((c) => /sg:rules/.test(c.sql))!;
      expect(rules.sql).toMatch(/r\.enabled/);
      expect(rules.params).toEqual(['sut-1', 'acc', 'peak']);
    });

    it('leaves out every panel of a dashboard an enabled dashboard-wide rule covers', async () => {
      const { service } = makeService(
        routes({
          ...podsPanel,
          extra: [
            [
              /sg:rules/,
              () => [{ id: 'r1', application_dashboard_id: DASHBOARD.id, panel_id: null, preset: 'k8s-pod', pattern: null, replacement: '', aggregation: 'avg', track_member_count: false }],
            ],
          ],
        }),
      );

      expect(await service.suggestions('run-001', [ORG_A])).toEqual([]);
    });

    it('keeps a panel when the rule on the workload belongs to a different panel', async () => {
      const { service } = makeService(
        routes({
          ...podsPanel,
          extra: [
            [
              /sg:rules/,
              () => [{ id: 'r1', application_dashboard_id: DASHBOARD.id, panel_id: 9, preset: 'k8s-pod', pattern: null, replacement: '', aggregation: 'avg', track_member_count: false }],
            ],
          ],
        }),
      );

      expect(await service.suggestions('run-001', [ORG_A])).toHaveLength(1);
    });

    it('does not suggest when the baseline already shares half of the run\'s names', async () => {
      // matchedBefore 0.5 is NOT < SUGGEST_MAX_MATCHED_BEFORE: the names mostly line up already.
      const { service } = makeService(
        routes({
          panels: [incomparablePanel(1, 2)],
          current: [nameRow('run-001', 1, 'db'), nameRow('run-001', 1, POD_A1)],
          baseline: [controlName(1, 'db'), controlName(1, 'api')],
        }),
      );

      expect(await service.suggestions('run-001', [ORG_A])).toEqual([]);
    });

    it('suggests at exactly 90% matched after, and not at 80%', async () => {
      const ninety = makeService(
        routes({
          panels: [incomparablePanel(1, 5)],
          current: [...podsOfServices(9, '7d9f8c6b5', 'x2k4p'), 'zzz-solo'].map((n) => nameRow('run-001', 1, n)),
          baseline: podsOfServices(9, '5c8d7f6b9', 'm4n2q').map((n) => controlName(1, n)),
        }),
      );
      const eighty = makeService(
        routes({
          panels: [incomparablePanel(1, 5)],
          current: [...podsOfServices(8, '7d9f8c6b5', 'x2k4p'), 'zzz-solo-1', 'zzz-solo-2'].map((n) => nameRow('run-001', 1, n)),
          baseline: podsOfServices(8, '5c8d7f6b9', 'm4n2q').map((n) => controlName(1, n)),
        }),
      );

      const at90 = await ninety.service.suggestions('run-001', [ORG_A]);
      const at80 = await eighty.service.suggestions('run-001', [ORG_A]);

      expect(at90).toHaveLength(1);
      expect(at90[0]!.matchedAfter).toBeCloseTo(0.9, 10);
      expect(at80).toEqual([]);
    });

    it('does not suggest a panel the run has no names for', async () => {
      const { service } = makeService(routes({ panels: [incomparablePanel(1, 3)], baseline: [controlName(1, POD_B1)] }));

      expect(await service.suggestions('run-001', [ORG_A])).toEqual([]);
    });

    it('answers [] and logs nothing when there are no qualifying panels', async () => {
      const { service, db } = makeService(routes({ panels: [] }));

      expect(await service.suggestions('run-001', [ORG_A])).toEqual([]);
      expect(db.calls.some((c) => /sg:names/.test(c.sql))).toBe(false);
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('series-grouping suggestion'));
    });

    it('answers [] when the run has no control group: there is nothing to line names up with', async () => {
      const { service } = makeService(routes({ ...podsPanel, controlGroupId: null }));

      expect(await service.suggestions('run-001', [ORG_A])).toEqual([]);
    });

    it('reads every qualifying panel\'s names in one statement per side, from the small tables', async () => {
      const { service, db } = makeService(
        routes({
          panels: [incomparablePanel(1, 3), incomparablePanel(2, 2)],
          current: [
            nameRow('run-001', 1, POD_A1),
            nameRow('run-001', 1, POD_A2),
            nameRow('run-001', 2, 'web-7d9f8c6b5-x2k4p'),
          ],
          baseline: [controlName(1, POD_B1), controlName(2, 'web-5c8d7f6b9-m4n2q')],
        }),
      );

      const result = await service.suggestions('run-001', [ORG_A]);

      expect(result.map((s) => s.panelId)).toEqual([1, 2]);
      expect(db.calls.filter((c) => /sg:names/.test(c.sql))).toHaveLength(1);
      expect(db.calls.filter((c) => /sg:control-names/.test(c.sql))).toHaveLength(1);
      const control = db.calls.find((c) => /sg:control-names/.test(c.sql))!;
      expect(control.params).toEqual(['cg-1', [DASHBOARD.id, DASHBOARD.id], [1, 2]]);
      expectNoDsMetricsRead(db.calls);
    });

    it('lists the panel with the most incomparable results first', async () => {
      const { service } = makeService(
        routes({
          panels: [incomparablePanel(1, 2), incomparablePanel(2, 7)],
          current: [nameRow('run-001', 1, POD_A1), nameRow('run-001', 2, POD_A2)],
          baseline: [controlName(1, POD_B1), controlName(2, POD_B2)],
        }),
      );

      expect((await service.suggestions('run-001', [ORG_A])).map((s) => s.panelId)).toEqual([2, 1]);
    });
  });

  describe('when migration 1819 has not run yet', () => {
    it('answers [] without touching the grouping tables: a failing statement would abort the request transaction', async () => {
      const { service, db } = makeService(
        routes(podsPanel).concat([[/sg:tables-present/, () => [{ present: false }]]]),
      );

      expect(await service.suggestions('run-001', [ORG_A])).toEqual([]);
      expect(db.calls.map((c) => c.sql.match(/sg:[a-z-]+/)?.[0])).toEqual(['sg:run', 'sg:tables-present']);
    });
  });

  describe('tenancy', () => {
    it('answers 404 for a run outside the caller\'s organizations', async () => {
      const { service, db } = makeService(routes(podsPanel));

      await expect(service.suggestions('run-001', [ORG_B])).rejects.toBeInstanceOf(NotFoundException);
      expect(db.calls.map((c) => c.sql.match(/sg:[a-z-]+/)?.[0])).toEqual(['sg:run']);
    });

    it('still refuses when a misbehaving lookup hands back another tenant\'s run', async () => {
      // The statement filters on the organization, and the result is checked again: a lookup that
      // lost its predicate must not become a cross-tenant read.
      const { service, db } = makeService(routes({ ...podsPanel, extra: [[/sg:run \*\//, () => [RUN]]] }));

      await expect(service.suggestions('run-001', [ORG_B])).rejects.toBeInstanceOf(NotFoundException);
      expect(db.calls.some((c) => /sg:incomparable/.test(c.sql))).toBe(false);
    });

    it('answers 404 for an empty organization list without touching the database', async () => {
      const { service, db } = makeService(routes(podsPanel));

      await expect(service.suggestions('run-001', [])).rejects.toBeInstanceOf(NotFoundException);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('lets a global admin through', async () => {
      const { service } = makeService(routes(podsPanel));

      await expect(service.suggestions('run-001', null)).resolves.toHaveLength(1);
    });
  });
});
