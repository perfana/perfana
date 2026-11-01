/**
 * Series grouping, the read side of the rules: preview, suggestions, status and apply.
 *
 * Everything here is cheap by construction. Names come from `ds_metric_statistics`,
 * `ds_metric_series_groups` and `ds_control_group_statistics` (a few hundred rows per run) and
 * NEVER from `ds_metrics`, the hypertable this feature must stay out of: a name lookup there
 * would decompress chunks to answer a question the small tables already answer. A spec asserts
 * that no emitted statement names it.
 *
 * Every route takes `accessibleOrgIds` as a REQUIRED parameter (`null` = global admin) and answers
 * 404 for anything outside it, with the message a missing resource would carry, so existence is
 * not learnable. There is no RLS backstop on a default deploy (`DB_ENABLE_RLS_ROLE` is off in
 * every shipped compose file); see root CLAUDE.md #48 and "The first-row class" in
 * apps/api/CLAUDE.md. The tenancy decision is made on the run's SYSTEM, the way
 * `AdaptService.validateTestRunAccess` does, and re-checked in JavaScript after the statement.
 *
 * Every statement starts with a `/* sg:<name> *\/` marker: it names the statement in
 * pg_stat_statements and in the slow-query log, and it is what the specs route on.
 *
 * Design: docs/design/2026-11-01-series-grouping-design.md ("Preview", "Suggestions", "Applying a
 * rule to runs that already exist", "Stale detection").
 */

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SUGGEST_MAX_MATCHED_BEFORE,
  SUGGEST_MIN_MATCHED_AFTER,
  applySeriesGrouping,
  compileSeriesGroupingRule,
  evaluateGroupingPresets,
  seriesGroupingRuleHash,
  validateRegexPattern,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
  type SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';
import { withRequestEm, runAfterRequestCommit } from '../../common/db/request-em';
import { AuthorizationService } from '../../common/services/authorization.service';
import { Capability } from '../../constants/capabilities.constants';
import { ApplicationDashboard, TestRun as TestRunEntity } from '../../entities';
import { BullMQClientService } from '../data-science/services/bullmq-client.service';
import { PreviewSeriesGroupingDto } from './dto/preview-series-grouping.dto';
import { ApplySeriesGroupingDto } from './dto/apply-series-grouping.dto';
import type {
  SeriesGroupingApplyResultDto,
  SeriesGroupingPreviewResponseDto,
  SeriesGroupingSuggestionDto,
  SeriesGroupingStatusDto,
  SeriesGroupingStaleDto,
} from './dto/series-grouping-insights-response.dto';
import {
  planRecalculation,
  resolveBaselineRunIds,
  resolveControlGroupId,
  type RecalculationTarget,
  type SqlRunner,
} from './run-scope';
import { loadControlGroupNames, loadRunSeriesNames } from './series-names';

/**
 * A group of at least two members averaging fewer than this many reporting per timestamp is not
 * aligned: its members share almost no timestamps, so the combined series is mostly one pod at
 * a time.
 *
 * MIRRORS `MISALIGNED_AVG_MEMBERS` in apps/worker/src/pipelines/helpers/series-grouping-plan.ts.
 * apps/api cannot import from apps/worker; `series-grouping.status.spec.ts` reads that file and
 * fails if the two drift.
 */
export const MISALIGNED_AVG_MEMBERS = 1.2;

/** Performance test dashboards never get rules: their series names are stable. */
const PERF_TEST_DASHBOARD_UID_PREFIX = 'performance-test-metrics-';

/** Same text for "does not exist" and "exists, but not yours". */
const RUN_NOT_FOUND = 'Test run not found';
const DASHBOARD_NOT_FOUND = 'Application dashboard not found';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RUN_COLUMNS = `tr.id, tr.test_run_id AS "testRunId", tr.system_under_test_id AS "systemUnderTestId",
       tr.test_environment AS "testEnvironment", tr.workload, tr.completed,
       tr.organization_id AS "organizationId", tr.team_id AS "teamId",
       sut.organization_id AS "sutOrganizationId"`;

interface RunRow extends RecalculationTarget {
  /** The organization of the run's SYSTEM: the tenancy decision is made on this. */
  sutOrganizationId: string;
}

interface RuleRow {
  id: string;
  applicationDashboardId: string;
  /** null = every panel of the dashboard. */
  panelId: number | null;
  spec: SeriesGroupingRuleSpec;
}

interface PanelNames {
  panelId: number;
  panelTitle: string | null;
  currentNames: string[];
  baselineNames: string[];
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values: Iterable<string>): string[] => Array.from(values).sort(byCodeUnit);
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const percent = (fraction: number): number => Math.round(fraction * 100);
const nonEmpty = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const panelKey = (dashboardId: string, panelId: number): string => `${dashboardId}\u0000${panelId}`;

@Injectable()
export class SeriesGroupingInsightsService {
  private readonly logger = new Logger(SeriesGroupingInsightsService.name);

  /** Only a positive probe is cached: a deploy that migrates later must start answering. */
  private groupingTablesKnownPresent = false;

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(ApplicationDashboard)
    private readonly appDashRepo: Repository<ApplicationDashboard>,
    private readonly bullmqClientService: BullMQClientService,
    private readonly authzService: AuthorizationService,
  ) {}

  // ───────────────────────────── preview ─────────────────────────────

  /**
   * What a rule would do to a run's names, before it is saved. Read-only. The client computes the
   * groups itself with `applySeriesGrouping`, so this is fetched once per dialog, not per
   * keystroke; what it adds is the baseline's names, and four checks the client cannot make.
   */
  async preview(
    dto: PreviewSeriesGroupingDto,
    accessibleOrgIds: string[] | null,
  ): Promise<SeriesGroupingPreviewResponseDto> {
    this.assertAnyOrganization(accessibleOrgIds);

    const run = dto.testRunId
      ? await this.resolveRun(dto.testRunId, accessibleOrgIds)
      : await this.resolveWorkloadRun(dto, accessibleOrgIds);
    const dashboard = await this.resolveDashboard(dto.applicationDashboardId, run, accessibleOrgIds);
    if ((dashboard.dashboardUid ?? '').startsWith(PERF_TEST_DASHBOARD_UID_PREFIX)) {
      throw new BadRequestException('Performance test dashboards cannot have series grouping rules');
    }

    const spec = toSpec(dto.rule);
    const compiled = compileSeriesGroupingRule(spec);
    if (!compiled.ok) {
      throw new BadRequestException(compiled.error ?? 'Invalid series grouping rule');
    }

    const q = this.sql();
    const wantedPanel = dto.panelId ?? null;
    const baselineRunIds = await resolveBaselineRunIds(q, run.testRunId);

    const nameRows = await loadRunSeriesNames(q, [run.testRunId, ...baselineRunIds], {
      kind: 'dashboard',
      dashboardId: dashboard.id,
      panelId: wantedPanel,
    });

    // A panel with its own enabled rule is governed by that rule, not by a dashboard-wide one: a
    // dashboard-wide preview must not claim to change it.
    const overridden = new Set<number>();
    if (wantedPanel === null) {
      for (const rule of await this.loadEnabledRules(q, run)) {
        if (rule.applicationDashboardId === dashboard.id && rule.panelId !== null) overridden.add(rule.panelId);
      }
    }

    const panels = this.collectPanels(nameRows, run.testRunId, wantedPanel, overridden);
    const groupings = new Map(panels.map((p) => [p.panelId, applySeriesGrouping(spec, p.currentNames)]));

    return {
      testRunId: run.testRunId,
      baselineRunIds,
      panels,
      sloWarnings: await this.findSloWarnings(q, run, dashboard.id, panels, groupings),
      rawNameCollisions: findRawNameCollisions(panels, groupings),
      alignment: await this.loadAlignment(q, run, dashboard.id, wantedPanel, new Set(panels.map((p) => p.panelId))),
    };
  }

  private collectPanels(
    rows: Array<{ test_run_id: string; panel_id: number; panel_title: string | null; metric_name: string }>,
    currentRunId: string,
    wantedPanel: number | null,
    overridden: Set<number>,
  ): PanelNames[] {
    const byPanel = new Map<number, { title: string | null; current: Set<string>; baseline: Set<string> }>();
    for (const row of rows) {
      if (wantedPanel !== null && row.panel_id !== wantedPanel) continue;
      if (overridden.has(row.panel_id)) continue;
      let acc = byPanel.get(row.panel_id);
      if (!acc) {
        acc = { title: null, current: new Set(), baseline: new Set() };
        byPanel.set(row.panel_id, acc);
      }
      if (row.test_run_id === currentRunId) {
        acc.current.add(row.metric_name);
        // The UNION can carry two titles for one panel; the smallest keeps the answer stable.
        if (row.panel_title !== null && (acc.title === null || row.panel_title < acc.title)) acc.title = row.panel_title;
      } else {
        acc.baseline.add(row.metric_name);
      }
    }
    return Array.from(byPanel.entries())
      .filter(([, acc]) => acc.current.size > 0)
      .sort(([a], [b]) => a - b)
      .map(([panelId, acc]) => ({
        panelId,
        panelTitle: acc.title,
        currentNames: sorted(acc.current),
        baselineNames: sorted(acc.baseline),
      }));
  }

  /**
   * SLOs whose match pattern would judge nothing after grouping: it matches at least one of the
   * run's raw names today and no group name tomorrow. The pattern lives in two places
   * (`configuration.matchPattern`, which the SLO dialog writes and wins, and the `match_pattern`
   * column grafana-sync's auto-config writes) — the same fold `withColumnMatchPattern` does in
   * the worker. An inverted pattern names the series to EXCLUDE, so "judged" is "does not match".
   */
  private async findSloWarnings(
    q: SqlRunner,
    run: RunRow,
    dashboardId: string,
    panels: PanelNames[],
    groupings: Map<number, ReturnType<typeof applySeriesGrouping>>,
  ): Promise<SeriesGroupingPreviewResponseDto['sloWarnings']> {
    if (panels.length === 0) return [];
    const rows: Array<{
      id: string;
      config_title: string | null;
      panel_title: string | null;
      match_pattern: string | null;
      config_match_pattern: string | null;
      invert_match_pattern: string | null;
      panel_key: string | null;
    }> = await q.query(
      `/* sg:benchmarks */
       SELECT b.id, b.config_title, b.panel_title, b.match_pattern,
              b.configuration->>'matchPattern' AS config_match_pattern,
              b.configuration->>'invertMatchPattern' AS invert_match_pattern,
              b.configuration->>'id' AS panel_key
       FROM benchmarks b
       WHERE b.system_under_test_id = $1
         AND b.test_environment = $2
         AND b.workload = $3
         AND b.application_dashboard_id = $4
         AND b.organization_id = $5
         AND b.enabled = true
         AND b.valid = true
         AND COALESCE(b.benchmark_type, 'metric') = 'metric'
       ORDER BY b.id`,
      [run.systemUnderTestId, run.testEnvironment, run.workload, dashboardId, run.sutOrganizationId],
    );

    const warnings: SeriesGroupingPreviewResponseDto['sloWarnings'] = [];
    for (const row of rows) {
      const panelId = row.panel_key !== null && /^\d+$/.test(row.panel_key) ? Number(row.panel_key) : null;
      const panel = panels.find((p) => p.panelId === panelId);
      const grouping = panelId === null ? undefined : groupings.get(panelId);
      if (!panel || !grouping) continue;

      const pattern = nonEmpty(row.config_match_pattern) ?? nonEmpty(row.match_pattern);
      if (pattern === null) continue;
      const checked = validateRegexPattern(pattern);
      if (!checked.safe || !checked.regex) continue; // a stored pattern the worker would also skip
      const regex = checked.regex;
      const inverted = row.invert_match_pattern === 'true';
      const judged = (name: string): boolean => regex.test(name) !== inverted;

      if (panel.currentNames.some(judged) && !Array.from(grouping.groups.keys()).some(judged)) {
        warnings.push({
          benchmarkId: row.id,
          name: row.config_title || row.panel_title || 'Unnamed SLO',
          matchPattern: pattern,
        });
      }
    }
    return warnings;
  }

  /** Alignment only exists for groups an earlier rule already formed: a first preview cannot know it. */
  private async loadAlignment(
    q: SqlRunner,
    run: RunRow,
    dashboardId: string,
    wantedPanel: number | null,
    previewedPanels: Set<number>,
  ): Promise<SeriesGroupingPreviewResponseDto['alignment']> {
    const rows: Array<{ panel_id: number; group_name: string; members: number; avg_members: number }> = await q.query(
      `/* sg:alignment */
       SELECT panel_id, group_name, COUNT(*)::int AS members, MAX(avg_members) AS avg_members
       FROM ds_metric_series_groups
       WHERE test_run_id = $1
         AND application_dashboard_id = $2::uuid
         AND ($3::int IS NULL OR panel_id = $3::int)
         AND avg_members IS NOT NULL
       GROUP BY panel_id, group_name
       HAVING COUNT(*) >= 2
       ORDER BY panel_id, group_name`,
      [run.testRunId, dashboardId, wantedPanel],
    );
    return rows
      .filter((r) => previewedPanels.has(r.panel_id))
      .map((r) => ({
        panelId: r.panel_id,
        group: r.group_name,
        members: r.members,
        avgMembers: round3(Number(r.avg_members)),
      }));
  }

  // ─────────────────────────── suggestions ───────────────────────────

  /**
   * Panels where a built-in preset would turn `incomparable` into a comparison: at least two
   * non-ignored `incomparable` ADAPT results, no enabled rule covering the panel, and a preset that
   * takes the share of the run's names the baseline already has from under
   * `SUGGEST_MAX_MATCHED_BEFORE` to at least `SUGGEST_MIN_MATCHED_AFTER`. Computed on request, so
   * detection stays out of the worker. Every served suggestion is logged (design Decision 5): the
   * log joined with `origin = 'suggestion'` on saved rules is how the thresholds get tuned.
   */
  async suggestions(
    testRunRef: string,
    accessibleOrgIds: string[] | null,
  ): Promise<SeriesGroupingSuggestionDto[]> {
    this.assertAnyOrganization(accessibleOrgIds);
    const run = await this.resolveRun(testRunRef, accessibleOrgIds);

    const q = this.sql();
    if (!(await this.groupingTablesPresent(q))) return [];

    const candidates: Array<{
      application_dashboard_id: string;
      dashboard_label: string | null;
      panel_id: number;
      panel_title: string | null;
      incomparable_count: number;
    }> = await q.query(
      `/* sg:incomparable */
       SELECT r.application_dashboard_id, MIN(r.dashboard_label) AS dashboard_label, r.panel_id,
              MIN(r.panel_title) AS panel_title, COUNT(*)::int AS incomparable_count
       FROM ds_adapt_results r
       JOIN application_dashboards ad ON ad.id = r.application_dashboard_id
       WHERE r.test_run_id = $1
         AND r.conclusion->>'label' = 'incomparable'
         AND NOT COALESCE((r.conclusion->>'ignore')::boolean, false)
         AND COALESCE(ad.dashboard_uid, '') NOT LIKE '${PERF_TEST_DASHBOARD_UID_PREFIX}%'
       GROUP BY r.application_dashboard_id, r.panel_id
       HAVING COUNT(*) >= 2`,
      [run.testRunId],
    );
    if (candidates.length === 0) return [];

    const rules = await this.loadEnabledRules(q, run);
    const uncovered = candidates.filter(
      (c) =>
        !rules.some(
          (r) => r.applicationDashboardId === c.application_dashboard_id && (r.panelId === null || r.panelId === c.panel_id),
        ),
    );
    if (uncovered.length === 0) return [];

    const controlGroupId = await resolveControlGroupId(q, run.testRunId);
    if (controlGroupId === null) return [];

    const dashboardIds = uncovered.map((c) => c.application_dashboard_id);
    const panelIds = uncovered.map((c) => c.panel_id);
    const [currentRows, baselineRows] = await Promise.all([
      loadRunSeriesNames(q, [run.testRunId], { kind: 'panels', dashboardIds, panelIds }),
      loadControlGroupNames(q, controlGroupId, dashboardIds, panelIds),
    ]);

    const current = new Map<string, Set<string>>();
    for (const row of currentRows) addTo(current, panelKey(row.application_dashboard_id, row.panel_id), row.metric_name);
    const baseline = new Map<string, Set<string>>();
    for (const row of baselineRows) addTo(baseline, panelKey(row.application_dashboard_id, row.panel_id), row.metric_name);

    const suggestions: SeriesGroupingSuggestionDto[] = [];
    for (const candidate of uncovered) {
      const key = panelKey(candidate.application_dashboard_id, candidate.panel_id);
      const currentNames = Array.from(current.get(key) ?? []);
      if (currentNames.length === 0) continue;

      const best = evaluateGroupingPresets(currentNames, Array.from(baseline.get(key) ?? []))[0];
      if (!best || !(best.matchedBefore < SUGGEST_MAX_MATCHED_BEFORE) || !(best.matchedAfter >= SUGGEST_MIN_MATCHED_AFTER)) {
        continue;
      }

      suggestions.push({
        applicationDashboardId: candidate.application_dashboard_id,
        dashboardLabel: candidate.dashboard_label,
        panelId: candidate.panel_id,
        panelTitle: candidate.panel_title,
        incomparableCount: candidate.incomparable_count,
        preset: best.preset,
        matchedBefore: best.matchedBefore,
        matchedAfter: best.matchedAfter,
      });
      this.logger.log(
        `series-grouping suggestion ${run.testRunId} ${candidate.application_dashboard_id}/${candidate.panel_id} ` +
          `preset=${best.preset} matched ${percent(best.matchedBefore)}% -> ${percent(best.matchedAfter)}% ` +
          `incomparable=${candidate.incomparable_count}`,
      );
    }

    return suggestions.sort(
      (a, b) =>
        b.incomparableCount - a.incomparableCount ||
        byCodeUnit(a.dashboardLabel ?? '', b.dashboardLabel ?? '') ||
        a.panelId - b.panelId,
    );
  }

  // ───────────────────────────── status ──────────────────────────────

  /**
   * Is the run's grouping in step with the rules that cover it? A panel is `stale` when its
   * membership rows (what the statistics were computed with) disagree with the enabled rules:
   *
   *  - `not-applied`: a rule covers the panel and the run has no membership for it;
   *  - `rule-removed`: membership whose rule is gone (`rule_id` NULL after a delete) or is now
   *    disabled, so the next recalculation would ungroup the panel. Wins over `rule-changed`;
   *  - `rule-changed`: the rule covering the panel is not the one that produced the membership, or
   *    its `rule_hash` differs (the rule was edited since).
   *
   * A run that is still running reports nothing: it has no membership until its analysis, which
   * applies the current rules on completion. `misaligned` lists groups of two or more members that
   * report about one member per timestamp, i.e. whose members share almost no timestamps.
   */
  async status(testRunRef: string, accessibleOrgIds: string[] | null): Promise<SeriesGroupingStatusDto> {
    this.assertAnyOrganization(accessibleOrgIds);
    const run = await this.resolveRun(testRunRef, accessibleOrgIds);
    const empty: SeriesGroupingStatusDto = { stale: [], misaligned: [] };
    if (run.completed !== true) return empty;

    const q = this.sql();
    if (!(await this.groupingTablesPresent(q))) return empty;

    const [rules, membership, misaligned] = await Promise.all([
      this.loadEnabledRules(q, run),
      q.query(
        `/* sg:membership */
         SELECT application_dashboard_id, panel_id, rule_id, rule_hash
         FROM ds_metric_series_groups
         WHERE test_run_id = $1
         GROUP BY application_dashboard_id, panel_id, rule_id, rule_hash`,
        [run.testRunId],
      ) as Promise<Array<{ application_dashboard_id: string; panel_id: number; rule_id: string | null; rule_hash: string }>>,
      this.loadMisaligned(q, run.testRunId),
    ]);

    // A dashboard-wide rule covers the panels the run actually has series for, so the panel list
    // comes from the statistics; a rule on a panel the run has no series for has nothing to group.
    const dashboardIds = Array.from(new Set(rules.map((r) => r.applicationDashboardId)));
    const statPanels: Array<{ application_dashboard_id: string; panel_id: number }> =
      dashboardIds.length === 0
        ? []
        : await q.query(
            `/* sg:stat-panels */
             SELECT DISTINCT application_dashboard_id, panel_id
             FROM ds_metric_statistics
             WHERE test_run_id = $1 AND application_dashboard_id = ANY($2::uuid[])`,
            [run.testRunId, dashboardIds],
          );

    const effectiveRule = (dashboardId: string, panelId: number): RuleRow | undefined =>
      rules.find((r) => r.applicationDashboardId === dashboardId && r.panelId === panelId) ??
      rules.find((r) => r.applicationDashboardId === dashboardId && r.panelId === null);

    const enabledRuleIds = new Set(rules.map((r) => r.id));
    const memberships = new Map<string, Array<{ ruleId: string | null; hash: string }>>();
    const panels = new Map<string, { dashboardId: string; panelId: number }>();
    for (const row of membership) {
      const key = panelKey(row.application_dashboard_id, row.panel_id);
      const list = memberships.get(key) ?? [];
      list.push({ ruleId: row.rule_id, hash: row.rule_hash });
      memberships.set(key, list);
      panels.set(key, { dashboardId: row.application_dashboard_id, panelId: row.panel_id });
    }
    for (const row of statPanels) {
      if (effectiveRule(row.application_dashboard_id, row.panel_id)) {
        panels.set(panelKey(row.application_dashboard_id, row.panel_id), {
          dashboardId: row.application_dashboard_id,
          panelId: row.panel_id,
        });
      }
    }

    const stale: SeriesGroupingStaleDto[] = [];
    for (const [key, { dashboardId, panelId }] of panels) {
      const rule = effectiveRule(dashboardId, panelId);
      const applied = memberships.get(key) ?? [];
      let reason: SeriesGroupingStaleDto['reason'] | null = null;
      if (applied.length === 0) {
        if (rule) reason = 'not-applied';
      } else if (!rule || applied.some((m) => m.ruleId === null || !enabledRuleIds.has(m.ruleId))) {
        reason = 'rule-removed';
      } else if (applied.some((m) => m.ruleId !== rule.id || m.hash !== seriesGroupingRuleHash(rule.spec))) {
        reason = 'rule-changed';
      }
      if (reason) stale.push({ applicationDashboardId: dashboardId, panelId, reason });
    }
    stale.sort((a, b) => byCodeUnit(a.applicationDashboardId, b.applicationDashboardId) || a.panelId - b.panelId);

    return { stale, misaligned };
  }

  private async loadMisaligned(q: SqlRunner, testRunId: string): Promise<SeriesGroupingStatusDto['misaligned']> {
    const rows: Array<{
      application_dashboard_id: string;
      panel_id: number;
      group_name: string;
      members: number;
      avg_members: number;
    }> = await q.query(
      `/* sg:misaligned */
       SELECT application_dashboard_id, panel_id, group_name, COUNT(*)::int AS members,
              MAX(avg_members) AS avg_members
       FROM ds_metric_series_groups
       WHERE test_run_id = $1 AND avg_members IS NOT NULL
       GROUP BY application_dashboard_id, panel_id, group_name
       HAVING COUNT(*) >= 2
       ORDER BY application_dashboard_id, panel_id, group_name`,
      [testRunId],
    );
    // Compared in JavaScript on the rounded value: avg_members is a REAL, so 1.2 round-trips as
    // 1.2000000476837158 and a SQL `< 1.2` would call the threshold itself misaligned.
    return rows
      .map((r) => ({
        applicationDashboardId: r.application_dashboard_id,
        panelId: r.panel_id,
        group: r.group_name,
        members: r.members,
        avgMembers: round3(Number(r.avg_members)),
      }))
      .filter((r) => r.avgMembers < MISALIGNED_AVG_MEMBERS);
  }

  // ───────────────────────────── apply ───────────────────────────────

  /**
   * Make a rule take effect on runs that already exist: re-evaluate with `recalculateStatistics`
   * over the run plus its baseline, or the workload's most recent runs. Saving a rule changes
   * nothing until statistics are recalculated.
   *
   * Enqueued AFTER the request's transaction commits (`runAfterRequestCommit`): awaiting Redis
   * inside it holds a pooled Postgres connection idle-in-transaction for the length of a Redis
   * stall. The hook logs and swallows every error, because with no request transaction it is
   * dispatched as a floating promise and a rejection would be an unhandled one. So `enqueued`
   * says what was SCHEDULED; a failed enqueue shows only in the log.
   */
  async apply(
    dto: ApplySeriesGroupingDto,
    userId: string,
    roles: string[],
    accessibleOrgIds: string[] | null,
  ): Promise<SeriesGroupingApplyResultDto> {
    this.assertAnyOrganization(accessibleOrgIds);
    const run = await this.resolveRun(dto.testRunId, accessibleOrgIds);
    // `partitionWritableCompletedRuns` skips runs outside the TARGET's (organization, team) on the
    // premise that the caller proved write permission on that pair. That proof is this check —
    // `test-run:update`, as the analysis-window apply requires. A re-evaluate rewrites stored
    // statistics and verdicts for up to 100 runs, so an org viewer must not be able to start one.
    // Checked after the 404 scoping; an API-key principal passes, as in TestRunsMutationService.
    if (!userId.startsWith('api-key:')) {
      const caps = await this.authzService.getCapabilities(userId, roles, run.organizationId ?? null, run.teamId ?? null);
      if (!caps.includes(Capability.TestRunUpdate)) {
        this.logger.warn(`Write denied: capability=${Capability.TestRunUpdate} userId=${userId} testRun=${run.testRunId}`);
        throw new ForbiddenException('You do not have permission to re-evaluate these test runs');
      }
    }

    const plan = await planRecalculation(this.sql(), run, dto.scope);
    const bucket = (reason: string) => plan.skipped.filter((s) => s.skipped === reason).length;
    this.logger.log(
      `series-grouping apply ${run.testRunId} scope=${dto.scope}: ${plan.enqueue.length} run(s) to re-evaluate, ` +
        `${plan.skipped.length} skipped (${bucket('running')} running, ${bucket('not-writable')} on another team or organization)`,
    );

    if (plan.enqueue.length > 0) {
      const testRunIds = plan.enqueue;
      runAfterRequestCommit(() => this.enqueueRecalculation(run.testRunId, testRunIds));
    }
    return { enqueued: plan.enqueue, skipped: plan.skipped };
  }

  /** Never rejects: see `apply`. */
  private async enqueueRecalculation(targetTestRunId: string, testRunIds: string[]): Promise<void> {
    try {
      // ONE batch: the orchestrator's scope lock is keyed on sut:env:workload, so a second job
      // for the workload is refused rather than queued; chunking happens inside that one job.
      await this.bullmqClientService.reevaluateBatch(testRunIds, {
        checks: true,
        adapt: true,
        recalculateStatistics: true,
      });
      this.logger.log(
        `series-grouping apply ${targetTestRunId}: re-evaluation enqueued for ${testRunIds.length} test run(s)`,
      );
    } catch (err) {
      this.logger.error(`series-grouping apply ${targetTestRunId}: failed to enqueue re-evaluation`, err);
    }
  }

  // ───────────────────────────── shared ──────────────────────────────

  /** Through the request's EntityManager when there is one, so RLS applies to every statement. */
  private sql(): SqlRunner {
    return withRequestEm(this.testRunRepo);
  }

  /**
   * `IN (:...orgs)` on an empty array renders `IN ()`, a syntax error rather than an empty result,
   * and an empty list means no run is reachable anyway: answer exactly as a missing run would.
   */
  private assertAnyOrganization(accessibleOrgIds: string[] | null): void {
    if (accessibleOrgIds !== null && accessibleOrgIds.length === 0) throw new NotFoundException(RUN_NOT_FOUND);
  }

  /**
   * A run by its canonical `test_run_id` or its entity UUID. 404 for anything outside the caller's
   * organizations, indistinguishable from a missing run. The tenancy decision is the run's SYSTEM
   * organization (`AdaptService.validateTestRunAccess`), in the statement AND re-checked here.
   */
  private async resolveRun(ref: string, accessibleOrgIds: string[] | null): Promise<RunRow> {
    if (UUID_RE.test(ref)) {
      const byId = await this.queryRun('sg:run', 'tr.id = $1::uuid', [ref], accessibleOrgIds);
      if (byId) return byId;
    }
    const run = await this.queryRun('sg:run', 'tr.test_run_id = $1', [ref], accessibleOrgIds);
    if (!run) throw new NotFoundException(RUN_NOT_FOUND);
    return run;
  }

  /** The system configuration entry point: no run in hand, so the workload's newest completed one. */
  private async resolveWorkloadRun(dto: PreviewSeriesGroupingDto, accessibleOrgIds: string[] | null): Promise<RunRow> {
    if (!dto.systemId || !dto.environment || !dto.workload) {
      throw new BadRequestException('Provide testRunId, or systemId together with environment and workload');
    }
    const run = await this.queryRun(
      'sg:workload-run',
      `tr.system_under_test_id = $1::uuid AND tr.test_environment = $2 AND tr.workload = $3
       AND tr.completed = true AND tr.deletion_status IS NULL`,
      [dto.systemId, dto.environment, dto.workload],
      accessibleOrgIds,
      'ORDER BY tr.start_time DESC NULLS LAST LIMIT 1',
    );
    if (!run) throw new NotFoundException(RUN_NOT_FOUND);
    return run;
  }

  private async queryRun(
    marker: 'sg:run' | 'sg:workload-run',
    where: string,
    params: unknown[],
    accessibleOrgIds: string[] | null,
    tail = 'LIMIT 1',
  ): Promise<RunRow | null> {
    const bound = [...params];
    let orgClause = '';
    if (accessibleOrgIds !== null) {
      bound.push(accessibleOrgIds);
      orgClause = `AND sut.organization_id = ANY($${bound.length}::uuid[])`;
    }
    const rows: RunRow[] = await this.sql().query(
      `/* ${marker} */
       SELECT ${RUN_COLUMNS}
       FROM test_runs tr
       JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
       WHERE ${where} ${orgClause}
       ${tail}`,
      bound,
    );
    const run = rows[0];
    if (!run) return null;
    // Defence in depth: the statement already filtered, and a lookup that did not must not leak.
    if (accessibleOrgIds !== null && !accessibleOrgIds.includes(run.sutOrganizationId)) return null;
    return run;
  }

  /**
   * The row the query will READ is the one authorized: it must belong to the run's system and
   * environment (rules are per workload, dashboards per environment) and to the caller's
   * organizations. A foreign dashboard answers like a missing one.
   */
  private async resolveDashboard(
    id: string,
    run: RunRow,
    accessibleOrgIds: string[] | null,
  ): Promise<{ id: string; dashboardUid?: string }> {
    const dashboard = await withRequestEm(this.appDashRepo).findOne({
      where: { id },
      select: { id: true, systemUnderTestId: true, testEnvironment: true, dashboardUid: true, organizationId: true },
    });
    if (
      !dashboard ||
      dashboard.systemUnderTestId !== run.systemUnderTestId ||
      dashboard.testEnvironment !== run.testEnvironment ||
      (accessibleOrgIds !== null && !accessibleOrgIds.includes(dashboard.organizationId))
    ) {
      throw new NotFoundException(DASHBOARD_NOT_FOUND);
    }
    return { id: dashboard.id, dashboardUid: dashboard.dashboardUid };
  }

  /**
   * The enabled rules covering the run's workload, perf-test dashboards excluded. The same
   * selection `StatisticsPipeline` loads (`SERIES_GROUPING_RULES_SQL` in the worker), and the
   * `spec` is built the way the worker builds it, so `seriesGroupingRuleHash(spec)` is the hash
   * a run grouped by this rule carries.
   */
  private async loadEnabledRules(q: SqlRunner, run: RunRow): Promise<RuleRow[]> {
    const rows: Array<{
      id: string;
      application_dashboard_id: string;
      panel_id: number | null;
      preset: SeriesGroupingPreset;
      pattern: string | null;
      replacement: string | null;
      aggregation: SeriesGroupingAggregation;
      track_member_count: boolean;
    }> = await q.query(
      `/* sg:rules */
       SELECT r.id, r.application_dashboard_id, r.panel_id, r.preset, r.pattern, r.replacement,
              r.aggregation, r.track_member_count
       FROM series_grouping_rules r
       JOIN application_dashboards ad ON ad.id = r.application_dashboard_id
       WHERE r.system_under_test_id = $1
         AND r.test_environment = $2
         AND r.workload = $3
         AND r.enabled
         AND COALESCE(ad.dashboard_uid, '') NOT LIKE '${PERF_TEST_DASHBOARD_UID_PREFIX}%'`,
      [run.systemUnderTestId, run.testEnvironment, run.workload],
    );
    return rows.map((row) => ({
      id: row.id,
      applicationDashboardId: row.application_dashboard_id,
      panelId: row.panel_id === null || row.panel_id === undefined ? null : Number(row.panel_id),
      spec: {
        preset: row.preset,
        pattern: row.pattern ?? null,
        replacement: row.replacement ?? '',
        aggregation: row.aggregation,
        trackMemberCount: row.track_member_count === true,
      },
    }));
  }

  /**
   * The API can start before migration 1819 runs, and a statement on a missing table inside the
   * request's RLS transaction aborts it (25P02). The two GET routes are called on every test run
   * page view, so a rollout-order mistake must read as "nothing to say", not as a stream of 500s.
   */
  private async groupingTablesPresent(q: SqlRunner): Promise<boolean> {
    if (this.groupingTablesKnownPresent) return true;
    try {
      const rows: Array<{ present: unknown }> = await q.query(
        `/* sg:tables-present */
         SELECT (to_regclass('public.series_grouping_rules') IS NOT NULL
                 AND to_regclass('public.ds_metric_series_groups') IS NOT NULL) AS present`,
      );
      if (rows[0]?.present === true) {
        this.groupingTablesKnownPresent = true;
        return true;
      }
    } catch (err) {
      this.logger.warn(`series-grouping: table probe failed, answering as if ungrouped: ${errorMessage(err)}`);
    }
    return false;
  }
}

function toSpec(rule: PreviewSeriesGroupingDto['rule']): SeriesGroupingRuleSpec {
  return {
    preset: rule.preset,
    pattern: rule.pattern ?? null,
    replacement: rule.replacement ?? '',
    aggregation: rule.aggregation,
    trackMemberCount: rule.trackMemberCount,
  };
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

/**
 * Raw baseline names that equal a group name the rule would produce by RENAMING something. A
 * baseline run that is not recalculated keeps its raw `api` (a legend that was already
 * `{{container}}`), and that raw value would pool into the new group `api`. A group the run
 * already carried under that very name is an ordinary same-series match, not a collision.
 */
function findRawNameCollisions(
  panels: PanelNames[],
  groupings: Map<number, ReturnType<typeof applySeriesGrouping>>,
): string[] {
  const collisions = new Set<string>();
  for (const panel of panels) {
    const grouping = groupings.get(panel.panelId);
    if (!grouping) continue;
    const baseline = new Set(panel.baselineNames);
    for (const [group, members] of grouping.groups) {
      if (members.some((m) => m !== group) && baseline.has(group)) collisions.add(group);
    }
  }
  return sorted(collisions);
}

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
}
