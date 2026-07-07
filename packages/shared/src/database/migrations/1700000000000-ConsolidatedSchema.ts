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
 * Phase 2: Restricted App Roles
 *   - Creates perfana_app role (NOSUPERUSER, NOBYPASSRLS, NOLOGIN)
 *     Used via SET LOCAL ROLE in API middleware for RLS enforcement
 *   - Creates perfana_system role (NOSUPERUSER, NOBYPASSRLS, NOLOGIN)
 *     Used by worker/grafana-sync/perfana-report; sets super-admin GUC to bypass RLS
 *   - Grants DML on all tables, sequences, and functions to both roles
 *
 * Phase 3: Seed Data
 *   - Default organization (00000000-0000-0000-0000-000000000001)
 *
 * Phase 4: TimescaleDB Hypertables
 *   - Converts time-series tables to hypertables
 *
 * Phase 5: Continuous Aggregates
 *   - requests_raw family: 5s / 1m / 5m + passed variants
 *   - transactions family: 5s / 1m / 5m + passed variants
 *   - requests_error family: 5s / 1m / 5m
 *   - Refresh and retention policies for all 15 CAGGs
 */
export class ConsolidatedSchema1700000000000 implements MigrationInterface {
  name = 'ConsolidatedSchema1700000000000';

  static readonly DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
  static readonly DEFAULT_ORG_NAME = 'Default Organization';
  static readonly DEFAULT_ORG_DESCRIPTION =
    'Default organization for legacy data. ' +
    'Resources in this organization were created before multi-tenancy enforcement.';

  // 42P07 = relation/index already exists
  // 42710 = object already exists (constraints, triggers)
  // 42723 = function already exists with same argument types
  static readonly ALREADY_EXISTS_CODES = ['42P07', '42710', '42723'];

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
        // TimescaleDB auto-created triggers
        !stmt.includes('_timescaledb_functions.insert_blocker') &&
        // TimescaleDB CAGG backing views (reference _timescaledb_internal.* hypertables
        // that only exist after CREATE MATERIALIZED VIEW is called in Phase 5).
        !stmt.includes('_timescaledb_internal') &&
        // Per-object GRANT statements for perfana_app/perfana_system roles.
        // Roles don't exist during Phase 1 (created in Phase 2).
        // Phase 2 covers all grants in bulk via GRANT ON ALL TABLES + ALTER DEFAULT PRIVILEGES.
        !stmt.match(/^GRANT .* TO (perfana_app|perfana_system)\s*;?\s*$/ms) &&
        // ALTER DEFAULT PRIVILEGES statements captured from a live DB that already had the
        // roles. Phase 2 re-applies these after role creation, so skip them here.
        !stmt.match(/ALTER DEFAULT PRIVILEGES .* TO (perfana_app|perfana_system)/ms) &&
        // TypeORM migrations table (created by TypeORM automatically)
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
        } catch (error: unknown) {
          // Skip "already exists" errors to make migration idempotent
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (ConsolidatedSchema1700000000000.ALREADY_EXISTS_CODES.includes((error as any)?.code)) {
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
    console.log('Phase 2: Creating restricted app roles...');
    await this.createRestrictedAppRole(queryRunner);

    // ─── Phase 3: Seed default organization ───
    console.log('Phase 3: Seeding default organization...');
    await this.seedDefaultOrganization(queryRunner);

    // ─── Phase 4: Create TimescaleDB hypertables ───
    console.log('Phase 4: Creating TimescaleDB hypertables...');
    await this.createHypertables(queryRunner);

    // ─── Phase 5: Create continuous aggregates ───
    console.log('Phase 5: Creating continuous aggregates...');
    await this.createContinuousAggregates(queryRunner);

    console.log('Consolidated schema migration complete.');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ─── Drop continuous aggregates first (depend on hypertables) ───
    console.log('Dropping continuous aggregates...');
    const caggViews = [
      'transactions_passed_5m', 'transactions_passed_1m', 'transactions_passed_5s',
      'requests_raw_passed_5m', 'requests_raw_passed_1m', 'requests_raw_passed_5s',
      'requests_error_5m',  'requests_error_1m',  'requests_error_5s',
      'transactions_5m',    'transactions_1m',    'transactions_5s',
      'requests_raw_5m',    'requests_raw_1m',    'requests_raw_5s',
    ];
    for (const view of caggViews) {
      await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS ${view} CASCADE`);
    }

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
      'test_run_sampler_stats',
      'test_run_transaction_stats',
      'test_run_views',
      'scaling_sessions',
      'alert_tag_filters',
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
      'benchmarks',
      'profile_benchmarks',
      'profile_grafana_dashboards',
      'application_dashboards',
      'grafana_dashboards',
      'grafana_instances',
      'data_sources',
      'metrics_sources',
      'sparse_metric_exclusions',
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
      'proxy_servers',
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
    for (const role of ['perfana_app', 'perfana_system']) {
      const exists = await queryRunner.query(
        `SELECT 1 FROM pg_roles WHERE rolname = $1`,
        [role],
      );
      if (exists.length === 0) {
        await queryRunner.query(`
          CREATE ROLE ${role}
            NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        `);
        console.log(`  Created role: ${role}`);
      } else {
        await queryRunner.query(`
          ALTER ROLE ${role}
            NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        `);
        console.log(`  Role ${role} already exists, ensured correct attributes`);
      }

      try {
        await queryRunner.query(`GRANT ${role} TO perfana`);
      } catch {
        // May already be granted
      }

      await queryRunner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await queryRunner.query(`
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}
      `);
      await queryRunner.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}
      `);
      await queryRunner.query(`
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}
      `);
      await queryRunner.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO ${role}
      `);
      await queryRunner.query(`
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}
      `);
      await queryRunner.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO ${role}
      `);
    }

    console.log('  Restricted app roles setup complete (perfana_app, perfana_system)');
  }

  private async dropRestrictedAppRole(
    queryRunner: QueryRunner,
  ): Promise<void> {
    for (const role of ['perfana_app', 'perfana_system']) {
      try {
        await queryRunner.query(`
          ALTER DEFAULT PRIVILEGES IN SCHEMA public
          REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${role}
        `);
        await queryRunner.query(`
          ALTER DEFAULT PRIVILEGES IN SCHEMA public
          REVOKE USAGE, SELECT ON SEQUENCES FROM ${role}
        `);
        await queryRunner.query(`
          ALTER DEFAULT PRIVILEGES IN SCHEMA public
          REVOKE EXECUTE ON FUNCTIONS FROM ${role}
        `);
        await queryRunner.query(
          `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`,
        );
        await queryRunner.query(
          `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
        );
        await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM ${role}`);
      } catch {
        // Ignore revoke errors
      }
      try {
        await queryRunner.query(`REVOKE ${role} FROM perfana`);
      } catch {
        // Ignore
      }
      const exists = await queryRunner.query(
        `SELECT 1 FROM pg_roles WHERE rolname = $1`,
        [role],
      );
      if (exists.length > 0) {
        await queryRunner.query(`DROP ROLE ${role}`);
        console.log(`  Dropped role: ${role}`);
      }
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
  // Continuous Aggregates
  // ═══════════════════════════════════════════════════════════

  private async createContinuousAggregates(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const tsCheck = await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') as has_ts
    `);
    if (!tsCheck[0]?.has_ts) {
      console.log('  TimescaleDB not available, skipping continuous aggregates');
      return;
    }

    // Creation order matters: each higher granularity rolls up from the one below
    const caggs: Array<{ view: string; sql: string }> = [
      // ── requests_raw family ──────────────────────────────────
      {
        view: 'requests_raw_5s',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)          AS bucket,
        system_under_test, test_environment, scenario_name, sampler_name,
        transaction_name, location,
        count(*)                                           AS n,
        count(*) FILTER (WHERE success)                    AS n_ok,
        count(*) FILTER (WHERE NOT success)                AS n_err,
        avg(response_time)                                 AS avg_rt,
        min(response_time)                                 AS min_rt,
        max(response_time)                                 AS max_rt,
        avg(response_connect_time)                         AS avg_connect,
        avg(response_latency)                              AS avg_latency,
        sum(response_size)::bigint                         AS bytes_in,
        sum(request_size)::bigint                          AS bytes_out,
        avg(response_size)                                 AS avg_response_size,
        sum(response_time) FILTER (WHERE success)          AS sum_rt_ok,
        percentile_agg(response_time::double precision)    AS pct_agg
      FROM requests_raw GROUP BY 1,2,3,4,5,6,7 WITH NO DATA`,
      },
      {
        view: 'requests_raw_1m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)          AS bucket,
        system_under_test, test_environment, scenario_name, sampler_name,
        transaction_name, location,
        sum(n)::bigint AS n, sum(n_ok)::bigint AS n_ok, sum(n_err)::bigint AS n_err,
        sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
        min(min_rt) AS min_rt, max(max_rt) AS max_rt,
        sum(avg_connect * n) / NULLIF(sum(n), 0)           AS avg_connect,
        sum(avg_latency * n) / NULLIF(sum(n), 0)           AS avg_latency,
        sum(bytes_in)::bigint AS bytes_in, sum(bytes_out)::bigint AS bytes_out,
        sum(avg_response_size * n) / NULLIF(sum(n), 0)     AS avg_response_size,
        sum(sum_rt_ok)                                     AS sum_rt_ok,
        rollup(pct_agg)                                    AS pct_agg
      FROM requests_raw_5s GROUP BY 1,2,3,4,5,6,7 WITH NO DATA`,
      },
      {
        view: 'requests_raw_5m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)         AS bucket,
        system_under_test, test_environment, scenario_name, sampler_name,
        transaction_name, location,
        sum(n)::bigint AS n, sum(n_ok)::bigint AS n_ok, sum(n_err)::bigint AS n_err,
        sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
        min(min_rt) AS min_rt, max(max_rt) AS max_rt,
        sum(avg_connect * n) / NULLIF(sum(n), 0)           AS avg_connect,
        sum(avg_latency * n) / NULLIF(sum(n), 0)           AS avg_latency,
        sum(bytes_in)::bigint AS bytes_in, sum(bytes_out)::bigint AS bytes_out,
        sum(avg_response_size * n) / NULLIF(sum(n), 0)     AS avg_response_size,
        sum(sum_rt_ok)                                     AS sum_rt_ok,
        rollup(pct_agg)                                    AS pct_agg
      FROM requests_raw_1m GROUP BY 1,2,3,4,5,6,7 WITH NO DATA`,
      },
      // ── transactions family ──────────────────────────────────
      {
        view: 'transactions_5s',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)          AS bucket,
        system_under_test, test_environment, scenario_name, transaction_name,
        count(*)                                           AS n,
        count(*) FILTER (WHERE success)                    AS n_ok,
        count(*) FILTER (WHERE NOT success)                AS n_err,
        avg(response_time)                                 AS avg_rt,
        min(response_time)                                 AS min_rt,
        max(response_time)                                 AS max_rt,
        sum(response_time) FILTER (WHERE success)          AS sum_rt_ok,
        percentile_agg(response_time::double precision)    AS pct_agg
      FROM transactions GROUP BY 1,2,3,4,5 WITH NO DATA`,
      },
      {
        view: 'transactions_1m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)          AS bucket,
        system_under_test, test_environment, scenario_name, transaction_name,
        sum(n)::bigint AS n, sum(n_ok)::bigint AS n_ok, sum(n_err)::bigint AS n_err,
        sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
        min(min_rt) AS min_rt, max(max_rt) AS max_rt,
        sum(sum_rt_ok)                                     AS sum_rt_ok,
        rollup(pct_agg)                                    AS pct_agg
      FROM transactions_5s GROUP BY 1,2,3,4,5 WITH NO DATA`,
      },
      {
        view: 'transactions_5m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)         AS bucket,
        system_under_test, test_environment, scenario_name, transaction_name,
        sum(n)::bigint AS n, sum(n_ok)::bigint AS n_ok, sum(n_err)::bigint AS n_err,
        sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
        min(min_rt) AS min_rt, max(max_rt) AS max_rt,
        sum(sum_rt_ok)                                     AS sum_rt_ok,
        rollup(pct_agg)                                    AS pct_agg
      FROM transactions_1m GROUP BY 1,2,3,4,5 WITH NO DATA`,
      },
      // ── requests_error family ────────────────────────────────
      {
        view: 'requests_error_5s',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)          AS bucket,
        system_under_test, test_environment, scenario_name,
        sampler_name, transaction_name, node_name, response_code,
        count(*)                                           AS n
      FROM requests_error GROUP BY 1,2,3,4,5,6,7,8 WITH NO DATA`,
      },
      {
        view: 'requests_error_1m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)          AS bucket,
        system_under_test, test_environment, scenario_name,
        sampler_name, transaction_name, node_name, response_code,
        sum(n)::bigint                                     AS n
      FROM requests_error_5s GROUP BY 1,2,3,4,5,6,7,8 WITH NO DATA`,
      },
      {
        view: 'requests_error_5m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)         AS bucket,
        system_under_test, test_environment, scenario_name,
        sampler_name, transaction_name, node_name, response_code,
        sum(n)::bigint                                     AS n
      FROM requests_error_1m GROUP BY 1,2,3,4,5,6,7,8 WITH NO DATA`,
      },
      // ── requests_raw_passed family ───────────────────────────
      {
        view: 'requests_raw_passed_5s',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)           AS bucket,
        system_under_test, test_environment, scenario_name,
        sampler_name, transaction_name, location,
        percentile_agg(response_time::double precision)
          FILTER (WHERE success)                            AS pct_agg_passed
      FROM requests_raw GROUP BY 1,2,3,4,5,6,7 WITH NO DATA`,
      },
      {
        view: 'requests_raw_passed_1m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)          AS bucket,
        system_under_test, test_environment, scenario_name,
        sampler_name, transaction_name, location,
        rollup(pct_agg_passed)                             AS pct_agg_passed
      FROM requests_raw_passed_5s GROUP BY 1,2,3,4,5,6,7 WITH NO DATA`,
      },
      {
        view: 'requests_raw_passed_5m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)         AS bucket,
        system_under_test, test_environment, scenario_name,
        sampler_name, transaction_name, location,
        rollup(pct_agg_passed)                             AS pct_agg_passed
      FROM requests_raw_passed_1m GROUP BY 1,2,3,4,5,6,7 WITH NO DATA`,
      },
      // ── transactions_passed family ───────────────────────────
      {
        view: 'transactions_passed_5s',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)           AS bucket,
        system_under_test, test_environment, scenario_name, transaction_name,
        percentile_agg(response_time::double precision)
          FILTER (WHERE success)                            AS pct_agg_passed
      FROM transactions GROUP BY 1,2,3,4,5 WITH NO DATA`,
      },
      {
        view: 'transactions_passed_1m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)          AS bucket,
        system_under_test, test_environment, scenario_name, transaction_name,
        rollup(pct_agg_passed)                             AS pct_agg_passed
      FROM transactions_passed_5s GROUP BY 1,2,3,4,5 WITH NO DATA`,
      },
      {
        view: 'transactions_passed_5m',
        sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)         AS bucket,
        system_under_test, test_environment, scenario_name, transaction_name,
        rollup(pct_agg_passed)                             AS pct_agg_passed
      FROM transactions_passed_1m GROUP BY 1,2,3,4,5 WITH NO DATA`,
      },
    ];

    for (const { view, sql } of caggs) {
      try {
        await queryRunner.query(sql);
        console.log(`  Created CAGG: ${view}`);
      } catch (error: unknown) {
        if (ConsolidatedSchema1700000000000.ALREADY_EXISTS_CODES.includes((error as { code?: string })?.code ?? '')) {
          console.log(`  CAGG already exists: ${view}`);
        } else {
          console.warn(`  Warning: Could not create CAGG ${view}:`, (error as Error).message);
        }
      }
    }

    // Refresh policies: each CAGG refreshes on a schedule, offset by granularity
    const refreshPolicies = [
      { view: 'requests_raw_5s',      start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'requests_raw_1m',      start: '2 hours', end: '2 minutes', schedule: '1 minute'   },
      { view: 'requests_raw_5m',      start: '1 day',   end: '5 minutes', schedule: '5 minutes'  },
      { view: 'transactions_5s',      start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'transactions_1m',      start: '2 hours', end: '2 minutes', schedule: '1 minute'   },
      { view: 'transactions_5m',      start: '1 day',   end: '5 minutes', schedule: '5 minutes'  },
      { view: 'requests_error_5s',    start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'requests_error_1m',    start: '2 hours', end: '2 minutes', schedule: '1 minute'   },
      { view: 'requests_error_5m',    start: '1 day',   end: '5 minutes', schedule: '5 minutes'  },
      { view: 'requests_raw_passed_5s',  start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'requests_raw_passed_1m',  start: '2 hours', end: '2 minutes', schedule: '1 minute'   },
      { view: 'requests_raw_passed_5m',  start: '1 day',   end: '5 minutes', schedule: '5 minutes'  },
      { view: 'transactions_passed_5s',  start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'transactions_passed_1m',  start: '2 hours', end: '2 minutes', schedule: '1 minute'   },
      { view: 'transactions_passed_5m',  start: '1 day',   end: '5 minutes', schedule: '5 minutes'  },
    ];

    for (const p of refreshPolicies) {
      try {
        await queryRunner.query(`
          SELECT add_continuous_aggregate_policy('${p.view}',
            start_offset      => INTERVAL '${p.start}',
            end_offset        => INTERVAL '${p.end}',
            schedule_interval => INTERVAL '${p.schedule}',
            if_not_exists     => TRUE
          )
        `);
      } catch (error: unknown) {
        console.warn(`  Warning: Could not add refresh policy for ${p.view}:`, (error as Error).message);
      }
    }

    // Retention policies: 90 days on all CAGGs
    const allCaggViews = caggs.map((c) => c.view);
    for (const view of allCaggViews) {
      try {
        await queryRunner.query(`
          SELECT add_retention_policy('${view}',
            drop_after    => INTERVAL '90 days',
            if_not_exists => TRUE
          )
        `);
      } catch (error: unknown) {
        console.warn(`  Warning: Could not add retention policy for ${view}:`, (error as Error).message);
      }
    }

    // Enable real-time aggregation so the CAGGs serve data immediately via the
    // raw hypertable for the unrefreshed end_offset window. Without this the
    // performance-analysis card shows the "rollup pending" banner for the first
    // ~90 s of every test run (one refresh cycle + end_offset delay).
    const realtimeCaggs = [
      'transactions_5s',
      'transactions_passed_5s',
      'requests_raw_5s',
      'requests_raw_passed_5s',
    ];
    for (const view of realtimeCaggs) {
      try {
        await queryRunner.query(
          `ALTER MATERIALIZED VIEW ${view} SET (timescaledb.materialized_only = false)`,
        );
      } catch (error: unknown) {
        console.warn(`  Warning: Could not enable real-time aggregation for ${view}:`, (error as Error).message);
      }
    }

    console.log(`  Created ${caggs.length} CAGGs with refresh and retention policies`);

    // ─── Phase 6: Post-schema column additions ───
    // Columns added after the initial schema dump. Safe to re-run via IF NOT EXISTS.
    await queryRunner.query(
      `ALTER TABLE "benchmarks" ADD COLUMN IF NOT EXISTS "aggregate_metric" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "benchmarks" ADD COLUMN IF NOT EXISTS "aggregate_stat" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS ramp_down INTEGER DEFAULT 0`,
    );
    // Nullable jsonb capturing a failed virtual user's session variables, written
    // opt-in by the perfana-jmeter-timescaledb backend listener for failed samples.
    // Continuous-aggregate views over requests_error are count rollups and do not
    // select this column, so they are unaffected. See issue #389.
    await queryRunner.query(
      `ALTER TABLE public.requests_error ADD COLUMN IF NOT EXISTS session_variables jsonb`,
    );

    // tags_hash unique index, folded in from the former standalone
    // 1700000000003-AddTagsHashUniqueIndex migration so the consolidated migration
    // is the single source of truth for a greenfield install. All idempotent —
    // no-ops when schema-sql.ts (Phase 1) already created the function and index.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION tags_hash(tags text[])
      RETURNS text
      LANGUAGE SQL
      IMMUTABLE
      AS $$
        SELECT md5(COALESCE(array_to_string(tags, ','), ''))
      $$;
    `);
    await queryRunner.query(
      `ALTER TABLE test_run_configs DROP CONSTRAINT IF EXISTS test_run_configs_test_run_id_key_key`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS test_run_configs_test_run_id_key_tags_key
        ON test_run_configs (test_run_id, key, tags_hash(tags))`,
    );

    // proxy_servers table — created inline in SCHEMA_SQL for greenfield; on existing DBs
    // the table will be absent if this migration ran before the proxy feature was added.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.proxy_servers (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        organization_id uuid NOT NULL,
        proxy_url text NOT NULL,
        username text,
        password text,
        team_id uuid,
        created_by character varying(255),
        updated_by character varying(255),
        created_at timestamp without time zone DEFAULT now() NOT NULL,
        updated_at timestamp without time zone DEFAULT now() NOT NULL,
        CONSTRAINT "PK_proxy_servers" PRIMARY KEY (id),
        CONSTRAINT "uq_proxy_servers_organization" UNIQUE (organization_id)
      )
    `);
    await queryRunner.query(
      `ALTER TABLE public.proxy_servers ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE public.proxy_servers FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`DROP POLICY IF EXISTS rls_proxy_servers_select ON public.proxy_servers`);
    await queryRunner.query(`CREATE POLICY rls_proxy_servers_select ON public.proxy_servers FOR SELECT USING (public.can_access_resource(organization_id, team_id, (created_by)::text))`);
    await queryRunner.query(`DROP POLICY IF EXISTS rls_proxy_servers_insert ON public.proxy_servers`);
    await queryRunner.query(`CREATE POLICY rls_proxy_servers_insert ON public.proxy_servers FOR INSERT WITH CHECK (true)`);
    await queryRunner.query(`DROP POLICY IF EXISTS rls_proxy_servers_update ON public.proxy_servers`);
    await queryRunner.query(`CREATE POLICY rls_proxy_servers_update ON public.proxy_servers FOR UPDATE USING (public.can_modify_resource(organization_id, team_id, (created_by)::text))`);
    await queryRunner.query(`DROP POLICY IF EXISTS rls_proxy_servers_delete ON public.proxy_servers`);
    await queryRunner.query(`CREATE POLICY rls_proxy_servers_delete ON public.proxy_servers FOR DELETE USING (public.can_modify_resource(organization_id, team_id, (created_by)::text))`);

    // use_proxy columns on integration tables — added after baseline schema dump.
    await queryRunner.query(
      `ALTER TABLE public.grafana_instances ADD COLUMN IF NOT EXISTS use_proxy boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE public.dynatrace_configs ADD COLUMN IF NOT EXISTS use_proxy boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE public.pyroscope_instances ADD COLUMN IF NOT EXISTS use_proxy boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE public.tracing_instances ADD COLUMN IF NOT EXISTS use_proxy boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE public.notification_channels ADD COLUMN IF NOT EXISTS use_proxy boolean NOT NULL DEFAULT false`,
    );

    console.log('Phase 6: Post-schema column additions applied.');
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
