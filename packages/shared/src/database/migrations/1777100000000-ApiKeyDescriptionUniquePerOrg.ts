import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replace the global UNIQUE(description) constraint on api_keys with a
 * composite UNIQUE(organization_id, description). Descriptions like "CI"
 * or "Jenkins" are commonly reused across organizations, and the global
 * constraint surfaced as an opaque 500 from the GlobalExceptionFilter
 * (QueryFailedError: api_keys_description_key) instead of a user-friendly
 * 409. See issue #117.
 *
 * NULL organization_id (legacy/global keys) does not collide thanks to
 * Postgres NULL-distinct semantics, so legacy rows continue to work.
 */
export class ApiKeyDescriptionUniquePerOrg1777100000000
  implements MigrationInterface
{
  name = 'ApiKeyDescriptionUniquePerOrg1777100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dupCheck = await queryRunner.query(`
      SELECT COUNT(*)::int AS dup_count
      FROM (
        SELECT 1
        FROM api_keys
        WHERE organization_id IS NOT NULL
        GROUP BY organization_id, description
        HAVING COUNT(*) > 1
      ) t
    `);
    if (dupCheck[0]?.dup_count > 0) {
      throw new Error(
        `Cannot create api_keys_organization_id_description_key: ${dupCheck[0].dup_count} ` +
          `duplicate (organization_id, description) groups exist in api_keys. Dedupe before re-running.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_description_key"`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_organization_id_description_key" ` +
        `ON "api_keys" ("organization_id", "description")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "api_keys_organization_id_description_key"`,
    );

    const globalDupCheck = await queryRunner.query(`
      SELECT COUNT(*)::int AS dup_count
      FROM (
        SELECT 1 FROM api_keys GROUP BY description HAVING COUNT(*) > 1
      ) t
    `);
    if (globalDupCheck[0]?.dup_count > 0) {
      throw new Error(
        `Cannot restore api_keys_description_key: ${globalDupCheck[0].dup_count} ` +
          `duplicate descriptions exist across organizations. Dedupe before reverting.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_description_key" UNIQUE ("description")`,
    );
  }
}
