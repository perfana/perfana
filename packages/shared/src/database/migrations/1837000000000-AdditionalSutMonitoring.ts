import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `test_runs.additional_sut_monitoring`: extra system-under-test / test-environment combinations
 * grafana-sync's auto-config adds dashboards, profile SLOs and series grouping rules for, stored
 * under the run's own system and environment (`[{systemUnderTest, testEnvironment, tags?}]`; v0.2.97.102 wrote `profile?`, now only read to skip the entry,
 * sent by perfana-cli from perfana.yaml). NULL on every existing run, which means "none".
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, safe to repeat, and the ACCESS
 * EXCLUSIVE wait on `test_runs` bounded with the previous `lock_timeout` restored on both exit
 * paths. A nullable column with no default is catalog-only; nothing is rewritten.
 */
const withBoundedLockWait = (label: string, body: string): string => `
  DO $additional_sut_monitoring$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        ${body}
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not ${label}: test_runs stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $additional_sut_monitoring$;
`;

export class AdditionalSutMonitoring1837000000000 implements MigrationInterface {
  name = 'AdditionalSutMonitoring1837000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add additional_sut_monitoring',
      'ALTER TABLE public.test_runs ADD COLUMN IF NOT EXISTS additional_sut_monitoring jsonb;'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop additional_sut_monitoring',
      'ALTER TABLE public.test_runs DROP COLUMN IF EXISTS additional_sut_monitoring;'));
  }
}
