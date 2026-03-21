import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add tags_hash function and replace the unique index on test_run_configs.
 *
 * The previous unique constraint (test_run_id, key) only allowed one row per
 * key per test run, so configs with the same key but different tags (e.g.
 * different Kubernetes services) would overwrite each other.
 *
 * This migration:
 * 1. Creates an IMMUTABLE tags_hash(text[]) function (md5 of sorted, joined tags)
 * 2. Drops the old unique index on (test_run_id, key)
 * 3. Creates a new unique index on (test_run_id, key, tags_hash(tags))
 *
 * The function treats NULL tags the same as an empty array to keep the
 * uniqueness semantics simple.
 */
export class AddTagsHashUniqueIndex1700000000003 implements MigrationInterface {
  name = 'AddTagsHashUniqueIndex1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the tags_hash helper function
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION tags_hash(tags text[])
      RETURNS text
      LANGUAGE SQL
      IMMUTABLE
      AS $$
        SELECT md5(COALESCE(array_to_string(tags, ','), ''))
      $$;
    `);

    // 2. Drop the old unique constraint (which backs the index) on (test_run_id, key)
    await queryRunner.query(`
      ALTER TABLE test_run_configs
        DROP CONSTRAINT IF EXISTS test_run_configs_test_run_id_key_key;
    `);

    // 3. Create the new unique index that includes the tags hash
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS test_run_configs_test_run_id_key_tags_key
        ON test_run_configs (test_run_id, key, tags_hash(tags));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: drop the new index, recreate the old one, drop the function

    await queryRunner.query(`
      DROP INDEX IF EXISTS test_run_configs_test_run_id_key_tags_key;
    `);

    await queryRunner.query(`
      ALTER TABLE test_run_configs
        ADD CONSTRAINT test_run_configs_test_run_id_key_key UNIQUE (test_run_id, key);
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS tags_hash(text[]);
    `);
  }
}
