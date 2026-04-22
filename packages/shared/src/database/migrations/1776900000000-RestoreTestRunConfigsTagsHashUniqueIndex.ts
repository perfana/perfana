import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restores the functional unique index on test_run_configs that
 * AddWorkloadToEvents (1776148518354) dropped without recreating.
 *
 * The index `test_run_configs_test_run_id_key_tags_key` on
 * (test_run_id, key, tags_hash(tags)) was added by
 * AddTagsHashUniqueIndex (1700000000003) so that the same key can coexist
 * with different tag sets. TypeORM's auto-generated AddWorkloadToEvents
 * migration didn't recognize the function-based index and dropped it
 * without restoring it, breaking every INSERT … ON CONFLICT
 * (test_run_id, key, tags_hash(tags)) upsert in TestRunsConfigService —
 * including the JTL upload flow (SQLSTATE 42P10).
 *
 * Idempotent: also (re)creates tags_hash() in case a fresh database is
 * provisioned without ever running 1700000000003.
 */
export class RestoreTestRunConfigsTagsHashUniqueIndex1776900000000
  implements MigrationInterface
{
  name = 'RestoreTestRunConfigsTagsHashUniqueIndex1776900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION tags_hash(tags text[])
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      AS $$
        SELECT md5(COALESCE(array_to_string(tags, ','), ''))
      $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS test_run_configs_test_run_id_key_tags_key
        ON test_run_configs (test_run_id, key, tags_hash(tags));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS test_run_configs_test_run_id_key_tags_key`,
    );
  }
}
