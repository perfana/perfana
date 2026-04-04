import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRunCommentsToScalingSessions1775310000000 implements MigrationInterface {
    name = 'AddRunCommentsToScalingSessions1775310000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scaling_sessions" ADD "run_comments" jsonb NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scaling_sessions" DROP COLUMN "run_comments"`);
    }
}
