import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tune autovacuum settings for ds_metrics (TimescaleDB hypertable).
 *
 * During load tests, autovacuum on the hot chunk competes with write ingestion
 * for I/O (LWLock/BufferMapping, IO/DataFileRead). These settings reduce
 * autovacuum's I/O impact during high-write periods:
 *
 * - autovacuum_vacuum_cost_delay: 20ms (default 2ms) — throttle vacuum I/O
 * - autovacuum_vacuum_scale_factor: 0.1 (default 0.2) — vacuum more often
 *   but in shorter bursts, reducing per-vacuum lock contention
 * - autovacuum_analyze_scale_factor: 0.1 — match vacuum frequency
 *
 * See: 2026-03-26 write starvation post-mortem (recommendation E)
 */
export class TuneAutovacuumForDsMetrics1700000000020 implements MigrationInterface {
  name = 'TuneAutovacuumForDsMetrics1700000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ds_metrics SET (
        autovacuum_vacuum_cost_delay = 20,
        autovacuum_vacuum_scale_factor = 0.1,
        autovacuum_analyze_scale_factor = 0.1
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ds_metrics RESET (
        autovacuum_vacuum_cost_delay,
        autovacuum_vacuum_scale_factor,
        autovacuum_analyze_scale_factor
      )
    `);
  }
}
