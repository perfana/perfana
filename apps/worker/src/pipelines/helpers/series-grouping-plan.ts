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
 *     no tables and aggregates exactly as before; one rolled out before 1820 finds the tables but
 *     not the column, and the probe reports that separately so the membership DELETE still runs
 *     (see `SeriesGroupingContext.extrasPresent` — conflating the two leaves the previous
 *     analysis's membership describing statistics that have been rewritten ungrouped).
 *   - The regex runs only in JavaScript (applySeriesGrouping), never in Postgres, so the dialog's
 *     preview and the stored membership cannot disagree.
 *   - The grouped statement reads ds_metrics itself; it never references the main statement's
 *     `metrics_filtered`, which would materialise the run's raw rows into a tuplestore.
 */
import type { Logger } from 'pino';
import {
  applySeriesGrouping,
  compileSeriesGroupingRule,
  extraAggregationSeriesName,
  SERIES_GROUPING_AGGREGATIONS,
  seriesGroupingRuleHash,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
  type SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';
import { SERIES_GROUPING_DERIVED_SOURCE } from '@perfana/shared/constants';
import { buildRunScopeCtes, buildStatisticsCtes, STATISTICS_INSERT } from './statistics-sql.js';

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
type PresentRow = { present?: unknown; has_extras?: unknown };

export interface LoadedRule {
  testRunId: string;
  ruleId: string;
  applicationDashboardId: string;
  /** null = every panel on the dashboard. */
  panelId: number | null;
  /** The rule's own scope, which is also how `ds_compare_config` is keyed. */
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  spec: SeriesGroupingRuleSpec;
  hash: string;
}

export interface SeriesGroupingContext {
  /** Both tables exist (migration 1819 has run). */
  tablesPresent: boolean;
  /**
   * `extra_aggregations` exists on both tables (migration 1820). Tracked SEPARATELY from
   * `tablesPresent` because the consequence of conflating them is not a missing feature but an
   * INCOHERENT run: the membership DELETE in `StatisticsPipeline` is gated on `tablesPresent`,
   * while `ds_metric_statistics` is deleted and rewritten regardless. Report the tables as
   * absent when only the column is missing and the previous analysis's membership rows survive
   * describing statistics that no longer exist — and because `SeriesGroupResolver` prefers
   * membership over the live rule, every picker, chart and report then offers a group name with
   * no statistics row behind it, while the insights page reports the run as in step (it
   * compares `rule_hash`, which has not changed).
   */
  extrasPresent: boolean;
  rules: LoadedRule[];
  /** Only meaningful when there are no rules: old membership a removed rule left behind. */
  hasExistingMembership: boolean;
}

export const NO_SERIES_GROUPING: SeriesGroupingContext = {
  tablesPresent: false,
  extrasPresent: false,
  rules: [],
  hasExistingMembership: false,
};

/**
 * Both tables (migration 1819) and the `extra_aggregations` column (1820), in one statement.
 *
 * The column is asked about SEPARATELY and on BOTH tables, because the two migrations do not
 * necessarily arrive together: 1819 shipped in v0.2.97.43, so on an upgrade 1820 applies alone
 * and nothing orders the worker behind the migration runner. Answered from `pg_attribute`
 * rather than `information_schema.columns`: measured 3 shared buffers and ~1.0 ms of planning
 * against 47 buffers and ~3.0 ms for the view, which is a 10-way catalog join with a per-row
 * `has_column_privilege()`, and whose planning cost grows with the catalog (one relation per
 * chunk per day on this deployment). `to_regclass` returns NULL rather than raising for a
 * missing table, so a pre-1819 database answers false instead of erroring.
 *
 * The one thing dropped with the view is that `has_column_privilege()`: `pg_attribute` reports a
 * column this role may not be able to write. Not reachable on this schema — the consolidated
 * migration grants at TABLE level and column privileges inherit from it, so a grant that admits
 * the INSERT admits every column of it — but on a deployment that ever added column-level grants
 * the probe would answer true and the membership INSERT would raise 42501 inside the analytics
 * transaction, which is the shape this probe exists to prevent.
 */
export const SERIES_GROUPING_TABLES_PROBE_SQL = `
      SELECT (to_regclass('public.series_grouping_rules') IS NOT NULL
              AND to_regclass('public.ds_metric_series_groups') IS NOT NULL) AS present,
             (EXISTS (SELECT 1 FROM pg_attribute
                       WHERE attrelid = to_regclass('public.series_grouping_rules')
                         AND attname = 'extra_aggregations' AND NOT attisdropped)
              AND EXISTS (SELECT 1 FROM pg_attribute
                           WHERE attrelid = to_regclass('public.ds_metric_series_groups')
                             AND attname = 'extra_aggregations' AND NOT attisdropped)) AS has_extras
    `;

/**
 * The enabled rules covering each run's (system, environment, workload). Perf-test dashboards are
 * excluded here as well as in the API: their series names are stable and a grouping there would
 * collide with PerformanceTestMetricsPipeline's live statistics writer.
 */
export const seriesGroupingRulesSql = (extrasPresent: boolean): string => `
      SELECT tr.test_run_id, r.id, r.application_dashboard_id, r.panel_id,
             r.system_under_test_id, r.test_environment, r.workload, r.preset, r.pattern,
             r.replacement, r.aggregation,
             ${extrasPresent ? 'r.extra_aggregations' : 'NULL::varchar(8)[]'} AS extra_aggregations,
             r.track_member_count
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
    const extrasPresent = probe?.[0]?.has_extras === true;

    const result = await db.query(seriesGroupingRulesSql(extrasPresent), [testRunIds]);
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
        // NULL on a pre-1820 database (the SELECT projects NULL rather than naming the column)
        // and on a row the SUT importer inserted from an older bundle, where
        // json_populate_recordset yields NULL instead of the DEFAULT.
        extraAggregations: Array.isArray(row.extra_aggregations)
          ? (row.extra_aggregations as SeriesGroupingAggregation[])
          : [],
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
        systemUnderTestId: String(row.system_under_test_id),
        testEnvironment: String(row.test_environment),
        workload: String(row.workload),
        spec,
        hash: seriesGroupingRuleHash(spec),
      });
    }

    let hasExistingMembership = false;
    if (rules.length === 0) {
      const exists = (await db.query(SERIES_GROUPING_MEMBERSHIP_EXISTS_SQL, [testRunIds])) as PresentRow[] | undefined;
      hasExistingMembership = exists?.[0]?.present === true;
    }
    return { tablesPresent: true, extrasPresent, rules, hasExistingMembership };
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
  /**
   * The group's extra aggregations, repeated on every member row (see the entity). `null` is
   * possible only for a row read back from the database (a pre-1820 projection, or a SUT-imported
   * row whose bundle lacked the key); `buildMembership` always produces an array.
   */
  extra_aggregations: SeriesGroupingAggregation[] | null;
  track_member_count: boolean;
  rule_id: string;
  rule_hash: string;
  /** The governing rule's scope, which is how `ds_compare_config` is keyed. */
  system_under_test_id: string;
  test_environment: string;
  workload: string;
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
        extra_aggregations: grouping.extraAggregations.get(group) ?? [],
        system_under_test_id: rule.systemUnderTestId,
        test_environment: rule.testEnvironment,
        workload: rule.workload,
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

/**
 * How a row's extra aggregations travel to Postgres: one delimited string per row, split back
 * with `string_to_array`. NOT an array column in the bound arrays: `unnest($1::text[], ...)`
 * cannot take a per-row array, because a Postgres multidimensional array is not an array of
 * arrays and every row would have to carry the same number of extras.
 */
const EXTRA_AGGREGATIONS_SEPARATOR = ',';
const EXTRAS_SQL = (param: string) =>
  `string_to_array(NULLIF(${param}, ''), '${EXTRA_AGGREGATIONS_SEPARATOR}')`;
/**
 * The separator is safe only because every element comes from the closed `['avg','sum','max']`
 * set. Enforced HERE rather than relying on `normalizeExtraAggregations` two call frames away:
 * a value containing the separator would split into phantom extras AFTER the bind, where
 * neither Postgres nor the rules table's CHECK can see it.
 */
const extrasParam = (rows: MembershipRow[]): string[] =>
  rows.map((r) =>
    (r.extra_aggregations ?? [])
      .filter((a) => SERIES_GROUPING_AGGREGATIONS.includes(a))
      .join(EXTRA_AGGREGATIONS_SEPARATOR),
  );

/** True when any row asks for an extra aggregation; what makes the grouped statement grow an arm. */
export function hasExtraAggregations(rows: readonly MembershipRow[]): boolean {
  return rows.some((r) => (r.extra_aggregations ?? []).length > 0);
}

/**
 * Organization and team come from the run, like every ds_metric_statistics row.
 *
 * **The `extra_aggregations` column is named only when it exists, and that is the whole point of
 * `SeriesGroupingContext.extrasPresent` reaching this statement.** It used to be a module constant
 * that named the column unconditionally, which made the pre-1820 window WORSE than the 42703 the
 * probe was added to avoid: the probe let the rules SELECT succeed (it projects `NULL::varchar(8)[]`),
 * membership was built, `DELETE_MEMBERSHIP_SQL` ran, and then THIS statement raised 42703 — inside
 * `withAnalyticsTransaction`. That aborts the transaction (25P02), and `statistics-calculation` is
 * not `softFail`, so it fails the whole re-evaluate batch; the DELETE rolls back with it, so the
 * stale membership the probe exists to prevent survives anyway. Before the probe, the SELECT threw
 * on the pooled connection OUTSIDE the transaction, the catch returned `NO_SERIES_GROUPING`, and the
 * run was analysed ungrouped with a warning.
 *
 * Grouping itself needs nothing from 1820 — migration 1819 carries every column it reads — so the
 * right behaviour in that window is to group normally and emit no extras, not to abandon grouping.
 * `hasExtraAggregations(membership)` is false there by construction (a rule's NULL extras coalesce
 * to `[]`), so the grouped statement's extras arm stays off on its own and only this column list
 * had to learn the flag.
 *
 * Extras are the LAST bind position so the parameter can be dropped without renumbering the other
 * eleven — the same shape `groupedStatementParams` uses.
 */
export const insertMembershipSql = (extrasPresent: boolean): string => `
      INSERT INTO ds_metric_series_groups (
          test_run_id, application_dashboard_id, panel_id, metric_name, group_name, member_count_name,
          dashboard_label, panel_title, aggregation, rule_id, rule_hash,
          organization_id, team_id${extrasPresent ? ', extra_aggregations' : ''}
      )
      SELECT s.test_run_id, s.application_dashboard_id, s.panel_id, s.metric_name, s.group_name,
             s.member_count_name, s.dashboard_label, s.panel_title, s.aggregation,
             s.rule_id, s.rule_hash, tr.organization_id, tr.team_id${
               extrasPresent
                 ? `,
             COALESCE(${EXTRAS_SQL('s.extra_aggregations')}, '{}')::character varying(8)[]`
                 : ''
             }
      FROM unnest($1::text[], $2::uuid[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[],
                  $8::text[], $9::text[], $10::uuid[], $11::text[]${extrasPresent ? ', $12::text[]' : ''})
        AS s(test_run_id, application_dashboard_id, panel_id, metric_name, group_name, member_count_name,
             dashboard_label, panel_title, aggregation, rule_id, rule_hash${extrasPresent ? ', extra_aggregations' : ''})
      LEFT JOIN test_runs tr ON tr.test_run_id = s.test_run_id
    `;

export function membershipInsertParams(rows: MembershipRow[], extrasPresent: boolean): unknown[] {
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
    ...(extrasPresent ? [extrasParam(rows)] : []),
  ];
}

/**
 * One unclassified `ds_compare_config` row per DERIVED series name, so ADAPT reports a change in
 * one as a difference rather than a regression.
 *
 * Why this exists. A derived series is pod-count dependent by construction: scale a Deployment
 * from 2 replicas to 4 and `api (sum)` doubles, and `api (pod count)` doubles, against a baseline
 * recorded at the old replica count. Every series in `ds_metric_statistics` reaches
 * `ds_adapt_results`, and `buildConclusionSQL` flips the whole run to REGRESSION on
 * `regression_count > 0` — so a scale-out would be reported as a regression, which is the exact
 * case this feature exists to let a reader rule OUT. The design doc's own table says so:
 * "`sum` up / `avg` flat = scale-out — more pods, same cost each. Not a regression."
 *
 * Why `higherIsBetter: null` and not `ignore`. `buildConclusionLogic` emits `'regression'` only
 * under `higherIsBetter = true` or `= false`; an unclassified metric's increase or decrease lands
 * in `difference_count`, which is visible but cannot flip the verdict. That is the mechanism
 * panel 304's roll-up already uses (`createDsCompareConfigRecordPanelLevelNoClassification`).
 * `ignore` is NOT an alternative: nothing reads it back off a stored row, so "stored but not
 * evaluated" is not expressible.
 *
 * Why METRIC level. Resolution is metric -> panel -> dashboard -> global -> default, and it picks
 * a whole object rather than merging keys. A Kubernetes panel usually HAS a classified
 * panel-level config (measured on the dev database: 346 of 419 inheritable configs carry a real
 * `higherIsBetter`), which a derived series would otherwise inherit. Only a metric-level row
 * overrides it.
 *
 * Why `ON CONFLICT DO NOTHING`. The row is a default, not a policy: a config the user has
 * deliberately set on `api (sum)` must survive every later analysis. This also makes the write
 * idempotent across runs of the same workload, which share the (system, environment, workload)
 * scope the table is keyed on.
 *
 * This covers the member-count series too, which has had the same exposure since v0.2.97.43.
 */
export interface DerivedSeriesConfigRow {
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  application_dashboard_id: string;
  panel_id: number;
  metric_name: string;
}

/** Every derived series name a run's membership implies, de-duplicated per config scope. */
export function derivedSeriesConfigRows(rows: readonly MembershipRow[]): DerivedSeriesConfigRow[] {
  const out = new Map<string, DerivedSeriesConfigRow>();
  for (const row of rows) {
    const names = [
      ...(row.member_count_name ? [row.member_count_name] : []),
      ...(row.extra_aggregations ?? []).map((a) => extraAggregationSeriesName(row.group_name, a)),
    ];
    for (const metric_name of names) {
      // Keyed on the CONFIG scope, not the run: several runs of one workload produce the same row.
      const k = key(row.system_under_test_id, row.test_environment, row.workload,
                    row.application_dashboard_id, row.panel_id, metric_name);
      if (out.has(k)) {continue;}
      out.set(k, {
        system_under_test_id: row.system_under_test_id,
        test_environment: row.test_environment,
        workload: row.workload,
        application_dashboard_id: row.application_dashboard_id,
        panel_id: row.panel_id,
        metric_name,
      });
    }
  }
  return Array.from(out.values());
}

/**
 * Organization and team come from the parent system, the way the perf-test pipeline's own
 * compare-config insert resolves them (`ds_compare_config.organization_id` is NOT NULL).
 */
/**
 * `created_by` / `updated_by` are stamped with the worker actor and `config_data.source` carries
 * `SERIES_GROUPING_DERIVED_SOURCE`, and BOTH are load-bearing rather than bookkeeping.
 *
 * `TestRunsMetricsService.applyGoldenPathClassifications` decides "a machine seeded this row" as
 * `updated_by === 'worker-pipeline'` OR (`!updated_by` AND `config_data.source` is the Dynatrace
 * marker). Unstamped, these rows read as a USER EDIT — and that method puts every existing config
 * row's `dashboard|panel` into `existingPanels` and skips a panel-level golden-path template whose
 * panel is in that set. So the first grouped analysis of a workload made every panel-level
 * golden-path template on that panel read as already-configured, permanently, with nothing logged
 * beyond `0 compare configs created`.
 *
 * The consequence was the exact inverse of what this write exists to prevent: with the template
 * never applied, the panel's own series — including the PRIMARY grouped series `api` — fall back to
 * `DEFAULT_COMPARE_CONFIG`, whose `higherIsBetter` is null, so a genuine regression on `api` lands
 * in `difference_count` and that panel can never flip the run to REGRESSION. It also outlived the
 * feature, since deleting the rule does not delete these rows.
 *
 * Why this bit here and not the two sibling machine writers: `PerformanceTestMetricsPipeline` and
 * the Dynatrace host mapping both write PANEL-level rows, which `workerSeeded` can key on and merge
 * into. This is the first metric-level machine writer, and `workerSeeded`'s key is
 * `dashboard|panel|metric`, so a panel-level template can never match one — which is why the API
 * side also has to exclude these rows from `existingPanels` rather than relying on the stamp alone.
 *
 * The actor is a local constant in the same style as `dashboard-manager.ts` and
 * `dynatrace-dashboard-manager.ts`, and like both of those it is **bound as a parameter** rather
 * than interpolated — it is a module-local literal either way, so this is house style rather than
 * a safety fix, but a reader who follows the citation should find the same shape at the other end.
 * There is no shared constant to import: the literal appears in ~40 places across this app, almost
 * all inside SQL string literals that a TypeScript constant cannot reach without rewriting them.
 * The `source` marker IS shared, because the value space of `config_data.source` is cross-app.
 */
const WORKER_PIPELINE_ACTOR = 'worker-pipeline';

export const INSERT_DERIVED_COMPARE_CONFIG_SQL = `
      INSERT INTO ds_compare_config (
          system_under_test_id, test_environment, workload, application_dashboard_id, panel_id,
          metric_name, config_data, organization_id, team_id, created_by, updated_by
      )
      SELECT s.system_under_test_id, s.test_environment, s.workload, s.application_dashboard_id,
             s.panel_id, s.metric_name, $7::jsonb, sut.organization_id, sut.team_id,
             $8::text, $8::text
      FROM unnest($1::uuid[], $2::text[], $3::text[], $4::uuid[], $5::int[], $6::text[])
        AS s(system_under_test_id, test_environment, workload, application_dashboard_id, panel_id,
             metric_name)
      JOIN systems_under_test sut ON sut.id = s.system_under_test_id
      ON CONFLICT DO NOTHING
    `;

/**
 * `mean` matches what the member-count and extras series are: a per-timestamp value whose
 * run-level summary is its average. The thresholds are the shared defaults; only the
 * classification matters here, and it is deliberately absent.
 *
 * Known residue, filed in TODOS.md: because config resolution picks a WHOLE object rather than
 * merging keys, these defaults also shadow the panel's own `thresholds`, so `api (sum)` is judged
 * on `mean` at 15% where its panel may be configured for `median` at 50%. It cannot change a
 * verdict — `higherIsBetter: null` keeps every derived series out of `regression_count` — but
 * `thresholds.aggregation` does pick which statistic is DISPLAYED as the compared value, so the
 * derived row can show a different number from its siblings with nothing saying why.
 */
export const DERIVED_SERIES_CONFIG_DATA = {
  metricClassification: { classification: 'none', higherIsBetter: null },
  thresholds: { aggregation: 'mean', percentageThreshold: 0.15, iqrThreshold: 2, absoluteThreshold: null },
  defaultValueIfControlGroupMissing: null,
  source: SERIES_GROUPING_DERIVED_SOURCE,
};

export function derivedCompareConfigParams(rows: DerivedSeriesConfigRow[]): unknown[] {
  return [
    rows.map((r) => r.system_under_test_id),
    rows.map((r) => r.test_environment),
    rows.map((r) => r.workload),
    rows.map((r) => r.application_dashboard_id),
    rows.map((r) => r.panel_id),
    rows.map((r) => r.metric_name),
    JSON.stringify(DERIVED_SERIES_CONFIG_DATA),
    WORKER_PIPELINE_ACTOR,
  ];
}

/**
 * The grouped panels' statistics. Combines the members of each group per timestamp, adds the
 * member-count series where tracked, runs the shared statistics chain over that, and writes the
 * average members per timestamp back onto the membership rows — the timestamp-alignment signal.
 * Returns that alignment, one row per group.
 *
 * Parameters: the run ids at `$1..$runCount`, then the eight member arrays from
 * `groupedStatementParams` — nine when `hasExtras`.
 *
 * `hasExtras` is what makes a rule with no extra aggregations send the statement it sent in
 * v0.2.97.43, byte for byte: the three `v_avg`/`v_sum`/`v_max` aggregate states and the third
 * `points` arm appear only when some rule actually asked for one. `groupedStatementParams` is
 * conditional on the same thing, or the bind count would not match — it derives the answer from
 * the rows with `hasExtraAggregations`, so pass `hasExtraAggregations(rows)` here and nothing
 * else. It is deliberately NOT defaulted: a caller that omitted it while holding extras-bearing
 * membership would compile cleanly and then send 10 parameters to a 9-bind statement, and
 * `statistics-calculation` is not softFail, so that fails the whole re-evaluate batch.
 */
export function buildGroupedStatisticsSQL(runCount: number, hasExtras: boolean): string {
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
                      ${p(5)}::text[], ${p(6)}::boolean[], ${p(7)}::text[]${hasExtras ? `, ${p(8)}::text[]` : ''})
            AS s(test_run_id, application_dashboard_id, panel_id, metric_name, group_name, aggregation,
                 track_member_count, member_count_name${hasExtras ? ', extra_aggregations' : ''})
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
              END AS value,${
                hasExtras
                  ? `
              -- Computed in the same GROUP BY pass as the primary CASE, so the extra cost is
              -- three aggregate states per group rather than a second scan of the panel.
              AVG(m.value) AS v_avg,
              SUM(m.value) AS v_sum,
              MAX(m.value) AS v_max,
              -- MAX, not MIN: extrasParam emits '' for a row with no extras and '' sorts
              -- BEFORE 'avg'/'max'/'sum', so MIN would collapse a group whose member rows
              -- disagree to '' -> NULLIF -> unnest(NULL) -> every extra silently dropped,
              -- while the JS-side extraSeries= counter still reported them as emitted. The two
              -- siblings below are both "any member wins" (bool_or, and MIN over a column whose
              -- no-value case is NULL rather than ''), so MAX matches their semantics.
              --
              -- What this does NOT do is reconcile a disagreement: these are comma-joined
              -- STRINGS, not arrays, so given {'avg,sum','max'} MAX returns 'max' and still
              -- drops avg and sum. It fixes the '' case and nothing more. That is adequate
              -- because disagreement is unreachable: one rule governs a panel,
              -- applySeriesGrouping keys the extras map on the GROUP rather than the member, and
              -- test_run_id, dashboard and panel are all in the GROUP BY. A union would need the
              -- column bound as an array, which unnest() cannot do per row (see EXTRAS_SQL).
              MAX(s.extra_aggregations) AS extra_aggregations,`
                  : ''
              }
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
          WHERE track_member_count AND member_count_name IS NOT NULL${
            hasExtras
              ? `
          UNION ALL
          -- One more series per extra aggregation. The name is composed here and in
          -- extraAggregationSeriesName (@perfana/shared/utils); the two must stay identical.
          -- unnest(NULL) yields no rows, so a group with no extras drops out of this arm.
          SELECT gp.test_run_id, gp.application_dashboard_id, gp.panel_id,
                 gp.group_name || ' (' || x.agg || ')' AS metric_name,
                 CASE x.agg WHEN 'sum' THEN gp.v_sum WHEN 'max' THEN gp.v_max ELSE gp.v_avg END AS value,
                 gp.time, gp.dashboard_uid, gp.panel_title, gp.dashboard_label,
                 -- NULL, matching the member-count arm above: first_benchmark_id reaches
                 -- ds_metric_statistics.benchmark_id and from there ds_adapt_results.benchmark_ids,
                 -- so inheriting it would attribute a threshold written for ONE pod's value to the
                 -- sum across the fleet. The unit IS kept: a SUM has the same unit as its members.
                 NULL::uuid AS first_benchmark_id,
                 gp.unit, gp.organization_id, gp.team_id, gp.metrics_source_id
          FROM grouped_points gp
          CROSS JOIN LATERAL unnest(${EXTRAS_SQL('gp.extra_aggregations')}) AS x(agg)`
              : ''
          }
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
    // Ninth only when the statement binds it; see buildGroupedStatisticsSQL's `hasExtras`.
    ...(hasExtraAggregations(rows) ? [extrasParam(rows)] : []),
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
