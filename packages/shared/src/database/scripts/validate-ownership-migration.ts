import { DataSource } from 'typeorm';

/**
 * Post-Migration Validation Script: Ownership Constraint Verification
 *
 * This script validates that the RBAC Phase 4 data migration completed successfully.
 * It verifies:
 * - Default organization exists
 * - System user is registered in migration_metadata
 * - All 25 resource tables have organization_id and created_by columns
 * - No NULL values exist in ownership columns
 * - NOT NULL constraints are enforced at database level
 * - Foreign key constraints exist from resource tables to organizations
 *
 * Usage:
 *   npx ts-node packages/shared/src/database/scripts/validate-ownership-migration.ts [--dry-run] [--verbose]
 *
 * Options:
 *   --dry-run   Validate script syntax without database connection
 *   --verbose   Show detailed per-table validation results
 */

// Well-known IDs from migrations
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000002';

// Resource tables requiring ownership validation (from spec.md)
const RESOURCE_TABLES = [
  'test_runs',
  'benchmarks',
  'systems_under_test',
  'profiles',
  'grafana_dashboards',
  'grafana_instances',
  'application_dashboards',
  'tracing_instances',
  'tracing_services',
  'pyroscope_instances',
  'dynatrace_configs',
  'dynatrace_entity_mappings',
  'dynatrace_queries',
  'report_templates',
  'generated_reports',
  'api_keys',
  'notification_channels',
  'graph_presets',
  'trends_filter_presets',
  'compare_filter_presets',
  'deep_links',
  'generic_deep_links',
  'url_patterns',
  'expected_config_changes',
  'data_sources',
] as const;

interface TableValidationResult {
  tableName: string;
  exists: boolean;
  hasOrganizationId: boolean;
  hasCreatedBy: boolean;
  totalRecords: number;
  nullOrganizationId: number;
  nullCreatedBy: number;
  hasNotNullOrgId: boolean;
  hasNotNullCreatedBy: boolean;
  hasForeignKeyToOrg: boolean;
  isValid: boolean;
  errors: string[];
}

interface ValidationSummary {
  defaultOrgExists: boolean;
  systemUserExists: boolean;
  totalTables: number;
  tablesFound: number;
  tablesWithAllColumns: number;
  tablesWithNoNulls: number;
  tablesWithNotNullConstraints: number;
  tablesWithForeignKeys: number;
  totalRecords: number;
  totalNullOrgId: number;
  totalNullCreatedBy: number;
  overallValid: boolean;
  errors: string[];
}

/**
 * Check if a table exists
 */
async function tableExists(dataSource: DataSource, tableName: string): Promise<boolean> {
  const result = await dataSource.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) as exists
  `,
    [tableName],
  );
  return result[0]?.exists === true;
}

/**
 * Check if a column exists in a table
 */
async function columnExists(
  dataSource: DataSource,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await dataSource.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) as exists
  `,
    [tableName, columnName],
  );
  return result[0]?.exists === true;
}

/**
 * Check if a column has NOT NULL constraint
 */
async function hasNotNullConstraint(
  dataSource: DataSource,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await dataSource.query(
    `
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
  `,
    [tableName, columnName],
  );
  return result[0]?.is_nullable === 'NO';
}

/**
 * Check if a foreign key constraint exists from a column to organizations table
 */
async function hasForeignKeyToOrganizations(
  dataSource: DataSource,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await dataSource.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
        AND kcu.column_name = $2
        AND ccu.table_name = 'organizations'
    ) as exists
  `,
    [tableName, columnName],
  );
  return result[0]?.exists === true;
}

/**
 * Get count of records with NULL value for a column
 */
async function countNullValues(
  dataSource: DataSource,
  tableName: string,
  columnName: string,
): Promise<number> {
  const result = await dataSource.query(
    `SELECT COUNT(*) as count FROM "${tableName}" WHERE "${columnName}" IS NULL`,
  );
  return parseInt(result[0]?.count ?? '0', 10);
}

/**
 * Get total record count for a table
 */
async function countRecords(dataSource: DataSource, tableName: string): Promise<number> {
  const result = await dataSource.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
  return parseInt(result[0]?.count ?? '0', 10);
}

/**
 * Verify default organization exists
 */
async function verifyDefaultOrganization(dataSource: DataSource): Promise<boolean> {
  const result = await dataSource.query(
    `SELECT EXISTS (SELECT 1 FROM organizations WHERE id = $1) as exists`,
    [DEFAULT_ORG_ID],
  );
  return result[0]?.exists === true;
}

/**
 * Verify system user is registered in migration_metadata
 */
async function verifySystemUser(dataSource: DataSource): Promise<boolean> {
  // First check if migration_metadata table exists
  const tableExistsResult = await tableExists(dataSource, 'migration_metadata');
  if (!tableExistsResult) {
    return false;
  }

  const result = await dataSource.query(
    `SELECT EXISTS (
      SELECT 1 FROM migration_metadata
      WHERE key = 'system_user_id' AND value = $1
    ) as exists`,
    [SYSTEM_USER_ID],
  );
  return result[0]?.exists === true;
}

/**
 * Validate a single table for ownership constraints
 */
async function validateTable(
  dataSource: DataSource,
  tableName: string,
): Promise<TableValidationResult> {
  const result: TableValidationResult = {
    tableName,
    exists: false,
    hasOrganizationId: false,
    hasCreatedBy: false,
    totalRecords: 0,
    nullOrganizationId: 0,
    nullCreatedBy: 0,
    hasNotNullOrgId: false,
    hasNotNullCreatedBy: false,
    hasForeignKeyToOrg: false,
    isValid: false,
    errors: [],
  };

  try {
    // Check if table exists
    result.exists = await tableExists(dataSource, tableName);
    if (!result.exists) {
      result.errors.push('Table does not exist');
      return result;
    }

    // Check for ownership columns
    result.hasOrganizationId = await columnExists(dataSource, tableName, 'organization_id');
    result.hasCreatedBy = await columnExists(dataSource, tableName, 'created_by');

    if (!result.hasOrganizationId) {
      result.errors.push('Missing organization_id column');
    }
    if (!result.hasCreatedBy) {
      result.errors.push('Missing created_by column');
    }

    // Get record counts
    result.totalRecords = await countRecords(dataSource, tableName);

    // Count NULL values if columns exist
    if (result.hasOrganizationId) {
      result.nullOrganizationId = await countNullValues(dataSource, tableName, 'organization_id');
      if (result.nullOrganizationId > 0) {
        result.errors.push(`${result.nullOrganizationId} records have NULL organization_id`);
      }
    }

    if (result.hasCreatedBy) {
      result.nullCreatedBy = await countNullValues(dataSource, tableName, 'created_by');
      if (result.nullCreatedBy > 0) {
        result.errors.push(`${result.nullCreatedBy} records have NULL created_by`);
      }
    }

    // Check NOT NULL constraints
    if (result.hasOrganizationId) {
      result.hasNotNullOrgId = await hasNotNullConstraint(
        dataSource,
        tableName,
        'organization_id',
      );
      if (!result.hasNotNullOrgId) {
        result.errors.push('NOT NULL constraint missing on organization_id');
      }
    }

    if (result.hasCreatedBy) {
      result.hasNotNullCreatedBy = await hasNotNullConstraint(dataSource, tableName, 'created_by');
      if (!result.hasNotNullCreatedBy) {
        result.errors.push('NOT NULL constraint missing on created_by');
      }
    }

    // Check foreign key constraint
    if (result.hasOrganizationId) {
      result.hasForeignKeyToOrg = await hasForeignKeyToOrganizations(
        dataSource,
        tableName,
        'organization_id',
      );
      if (!result.hasForeignKeyToOrg) {
        result.errors.push('Foreign key constraint to organizations missing');
      }
    }

    // Determine overall validity
    result.isValid =
      result.exists &&
      result.hasOrganizationId &&
      result.hasCreatedBy &&
      result.nullOrganizationId === 0 &&
      result.nullCreatedBy === 0 &&
      result.hasNotNullOrgId &&
      result.hasNotNullCreatedBy &&
      result.hasForeignKeyToOrg;
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
    result.errors.push(`Validation error: ${message}`);
  }

  return result;
}

/**
 * Generate validation summary from results
 */
function generateSummary(
  results: TableValidationResult[],
  defaultOrgExists: boolean,
  systemUserExists: boolean,
): ValidationSummary {
  const existingTables = results.filter((r) => r.exists);
  const errors: string[] = [];

  if (!defaultOrgExists) {
    errors.push('Default organization does not exist');
  }
  if (!systemUserExists) {
    errors.push('System user not registered in migration_metadata');
  }

  // Collect table-level errors
  for (const table of results) {
    if (!table.isValid) {
      table.errors.forEach((e) => errors.push(`${table.tableName}: ${e}`));
    }
  }

  const summary: ValidationSummary = {
    defaultOrgExists,
    systemUserExists,
    totalTables: RESOURCE_TABLES.length,
    tablesFound: existingTables.length,
    tablesWithAllColumns: existingTables.filter((r) => r.hasOrganizationId && r.hasCreatedBy)
      .length,
    tablesWithNoNulls: existingTables.filter(
      (r) => r.nullOrganizationId === 0 && r.nullCreatedBy === 0,
    ).length,
    tablesWithNotNullConstraints: existingTables.filter(
      (r) => r.hasNotNullOrgId && r.hasNotNullCreatedBy,
    ).length,
    tablesWithForeignKeys: existingTables.filter((r) => r.hasForeignKeyToOrg).length,
    totalRecords: existingTables.reduce((sum, r) => sum + r.totalRecords, 0),
    totalNullOrgId: existingTables.reduce((sum, r) => sum + r.nullOrganizationId, 0),
    totalNullCreatedBy: existingTables.reduce((sum, r) => sum + r.nullCreatedBy, 0),
    overallValid:
      defaultOrgExists &&
      systemUserExists &&
      existingTables.length === RESOURCE_TABLES.length &&
      existingTables.every((r) => r.isValid),
    errors,
  };

  return summary;
}

/**
 * Format a number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Print validation results
 */
function printResults(
  results: TableValidationResult[],
  summary: ValidationSummary,
  verbose: boolean,
): void {
  console.log('\n' + '='.repeat(80));
  console.log('RBAC Phase 4 - Post-Migration Validation Report');
  console.log('='.repeat(80));
  console.log(`\nValidation Date: ${new Date().toISOString()}`);
  console.log(`Tables Validated: ${RESOURCE_TABLES.length}`);
  console.log('\n' + '-'.repeat(80));

  // Pre-requisites section
  console.log('\n🔧 PRE-REQUISITES\n');
  console.log(
    `  Default Organization (${DEFAULT_ORG_ID}): ${summary.defaultOrgExists ? '✅ exists' : '❌ missing'}`,
  );
  console.log(
    `  System User (${SYSTEM_USER_ID}): ${summary.systemUserExists ? '✅ registered' : '❌ not found'}`,
  );

  // Summary section
  console.log('\n📊 SUMMARY\n');
  console.log(`  Tables Found:              ${summary.tablesFound}/${summary.totalTables}`);
  console.log(`  Tables with all columns:   ${summary.tablesWithAllColumns}/${summary.tablesFound}`);
  console.log(`  Tables with no NULL values: ${summary.tablesWithNoNulls}/${summary.tablesFound}`);
  console.log(
    `  Tables with NOT NULL:      ${summary.tablesWithNotNullConstraints}/${summary.tablesFound}`,
  );
  console.log(`  Tables with FK to orgs:    ${summary.tablesWithForeignKeys}/${summary.tablesFound}`);
  console.log('');
  console.log(`  Total Records:             ${formatNumber(summary.totalRecords)}`);
  console.log(`  Records with NULL org_id:  ${formatNumber(summary.totalNullOrgId)}`);
  console.log(`  Records with NULL created_by: ${formatNumber(summary.totalNullCreatedBy)}`);

  // Overall status
  console.log('\n' + '-'.repeat(80));
  if (summary.overallValid) {
    console.log('\n✅ VALIDATION PASSED - All ownership constraints are in place\n');
  } else {
    console.log('\n❌ VALIDATION FAILED - Issues found with ownership constraints\n');

    // Print errors
    console.log('🚨 ERRORS:\n');
    summary.errors.forEach((e) => console.log(`    - ${e}`));
  }

  // Verbose per-table details
  if (verbose) {
    console.log('\n' + '-'.repeat(80));
    console.log('\n📋 DETAILED TABLE VALIDATION\n');

    for (const table of results) {
      const status = table.isValid ? '✅' : '❌';
      console.log(`\n  ${status} ${table.tableName}`);

      if (!table.exists) {
        console.log('     ⚠️  Table not found');
        continue;
      }

      console.log(`     Total Records: ${formatNumber(table.totalRecords)}`);
      console.log(
        `     organization_id: ${table.hasOrganizationId ? '✅ exists' : '❌ missing'}`,
      );
      if (table.hasOrganizationId) {
        console.log(`       - NULL values: ${formatNumber(table.nullOrganizationId)}`);
        console.log(`       - NOT NULL constraint: ${table.hasNotNullOrgId ? '✅' : '❌'}`);
        console.log(`       - FK to organizations: ${table.hasForeignKeyToOrg ? '✅' : '❌'}`);
      }
      console.log(`     created_by: ${table.hasCreatedBy ? '✅ exists' : '❌ missing'}`);
      if (table.hasCreatedBy) {
        console.log(`       - NULL values: ${formatNumber(table.nullCreatedBy)}`);
        console.log(`       - NOT NULL constraint: ${table.hasNotNullCreatedBy ? '✅' : '❌'}`);
      }

      if (table.errors.length > 0) {
        console.log('     Errors:');
        table.errors.forEach((e) => console.log(`       - ${e}`));
      }
    }
  }

  // Recommendations if failed
  if (!summary.overallValid) {
    console.log('\n' + '-'.repeat(80));
    console.log('\n📝 RECOMMENDED ACTIONS\n');

    if (!summary.defaultOrgExists) {
      console.log('  1. Run migration: 1776000000000-CreateDefaultOrganization');
    }
    if (!summary.systemUserExists) {
      console.log('  2. Run migration: 1776000000001-RegisterSystemUser');
    }
    if (summary.totalNullOrgId > 0 || summary.totalNullCreatedBy > 0) {
      console.log('  3. Run migration: 1776000000002-AssignResourceOwnership');
    }
    if (summary.tablesWithNotNullConstraints < summary.tablesFound) {
      console.log('  4. Run migration: 1776000000003-EnforceOwnershipConstraints');
    }
    if (summary.tablesWithForeignKeys < summary.tablesFound) {
      console.log('  5. Run migration: 1776000000004-AddOwnershipForeignKeys');
    }
    console.log('\n  Run: npm run migration:run');
  }

  console.log('\n' + '='.repeat(80));
  console.log('');
}

/**
 * Create database connection
 */
async function createDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'perfana',
    password: process.env.DB_PASSWORD || 'perfana',
    database: process.env.DB_NAME || 'perfana',
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  return dataSource;
}

/**
 * Run dry-run validation
 */
function runDryRun(): void {
  console.log('\n🔍 Dry-run mode: Validating script syntax...\n');
  console.log('✅ Script syntax is valid');
  console.log('✅ Default organization ID:', DEFAULT_ORG_ID);
  console.log('✅ System user ID:', SYSTEM_USER_ID);
  console.log('✅ Resource tables defined:', RESOURCE_TABLES.length);
  console.log('\nResource tables to validate:');
  RESOURCE_TABLES.forEach((table, index) => {
    console.log(`  ${index + 1}. ${table}`);
  });
  console.log('\nValidations performed:');
  console.log('  1. Default organization exists');
  console.log('  2. System user registered in migration_metadata');
  console.log('  3. Each table has organization_id column');
  console.log('  4. Each table has created_by column');
  console.log('  5. No NULL values in organization_id');
  console.log('  6. No NULL values in created_by');
  console.log('  7. NOT NULL constraint on organization_id');
  console.log('  8. NOT NULL constraint on created_by');
  console.log('  9. Foreign key from organization_id to organizations table');
  console.log(
    '\n📋 To run actual validation, execute without --dry-run flag and ensure database connection.',
  );
  console.log('   Required environment variables:');
  console.log('     - DB_HOST (default: localhost)');
  console.log('     - DB_PORT (default: 5432)');
  console.log('     - DB_USERNAME (default: perfana)');
  console.log('     - DB_PASSWORD (default: perfana)');
  console.log('     - DB_NAME (default: perfana)');
  console.log('');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isVerbose = args.includes('--verbose');

  if (isDryRun) {
    runDryRun();
    process.exit(0);
  }

  console.log('\n🚀 Starting RBAC Phase 4 Post-Migration Validation...\n');

  let dataSource: DataSource | null = null;

  try {
    // Connect to database
    console.log('📡 Connecting to database...');
    dataSource = await createDataSource();
    console.log('✅ Database connection established\n');

    // Verify pre-requisites
    console.log('🔧 Verifying pre-requisites...');
    const defaultOrgExists = await verifyDefaultOrganization(dataSource);
    console.log(
      `  Default organization: ${defaultOrgExists ? '✅ exists' : '❌ missing'}`,
    );

    const systemUserExists = await verifySystemUser(dataSource);
    console.log(
      `  System user: ${systemUserExists ? '✅ registered' : '❌ not found'}`,
    );

    // Validate each table
    console.log('\n🔍 Validating resource tables...\n');
    const results: TableValidationResult[] = [];

    for (const tableName of RESOURCE_TABLES) {
      process.stdout.write(`  Validating ${tableName}...`);
      const result = await validateTable(dataSource, tableName);
      results.push(result);
      if (result.isValid) {
        console.log(' ✅');
      } else if (!result.exists) {
        console.log(' ⚠️  table not found');
      } else {
        console.log(` ❌ (${result.errors.length} issue${result.errors.length !== 1 ? 's' : ''})`);
      }
    }

    // Generate and print summary
    const summary = generateSummary(results, defaultOrgExists, systemUserExists);
    printResults(results, summary, isVerbose);

    // Exit with appropriate code
    if (!summary.overallValid) {
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
    console.error('\n❌ Validation failed:', message);
    process.exit(1);
  } finally {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  }
}

// Execute main function
main();
