/**
 * The series NAMES of a run's panels, read from the small tables only.
 *
 * Never `ds_metrics`: that is the hypertable the whole feature stays out of (it is read-only
 * for series grouping, and a name lookup there would decompress chunks to answer a question two
 * tables of a few hundred rows per run already answer). A panel's raw names are
 *
 *  - `ds_metric_series_groups.metric_name` for a panel the run has membership on — the membership
 *    IS the raw name list, because the statistics of such a panel are stored under group names;
 *  - `ds_metric_statistics.metric_name` for every other panel, where the statistics still carry
 *    the raw names.
 *
 * The caller authorizes the run and the dashboards first; nothing here checks tenancy.
 */

import type { SqlRunner } from './run-scope';

export interface SeriesNameRow {
  test_run_id: string;
  application_dashboard_id: string;
  panel_id: number;
  panel_title: string | null;
  metric_name: string;
}

/** One dashboard (every panel, or one), or an explicit list of (dashboard, panel) pairs. */
export type PanelSelector =
  | { kind: 'dashboard'; dashboardId: string; panelId?: number | null }
  | { kind: 'panels'; dashboardIds: string[]; panelIds: number[] };

function selectorSql(alias: string, selector: PanelSelector): { sql: string; params: unknown[] } {
  if (selector.kind === 'panels') {
    return {
      sql:
        `EXISTS (SELECT 1 FROM unnest($2::uuid[], $3::int[]) AS p(d, pid)` +
        ` WHERE p.d = ${alias}.application_dashboard_id AND p.pid = ${alias}.panel_id)`,
      params: [selector.dashboardIds, selector.panelIds],
    };
  }
  if (selector.panelId === undefined || selector.panelId === null) {
    return { sql: `${alias}.application_dashboard_id = $2::uuid`, params: [selector.dashboardId] };
  }
  return {
    sql: `${alias}.application_dashboard_id = $2::uuid AND ${alias}.panel_id = $3::int`,
    params: [selector.dashboardId, selector.panelId],
  };
}

export async function loadRunSeriesNames(
  q: SqlRunner,
  testRunIds: string[],
  selector: PanelSelector,
): Promise<SeriesNameRow[]> {
  if (testRunIds.length === 0) return [];
  const grouped = selectorSql('g', selector);
  const stats = selectorSql('s', selector);
  return q.query(
    `/* sg:names */
     SELECT g.test_run_id, g.application_dashboard_id, g.panel_id, g.panel_title, g.metric_name
     FROM ds_metric_series_groups g
     WHERE g.test_run_id = ANY($1::text[]) AND ${grouped.sql}
     UNION
     SELECT s.test_run_id, s.application_dashboard_id, s.panel_id, s.panel_title, s.metric_name
     FROM ds_metric_statistics s
     WHERE s.test_run_id = ANY($1::text[]) AND ${stats.sql}
       AND s.metric_name IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM ds_metric_series_groups g2
         WHERE g2.test_run_id = s.test_run_id
           AND g2.application_dashboard_id = s.application_dashboard_id
           AND g2.panel_id = s.panel_id
       )`,
    [testRunIds, ...grouped.params],
  );
}

/** The baseline side of a suggestion: the control group's own statistics rows. */
export async function loadControlGroupNames(
  q: SqlRunner,
  controlGroupId: string,
  dashboardIds: string[],
  panelIds: number[],
): Promise<Array<{ application_dashboard_id: string; panel_id: number; metric_name: string }>> {
  return q.query(
    `/* sg:control-names */
     SELECT DISTINCT c.application_dashboard_id, c.panel_id, c.metric_name
     FROM ds_control_group_statistics c
     WHERE c.control_group_id = $1
       AND c.metric_name IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM unnest($2::uuid[], $3::int[]) AS p(d, pid)
         WHERE p.d = c.application_dashboard_id AND p.pid = c.panel_id
       )`,
    [controlGroupId, dashboardIds, panelIds],
  );
}
