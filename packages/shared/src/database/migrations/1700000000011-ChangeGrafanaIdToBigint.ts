import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeGrafanaIdToBigint1700000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE grafana_dashboards
      ALTER COLUMN grafana_id TYPE bigint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE grafana_dashboards
      ALTER COLUMN grafana_id TYPE integer
    `);
  }
}
