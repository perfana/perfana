/**
 * GET /test-runs/:id/series-grouping-status: is the run's grouping in step with the rules?
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { seriesGroupingRuleHash } from '@perfana/shared/utils';
import { MISALIGNED_AVG_MEMBERS } from './series-grouping-insights.service';
import {
  DASHBOARD,
  ORG_A,
  ORG_B,
  RUN,
  expectNoDsMetricsRead,
  makeService,
  type Route,
} from '../../test/series-grouping-insights-helpers';

const SPEC = { preset: 'k8s-pod', pattern: null, replacement: '', aggregation: 'avg', trackMemberCount: false } as const;
const HASH = seriesGroupingRuleHash(SPEC);

const rule = (id: string, panelId: number | null, overrides: Record<string, unknown> = {}) => ({
  id,
  application_dashboard_id: DASHBOARD.id,
  panel_id: panelId,
  preset: SPEC.preset,
  pattern: SPEC.pattern,
  replacement: SPEC.replacement,
  aggregation: SPEC.aggregation,
  track_member_count: SPEC.trackMemberCount,
  ...overrides,
});

const membership = (panelId: number, ruleId: string | null, ruleHash = HASH) => ({
  application_dashboard_id: DASHBOARD.id,
  panel_id: panelId,
  rule_id: ruleId,
  rule_hash: ruleHash,
});

const statPanel = (panelId: number) => ({ application_dashboard_id: DASHBOARD.id, panel_id: panelId });

function routes(opts: {
  rules?: ReturnType<typeof rule>[];
  membership?: ReturnType<typeof membership>[];
  panels?: ReturnType<typeof statPanel>[];
  misaligned?: Array<Record<string, unknown>>;
  extra?: Route[];
}): Route[] {
  return [
    [/sg:rules/, () => opts.rules ?? []],
    [/sg:membership/, () => opts.membership ?? []],
    [/sg:stat-panels/, () => opts.panels ?? []],
    [/sg:misaligned/, () => opts.misaligned ?? []],
    ...(opts.extra ?? []),
  ];
}

describe('SeriesGroupingInsightsService.status', () => {
  describe('stale', () => {
    it('is empty when every covered panel was grouped by the current rule', async () => {
      const { service, db } = makeService(
        routes({ rules: [rule('r1', 1)], membership: [membership(1, 'r1')], panels: [statPanel(1)] }),
      );

      expect(await service.status('run-001', [ORG_A])).toEqual({ stale: [], misaligned: [] });
      expectNoDsMetricsRead(db.calls);
    });

    it('not-applied: a rule covers the panel and the run has no membership for it', async () => {
      const { service } = makeService(routes({ rules: [rule('r1', 1)], panels: [statPanel(1)] }));

      expect((await service.status('run-001', [ORG_A])).stale).toEqual([
        { applicationDashboardId: DASHBOARD.id, panelId: 1, reason: 'not-applied' },
      ]);
    });

    it('rule-changed: the membership was computed with a different version of the rule', async () => {
      const { service } = makeService(
        routes({
          rules: [rule('r1', 1)],
          membership: [membership(1, 'r1', seriesGroupingRuleHash({ ...SPEC, aggregation: 'sum' }))],
          panels: [statPanel(1)],
        }),
      );

      expect((await service.status('run-001', [ORG_A])).stale).toEqual([
        { applicationDashboardId: DASHBOARD.id, panelId: 1, reason: 'rule-changed' },
      ]);
    });

    it('hashes the stored row exactly as the worker does: a custom rule\'s pattern and replacement count', async () => {
      const custom = { preset: 'custom', pattern: '-[a-z0-9]{4}$', replacement: '', aggregation: 'max', trackMemberCount: true } as const;
      const { service } = makeService(
        routes({
          rules: [rule('r1', 1, { preset: 'custom', pattern: custom.pattern, aggregation: 'max', track_member_count: true })],
          membership: [membership(1, 'r1', seriesGroupingRuleHash(custom))],
          panels: [statPanel(1)],
        }),
      );

      expect((await service.status('run-001', [ORG_A])).stale).toEqual([]);
    });

    it('rule-removed: the membership outlived its rule (rule_id is NULL after the delete)', async () => {
      const { service } = makeService(routes({ membership: [membership(1, null)], panels: [statPanel(1)] }));

      expect((await service.status('run-001', [ORG_A])).stale).toEqual([
        { applicationDashboardId: DASHBOARD.id, panelId: 1, reason: 'rule-removed' },
      ]);
    });

    it('rule-removed: the rule that produced the membership is now disabled', async () => {
      // A disabled rule is not in the enabled set the worker loads, so the next recalculation
      // would ungroup the panel.
      const { service } = makeService(routes({ membership: [membership(1, 'r-disabled')], panels: [statPanel(1)] }));

      expect((await service.status('run-001', [ORG_A])).stale).toEqual([
        { applicationDashboardId: DASHBOARD.id, panelId: 1, reason: 'rule-removed' },
      ]);
    });

    it('rule-removed wins over rule-changed when a replacement rule has since been created on the slot', async () => {
      const { service } = makeService(
        routes({ rules: [rule('r2', 1)], membership: [membership(1, null)], panels: [statPanel(1)] }),
      );

      expect((await service.status('run-001', [ORG_A])).stale.map((s) => s.reason)).toEqual(['rule-removed']);
    });

    it('rule-changed: a panel rule now overrides the dashboard-wide rule the membership came from', async () => {
      const { service } = makeService(
        routes({
          rules: [rule('r-dash', null), rule('r-panel', 1)],
          membership: [membership(1, 'r-dash')],
          panels: [statPanel(1)],
        }),
      );

      expect((await service.status('run-001', [ORG_A])).stale).toEqual([
        { applicationDashboardId: DASHBOARD.id, panelId: 1, reason: 'rule-changed' },
      ]);
    });

    it('a dashboard-wide rule covers every panel the run has statistics for', async () => {
      const { service } = makeService(
        routes({
          rules: [rule('r-dash', null)],
          membership: [membership(1, 'r-dash')],
          panels: [statPanel(1), statPanel(2), statPanel(3)],
        }),
      );

      expect((await service.status('run-001', [ORG_A])).stale).toEqual([
        { applicationDashboardId: DASHBOARD.id, panelId: 2, reason: 'not-applied' },
        { applicationDashboardId: DASHBOARD.id, panelId: 3, reason: 'not-applied' },
      ]);
    });

    it('a rule on a panel the run has no series for is not stale: there is nothing to group', async () => {
      const { service } = makeService(routes({ rules: [rule('r1', 7)], panels: [statPanel(1)] }));

      expect((await service.status('run-001', [ORG_A])).stale).toEqual([]);
    });

    it('lists stale panels in dashboard then panel order', async () => {
      const { service } = makeService(
        routes({
          rules: [rule('r2', 2), rule('r1', 1)],
          panels: [statPanel(2), statPanel(1)],
        }),
      );

      expect((await service.status('run-001', [ORG_A])).stale.map((s) => s.panelId)).toEqual([1, 2]);
    });

    it('a run that is still running reports nothing: its analysis applies the current rules on completion', async () => {
      const { service, db } = makeService(
        routes({ rules: [rule('r1', 1)], panels: [statPanel(1)], extra: [[/sg:run \*\//, () => [{ ...RUN, completed: false }]]] }),
      );

      expect(await service.status('run-001', [ORG_A])).toEqual({ stale: [], misaligned: [] });
      expect(db.calls.some((c) => /sg:membership/.test(c.sql))).toBe(false);
    });

    it('reads the rules of the run\'s own workload, enabled ones only', async () => {
      const { service, db } = makeService(routes({}));

      await service.status('run-001', [ORG_A]);

      const q = db.calls.find((c) => /sg:rules/.test(c.sql))!;
      expect(q.sql).toMatch(/r\.enabled/);
      expect(q.sql).toMatch(/NOT LIKE 'performance-test-metrics-%'/);
      expect(q.params).toEqual(['sut-1', 'acc', 'peak']);
    });
  });

  describe('misaligned', () => {
    const misalignedRow = (group: string, members: number, avg: number, panelId = 1) => ({
      application_dashboard_id: DASHBOARD.id,
      panel_id: panelId,
      group_name: group,
      members,
      avg_members: avg,
    });

    it('lists groups of at least two members that report about one member per timestamp', async () => {
      const { service, db } = makeService(
        routes({ misaligned: [misalignedRow('api', 3, 1.100000023841858), misalignedRow('web', 2, 1.9)] }),
      );

      const { misaligned } = await service.status('run-001', [ORG_A]);

      expect(misaligned).toEqual([
        { applicationDashboardId: DASHBOARD.id, panelId: 1, group: 'api', members: 3, avgMembers: 1.1 },
      ]);
      const q = db.calls.find((c) => /sg:misaligned/.test(c.sql))!;
      expect(q.sql).toMatch(/HAVING COUNT\(\*\) >= 2/);
      expect(q.sql).toMatch(/avg_members IS NOT NULL/);
      expect(q.params).toEqual(['run-001']);
    });

    it('treats exactly the threshold as aligned', async () => {
      const { service } = makeService(routes({ misaligned: [misalignedRow('api', 2, 1.2000000476837158)] }));

      expect((await service.status('run-001', [ORG_A])).misaligned).toEqual([]);
    });

    it('mirrors the worker\'s threshold', () => {
      // apps/api cannot import from apps/worker, so the constant is a copy; this is what stops
      // the copy drifting.
      const worker = readFileSync(
        join(__dirname, '../../../../worker/src/pipelines/helpers/series-grouping-plan.ts'),
        'utf8',
      );
      const match = /export const MISALIGNED_AVG_MEMBERS = ([0-9.]+);/.exec(worker);

      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(MISALIGNED_AVG_MEMBERS);
    });
  });

  describe('when migration 1819 has not run yet', () => {
    it('answers empty without touching the grouping tables', async () => {
      const { service, db } = makeService(routes({}).concat([[/sg:tables-present/, () => [{ present: false }]]]));

      expect(await service.status('run-001', [ORG_A])).toEqual({ stale: [], misaligned: [] });
      expect(db.calls.map((c) => c.sql.match(/sg:[a-z-]+/)?.[0])).toEqual(['sg:run', 'sg:tables-present']);
    });
  });

  describe('tenancy', () => {
    it('answers 404 for a run outside the caller\'s organizations', async () => {
      const { service, db } = makeService(routes({ rules: [rule('r1', 1)] }));

      await expect(service.status('run-001', [ORG_B])).rejects.toBeInstanceOf(NotFoundException);
      expect(db.calls.map((c) => c.sql.match(/sg:[a-z-]+/)?.[0])).toEqual(['sg:run']);
    });

    it('answers 404 for an empty organization list without touching the database', async () => {
      const { service, db } = makeService(routes({}));

      await expect(service.status('run-001', [])).rejects.toBeInstanceOf(NotFoundException);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('lets a global admin through', async () => {
      const { service } = makeService(routes({}));

      await expect(service.status('run-001', null)).resolves.toEqual({ stale: [], misaligned: [] });
    });
  });
});
