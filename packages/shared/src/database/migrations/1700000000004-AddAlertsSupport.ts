import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add alerts support:
 * 1. Add source and alert_metadata columns to events table
 * 2. Create alert_tag_filters table
 * 3. Add abort_message column to test_runs table
 */
export class AddAlertsSupport1700000000004 implements MigrationInterface {
  name = 'AddAlertsSupport1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add source and alert_metadata to events
    await queryRunner.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS source varchar(50) NOT NULL DEFAULT 'manual'
    `);

    await queryRunner.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS alert_metadata jsonb
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_events_source ON events (source)
    `);

    // 2. Add abort_message to test_runs
    await queryRunner.query(`
      ALTER TABLE test_runs
      ADD COLUMN IF NOT EXISTS abort_message text
    `);

    // 3. Create alert_tag_filters table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alert_tag_filters (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filter_type varchar(20) NOT NULL,
        alert_source varchar(50) NOT NULL,
        tag_key varchar(255) NOT NULL,
        tag_value varchar(255),
        system_under_test_id uuid,
        test_environment varchar(255),
        test_type varchar(255),
        organization_id uuid,
        team_id uuid,
        created_by varchar(255),
        updated_by varchar(255),
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        updated_at timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT fk_alert_tag_filters_sut FOREIGN KEY (system_under_test_id) REFERENCES systems_under_test(id) ON DELETE SET NULL,
        CONSTRAINT fk_alert_tag_filters_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_tag_filters_source_type ON alert_tag_filters (alert_source, filter_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_tag_filters_organization_id ON alert_tag_filters (organization_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS alert_tag_filters`);
    await queryRunner.query(`ALTER TABLE test_runs DROP COLUMN IF EXISTS abort_message`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_events_source`);
    await queryRunner.query(`ALTER TABLE events DROP COLUMN IF EXISTS alert_metadata`);
    await queryRunner.query(`ALTER TABLE events DROP COLUMN IF EXISTS source`);
  }
}
