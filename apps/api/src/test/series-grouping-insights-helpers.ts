/**
 * Shared fixtures for the series grouping insights specs (preview, suggestions, apply, status).
 *
 * The database is a router keyed on the `/* sg:<name> *\/` marker every statement of the
 * insights service starts with. An unrouted statement THROWS, so a query the spec did not expect
 * (a new table, a `ds_metrics` read) fails loudly instead of returning `undefined`.
 */

import { SeriesGroupingInsightsService } from '../modules/series-grouping/series-grouping-insights.service';

export const ORG_A = '11111111-1111-1111-1111-111111111111';
export const ORG_B = '22222222-2222-2222-2222-222222222222';

export const RUN = {
  id: '9f1c0f9e-0000-4000-8000-000000000001',
  testRunId: 'run-001',
  systemUnderTestId: 'sut-1',
  testEnvironment: 'acc',
  workload: 'peak',
  completed: true,
  organizationId: ORG_A,
  teamId: null as string | null,
  sutOrganizationId: ORG_A,
};

export const DASHBOARD = {
  id: 'dash-1',
  systemUnderTestId: 'sut-1',
  testEnvironment: 'acc',
  dashboardUid: 'k8s-pods',
  organizationId: ORG_A,
};

export const POD_A1 = 'api-7d9f8c6b5-x2k4p';
export const POD_A2 = 'api-7d9f8c6b5-z9w2t';
export const POD_B1 = 'api-5c8d7f6b9-m4n2q';
export const POD_B2 = 'api-5c8d7f6b9-r7s5v';

export type Route = [RegExp, (params: unknown[], sql: string) => unknown];

export interface FakeDb {
  query: jest.Mock;
  calls: Array<{ sql: string; params: unknown[] }>;
}

/** The org list a `sg:run` statement was bound to, or null when it carries no org predicate. */
export function boundOrgs(sql: string, params: unknown[]): string[] | null {
  return /sut\.organization_id = ANY\(\$\d+::uuid\[\]\)/.test(sql) ? (params[params.length - 1] as string[]) : null;
}

export function makeDb(routes: Route[]): FakeDb {
  const calls: FakeDb['calls'] = [];
  const defaults: Route[] = [
    // Emulates the database honouring the organization predicate the service sends.
    [
      /sg:run \*\//,
      (params, sql) => {
        const orgs = boundOrgs(sql, params);
        return orgs === null || orgs.includes(RUN.sutOrganizationId) ? [RUN] : [];
      },
    ],
    [/sg:tables-present/, () => [{ present: true }]],
    [/sg:rules/, () => []],
  ];
  const all = [...routes, ...defaults];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    for (const [re, fn] of all) {
      if (re.test(sql)) return fn(params, sql);
    }
    throw new Error(`unrouted SQL: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`);
  });
  return { query, calls };
}

export function makeService(routes: Route[] = [], opts: { dashboard?: unknown } = {}) {
  const db = makeDb(routes);
  const testRunRepo = { query: db.query };
  const appDashRepo = {
    findOne: jest.fn(async () => ('dashboard' in opts ? opts.dashboard : DASHBOARD)),
  };
  const bullmq = { reevaluateBatch: jest.fn(async (_ids: string[], _options?: unknown) => ({ success: true })) };
  const authz = { getCapabilities: jest.fn(async () => ['test-run:read', 'test-run:update']) };
  const service = new SeriesGroupingInsightsService(testRunRepo as never, appDashRepo as never, bullmq as never, authz as never);
  return { service, db, testRunRepo, appDashRepo, bullmq, authz };
}

/** No emitted statement may read the `ds_metrics` hypertable (`ds_metric_statistics` merely contains the substring). */
export function expectNoDsMetricsRead(calls: FakeDb['calls']): void {
  for (const { sql } of calls) {
    expect(sql).not.toMatch(/\bds_metrics\b/);
  }
}

export const nameRow = (
  testRunId: string,
  panelId: number,
  metricName: string,
  panelTitle: string | null = `Panel ${panelId}`,
  dashboardId = DASHBOARD.id,
) => ({
  test_run_id: testRunId,
  application_dashboard_id: dashboardId,
  panel_id: panelId,
  panel_title: panelTitle,
  metric_name: metricName,
});
