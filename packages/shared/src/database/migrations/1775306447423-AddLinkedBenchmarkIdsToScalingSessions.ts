import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLinkedBenchmarkIdsToScalingSessions1775306447423 implements MigrationInterface {
    name = 'AddLinkedBenchmarkIdsToScalingSessions1775306447423'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scaling_sessions" ADD "linked_benchmark_ids" uuid[] NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scaling_sessions" DROP COLUMN "linked_benchmark_ids"`);
    }
}
