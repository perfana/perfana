import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * loki_run_services.level_lines: lines per log level for each application in a run's Loki snapshot
 * (`{"info": 4525, "warn": 3}`), so an application's tab can show its own levels by name. Before
 * this only the error and warning counts were kept, and the card had to call the rest "other
 * levels". NULL on rows written before it; the card falls back to error / warn / the rest there.
 *
 * Nullable with no default, so the ADD COLUMN touches only the catalog. **Numbered above 1791**
 * (root CLAUDE.md #64): no SAVEPOINT, idempotent, lock wait bounded.
 */

const UP_DDL = `ALTER TABLE public.loki_run_services ADD COLUMN IF NOT EXISTS level_lines jsonb;`;
const DOWN_DDL = `ALTER TABLE public.loki_run_services DROP COLUMN IF EXISTS level_lines;`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $loki_service_levels$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        ${ddl}
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not ${label}: loki_run_services stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $loki_service_levels$;
`;

export class LokiServiceLevels1841000000000 implements MigrationInterface {
  name = 'LokiServiceLevels1841000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add loki_run_services.level_lines', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop loki_run_services.level_lines', DOWN_DDL));
  }
}
