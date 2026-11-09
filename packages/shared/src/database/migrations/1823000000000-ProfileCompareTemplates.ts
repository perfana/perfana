import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The identity of a compare-config template once templates can belong to a profile. Replaces the
 * scope term of 1822's `COMPARE_TEMPLATE_KEY_SQL`; the other four terms are unchanged. `templateKey()`
 * in `apps/api/src/modules/provisioning/compare-template-codec.ts` computes the same five terms, and
 * its spec reads this constant to keep the two in step.
 *
 * A profile template's scope is its profile alone: its `organization_id` is a copy of the profile's,
 * written for the audit log, and is deliberately not part of the key, so a profile that moves to
 * another organization keeps its templates' identity. Readers take the organization from the
 * profile (a join), never from that copy.
 */
export const COMPARE_TEMPLATE_KEY_SQL = `
  (CASE WHEN profile_id IS NOT NULL THEN 'profile:' || profile_id::text ELSE 'org:' || COALESCE(organization_id::text, 'install') END),
  COALESCE(dashboard_uid, ''),
  regex,
  COALESCE(panel_id::text, 'title:' || panel_title),
  COALESCE(metric_name, '')`;

export const UQ_COMPARE_TEMPLATE_KEY_NAME = 'uq_provisioned_template_ds_compare_configs_key';

const UQ_COMPARE_TEMPLATE_KEY = `
CREATE UNIQUE INDEX ${UQ_COMPARE_TEMPLATE_KEY_NAME}
ON public.provisioned_template_ds_compare_configs (${COMPARE_TEMPLATE_KEY_SQL}
)
WHERE system_under_test_id IS NULL`;

/** 1822's index, restored by `down()`. */
const UQ_COMPARE_TEMPLATE_KEY_1822 = `
CREATE UNIQUE INDEX ${UQ_COMPARE_TEMPLATE_KEY_NAME}
ON public.provisioned_template_ds_compare_configs (
  COALESCE(organization_id::text, 'install'),
  COALESCE(dashboard_uid, ''),
  regex,
  COALESCE(panel_id::text, 'title:' || panel_title),
  COALESCE(metric_name, '')
)
WHERE system_under_test_id IS NULL`;

/**
 * Same discipline as 1822 (and 1819): a 3 s `lock_timeout`, ten attempts, and the previous
 * `lock_timeout` restored on both exit paths, because on an existing deploy the batch is one
 * transaction and a 3 s left in place would fail every later migration with 55P03.
 */
const withLockRetry = (what: string, statement: string): string => `
  DO $ddl$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        EXECUTE $stmt$${statement}$stmt$;
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not ${what}: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $ddl$;
`;

/**
 * Swaps the key index in ONE statement (a DO block is atomic on its own, with or without a batch
 * transaction), so there is never a moment without uniqueness, and skips the swap when the index
 * already has the wanted shape, so a re-run does nothing.
 */
const swapIndex = (marker: string, create: string, wantMarker: boolean): string => `DO $swap$ BEGIN
  IF ${wantMarker ? 'NOT ' : ''}EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'public' AND indexname = '${UQ_COMPARE_TEMPLATE_KEY_NAME}'
                   AND indexdef LIKE '%${marker}%') OR NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'public' AND indexname = '${UQ_COMPARE_TEMPLATE_KEY_NAME}') THEN
    DROP INDEX IF EXISTS public.${UQ_COMPARE_TEMPLATE_KEY_NAME};
    EXECUTE '${create.replace(/'/g, "''")}';
  END IF;
END $swap$`;

/**
 * Lets a compare-config template belong to a profile, so it applies only to runs whose tags match
 * that profile (design: docs/design/2026-11-08-compare-config-templates-design.md, "PR 2 migration").
 *
 * - `profile_id` references `profiles(id)` ON DELETE CASCADE: deleting a profile deletes its
 *   templates, provisioned ones included. That is intended, and the profile delete confirmation says
 *   how many (D14).
 * - The unique index's scope term becomes `'profile:' || profile_id` for a profile template and
 *   `'org:' || COALESCE(organization_id, 'install')` otherwise. No existing row can collide under the
 *   new key: every row has `profile_id` NULL, and the old scope term maps one-to-one onto the new one,
 *   so unlike 1822 this needs no duplicate pre-check.
 *
 * **Numbered above 1791**, whose `COMMIT` ends the batch transaction on a fresh install (root
 * CLAUDE.md #64): no SAVEPOINT, no reliance on a rollback. Each statement is safe to repeat.
 */
export class ProfileCompareTemplates1823000000000 implements MigrationInterface {
  name = 'ProfileCompareTemplates1823000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      withLockRetry(
        'add profile_id to provisioned_template_ds_compare_configs',
        'ALTER TABLE public.provisioned_template_ds_compare_configs ADD COLUMN IF NOT EXISTS profile_id uuid NULL ' +
          'CONSTRAINT fk_provisioned_template_ds_compare_configs_profile REFERENCES public.profiles(id) ON DELETE CASCADE',
      ),
    );
    // The cascade and the profile tab both look templates up by profile.
    await queryRunner.query(
      withLockRetry(
        'build idx_provisioned_template_ds_compare_configs_profile',
        'CREATE INDEX IF NOT EXISTS idx_provisioned_template_ds_compare_configs_profile ' +
          'ON public.provisioned_template_ds_compare_configs (profile_id) WHERE profile_id IS NOT NULL',
      ),
    );
    await queryRunner.query(
      withLockRetry('rebuild uq_provisioned_template_ds_compare_configs_key', swapIndex('profile:', UQ_COMPARE_TEMPLATE_KEY, true)),
    );
  }

  /**
   * Deletes the profile templates before restoring 1822's index: without the profile term two
   * profiles' templates for the same panel would collide, and an older API would read them as
   * organization templates applying to every run in the organization.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM public.provisioned_template_ds_compare_configs WHERE profile_id IS NOT NULL`,
    );
    await queryRunner.query(
      withLockRetry('restore the 1822 template key', swapIndex('profile:', UQ_COMPARE_TEMPLATE_KEY_1822, false)),
    );
    await queryRunner.query(
      withLockRetry(
        'drop idx_provisioned_template_ds_compare_configs_profile',
        'DROP INDEX IF EXISTS public.idx_provisioned_template_ds_compare_configs_profile',
      ),
    );
    await queryRunner.query(
      withLockRetry(
        'drop profile_id',
        'ALTER TABLE public.provisioned_template_ds_compare_configs DROP COLUMN IF EXISTS profile_id',
      ),
    );
  }
}
