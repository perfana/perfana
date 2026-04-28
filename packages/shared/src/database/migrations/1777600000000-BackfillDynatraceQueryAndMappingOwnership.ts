import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill `organization_id`, `created_by`, and `updated_by` on `dynatrace_queries`
 * and `dynatrace_entity_mappings` by inheriting them from the parent
 * `dynatrace_configs` row (joined on `dynatrace_config_id`).
 *
 * Background:
 * - The Phase 2 ownership migration added these columns to both tables but the
 *   application service layer (`DynatraceService.createQuery` /
 *   `createQuerySmart` / `bulkImportQuery` / `createEntityMapping`) never
 *   propagated the parent config's `organization_id` onto new rows. Every
 *   existing row therefore has `organization_id IS NULL`, which trips the
 *   "legacy data is permissive" hatch in the mutation paths and let
 *   org-non-admins update / delete other orgs' DQL queries and entity
 *   mappings (security gap; see CHANGELOG entry for v0.2.47.8).
 * - The companion service-layer fix lands in the same release: creates
 *   propagate `organization_id` going forward, mutations require
 *   `IntegrationDynatraceUpdate` / `IntegrationDynatraceDelete` capability
 *   scoped to `existing.organizationId`. Without this backfill those guards
 *   would still let everyone touch the existing rows because they all have
 *   `organization_id IS NULL`.
 *
 * Idempotent: only updates rows where `organization_id IS NULL`.
 */
export class BackfillDynatraceQueryAndMappingOwnership1777600000000
  implements MigrationInterface
{
  name = 'BackfillDynatraceQueryAndMappingOwnership1777600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // dynatrace_queries: inherit ownership from parent config.
    // updated_by intentionally tracks the parent's `updated_by` because the
    // child row's last write predates this column existing — pretending we
    // know who modified it would be a lie. Future writes set updated_by
    // accurately at the service layer.
    await queryRunner.query(`
      UPDATE dynatrace_queries q
      SET organization_id = c.organization_id,
          team_id = COALESCE(q.team_id, c.team_id),
          created_by = COALESCE(q.created_by, c.created_by),
          updated_by = COALESCE(q.updated_by, c.updated_by)
      FROM dynatrace_configs c
      WHERE q.dynatrace_config_id = c.id
        AND q.organization_id IS NULL
        AND c.organization_id IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE dynatrace_entity_mappings m
      SET organization_id = c.organization_id,
          team_id = COALESCE(m.team_id, c.team_id),
          created_by = COALESCE(m.created_by, c.created_by),
          updated_by = COALESCE(m.updated_by, c.updated_by)
      FROM dynatrace_configs c
      WHERE m.dynatrace_config_id = c.id
        AND m.organization_id IS NULL
        AND c.organization_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverting the backfill would re-open the security gap. We intentionally
    // *do not* null these columns out — the `up` is idempotent so re-running
    // the migration after a mistaken `down` is safe.
    await queryRunner.query(
      `-- BackfillDynatraceQueryAndMappingOwnership: down() is a no-op by design`,
    );
  }
}
