import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { GrafanaInstance } from '@perfana/shared/entities';

/**
 * Resolve a Grafana instance by label, scoped to one organization.
 *
 * **`grafana_instances.label` has no unique constraint, and grafana-sync sets no RLS
 * context anywhere** — so a bare `findOne({ where: { label } })` sees every
 * organization's rows and returns whichever the planner hands back first. Duplicate
 * labels across organizations are not an edge case here, they are *required*: one
 * auto-config profile configures several organizations' systems by naming the same
 * label in each.
 *
 * The consequence before v0.2.97.39: `insertApplicationDashboard` org-scoped its
 * system-under-test lookup and then resolved the instance org-blind, so org A's system
 * could be handed org B's `grafana_instance_id` — and the dashboard builder then
 * received org B's `server_url` **and its API key**.
 *
 * **Fails closed on ambiguity rather than picking one.** A caller that matches several
 * rows is exactly the bug; returning null makes the profile skip with an ERROR line
 * instead of writing to the wrong tenant. A single match is returned even without an
 * organization id, which is what keeps every single-org deploy working unchanged.
 *
 * This lives in its own file, rather than as a private method on `DashboardFinderService`,
 * because two services need it (`DashboardFinderService` and `AutoConfigUpdatesService`)
 * and a second hand-written copy of the fail-closed branches is the shape that drifts
 * back to a bare `findOne`. It takes the repository and logger as arguments rather than
 * being a provider: there is no state to hold, and both callers already have both.
 */
export async function resolveGrafanaInstanceByLabel(
  repo: Repository<GrafanaInstance>,
  logger: Logger,
  label: string,
  organizationId?: string | null,
): Promise<GrafanaInstance | null> {
  const query = repo.createQueryBuilder('gi').where('gi.label = :label', { label });

  if (organizationId) {
    query.andWhere('gi.organizationId = :orgId', { orgId: organizationId });
  }

  // take(2) rather than getOne(): the point is to SEE the ambiguity. getOne() would
  // hide it behind the same arbitrary pick this function exists to remove.
  const matches = await query.orderBy('gi.label', 'ASC').take(2).getMany();

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    logger.error(
      `Grafana label '${label}' matches ${matches.length}+ instances${
        organizationId ? ` in organization ${organizationId}` : ' and no organization was supplied'
      } — refusing to guess. Give the instances distinct labels, or pass the organization.`,
    );
    return null;
  }

  return matches[0] ?? null;
}
