import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAggregatedBenchmarkColumns1779299953902 implements MigrationInterface {
    name = 'AddAggregatedBenchmarkColumns1779299953902'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "benchmarks" ADD COLUMN IF NOT EXISTS "aggregate_metric" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "benchmarks" ADD COLUMN IF NOT EXISTS "aggregate_stat" character varying(20)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "benchmarks" DROP COLUMN IF EXISTS "aggregate_stat"`);
        await queryRunner.query(`ALTER TABLE "benchmarks" DROP COLUMN IF EXISTS "aggregate_metric"`);
    }

}
