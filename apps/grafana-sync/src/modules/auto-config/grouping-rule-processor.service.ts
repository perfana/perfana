/**
 * Provisions a profile's series grouping rules (migration 1826) into `series_grouping_rules`.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApplicationDashboard, TestRun } from '@perfana/shared/entities';
import { compileSeriesGroupingRule } from '@perfana/shared/utils';
import type { SeriesGroupingAggregation, SeriesGroupingPreset } from '@perfana/shared/utils';
import { DashboardFinderService } from './dashboard-finder.service';

/** A profile rule joined to its profile dashboard. */
export interface ProfileGroupingRuleRow {
  id: string;
  profile: string;
  dashboard_uid: string;
  panel_id: number | null;
  preset: SeriesGroupingPreset;
  pattern: string | null;
  replacement: string;
  aggregations: SeriesGroupingAggregation[];
  enabled: boolean;
}

/** `created_by` of a provisioned row; `updated_by` stays NULL until someone saves it by hand. */
export const PROFILE_GROUPING_ACTOR = 'system:profile';

/**
 * A provisioned row is keyed on its slot (system, environment, workload, dashboard, panel):
 *
 * - an empty slot gets the profile rule, `origin = 'profile'`, `profile_rule_id` set;
 * - a slot this profile rule owns (`profile_rule_id` matches, `updated_by IS NULL`) is re-synced
 *   from it, so an edit the API's propagation missed still lands, and only a difference is written;
 * - any other occupant is left alone: a hand-made or hand-edited rule always wins, and the first
 *   of two profile rules on one slot keeps it rather than the two taking turns.
 */
@Injectable()
export class GroupingRuleProcessorService {
  private readonly logger = new Logger(GroupingRuleProcessorService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dashboardFinderService: DashboardFinderService,
  ) {}

  /**
   * Every profile rule, oldest first so slot ties resolve the same way on every pass. Before
   * migration 1826 the table does not exist; that reads as "no rules" with a warning rather than
   * failing the auto-config pass.
   */
  async findProfileGroupingRules(organizationIds?: string[]): Promise<ProfileGroupingRuleRow[]> {
    try {
      const orgFilter = organizationIds && organizationIds.length > 0;
      return await this.dataSource.query(
        `SELECT r.id, d.profile, d.dashboard_uid, r.panel_id, r.preset, r.pattern, r.replacement,
                r.aggregations, r.enabled
           FROM profile_series_grouping_rules r
           JOIN profile_grafana_dashboards d ON d.id = r.profile_dashboard_id
          ${orgFilter ? 'WHERE r.organization_id = ANY($1::uuid[])' : ''}
          ORDER BY r.created_at, r.id`,
        orgFilter ? [organizationIds] : [],
      );
    } catch (error) {
      // Either way the rest of the auto-config pass (dashboards, SLOs) still runs; only an
      // undefined_table is blamed on the migration, so any other failure is not misread.
      const msg = error instanceof Error ? error.message : String(error);
      const code =
        (error as { code?: string; driverError?: { code?: string } })?.code ??
        (error as { driverError?: { code?: string } })?.driverError?.code;
      if (code === '42P01') {
        this.logger.warn(
          `Profile series grouping rules not read: migration 1826 not applied yet (${msg})`,
        );
      } else {
        this.logger.error(
          `Could not read profile series grouping rules; provisioning skipped this pass: ${msg}`,
        );
      }
      return [];
    }
  }

  async processProfileGroupingRules(
    testRun: TestRun,
    profileNames: string[],
    rules: ProfileGroupingRuleRow[],
  ): Promise<void> {
    const matching = rules.filter((r) => profileNames.includes(r.profile));
    if (matching.length === 0) return;
    if (!testRun.workload) {
      this.logger.warn(
        `Test run ${testRun.testRunId} has no workload; profile series grouping rules skipped`,
      );
      return;
    }
    const systemUnderTestName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    let inserted = 0;
    let updated = 0;
    // Several rules usually share one template; look each up once per run.
    const dashboardsByUid = new Map<string, Promise<ApplicationDashboard[]>>();

    for (const rule of matching) {
      // The API validates on write; a row written by SQL reaches the worker's regex engine otherwise.
      const compiled = compileSeriesGroupingRule(rule);
      if (!compiled.ok) {
        this.logger.warn(
          `Profile series grouping rule ${rule.id} is invalid (${compiled.error}) - skipping`,
        );
        continue;
      }
      let lookup = dashboardsByUid.get(rule.dashboard_uid);
      if (!lookup) {
        lookup = this.dashboardFinderService.findApplicationDashboardsByTemplateDashboardUid(
          rule.dashboard_uid,
          systemUnderTestName,
          testRun.testEnvironment,
          testRun.organizationId,
        );
        dashboardsByUid.set(rule.dashboard_uid, lookup);
      }
      let dashboards: ApplicationDashboard[];
      try {
        dashboards = await lookup;
      } catch (error) {
        // One template that cannot be looked up fails only the rules on it, each with its own line.
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Profile series grouping rule ${rule.id}: template ${rule.dashboard_uid} lookup failed: ${msg}`,
        );
        continue;
      }
      // One failing dashboard must not skip the rest.
      for (const ad of dashboards) {
        if (!ad.organizationId) continue; // series_grouping_rules.organization_id is NOT NULL
        try {
          const outcome = await this.upsert(testRun, rule, ad);
          if (outcome === 'inserted') inserted++;
          else if (outcome === 'updated') updated++;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to provision profile series grouping rule ${rule.id} on dashboard ${ad.id}: ${msg}`,
          );
        }
      }
    }

    if (inserted + updated > 0) {
      this.logger.log(
        `Profile series grouping rules for ${testRun.testRunId} (${testRun.testEnvironment}/${testRun.workload}): ` +
          `${inserted} created, ${updated} re-synced`,
      );
    }
  }

  /**
   * The rule's fields are read from `profile_series_grouping_rules` in the statement itself, never
   * from the copy this pass loaded at its start: a rule deleted meanwhile then inserts nothing (no
   * orphan row that no profile delete could find again), and one edited meanwhile writes its
   * current values instead of reverting the API's propagation. Three guards on that read:
   *
   * - `FOR SHARE OF r, d` waits for an API request that is deleting the rule or re-pointing its
   *   profile dashboard, then re-checks the row: the API deletes copies by rule id only after the
   *   rule is gone, so a racing insert either copies nothing or commits before that DELETE sees it.
   * - `d.dashboard_uid = $9` drops a rule whose profile dashboard was re-pointed after this pass
   *   looked its template up, so no copy lands on the old template's dashboards.
   * - `r.enabled`: a disabled rule creates no new copies, so it holds no slot another rule or a
   *   person could use. Copies it already has follow it through the API's propagation.
   *
   * `uq_series_grouping_rules_slot` is migration 1819's slot constraint, named in the API as
   * `SERIES_GROUPING_SLOT_INDEX` (apps/api/src/modules/series-grouping/duplicate-rule.ts); a rename
   * has to change both.
   */
  private async upsert(
    testRun: TestRun,
    rule: ProfileGroupingRuleRow,
    ad: { id: string; systemUnderTestId: string; organizationId: string; teamId?: string | null },
  ): Promise<'inserted' | 'updated' | 'unchanged'> {
    const rows: Array<{ inserted: boolean }> = await this.dataSource.query(
      `INSERT INTO series_grouping_rules AS s
         (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id,
          preset, pattern, replacement, aggregations, enabled, origin, profile_rule_id,
          organization_id, team_id, created_by)
       SELECT $1, $2, $3, $4, r.panel_id, r.preset, r.pattern, r.replacement, r.aggregations, r.enabled,
              'profile', r.id, $6, $7, $8
         FROM profile_series_grouping_rules r
         JOIN profile_grafana_dashboards d ON d.id = r.profile_dashboard_id
        WHERE r.id = $5 AND r.enabled AND d.dashboard_uid = $9
          FOR SHARE OF r, d
       ON CONFLICT ON CONSTRAINT uq_series_grouping_rules_slot DO UPDATE
         SET preset = EXCLUDED.preset, pattern = EXCLUDED.pattern, replacement = EXCLUDED.replacement,
             aggregations = EXCLUDED.aggregations, enabled = EXCLUDED.enabled, updated_at = now()
         WHERE s.profile_rule_id = EXCLUDED.profile_rule_id AND s.updated_by IS NULL
           AND (s.preset, s.pattern, s.replacement, s.aggregations, s.enabled)
               IS DISTINCT FROM (EXCLUDED.preset, EXCLUDED.pattern, EXCLUDED.replacement, EXCLUDED.aggregations, EXCLUDED.enabled)
       RETURNING (xmax = 0) AS inserted`,
      [
        ad.systemUnderTestId,
        testRun.testEnvironment,
        testRun.workload,
        ad.id,
        rule.id,
        ad.organizationId,
        ad.teamId ?? null,
        PROFILE_GROUPING_ACTOR,
        rule.dashboard_uid,
      ],
    );
    if (rows.length === 0) return 'unchanged';
    return rows[0]!.inserted ? 'inserted' : 'updated';
  }
}
