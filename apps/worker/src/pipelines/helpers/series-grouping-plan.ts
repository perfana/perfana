/**
 * Series grouping for StatisticsPipeline (docs/design/2026-11-01-series-grouping-design.md).
 *
 * A grouping rule rewrites raw series names (Kubernetes pod names) on a panel to group names.
 * StatisticsPipeline then:
 *   1. records each run's raw -> group membership in ds_metric_series_groups, and
 *   2. aggregates the grouped panels in a SECOND statement that combines members per timestamp
 *      (avg / sum / max) before the usual statistics chain, while the main statement skips them.
 *
 * Every comparison reader (ADAPT, the Compare table, SLO checks) reads ds_metric_statistics, so it
 * sees group names with no change of its own. ds_metrics is never written.
 *
 * Three rules hold this together:
 *   - Rules load BEFORE the analytics transaction, on the pooled connection, and never throw: an
 *     error inside the transaction aborts it (25P02), and statistics-calculation is not softFail,
 *     so it would fail the whole re-evaluate batch. A worker rolled out before migration 1819 finds
 *     no tables and aggregates exactly as before.
 *   - The regex runs only in JavaScript (applySeriesGrouping), never in Postgres, so the dialog's
 *     preview and the stored membership cannot disagree.
 *   - The grouped statement reads ds_metrics itself; it never references the main statement's
 *     `metrics_filtered`, which would materialise the run's raw rows into a tuplestore.
 */
import type { Logger } from 'pino';
import {
  applySeriesGrouping,
  compileSeriesGroupingRule,
  seriesGroupingRuleHash,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
  type SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';
import { buildRunScopeCtes, buildStatisticsCtes, STATISTICS_INSERT } from './statistics-sql.js';

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
type PresentRow = { present?: unknown };

export interface LoadedRule {
  testRunId: string;
  ruleId: string;
  applicationDashboardId: string;
  /** null = every panel on the dashboard. */
  panelId: number | null;
  spec: SeriesGroupingRuleSpec;
  hash: string;
}

export interface SeriesGroupingContext {
  /** Both tables exist (migration 1819 has run). */
  tablesPresent: boolean;
  rules: LoadedRule[];
  /** Only meaningful when there are no rules: old membership a removed rule left behind. */
  hasExistingMembership: boolean;
}

export const NO_SERIES_GROUPING: SeriesGroupingContext = {
  tablesPresent: false,
  rules: [],
  hasExistingMembership: false,
};

export const SERIES_GROUPING_TABLES_PROBE_SQL =
  "SELECT (to_regclass('public.series_grouping_rules') IS NOT NULL" +
  " AND to_regclass('public.ds_metric_series_groups') IS NOT NULL) AS present";

/**
 * The enabled rules covering each run's (system, environment, workload). Perf-test dashboards are
 * excluded here as well as in the API: their series names are stable and a grouping there would
 * collide with PerformanceTestMetricsPipeline's live statistics writer.
 */
export const SERIES_GROUPING_RULES_SQL = `
      SELECT tr.test_run_id, r.id, r.application_dashboard_id, r.panel_id, r.preset, r.pattern,
             r.replacement, r.aggregation, r.track_member_count
      FROM test_runs tr
      JOIN series_grouping_rules r
        ON r.system_under_test_id = tr.system_under_test_id
       AND r.test_environment = tr.test_environment
       AND r.workload = tr.workload
       AND r.enabled
      JOIN application_dashboards ad ON ad.id = r.application_dashboard_id
      WHERE tr.test_run_id = ANY($1::text[])
        AND COALESCE(ad.dashboard_uid, '') NOT LIKE 'performance-test-metrics-%'
      ORDER BY tr.test_run_id, r.application_dashboard_id, r.panel_id NULLS FIRST
    `;

export const SERIES_GROUPING_MEMBERSHIP_EXISTS_SQL =
  'SELECT EXISTS (SELECT 1 FROM ds_metric_series_groups WHERE test_run_id = ANY($1::text[])) AS present';

/** Load the grouping rules for these runs. Pooled connection, outside any transaction. Never throws. */
export async function loadSeriesGroupingContext(
  db: Queryable,
  testRunIds: string[],
  logger: Logger,
): Promise<SeriesGroupingContext> {
  try {
    const probe = (await db.query(SERIES_GROUPING_TABLES_PROBE_SQL)) as PresentRow[] | undefined;
    if (probe?.[0]?.present !== true) {return NO_SERIES_GROUPING;}

    const result = await db.query(SERIES_GROUPING_RULES_SQL, [testRunIds]);
    const rows: Array<Record<string, unknown>> = Array.isArray(result)
      ? result.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      : [];
    const rules: LoadedRule[] = [];
    for (const row of rows) {
      const spec: SeriesGroupingRuleSpec = {
        preset: row.preset as SeriesGroupingPreset,
        pattern: (row.pattern as string | null) ?? null,
        replacement: (row.replacement as string | null) ?? '',
        aggregation: row.aggregation as SeriesGroupingAggregation,
        trackMemberCount: row.track_member_count === true,
      };
      // The API validates on write; a row written by hand, or a guard tightened since, is
      // skipped rather than applied unguarded.
      const compiled = compileSeriesGroupingRule(spec);
      if (!compiled.ok) {
        logger.warn(`series-grouping: rule ${String(row.id)} skipped: ${compiled.error}`);
        continue;
      }
      rules.push({
        testRunId: String(row.test_run_id),
        ruleId: String(row.id),
        applicationDashboardId: String(row.application_dashboard_id),
        panelId: row.panel_id === null || row.panel_id === undefined ? null : Number(row.panel_id),
        spec,
        hash: seriesGroupingRuleHash(spec),
      });
    }

    let hasExistingMembership = false;
    if (rules.length === 0) {
      const exists = (await db.query(SERIES_GROUPING_MEMBERSHIP_EXISTS_SQL, [testRunIds])) as PresentRow[] | undefined;
      hasExistingMembership = exists?.[0]?.present === true;
    }
    return { tablesPresent: true, rules, hasExistingMembership };
  } catch (err) {
    logger.warn({ err }, 'series-grouping: rules unavailable, aggregating without grouping');
    return NO_SERIES_GROUPING;
  }
}

export interface SeriesRow {
  test_run_id: string;
  application_dashboard_id: string;
  panel_id: number;
  metric_name: string;
  dashboard_label: string | null;
  panel_title: string | null;
}

export interface MembershipRow extends SeriesRow {
  group_name: string;
  member_count_name: string | null;
  aggregation: SeriesGroupingAggregation;
  track_member_count: boolean;
  rule_id: string;
  rule_hash: string;
}

/**
 * The series of the dashboards a run's rules touch, one row per raw series. Reads those
 * dashboards' rows once; on a compressed chunk that is a transient decompression (a read, not
 * DML), the same order of cost as the aggregation that follows.
 */
export const SERIES_OF_DASHBOARDS_SQL = `
      SELECT application_dashboard_id, panel_id, metric_name,
             MIN(dashboard_label) AS dashboard_label, MIN(panel_title) AS panel_title
      FROM ds_metrics
      WHERE test_run_id = $1 AND application_dashboard_id = ANY($2::uuid[])
      GROUP BY application_dashboard_id, panel_id, metric_name
    `;

const key = (...parts: Array<string | number>) => parts.join('\u0000');

/**
 * Raw -> group membership for every series on a covered panel. A panel rule beats the
 * dashboard-wide rule of the same run and dashboard. A series the rule does not rename is a group
 * of one: the whole panel takes the grouped path, so the run is visibly "grouped under rule X".
 * Pure; rows come back sorted by run, dashboard, panel, metric.
 */
export function buildMembership(rules: LoadedRule[], series: SeriesRow[]): MembershipRow[] {
  const byRunDashboard = new Map<string, { panels: Map<number, LoadedRule>; dashboard?: LoadedRule }>();
  for (const rule of rules) {
    const k = key(rule.testRunId, rule.applicationDashboardId);
    const entry = byRunDashboard.get(k) ?? { panels: new Map<number, LoadedRule>() };
    if (rule.panelId === null) {entry.dashboard = rule;}
    else {entry.panels.set(rule.panelId, rule);}
    byRunDashboard.set(k, entry);
  }

  const panels = new Map<string, SeriesRow[]>();
  for (const row of series) {
    const k = key(row.test_run_id, row.application_dashboard_id, row.panel_id);
    const list = panels.get(k);
    if (list) {list.push(row);}
    else {panels.set(k, [row]);}
  }

  const out: MembershipRow[] = [];
  for (const rows of panels.values()) {
    const first = rows[0]!;
    const entry = byRunDashboard.get(key(first.test_run_id, first.application_dashboard_id));
    const rule = entry?.panels.get(first.panel_id) ?? entry?.dashboard;
    if (!rule) {continue;}
    const grouping = applySeriesGrouping(rule.spec, rows.map((r) => r.metric_name));
    for (const row of rows) {
      const group = grouping.mapping.get(row.metric_name)!;
      out.push({
        ...row,
        group_name: group,
        member_count_name: grouping.memberCountNames.get(group) ?? null,
        aggregation: rule.spec.aggregation,
        track_member_count: rule.spec.trackMemberCount,
        rule_id: rule.ruleId,
        rule_hash: rule.hash,
      });
    }
  }
  return out.sort((a, b) => {
    const ka = key(a.test_run_id, a.application_dashboard_id, String(a.panel_id).padStart(10, '0'), a.metric_name);
    const kb = key(b.test_run_id, b.application_dashboard_id, String(b.panel_id).padStart(10, '0'), b.metric_name);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** The distinct grouped (run, dashboard, panel) triples, as three aligned arrays. */
export function groupedPanelTriples(rows: MembershipRow[]): [string[], string[], number[]] {
  const seen = new Set<string>();
  const runs: string[] = [];
  const dashboards: string[] = [];
  const panelIds: number[] = [];
  for (const row of rows) {
    const k = key(row.test_run_id, row.application_dashboard_id, row.panel_id);
    if (seen.has(k)) {continue;}
    seen.add(k);
    runs.push(row.test_run_id);
    dashboards.push(row.application_dashboard_id);
    panelIds.push(row.panel_id);
  }
  return [runs, dashboards, panelIds];
}

/**
 * The predicate that keeps grouped panels out of the main statement's `metrics_filtered`. Bound
 * to three arrays starting at `$firstParam`; appended only when there are grouped panels, so a
 * batch without grouping keeps its SQL byte for byte.
 */
export function buildGroupedExclusion(firstParam: number): string {
  return `
            AND NOT EXISTS (
                SELECT 1
                FROM unnest($${firstParam}::text[], $${firstParam + 1}::uuid[], $${firstParam + 2}::int[])
                  AS g(test_run_id, application_dashboard_id, panel_id)
                WHERE g.test_run_id = m.test_run_id
                  AND g.application_dashboard_id = m.application_dashboard_id
                  AND g.panel_id = m.panel_id
            )`;
}

export const DELETE_MEMBERSHIP_SQL = (placeholders: string) => `
      DELETE FROM ds_metric_series_groups
      WHERE test_run_id IN (${placeholders})
    `;

/** Organization and team come from the run, like every ds_metric_statistics row. */
export const INSERT_MEMBERSHIP_SQL = `
      INSERT INTO ds_metric_series_groups (
          test_run_id, application_dashboard_id, panel_id, metric_name, group_name, member_count_name,
          dashboard_label, panel_title, aggregation, rule_id, rule_hash, organization_id, team_id
      )
      SELECT s.test_run_id, s.application_dashboard_id, s.panel_id, s.metric_name, s.group_name,
             s.member_count_name, s.dashboard_label, s.panel_title, s.aggregation, s.rule_id, s.rule_hash,
             tr.organization_id, tr.team_id
      FROM unnest($1::text[], $2::uuid[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[],
                  $8::text[], $9::text[], $10::uuid[], $11::text[])
        AS s(test_run_id, application_dashboard_id, panel_id, metric_name, group_name, member_count_name,
             dashboard_label, panel_title, aggregation, rule_id, rule_hash)
      LEFT JOIN test_runs tr ON tr.test_run_id = s.test_run_id
    `;

export function membershipInsertParams(rows: MembershipRow[]): unknown[] {
  return [
    rows.map((r) => r.test_run_id),
    rows.map((r) => r.application_dashboard_id),
    rows.map((r) => r.panel_id),
    rows.map((r) => r.metric_name),
    rows.map((r) => r.group_name),
    rows.map((r) => r.member_count_name),
    rows.map((r) => r.dashboard_label),
    rows.map((r) => r.panel_title),
    rows.map((r) => r.aggregation),
    rows.map((r) => r.rule_id),
    rows.map((r) => r.rule_hash),
  ];
}

/**
 * The grouped panels' statistics. Combines the members of each group per timestamp, adds the
 * member-count series where tracked, runs the shared statistics chain over that, and writes the
 * average members per timestamp back onto the membership rows — the timestamp-alignment signal.
 * Returns that alignment, one row per group.
 *
 * Parameters: the run ids at `$1..$runCount`, then the eight member arrays from
 * `groupedStatementParams`.
 */
export function buildGroupedStatisticsSQL(runCount: number): string {
  const placeholders = Array.from({ length: runCount }, (_, i) => `$${i + 1}`).join(', ');
  const p = (offset: number) => `$${runCount + 1 + offset}`;
  return (
    buildRunScopeCtes(placeholders) +
    `      -- The membership of the grouped panels, bound as arrays: rows inserted earlier in this
      -- transaction are invisible to the planner's statistics, so a join against the table would
      -- be planned as if it were empty.
      members AS MATERIALIZED (
          SELECT *
          FROM unnest(${p(0)}::text[], ${p(1)}::uuid[], ${p(2)}::int[], ${p(3)}::text[], ${p(4)}::text[],
                      ${p(5)}::text[], ${p(6)}::boolean[], ${p(7)}::text[])
            AS s(test_run_id, application_dashboard_id, panel_id, metric_name, group_name, aggregation,
                 track_member_count, member_count_name)
      ),

      -- One point per group per timestamp. COUNT(*) is the members reporting at that instant:
      -- uniq_ds_metrics_upsert allows one row per raw series per time.
      grouped_points AS (
          SELECT
              m.test_run_id,
              m.application_dashboard_id,
              m.panel_id,
              s.group_name,
              m.time,
              CASE MIN(s.aggregation)
                  WHEN 'sum' THEN SUM(m.value)
                  WHEN 'max' THEN MAX(m.value)
                  ELSE AVG(m.value)
              END AS value,
              COUNT(*) AS member_count,
              bool_or(s.track_member_count) AS track_member_count,
              MIN(s.member_count_name) AS member_count_name,
              MIN(m.dashboard_uid) AS dashboard_uid,
              MIN(m.panel_title) AS panel_title,
              MIN(m.dashboard_label) AS dashboard_label,
              MIN(m.benchmark_ids[1]::text)::uuid AS first_benchmark_id,
              MIN(m.unit) AS unit,
              MIN(tr.organization_id::text)::uuid AS organization_id,
              MIN(tr.team_id::text)::uuid AS team_id,
              MIN(m.metrics_source_id::text)::uuid AS metrics_source_id
          FROM ds_metrics m
          INNER JOIN run_orgs tr ON m.test_run_id = tr.test_run_id
          INNER JOIN members s
            ON s.test_run_id = m.test_run_id
           AND s.application_dashboard_id = m.application_dashboard_id
           AND s.panel_id = m.panel_id
           AND s.metric_name = m.metric_name
          WHERE m.test_run_id IN (${placeholders})
            AND m.ramp_up = false
            AND m.value IS NOT NULL
            AND m.application_dashboard_id IN (SELECT id FROM allowed_dashboards)
          GROUP BY m.test_run_id, m.application_dashboard_id, m.panel_id, s.group_name, m.time
      ),

      -- The statistics chain's input: the combined series, plus each tracked group's member count.
      points AS (
          SELECT test_run_id, application_dashboard_id, panel_id, group_name AS metric_name, value, time,
                 dashboard_uid, panel_title, dashboard_label, first_benchmark_id, unit,
                 organization_id, team_id, metrics_source_id
          FROM grouped_points
          UNION ALL
          SELECT test_run_id, application_dashboard_id, panel_id, member_count_name AS metric_name,
                 member_count::double precision AS value, time,
                 dashboard_uid, panel_title, dashboard_label, NULL::uuid AS first_benchmark_id,
                 NULL::character varying AS unit, organization_id, team_id, metrics_source_id
          FROM grouped_points
          WHERE track_member_count AND member_count_name IS NOT NULL
      ),

` +
    buildStatisticsCtes('points') +
    `,

      alignment AS (
          SELECT test_run_id, application_dashboard_id, panel_id, group_name,
                 AVG(member_count)::real AS avg_members
          FROM grouped_points
          GROUP BY test_run_id, application_dashboard_id, panel_id, group_name
      ),

      -- Data-modifying CTEs run exactly once whether or not they are read.
      inserted AS (
` +
    STATISTICS_INSERT +
    `  ),

      aligned AS (
          UPDATE ds_metric_series_groups g
          SET avg_members = a.avg_members
          FROM alignment a
          WHERE g.test_run_id = a.test_run_id
            AND g.application_dashboard_id = a.application_dashboard_id
            AND g.panel_id = a.panel_id
            AND g.group_name = a.group_name
      )

      SELECT test_run_id, application_dashboard_id, panel_id, group_name, avg_members
      FROM alignment
    `
  );
}

export function groupedStatementParams(runIds: string[], rows: MembershipRow[]): unknown[] {
  return [
    ...runIds,
    rows.map((r) => r.test_run_id),
    rows.map((r) => r.application_dashboard_id),
    rows.map((r) => r.panel_id),
    rows.map((r) => r.metric_name),
    rows.map((r) => r.group_name),
    rows.map((r) => r.aggregation),
    rows.map((r) => r.track_member_count),
    rows.map((r) => r.member_count_name),
  ];
}

/** Members per group, keyed like the alignment rows. */
export function membersPerGroup(rows: MembershipRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = key(row.test_run_id, row.application_dashboard_id, row.panel_id, row.group_name);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** A group with ≥ 2 members averaging fewer than this many per timestamp is not aligned. */
export const MISALIGNED_AVG_MEMBERS = 1.2;

export function alignmentKey(row: { test_run_id: unknown; application_dashboard_id: unknown; panel_id: unknown; group_name: unknown }): string {
  return key(String(row.test_run_id), String(row.application_dashboard_id), Number(row.panel_id), String(row.group_name));
}
