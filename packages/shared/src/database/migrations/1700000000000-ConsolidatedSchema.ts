import { MigrationInterface, QueryRunner } from 'typeorm';
import { SCHEMA_SQL } from './schema-sql';

/**
 * Consolidated Schema Migration
 *
 * This single migration creates the complete database schema for Perfana,
 * replacing all previous incremental migrations. It includes:
 *
 * Phase 1: Schema (from schema_dump.sql)
 *   - Extensions (uuid-ossp, timescaledb, timescaledb_toolkit)
 *   - Custom types and enums
 *   - Functions (utility, trigger, RLS helper)
 *   - Tables with columns, defaults, and constraints
 *   - Views (benchmarks_view)
 *   - Indexes
 *   - Triggers
 *   - Foreign key constraints
 *   - Row-level security (ENABLE + FORCE + policies)
 *
 * Phase 2: Restricted App Role
 *   - Creates perfana_app role (NOSUPERUSER, NOBYPASSRLS, NOLOGIN)
 *   - Grants DML on all tables, sequences, and functions
 *   - Used via SET LOCAL ROLE in API middleware for RLS enforcement
 *
 * Phase 3: Seed Data
 *   - Default organization (00000000-0000-0000-0000-000000000001)
 *
 * Phase 4: TimescaleDB Hypertables
 *   - Converts time-series tables to hypertables
 */
export class ConsolidatedSchema1700000000000 implements MigrationInterface {
  name = 'ConsolidatedSchema1700000000000';

  static readonly DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
  static readonly DEFAULT_ORG_NAME = 'Default Organization';
  static readonly DEFAULT_ORG_DESCRIPTION =
    'Default organization for legacy data. ' +
    'Resources in this organization were created before multi-tenancy enforcement.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Phase 1: Execute schema dump ───
    console.log('Phase 1: Executing schema dump...');

    const statements = this.splitStatements(SCHEMA_SQL);

    // Filter out statements that should not be executed:
    // 1. TimescaleDB internal triggers (auto-created with hypertables)
    // 2. migrations table and sequence (TypeORM creates these automatically)
    // 3. psql meta-commands (backslash commands)
    const filteredStatements = statements.filter(
      (stmt) =>
        !stmt.includes('_timescaledb_functions.insert_blocker') &&
        !stmt.includes('migrations_id_seq') &&
        !stmt.match(/CREATE TABLE.*migrations/i) &&
        !stmt.match(/ALTER TABLE.*migrations/i) &&
        !stmt.trim().startsWith('\\'),
    );

    console.log(`Executing ${filteredStatements.length} SQL statements...`);

    let executed = 0;
    for (const statement of filteredStatements) {
      if (statement.trim()) {
        try {
          await queryRunner.query(statement);
          executed++;
          if (executed % 50 === 0) {
            console.log(
              `  Executed ${executed}/${filteredStatements.length} statements...`,
            );
          }
        } catch (error: any) {
          // Skip "already exists" errors to make migration idempotent:
          // 42P07 = relation/index already exists
          // 42710 = object already exists (constraints, triggers)
          // 42723 = function already exists with same argument types
          const alreadyExistsCodes = ['42P07', '42710', '42723'];
          if (alreadyExistsCodes.includes(error?.code)) {
            executed++;
            continue;
          }
          console.error(
            `Failed to execute statement:`,
            statement.substring(0, 200),
          );
          throw error;
        }
      }
    }

    console.log(`Successfully executed ${executed} statements.`);

    // ─── Phase 2: Create restricted app role ───
    console.log('Phase 2: Creating restricted app role...');
    await this.createRestrictedAppRole(queryRunner);

    // ─── Phase 3: Seed default organization ───
    console.log('Phase 3: Seeding default organization...');
    await this.seedDefaultOrganization(queryRunner);

    // ─── Phase 4: Create TimescaleDB hypertables ───
    console.log('Phase 4: Creating TimescaleDB hypertables...');
    await this.createHypertables(queryRunner);

    console.log('Consolidated schema migration complete.');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ─── Drop RLS policies first ───
    console.log('Dropping RLS policies...');
    const policies = await queryRunner.query(`
      SELECT policyname, tablename
      FROM pg_policies
      WHERE schemaname = 'public'
    `);
    for (const policy of policies) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "${policy.policyname}" ON "${policy.tablename}"`,
      );
    }

    // ─── Drop triggers ───
    console.log('Dropping triggers...');
    const triggers = await queryRunner.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
    `);
    for (const trigger of triggers) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "${trigger.trigger_name}" ON "${trigger.event_object_table}" CASCADE`,
      );
    }

    // ─── Drop views ───
    console.log('Dropping views...');
    await queryRunner.query(
      `DROP VIEW IF EXISTS benchmarks_view CASCADE`,
    );

    // ─── Drop all tables in reverse dependency order ───
    console.log('Dropping tables...');
    const tables = [
      // Child tables with foreign keys (drop first)
      'events',
      'audit_logs',
      'generated_reports',
      'report_templates',
      'awr_analysis',
      'awr_reports',
      'ds_metric_collection_status',
      'notification_channels',
      'test_run_events',
      'test_run_alerts',
      'test_run_configs',
      'expected_config_changes',
      'test_runs',
      'ds_tracked_differences',
      'ds_adapt_tracked_results',
      'ds_adapt_results',
      'ds_adapt_conclusion',
      'ds_control_group_statistics',
      'ds_control_groups',
      'ds_metric_statistics',
      'provisioned_template_ds_compare_configs',
      'ds_change_points',
      'ds_metrics',
      'ds_query_executions',
      'ds_queries',
      'ds_panels',
      'pending_ds_compare_config_changes',
      'ds_compare_config',
      'dynatrace_entity_mappings',
      'dynatrace_queries',
      'dynatrace_configs',
      'check_results',
      'compare_results',
      'benchmarks',
      'profile_benchmarks',
      'profile_grafana_dashboards',
      'application_dashboards',
      'grafana_dashboards',
      'grafana_instances',
      'data_sources',
      'generic_deep_links',
      'deep_links',
      'compare_filter_presets',
      'trends_filter_presets',
      'graph_presets',
      'url_patterns',
      'workload_transaction_apdex_thresholds',
      'workload_apdex_thresholds',
      'tracing_services',
      'tracing_instances',
      'system_under_test_workloads',
      'system_under_test_test_environments',
      'systems_under_test',
      'configuration',
      'profiles',
      'pyroscope_instances',
      'requests_raw',
      'requests_error',
      'transactions',
      'virtual_users',
      'versions',
      'licenses',
      // Membership tables
      'organization_members',
      'team_members',
      // Parent tables (drop last)
      'teams',
      'organizations',
      'api_keys',
    ];

    for (const table of tables) {
      await queryRunner.query(
        `DROP TABLE IF EXISTS "${table}" CASCADE`,
      );
    }

    // ─── Drop functions ───
    console.log('Dropping functions...');
    const functions = await queryRunner.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
    `);
    for (const func of functions) {
      try {
        await queryRunner.query(
          `DROP FUNCTION IF EXISTS "${func.proname}"(${func.args}) CASCADE`,
        );
      } catch {
        // Ignore errors from extension functions
      }
    }

    // ─── Drop custom types ───
    console.log('Dropping custom types...');
    await queryRunner.query(
      `DROP TYPE IF EXISTS tracing_instances_tracing_ui_enum CASCADE`,
    );

    // ─── Drop restricted app role ───
    console.log('Dropping restricted app role...');
    await this.dropRestrictedAppRole(queryRunner);

    // ─── Drop extensions ───
    console.log('Dropping extensions...');
    await queryRunner.query(
      `DROP EXTENSION IF EXISTS timescaledb_toolkit CASCADE`,
    );
    await queryRunner.query(
      `DROP EXTENSION IF EXISTS timescaledb CASCADE`,
    );
    await queryRunner.query(
      `DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE`,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Restricted App Role
  // ═══════════════════════════════════════════════════════════

  private async createRestrictedAppRole(
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
    } else {
      await queryRunner.query(`
        ALTER ROLE perfana_app
          NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `);
      console.log('  Role perfana_app already exists, ensured correct attributes');
    }

    // Grant the role to perfana so SET ROLE works
    try {
      await queryRunner.query(`GRANT perfana_app TO perfana`);
    } catch {
      // May already be granted
    }

    // Schema usage
    await queryRunner.query(
      `GRANT USAGE ON SCHEMA public TO perfana_app`,
    );

    // Table permissions (current + future)
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA public TO perfana_app
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO perfana_app
    `);

    // Sequence permissions (current + future)
    await queryRunner.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO perfana_app
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO perfana_app
    `);

    // Function permissions (current + future)
    const rlsFunctions = [
      'current_user_id()',
      'current_user_organizations()',
      'current_user_teams()',
      'is_global_admin()',
      'can_access_resource(UUID, UUID, TEXT)',
      'can_modify_resource(UUID, UUID, TEXT)',
      'generate_uuidv7()',
      'validate_benchmark_configuration()',
    ];

    for (const func of rlsFunctions) {
      try {
        await queryRunner.query(
          `GRANT EXECUTE ON FUNCTION ${func} TO perfana_app`,
        );
      } catch {
        // Function may not exist yet
      }
    }

    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO perfana_app
    `);

    console.log('  Restricted app role setup complete');
  }

  private async dropRestrictedAppRole(
    queryRunner: QueryRunner,
  ): Promise<void> {
    try {
      await queryRunner.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM perfana_app
      `);
      await queryRunner.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE USAGE, SELECT ON SEQUENCES FROM perfana_app
      `);
      await queryRunner.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM perfana_app
      `);
      await queryRunner.query(`
        REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM perfana_app
      `);
      await queryRunner.query(`
        REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM perfana_app
      `);
      await queryRunner.query(
        `REVOKE USAGE ON SCHEMA public FROM perfana_app`,
      );
    } catch {
      // Ignore revoke errors
    }

    try {
      await queryRunner.query(`REVOKE perfana_app FROM perfana`);
    } catch {
      // Ignore
    }

    const roleExists = await queryRunner.query(
      `SELECT 1 FROM pg_roles WHERE rolname = 'perfana_app'`,
    );
    if (roleExists.length > 0) {
      await queryRunner.query(`DROP ROLE perfana_app`);
      console.log('  Dropped role: perfana_app');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Seed Data
  // ═══════════════════════════════════════════════════════════

  private async seedDefaultOrganization(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const existingOrg = await queryRunner.query(
      `SELECT id FROM organizations WHERE id = $1`,
      [ConsolidatedSchema1700000000000.DEFAULT_ORG_ID],
    );

    if (existingOrg && existingOrg.length > 0) {
      console.log('  Default organization already exists, skipping');
      return;
    }

    await queryRunner.query(
      `INSERT INTO organizations (id, name, description, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [
        ConsolidatedSchema1700000000000.DEFAULT_ORG_ID,
        ConsolidatedSchema1700000000000.DEFAULT_ORG_NAME,
        ConsolidatedSchema1700000000000.DEFAULT_ORG_DESCRIPTION,
      ],
    );

    console.log(
      `  Created default organization: ${ConsolidatedSchema1700000000000.DEFAULT_ORG_ID}`,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // TimescaleDB Hypertables
  // ═══════════════════════════════════════════════════════════

  private async createHypertables(
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
      const savepointName = `sp_${table}`;
      try {
        await queryRunner.query(`SAVEPOINT ${savepointName}`);

        const tsCheck = await queryRunner.query(`
          SELECT EXISTS (
            SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
          ) as has_timescaledb
        `);

        if (!tsCheck[0]?.has_timescaledb) {
          console.log(
            `  TimescaleDB not available, skipping hypertable creation`,
          );
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
        } else {
          console.log(`  Hypertable already exists: ${table}`);
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
  // SQL Statement Parsing
  // ═══════════════════════════════════════════════════════════

  /**
   * Split SQL dump into individual statements, respecting $$ delimiters for functions
   */
  private splitStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inDollarQuote = false;
    let i = 0;

    // Remove pg_dump specific settings and comments
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
      // Check for $$ delimiter
      if (cleanSql[i] === '$' && cleanSql[i + 1] === '$') {
        current += '$$';
        i += 2;
        inDollarQuote = !inDollarQuote;
        continue;
      }

      // Check for statement end (semicolon not inside $$ block)
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

    // Add any remaining statement
    const trimmed = current.trim();
    if (trimmed && trimmed !== ';') {
      statements.push(trimmed);
    }

    return statements;
  }
}
