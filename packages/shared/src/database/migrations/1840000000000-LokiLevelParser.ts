import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * loki_configs.level_parser: how the connection's level label is obtained (docs/reference/Features/
 * Loki Log Metrics (spec).md, "Where the level comes from"). `none` (the default, and what every
 * existing connection keeps): the label is on the line already, as a stream label or structured
 * metadata. `json` / `logfmt`: the level is a field of the line, so the starter panels and the
 * worker's level queries put that parser in front of anything that groups or filters on it.
 *
 * A constant default, so the ADD COLUMN does not rewrite the table; loki_configs holds a handful of
 * rows. **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, idempotent, lock wait bounded.
 */

const UP_DDL = `
  ALTER TABLE public.loki_configs ADD COLUMN IF NOT EXISTS level_parser character varying(10) NOT NULL DEFAULT 'none';
  ALTER TABLE public.loki_configs DROP CONSTRAINT IF EXISTS ck_loki_configs_level_parser;
  ALTER TABLE public.loki_configs ADD CONSTRAINT ck_loki_configs_level_parser CHECK (level_parser IN ('none', 'json', 'logfmt'));
`;

const DOWN_DDL = `
  ALTER TABLE public.loki_configs DROP CONSTRAINT IF EXISTS ck_loki_configs_level_parser;
  ALTER TABLE public.loki_configs DROP COLUMN IF EXISTS level_parser;
`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $loki_level_parser$
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
            'could not ${label}: loki_configs stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $loki_level_parser$;
`;

export class LokiLevelParser1840000000000 implements MigrationInterface {
  name = 'LokiLevelParser1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add loki_configs.level_parser', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop loki_configs.level_parser', DOWN_DDL));
  }
}
