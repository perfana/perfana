import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeepLinkTags1700000000012 implements MigrationInterface {
  name = 'AddDeepLinkTags1700000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deep_links
      ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_deep_links_tags
      ON deep_links USING GIN (tags)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_deep_links_tags`);
    await queryRunner.query(`ALTER TABLE deep_links DROP COLUMN IF EXISTS tags`);
  }
}
