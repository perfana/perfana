import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tune autovacuum for url_patterns.
 *
 * The global defaults are gentle (autovacuum_vacuum_cost_limit = 200), so a
 * VACUUM ANALYZE of url_patterns (~2.9 GB on busy tenants) stays in contention
 * with concurrent autovacuum on requests_raw chunks, saturating disk I/O and
 * blocking foreground dashboard queries on IO:DataFileRead.
 *
 * Trigger vacuum/analyze more often on smaller batches, and drain each batch
 * faster, to shrink the contention window without affecting global defaults.
 *
 * See issue #142.
 */
export class TuneAutovacuumForUrlPatterns1777200000000 implements MigrationInterface {
  name = 'TuneAutovacuumForUrlPatterns1777200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE url_patterns SET (
        autovacuum_vacuum_scale_factor  = 0.05,
        autovacuum_analyze_scale_factor = 0.05,
        autovacuum_vacuum_cost_limit    = 1000
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE url_patterns RESET (
        autovacuum_vacuum_scale_factor,
        autovacuum_analyze_scale_factor,
        autovacuum_vacuum_cost_limit
      )
    `);
  }
}
