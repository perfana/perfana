import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Create the `perfana_system` Postgres role used by worker /
 * grafana-sync / perfana-report processes. NOBYPASSRLS — RLS still evaluates,
 * but the system processes set `app.current_user_roles = '["super-admin"]'` so
 * `is_global_admin()` short-circuits all policies to TRUE.
 *
 * Idempotent: safe to re-run. Mirrors the perfana_app role created in
 * 1700000000000-ConsolidatedSchema.ts.
 */
export class CreatePerfanaSystemRole1778000000000 implements MigrationInterface {
  name = 'CreatePerfanaSystemRole1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.query(
      `SELECT 1 FROM pg_roles WHERE rolname = 'perfana_system'`,
    );
    if (exists.length === 0) {
      await queryRunner.query(`
        CREATE ROLE perfana_system
          NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `);
    } else {
      await queryRunner.query(`
        ALTER ROLE perfana_system
          NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `);
    }
    // Owner role can SET ROLE into perfana_system (system processes connect as
    // perfana, then SET ROLE perfana_system on connection checkout).
    await queryRunner.query(`GRANT perfana_system TO perfana`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO perfana_system`);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO perfana_system`,
    );
    await queryRunner.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO perfana_system`,
    );
    await queryRunner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO perfana_system`,
    );
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO perfana_system
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO perfana_system
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO perfana_system
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM perfana_system
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM perfana_system
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE USAGE, SELECT ON SEQUENCES FROM perfana_system
    `);
    await queryRunner.query(
      `REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM perfana_system`,
    );
    await queryRunner.query(
      `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM perfana_system`,
    );
    await queryRunner.query(
      `REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM perfana_system`,
    );
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM perfana_system`);
    await queryRunner.query(`REVOKE perfana_system FROM perfana`);
    await queryRunner.query(`DROP ROLE IF EXISTS perfana_system`);
  }
}
