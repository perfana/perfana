import { MigrationInterface, QueryRunner } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sync Schema State Migration
 *
 * This migration brings any existing database up to the current schema state.
 * It handles the case where ConsolidatedSchema1700000000000 was already recorded
 * as run by an older version of the code (before RBAC, RLS, membership tables, etc.
 * were consolidated into it).
 *
 * It re-applies the full schema_dump.sql idempotently:
 * - Statements that create already-existing objects are skipped (duplicate errors caught)
 * - Statements that create new objects succeed normally
 * - Role creation, default org seeding, and hypertable setup are also handled
 *
 * Safe to run on:
 * - Fresh databases: everything already exists from ConsolidatedSchema → all skipped
 * - Partially migrated databases: missing objects are created, existing ones skipped
 * - Fully migrated databases: everything already exists → all skipped
 */
export class SyncSchemaState1700000000002 implements MigrationInterface {
  name = 'SyncSchemaState1700000000002';

  /** PostgreSQL error codes that indicate the object already exists */
  private readonly SAFE_TO_SKIP_CODES = new Set([
    '42P07', // duplicate_table
    '42P06', // duplicate_schema
    '42710', // duplicate_object (constraints, types, extensions, policies)
    '42723', // duplicate_function
    '42701', // duplicate_column
    '23505', // unique_violation (seed data already exists)
  ]);

  static readonly DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
  static readonly DEFAULT_ORG_NAME = 'Default Organization';
  static readonly DEFAULT_ORG_DESCRIPTION =
    'Default organization for legacy data. ' +
    'Resources in this organization were created before multi-tenancy enforcement.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Phase 1: Apply schema dump idempotently ───
    console.log('SyncSchemaState: Applying schema dump idempotently...');

    const schemaPath = join(
      __dirname,
      '../../../../../database/schema_dump.sql',
    );
    const schema = readFileSync(schemaPath, 'utf8');
    const statements = this.splitStatements(schema);

    const filteredStatements = statements.filter(
      (stmt) =>
        !stmt.includes('_timescaledb_functions.insert_blocker') &&
        !stmt.includes('migrations_id_seq') &&
        !stmt.match(/CREATE TABLE.*migrations/i) &&
        !stmt.match(/ALTER TABLE.*migrations/i) &&
        !stmt.trim().startsWith('\\'),
    );

    let executed = 0;
    let skipped = 0;

    for (let idx = 0; idx < filteredStatements.length; idx++) {
      const statement = filteredStatements[idx];
      if (!statement.trim()) continue;

      const sp = `sp_sync_${idx}`;
      try {
        await queryRunner.query(`SAVEPOINT ${sp}`);
        await queryRunner.query(statement);
        await queryRunner.query(`RELEASE SAVEPOINT ${sp}`);
        executed++;
      } catch (error: unknown) {
        // Roll back just this savepoint so the transaction stays usable
        try {
          await queryRunner.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          await queryRunner.query(`RELEASE SAVEPOINT ${sp}`);
        } catch {
          // Ignore savepoint cleanup errors
        }

        const pgError = error as { code?: string };
        if (
          !pgError.code ||
          !this.SAFE_TO_SKIP_CODES.has(pgError.code)
        ) {
          console.warn(
            `SyncSchemaState: Skipped (${pgError.code}):`,
            statement.substring(0, 120),
          );
        }
        skipped++;
      }
    }

    console.log(
      `SyncSchemaState: ${executed} applied, ${skipped} skipped (already exist).`,
    );

    // ─── Phase 2: Create restricted app role ───
    console.log('SyncSchemaState: Ensuring restricted app role...');
    await this.ensureRestrictedAppRole(queryRunner);

    // ─── Phase 3: Seed default organization ───
    console.log('SyncSchemaState: Ensuring default organization...');
    await this.ensureDefaultOrganization(queryRunner);

    // ─── Phase 4: Create TimescaleDB hypertables ───
    console.log('SyncSchemaState: Ensuring TimescaleDB hypertables...');
    await this.ensureHypertables(queryRunner);

    console.log('SyncSchemaState: Complete.');
  }

  public async down(): Promise<void> {
    // No-op: this is a sync migration, reverting would require knowing
    // exactly what was added vs what already existed.
  }

  // ═══════════════════════════════════════════════════════════
  // Restricted App Role
  // ═══════════════════════════════════════════════════════════

  private async ensureRestrictedAppRole(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const roleExists = await queryRunner.query(
      `SELECT 1 FROM pg_roles WHERE rolname = 'perfana_app'`,
    );

    if (roleExists.length === 0) {
      await queryRunner.query(`
        CREATE ROLE perfana_app
          NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `);
      console.log('  Created role: perfana_app');
    }

    try {
      await queryRunner.query(`GRANT perfana_app TO perfana`);
    } catch {
      // Already granted
    }

    await queryRunner.query(
      `GRANT USAGE ON SCHEMA public TO perfana_app`,
    );
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA public TO perfana_app
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO perfana_app
    `);
    await queryRunner.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO perfana_app
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO perfana_app
    `);

    for (const func of [
      'current_user_id()',
      'current_user_organizations()',
      'current_user_teams()',
      'is_global_admin()',
      'can_access_resource(UUID, UUID, TEXT)',
      'can_modify_resource(UUID, UUID, TEXT)',
      'generate_uuidv7()',
      'validate_benchmark_configuration()',
    ]) {
      try {
        await queryRunner.query(
          `GRANT EXECUTE ON FUNCTION ${func} TO perfana_app`,
        );
      } catch {
        // Function may not exist
      }
    }

    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO perfana_app
    `);
  }

  // ═══════════════════════════════════════════════════════════
  // Seed Data
  // ═══════════════════════════════════════════════════════════

  private async ensureDefaultOrganization(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT id FROM organizations WHERE id = $1`,
      [SyncSchemaState1700000000002.DEFAULT_ORG_ID],
    );

    if (existing && existing.length > 0) {
      return;
    }

    await queryRunner.query(
      `INSERT INTO organizations (id, name, description, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [
        SyncSchemaState1700000000002.DEFAULT_ORG_ID,
        SyncSchemaState1700000000002.DEFAULT_ORG_NAME,
        SyncSchemaState1700000000002.DEFAULT_ORG_DESCRIPTION,
      ],
    );

    console.log(
      `  Created default organization: ${SyncSchemaState1700000000002.DEFAULT_ORG_ID}`,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // TimescaleDB Hypertables
  // ═══════════════════════════════════════════════════════════

  private async ensureHypertables(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const hypertables = [
      { table: 'ds_metrics', timeColumn: 'time' },
      { table: 'requests_raw', timeColumn: 'time' },
      { table: 'requests_error', timeColumn: 'time' },
      { table: 'transactions', timeColumn: 'time' },
      { table: 'virtual_users', timeColumn: 'time' },
    ];

    for (const { table, timeColumn } of hypertables) {
      const savepointName = `sp_sync_${table}`;
      try {
        await queryRunner.query(`SAVEPOINT ${savepointName}`);

        const tsCheck = await queryRunner.query(`
          SELECT EXISTS (
            SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
          ) as has_timescaledb
        `);

        if (!tsCheck[0]?.has_timescaledb) {
          await queryRunner.query(
            `RELEASE SAVEPOINT ${savepointName}`,
          );
          return;
        }

        const result = await queryRunner.query(`
          SELECT EXISTS (
            SELECT 1 FROM timescaledb_information.hypertables
            WHERE hypertable_name = '${table}'
          ) as is_hypertable
        `);

        if (!result[0]?.is_hypertable) {
          await queryRunner.query(
            `SELECT create_hypertable('${table}', '${timeColumn}', if_not_exists => TRUE, migrate_data => TRUE)`,
          );
          console.log(`  Created hypertable: ${table}`);
        }

        await queryRunner.query(
          `RELEASE SAVEPOINT ${savepointName}`,
        );
      } catch (error) {
        try {
          await queryRunner.query(
            `ROLLBACK TO SAVEPOINT ${savepointName}`,
          );
          await queryRunner.query(
            `RELEASE SAVEPOINT ${savepointName}`,
          );
        } catch {
          // Ignore savepoint cleanup errors
        }
        console.warn(
          `  Warning: Could not create hypertable for ${table}:`,
          (error as Error).message,
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SQL Statement Parsing (same as ConsolidatedSchema)
  // ═══════════════════════════════════════════════════════════

  private splitStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inDollarQuote = false;
    let i = 0;

    const lines = sql.split('\n');
    const filteredLines: string[] = [];

    for (const line of lines) {
      if (
        line.startsWith('SET statement_timeout') ||
        line.startsWith('SET lock_timeout') ||
        line.startsWith('SET idle_in_transaction_session_timeout') ||
        line.startsWith('SET client_encoding') ||
        line.startsWith('SET standard_conforming_strings') ||
        line.startsWith('SELECT pg_catalog.set_config') ||
        line.startsWith('SET check_function_bodies') ||
        line.startsWith('SET xmloption') ||
        line.startsWith('SET client_min_messages') ||
        line.startsWith('SET row_security') ||
        line.startsWith('SET default_tablespace') ||
        line.startsWith('SET default_table_access_method') ||
        line.match(/^ALTER .* OWNER TO .*;$/) ||
        line.match(/^COMMENT ON EXTENSION/) ||
        line.startsWith('--')
      ) {
        continue;
      }
      filteredLines.push(line);
    }

    const cleanSql = filteredLines.join('\n');

    while (i < cleanSql.length) {
      if (cleanSql[i] === '$' && cleanSql[i + 1] === '$') {
        current += '$$';
        i += 2;
        inDollarQuote = !inDollarQuote;
        continue;
      }

      if (cleanSql[i] === ';' && !inDollarQuote) {
        current += ';';
        const trimmed = current.trim();
        if (trimmed && trimmed !== ';') {
          statements.push(trimmed);
        }
        current = '';
        i++;
        continue;
      }

      current += cleanSql[i];
      i++;
    }

    const trimmed = current.trim();
    if (trimmed && trimmed !== ';') {
      statements.push(trimmed);
    }

    return statements;
  }
}
