import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migrate SCALING mode to BASELINE mode in test run adapt_config
 *
 * The SCALING mode was removed in favor of BASELINE mode (commit 36e29d7).
 * Existing test runs with mode=SCALING need to be updated to mode=BASELINE
 * so they are correctly included in control groups.
 *
 * BASELINE mode means the run is always accepted into the control group
 * regardless of SLO results, which is the same intent as SCALING.
 */
export class MigrateScalingToBaselineMode1775400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // First: set differencesAccepted to ACCEPTED for SCALING runs with TBD status
    // (done BEFORE the mode rename so we only target actual SCALING runs,
    //  not existing BASELINE runs that may legitimately have TBD status)
    await queryRunner.query(`
      UPDATE test_runs
      SET
        adapt_config = jsonb_set(
          jsonb_set(
            adapt_config,
            '{differencesAccepted}',
            '"ACCEPTED"'
          ),
          '{mode}',
          '"BASELINE"'
        ),
        consolidated_result = jsonb_set(
          jsonb_set(
            COALESCE(consolidated_result, '{}'),
            '{adaptTestRunOK}',
            'true'
          ),
          '{overall}',
          to_jsonb(COALESCE((consolidated_result->>'meetsRequirement')::boolean, true))
        )
      WHERE adapt_config->>'mode' = 'SCALING'
        AND adapt_config->>'differencesAccepted' = 'TBD'
    `);

    // Second: rename remaining SCALING runs (those without TBD) to BASELINE
    await queryRunner.query(`
      UPDATE test_runs
      SET adapt_config = jsonb_set(
        adapt_config,
        '{mode}',
        '"BASELINE"'
      )
      WHERE adapt_config->>'mode' = 'SCALING'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert BASELINE back to SCALING (best-effort, can't distinguish original BASELINE from migrated)
    // This is a lossy revert since we can't tell which runs were originally SCALING
    await queryRunner.query(`
      UPDATE test_runs
      SET adapt_config = jsonb_set(
        adapt_config,
        '{mode}',
        '"SCALING"'
      )
      WHERE adapt_config->>'mode' = 'BASELINE'
        AND adapt_config->>'baselineTestRunId' IS NOT NULL
    `);
  }
}
