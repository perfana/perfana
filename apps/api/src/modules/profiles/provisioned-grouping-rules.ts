import type { RuleFields } from '../series-grouping/rule-fields';

/** What `withRequestQuery(dataSource)` hands back: something that runs raw SQL. */
interface Querier {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** Row count of a raw UPDATE/DELETE: TypeORM's postgres driver returns `[rows, rowCount]` for one. */
function affectedCount(res: unknown): number {
  return Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0;
}

/*
 * The workload rules a profile rule provisioned (`series_grouping_rules.profile_rule_id`, migration
 * 1826) follow it while `updated_by IS NULL` — the profile-SLO ownership rule. A save through the
 * rules API stamps the user and detaches the row, so nothing here ever touches it again.
 *
 * Both statements also pin the organization: a provisioned row inherits its organization from the
 * application dashboard, which grafana-sync only picks inside the profile's own organization, so a
 * row outside it is not this profile's to change whatever its `profile_rule_id` says (a SUT import
 * carries the column across environments).
 */

/** Carry a profile rule's fields to every row it still owns. Writes only a difference. */
export async function propagateToProvisionedRules(
  q: Querier,
  profileRuleId: string,
  organizationId: string,
  fields: RuleFields & { enabled: boolean },
): Promise<number> {
  const res = await q.query(
    `UPDATE series_grouping_rules
        SET preset = $3, pattern = $4, replacement = $5, aggregations = $6::varchar(8)[], enabled = $7, updated_at = now()
      WHERE profile_rule_id = $1 AND organization_id = $2 AND updated_by IS NULL
        AND (preset, pattern, replacement, aggregations, enabled)
            IS DISTINCT FROM ($3::varchar, $4::text, $5::text, $6::varchar(8)[], $7::boolean)`,
    [profileRuleId, organizationId, fields.preset, fields.pattern, fields.replacement, fields.aggregations, fields.enabled],
  );
  return affectedCount(res);
}

/**
 * Delete the rows still owned by the named profile rules. Edited rows stay: the person who edited one
 * wanted it, and with no foreign key on `profile_rule_id` they simply stop following anything.
 *
 * Call it AFTER the profile rules themselves are deleted (or, for a re-point, after the profile
 * dashboard is updated), in the same transaction, with ids collected beforehand. grafana-sync's
 * insert locks the rule and its profile dashboard `FOR SHARE`, so an insert racing this request
 * either blocks until it commits and then finds nothing to copy, or committed first and is seen by
 * this later statement. Deleting the copies first, through a subquery on the rule table, left a
 * window in which a pass inserted a copy no delete could find again.
 */
export async function deleteOwnedProvisionedRules(
  q: Querier,
  organizationId: string,
  ruleIds: string[],
): Promise<number> {
  if (ruleIds.length === 0) return 0;
  const res = await q.query(
    `DELETE FROM series_grouping_rules
      WHERE organization_id = $2 AND updated_by IS NULL AND profile_rule_id = ANY($1::uuid[])`,
    [ruleIds, organizationId],
  );
  return affectedCount(res);
}

/** The ids of every series grouping rule on the given profile dashboards. */
export async function profileRuleIdsOf(q: Querier, profileDashboardIds: string[]): Promise<string[]> {
  if (profileDashboardIds.length === 0) return [];
  const rows = (await q.query(
    `SELECT id FROM profile_series_grouping_rules WHERE profile_dashboard_id = ANY($1::uuid[])`,
    [profileDashboardIds],
  )) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
