import { Injectable, Logger } from '@nestjs/common';
import {
  applySeriesGrouping,
  compileSeriesGroupingRule,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
  type SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';

/**
 * Series grouping on the READ side of `ds_metrics`.
 *
 * `StatisticsPipeline` rewrites series whose names differ only by a generated segment (a
 * Kubernetes pod name) to one group name, and stores the statistics under that name.
 * `ds_metrics` is never rewritten, so a reader that is handed a group name by a picker, a
 * saved graph preset, a report section or a deep link finds NOTHING under it and draws an
 * empty chart (root CLAUDE.md #18, #20, #49: silent, nothing logged). This resolver maps a
 * group name back to the raw series it stands for, and says how to combine them.
 *
 * Where the answer comes from, in order:
 *
 * 1. `ds_metric_series_groups`, the membership the run's statistics were computed WITH. It
 *    wins even when the rule has since changed: a chart must agree with the statistics.
 * 2. Otherwise (a live run, or one not yet recalculated) the CURRENT enabled rule for the
 *    run's (system, environment, workload) on that dashboard, applied with
 *    `applySeriesGrouping`. A panel rule beats a dashboard-wide rule.
 * 3. Otherwise nothing is grouped, and the caller takes its existing code path unchanged.
 *
 * Constraints that shape this file:
 *
 * - The lookup is ONE statement against small, indexed tables
 *   (`idx_ds_metric_series_groups_group` / `_label`, the rules table's unique slot index,
 *   which leads on `system_under_test_id`). It never touches `ds_metrics` unless a rule
 *   candidate exists and the caller did not already hold the raw names.
 * - No regex ever reaches SQL. A rule is applied by `applySeriesGrouping` in JavaScript,
 *   the one implementation shared with the worker and the web preview.
 * - Nothing here interpolates a name into SQL. Group names, member names and aggregations
 *   are bound parameters.
 * - It never throws. Grouping is an enhancement of a read that works without it, so a
 *   failure degrades to "nothing grouped" and logs.
 * - It has no RLS of its own: `ds_metrics` and `ds_metric_series_groups` carry none, so the
 *   CALLER must already have authorized the run.
 *
 * Design: docs/design/2026-11-01-series-grouping-design.md ("`ds_metrics` readers must
 * become group-aware").
 */

/** Anything with a `query(sql, params)`: an EntityManager or a Repository. */
export interface SeriesQueryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: any[]): Promise<any>;
}

/** What a group is combined with. `count` is the member-count series. */
export type SeriesValueAggregation = SeriesGroupingAggregation | 'count';

/**
 * A panel of one run. Address it by dashboard id, or by label (and title), the way
 * `getMetricTimeSeries` and the reports do. `panelId` is optional for the latter: the
 * report selectors and the time-series route carry a title, not an id.
 */
export interface PanelRef {
  testRunId: string;
  applicationDashboardId?: string;
  dashboardLabel?: string;
  panelTitle?: string;
  panelId?: number;
}

export interface SeriesGroup {
  /** The name a client sees: a group name, or a member-count name when `aggregation` is `count`. */
  group: string;
  /** Raw series names in `ds_metrics`, sorted. */
  members: string[];
  aggregation: SeriesValueAggregation;
  /** This group's member-count series name, when the rule tracks one. Never set on a count entry. */
  memberCountName: string | null;
}

interface MembershipRow {
  application_dashboard_id: string;
  panel_id: number;
  dashboard_label: string | null;
  panel_title: string | null;
  metric_name: string;
  group_name: string;
  aggregation: SeriesGroupingAggregation;
  member_count_name: string | null;
}

interface RuleRow {
  application_dashboard_id: string;
  panel_id: number | null;
  dashboard_label: string | null;
  spec: SeriesGroupingRuleSpec;
}

/** Everything the grouping tables say about a run (or a panel of it). */
export interface RunSeriesGrouping {
  membership: MembershipRow[];
  rules: RuleRow[];
  /** True when nothing applies: callers can skip all remapping. */
  isEmpty: boolean;
}

const EMPTY_GROUPING: RunSeriesGrouping = { membership: [], rules: [], isEmpty: true };

/** Code-unit order, the same the shared function sorts members in. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A group is only worth expanding when it ISN'T a series that already exists under its own
 * name: a lone unrenamed series is "a group of one" in the membership table, and answering
 * it from the aggregate would change nothing but the shape of the row.
 */
function isRealGroup(group: string, members: readonly string[]): boolean {
  return members.length > 1 || members[0] !== group;
}

/** `dashboardLabel|panelTitle|panelId`, for matching a row to the panel it belongs to. */
export function seriesPanelKey(label: string | null | undefined, title: string | null | undefined, panelId: number): string {
  return `${label ?? ''}\u0000${title ?? ''}\u0000${panelId}`;
}

/** Groups out of membership rows (the statistics' own record). */
function groupsFromMembership(rows: readonly MembershipRow[]): SeriesGroup[] {
  const byGroup = new Map<string, SeriesGroup>();
  for (const row of rows) {
    const existing = byGroup.get(row.group_name);
    if (existing) {
      existing.members.push(row.metric_name);
      existing.memberCountName ??= row.member_count_name;
    } else {
      byGroup.set(row.group_name, {
        group: row.group_name,
        members: [row.metric_name],
        aggregation: row.aggregation,
        memberCountName: row.member_count_name,
      });
    }
  }
  return Array.from(byGroup.values())
    .filter((g) => isRealGroup(g.group, g.members))
    .map((g) => ({ ...g, members: [...g.members].sort(byCodeUnit) }))
    .sort((a, b) => byCodeUnit(a.group, b.group));
}

/** Groups out of the current rule applied to `rawNames`. An invalid rule groups nothing. */
function groupsFromRule(spec: SeriesGroupingRuleSpec, rawNames: readonly string[]): SeriesGroup[] {
  if (!compileSeriesGroupingRule(spec).ok) return [];
  const result = applySeriesGrouping(spec, rawNames);
  const groups: SeriesGroup[] = [];
  for (const [group, members] of result.groups) {
    if (!isRealGroup(group, members)) continue;
    groups.push({
      group,
      members: [...members],
      aggregation: spec.aggregation,
      memberCountName: result.memberCountNames.get(group) ?? null,
    });
  }
  return groups;
}

/** Panel rule beats a dashboard-wide rule; ties break on dashboard id so the pick is stable. */
function pickRule(rules: readonly RuleRow[], panelId: number): RuleRow | undefined {
  const forPanel = rules.filter((r) => r.panel_id === panelId);
  const pool = forPanel.length > 0 ? forPanel : rules.filter((r) => r.panel_id === null);
  return [...pool].sort((a, b) => byCodeUnit(a.application_dashboard_id, b.application_dashboard_id))[0];
}

@Injectable()
export class SeriesGroupResolver {
  private readonly logger = new Logger(SeriesGroupResolver.name);

  /**
   * Set once both tables have been seen. Migration 1819 is not ordered before the API
   * starts (no service declares `depends_on: perfana-migration`), and a statement against a
   * missing table inside the request's RLS transaction aborts it (25P02), taking every later
   * query of the request with it. So presence is probed with `to_regclass`, which cannot
   * fail, and only a POSITIVE answer is remembered: the tables never go away again.
   */
  private tablesPresent = false;

  /**
   * Groups for a panel of a run, real groups only (a series nothing renamed is not one).
   *
   * @param rawNames the panel's raw series names when the caller already holds them. Only
   *   used for the live-run fallback; without them, and only when a rule candidate exists,
   *   they are read from `ds_metrics`.
   */
  async groupsForPanel(q: SeriesQueryable, ref: PanelRef, rawNames?: readonly string[]): Promise<SeriesGroup[]> {
    try {
      if (!(await this.ensureTables(q))) return [];
      const grouping = await this.load(q, ref);
      if (grouping.isEmpty) return [];

      const fromMembership = groupsFromMembership(grouping.membership);
      if (grouping.membership.length > 0) return fromMembership;

      // No membership for this panel: the current rule, if one applies.
      if (rawNames && ref.panelId !== undefined) {
        const rule = pickRule(grouping.rules, ref.panelId);
        return rule ? groupsFromRule(rule.spec, rawNames) : [];
      }
      return await this.applyRulesToStoredNames(q, ref, grouping.rules);
    } catch (error) {
      this.logger.warn(`Series grouping unavailable, reading ungrouped: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Expand requested names. A group name becomes its members; a member-count name becomes
   * its group's members with the `count` aggregation; anything else passes through as a raw
   * name. Nothing is queried for an empty request.
   */
  async expand(
    q: SeriesQueryable,
    ref: PanelRef,
    names: readonly string[],
  ): Promise<{ raw: string[]; groups: SeriesGroup[] }> {
    if (names.length === 0) return { raw: [], groups: [] };
    return expandSeriesNames(await this.groupsForPanel(q, ref), names);
  }

  /**
   * Everything the grouping tables say about a whole run, in one statement, for the readers
   * that list every panel (the series pickers). Pair with `groupsInRun` per panel.
   */
  async loadRun(q: SeriesQueryable, testRunId: string): Promise<RunSeriesGrouping> {
    try {
      if (!(await this.ensureTables(q))) return EMPTY_GROUPING;
      return await this.load(q, { testRunId });
    } catch (error) {
      this.logger.warn(`Series grouping unavailable, listing ungrouped: ${(error as Error).message}`);
      return EMPTY_GROUPING;
    }
  }

  /**
   * Groups for one panel out of a `loadRun` result: membership if the run has any for the
   * panel, else the current rule applied to `rawNames`. Pure.
   */
  groupsInRun(
    run: RunSeriesGrouping,
    panel: { dashboardLabel: string | null; panelTitle: string | null; panelId: number },
    rawNames: readonly string[],
  ): SeriesGroup[] {
    if (run.isEmpty) return [];
    const key = seriesPanelKey(panel.dashboardLabel, panel.panelTitle, panel.panelId);
    const mine = run.membership.filter(
      (m) => seriesPanelKey(m.dashboard_label, m.panel_title, m.panel_id) === key,
    );
    if (mine.length > 0) return groupsFromMembership(mine);

    const candidates = run.rules.filter((r) => r.dashboard_label === panel.dashboardLabel);
    const rule = pickRule(candidates, panel.panelId);
    return rule ? groupsFromRule(rule.spec, rawNames) : [];
  }

  // ---------------------------------------------------------------------------------------

  private async ensureTables(q: SeriesQueryable): Promise<boolean> {
    if (this.tablesPresent) return true;
    const rows = await q.query(
      `SELECT to_regclass('public.ds_metric_series_groups') IS NOT NULL
          AND to_regclass('public.series_grouping_rules') IS NOT NULL AS present`,
    );
    this.tablesPresent = Array.isArray(rows) && rows[0]?.present === true;
    return this.tablesPresent;
  }

  /**
   * The one lookup. Membership rows and rule candidates come back in a single statement
   * (UNION ALL, discriminated by `kind`) so that an ungrouped panel costs one round trip.
   * For a single panel the rule arm is guarded by NOT EXISTS on the membership arm, so a
   * run that has membership never pays for the rule join.
   */
  private async load(q: SeriesQueryable, ref: PanelRef): Promise<RunSeriesGrouping> {
    const params: unknown[] = [ref.testRunId];
    const scoped = this.panelPredicates(ref, params);
    if (scoped === null) return EMPTY_GROUPING;

    const membershipWhere = scoped.membership('g');
    const rows = await q.query(
      `SELECT 'm'::text AS kind, g.application_dashboard_id, g.panel_id,
              g.dashboard_label::text AS dashboard_label, g.panel_title::text AS panel_title,
              g.metric_name::text AS metric_name, g.group_name::text AS group_name,
              g.aggregation::text AS aggregation, g.member_count_name::text AS member_count_name,
              NULL::text AS preset, NULL::text AS pattern, NULL::text AS replacement,
              NULL::boolean AS track_member_count
         FROM ds_metric_series_groups g
        WHERE g.test_run_id = $1 AND ${membershipWhere}
       UNION ALL
       SELECT 'r'::text, r.application_dashboard_id, r.panel_id,
              ad.dashboard_label::text, NULL::text,
              NULL::text, NULL::text,
              r.aggregation::text, NULL::text,
              r.preset::text, r.pattern, r.replacement, r.track_member_count
         FROM series_grouping_rules r
         JOIN test_runs tr
           ON tr.test_run_id = $1
          AND tr.system_under_test_id = r.system_under_test_id
          AND tr.test_environment = r.test_environment
          AND tr.workload = r.workload
         JOIN application_dashboards ad ON ad.id = r.application_dashboard_id
        WHERE r.enabled AND ${scoped.rule('r', 'ad')}${
          scoped.isPanel
            ? ` AND NOT EXISTS (SELECT 1 FROM ds_metric_series_groups g2
                                 WHERE g2.test_run_id = $1 AND ${scoped.membership('g2')})`
            : ''
        }`,
      params,
    );
    if (!Array.isArray(rows) || rows.length === 0) return EMPTY_GROUPING;

    const membership: MembershipRow[] = [];
    const rules: RuleRow[] = [];
    for (const row of rows) {
      if (row.kind === 'm') {
        membership.push({
          application_dashboard_id: row.application_dashboard_id,
          panel_id: Number(row.panel_id),
          dashboard_label: row.dashboard_label,
          panel_title: row.panel_title,
          metric_name: row.metric_name,
          group_name: row.group_name,
          aggregation: row.aggregation,
          member_count_name: row.member_count_name ?? null,
        });
      } else {
        rules.push({
          application_dashboard_id: row.application_dashboard_id,
          panel_id: row.panel_id === null || row.panel_id === undefined ? null : Number(row.panel_id),
          dashboard_label: row.dashboard_label,
          spec: {
            preset: row.preset as SeriesGroupingPreset,
            pattern: row.pattern,
            replacement: row.replacement,
            aggregation: row.aggregation,
            trackMemberCount: row.track_member_count === true,
          },
        });
      }
    }
    return { membership, rules, isEmpty: membership.length === 0 && rules.length === 0 };
  }

  /**
   * WHERE fragments for the membership and rule arms, with their bound values appended to
   * `params` ($1 is already the run). Null when the reference cannot address a panel.
   */
  private panelPredicates(
    ref: PanelRef,
    params: unknown[],
  ): {
    isPanel: boolean;
    membership: (g: string) => string;
    rule: (r: string, ad: string) => string;
  } | null {
    const hasDashboardId = ref.applicationDashboardId !== undefined && ref.applicationDashboardId !== '';
    const hasLabel = ref.dashboardLabel !== undefined && ref.dashboardLabel !== '';
    if (!hasDashboardId && !hasLabel) {
      // Whole run: no panel address, only the run id.
      if (ref.panelId !== undefined || ref.panelTitle !== undefined) return null;
      return { isPanel: false, membership: () => 'TRUE', rule: () => 'TRUE' };
    }

    let dashboardIdx = 0;
    let titleIdx = 0;
    let panelIdx = 0;
    if (hasDashboardId) {
      params.push(ref.applicationDashboardId);
      dashboardIdx = params.length;
    } else {
      params.push(ref.dashboardLabel);
      dashboardIdx = params.length;
      if (ref.panelTitle !== undefined) {
        params.push(ref.panelTitle);
        titleIdx = params.length;
      }
    }
    if (ref.panelId !== undefined) {
      params.push(ref.panelId);
      panelIdx = params.length;
    }

    return {
      isPanel: true,
      membership: (g) =>
        [
          hasDashboardId ? `${g}.application_dashboard_id = $${dashboardIdx}` : `${g}.dashboard_label = $${dashboardIdx}`,
          titleIdx ? `${g}.panel_title = $${titleIdx}` : null,
          panelIdx ? `${g}.panel_id = $${panelIdx}` : null,
        ]
          .filter(Boolean)
          .join(' AND '),
      rule: (r, ad) =>
        [
          hasDashboardId ? `${r}.application_dashboard_id = $${dashboardIdx}` : `${ad}.dashboard_label = $${dashboardIdx}`,
          panelIdx ? `(${r}.panel_id = $${panelIdx} OR ${r}.panel_id IS NULL)` : null,
        ]
          .filter(Boolean)
          .join(' AND '),
    };
  }

  /**
   * Live-run fallback when the caller did not hold the raw names: a rule candidate exists, so
   * (and only so) read the panel's series from `ds_metrics`. One short DISTINCT over the
   * panel's own rows.
   */
  private async applyRulesToStoredNames(
    q: SeriesQueryable,
    ref: PanelRef,
    rules: readonly RuleRow[],
  ): Promise<SeriesGroup[]> {
    if (rules.length === 0) return [];
    const params: unknown[] = [ref.testRunId];
    const conditions = ['test_run_id = $1'];
    if (ref.applicationDashboardId) {
      params.push(ref.applicationDashboardId);
      conditions.push(`application_dashboard_id = $${params.length}`);
    } else if (ref.dashboardLabel) {
      params.push(ref.dashboardLabel);
      conditions.push(`dashboard_label = $${params.length}`);
      if (ref.panelTitle !== undefined) {
        params.push(ref.panelTitle);
        conditions.push(`panel_title = $${params.length}`);
      }
    } else {
      return [];
    }
    if (ref.panelId !== undefined) {
      params.push(ref.panelId);
      conditions.push(`panel_id = $${params.length}`);
    }

    const rows: Array<{ panel_id: number; metric_name: string }> = await q.query(
      `SELECT DISTINCT panel_id, metric_name FROM ds_metrics WHERE ${conditions.join(' AND ')}`,
      params,
    );
    const namesByPanel = new Map<number, string[]>();
    for (const row of rows ?? []) {
      const panelId = Number(row.panel_id);
      const list = namesByPanel.get(panelId);
      if (list) list.push(row.metric_name);
      else namesByPanel.set(panelId, [row.metric_name]);
    }

    const groups = new Map<string, SeriesGroup>();
    for (const [panelId, names] of namesByPanel) {
      const rule = pickRule(rules, panelId);
      if (!rule) continue;
      for (const g of groupsFromRule(rule.spec, names)) if (!groups.has(g.group)) groups.set(g.group, g);
    }
    return Array.from(groups.values());
  }
}

/**
 * Split requested names against a panel's groups. A group name becomes its members; a
 * member-count name becomes its group's members with the `count` aggregation; anything else
 * is a raw name and passes through. Pure, so a caller that reads many series of one panel
 * can look the groups up once.
 */
export function expandSeriesNames(
  available: readonly SeriesGroup[],
  names: readonly string[],
): { raw: string[]; groups: SeriesGroup[] } {
  if (available.length === 0) return { raw: [...names], groups: [] };

  const byName = new Map<string, SeriesGroup>();
  for (const g of available) {
    byName.set(g.group, g);
    // The worker drops a member-count name that collides with a real series, in which case
    // memberCountName is null here and there is nothing to add.
    if (g.memberCountName && !byName.has(g.memberCountName)) {
      byName.set(g.memberCountName, {
        group: g.memberCountName,
        members: g.members,
        aggregation: 'count',
        memberCountName: null,
      });
    }
  }

  const raw: string[] = [];
  const groups: SeriesGroup[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const hit = byName.get(name);
    if (!hit) {
      raw.push(name);
    } else if (!seen.has(hit.group)) {
      seen.add(hit.group);
      groups.push(hit);
    }
  }
  return { raw, groups };
}

/**
 * Replace the raw names a set of groups covers with the group names (and member-count
 * names), de-duplicated and sorted. Names no group covers pass through. What the pickers
 * list.
 */
export function mapNamesToGroups(
  rawNames: readonly string[],
  groups: readonly SeriesGroup[],
): { names: string[]; seriesGroups: SeriesGroup[] } {
  const memberToGroup = new Map<string, SeriesGroup>();
  for (const g of groups) for (const m of g.members) memberToGroup.set(m, g);

  const names = new Set<string>();
  const used = new Map<string, Set<string>>();
  for (const raw of rawNames) {
    const g = memberToGroup.get(raw);
    if (!g) {
      names.add(raw);
      continue;
    }
    names.add(g.group);
    if (g.memberCountName) names.add(g.memberCountName);
    const members = used.get(g.group) ?? new Set<string>();
    members.add(raw);
    used.set(g.group, members);
  }

  const seriesGroups = groups
    .filter((g) => used.has(g.group))
    .map((g) => ({ ...g, members: g.members.filter((m) => used.get(g.group)!.has(m)) }));
  return { names: Array.from(names).sort(byCodeUnit), seriesGroups };
}

export interface SeriesRelationOptions {
  /** The alias `conditions` use for `ds_metrics`. */
  alias: string;
  /** Conditions on `alias` columns, WITHOUT any condition on the series name. */
  conditions: readonly string[];
  /** The values `conditions` bind, as `$1..$n`. Not mutated. */
  params: readonly unknown[];
  /** Series answered by combining their members per timestamp. */
  groups?: readonly SeriesGroup[];
  /** Plain series, by exact name. */
  rawNames?: readonly string[];
  /** Plain series: every series EXCEPT these. */
  excludeNames?: readonly string[];
  /** Extra columns carried through (`MIN()` over the members for an aggregated series). */
  attributes?: readonly string[];
}

/**
 * The relation a group-aware reader reads instead of `ds_metrics`: columns
 * `time, metric_name, value, timestep, ramp_up` plus `attributes`.
 *
 * A group is answered by combining its members PER TIMESTAMP with its stored aggregation, the
 * way the worker computed the statistics (`GROUP BY time` over the members). The member list,
 * the output name and the aggregation travel as three bound arrays joined in, so any number
 * of groups costs one scan and nothing about a name is ever interpolated.
 *
 * The caller's existing ramp-up behaviour is deliberately NOT changed: the worker aggregates
 * only `ramp_up = false AND value IS NOT NULL` into statistics, but a chart reader keeps
 * whatever filter it already had, which is already in `conditions`. A timestamp counts as
 * ramp-up only when every member is.
 */
export function buildSeriesRelation(opts: SeriesRelationOptions): { sql: string; params: unknown[] } {
  const a = opts.alias;
  const params: unknown[] = [...opts.params];
  const attrs = opts.attributes ?? [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = (extra?: string): string => [...opts.conditions, ...(extra ? [extra] : [])].join(' AND ');
  const branches: string[] = [];

  const rawColumns = [
    `${a}."time" AS "time"`,
    `${a}.metric_name AS metric_name`,
    `${a}.value AS value`,
    `${a}.timestep AS timestep`,
    `${a}.ramp_up AS ramp_up`,
    ...attrs.map((c) => `${a}.${c} AS ${c}`),
  ].join(', ');

  if (opts.rawNames) {
    branches.push(
      `SELECT ${rawColumns} FROM ds_metrics ${a} WHERE ${where(`${a}.metric_name = ANY(${bind([...opts.rawNames])}::text[])`)}`,
    );
  } else if (opts.excludeNames && opts.excludeNames.length > 0) {
    branches.push(
      `SELECT ${rawColumns} FROM ds_metrics ${a} WHERE ${where(`NOT (${a}.metric_name = ANY(${bind([...opts.excludeNames])}::text[]))`)}`,
    );
  }

  const groups = opts.groups ?? [];
  if (groups.length > 0) {
    const members: string[] = [];
    const names: string[] = [];
    const aggregations: string[] = [];
    for (const g of groups) {
      for (const m of g.members) {
        members.push(m);
        names.push(g.group);
        aggregations.push(g.aggregation);
      }
    }
    const membersParam = bind(members);
    const namesParam = bind(names);
    const aggregationsParam = bind(aggregations);
    const allMembersParam = bind([...new Set(members)]);
    branches.push(
      `SELECT ${a}."time" AS "time", g.group_name AS metric_name,
              CASE MIN(g.aggregation)
                WHEN 'sum' THEN SUM(${a}.value)
                WHEN 'max' THEN MAX(${a}.value)
                WHEN 'count' THEN COUNT(*)::double precision
                ELSE AVG(${a}.value)
              END AS value,
              MIN(${a}.timestep) AS timestep, bool_and(${a}.ramp_up) AS ramp_up${attrs
                .map((c) => `, MIN(${a}.${c}) AS ${c}`)
                .join('')}
         FROM ds_metrics ${a}
         JOIN unnest(${membersParam}::text[], ${namesParam}::text[], ${aggregationsParam}::text[])
           AS g(member, group_name, aggregation) ON g.member = ${a}.metric_name
        WHERE ${where(`${a}.metric_name = ANY(${allMembersParam}::text[])`)}
        GROUP BY ${a}."time", g.group_name`,
    );
  }

  return { sql: branches.join('\nUNION ALL\n'), params };
}
