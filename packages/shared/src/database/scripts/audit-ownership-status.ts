import { DataSource } from 'typeorm';

/**
 * Pre-Migration Audit Script: Ownership Status Analysis
 *
 * This script analyzes all 25 resource tables to assess ownership status
 * before running the RBAC Phase 4 data migration. It reports:
 * - Which tables have organization_id and created_by columns
 * - How many records exist in each table
 * - How many records have NULL ownership values
 * - Migration scope estimation
 *
 * Usage:
 *   npx ts-node packages/shared/src/database/scripts/audit-ownership-status.ts [--dry-run] [--verbose]
 *
 * Options:
 *   --dry-run   Validate script syntax without database connection
 *   --verbose   Show detailed per-table statistics
 */

// Resource tables requiring ownership migration (from spec.md)
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

interface TableAuditResult {
  tableName: string;
  exists: boolean;
  hasOrganizationId: boolean;
  hasCreatedBy: boolean;
  totalRecords: number;
  nullOrganizationId: number;
  nullCreatedBy: number;
  percentNullOrgId: number;
  percentNullCreatedBy: number;
  error?: string;
}

interface AuditSummary {
  totalTables: number;
  tablesWithOrgId: number;
  tablesWithCreatedBy: number;
  tablesWithBothColumns: number;
  tablesMissingOrgId: number;
  tablesMissingCreatedBy: number;
  totalRecords: number;
  recordsNeedingOrgId: number;
  recordsNeedingCreatedBy: number;
  migrationScope: 'low' | 'medium' | 'high';
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
 * Audit a single table for ownership status
 */
async function auditTable(dataSource: DataSource, tableName: string): Promise<TableAuditResult> {
  const result: TableAuditResult = {
    tableName,
    exists: false,
    hasOrganizationId: false,
    hasCreatedBy: false,
    totalRecords: 0,
    nullOrganizationId: 0,
    nullCreatedBy: 0,
    percentNullOrgId: 0,
    percentNullCreatedBy: 0,
  };

  try {
    // Check if table exists
    result.exists = await tableExists(dataSource, tableName);
    if (!result.exists) {
      return result;
    }

    // Check for ownership columns
    result.hasOrganizationId = await columnExists(dataSource, tableName, 'organization_id');
    result.hasCreatedBy = await columnExists(dataSource, tableName, 'created_by');

    // Get record counts
    result.totalRecords = await countRecords(dataSource, tableName);

    if (result.totalRecords > 0) {
      // Count NULL values if columns exist
      if (result.hasOrganizationId) {
        result.nullOrganizationId = await countNullValues(dataSource, tableName, 'organization_id');
        result.percentNullOrgId = (result.nullOrganizationId / result.totalRecords) * 100;
      } else {
        // If column doesn't exist, all records need migration
        result.nullOrganizationId = result.totalRecords;
        result.percentNullOrgId = 100;
      }

      if (result.hasCreatedBy) {
        result.nullCreatedBy = await countNullValues(dataSource, tableName, 'created_by');
        result.percentNullCreatedBy = (result.nullCreatedBy / result.totalRecords) * 100;
      } else {
        // If column doesn't exist, all records need migration
        result.nullCreatedBy = result.totalRecords;
        result.percentNullCreatedBy = 100;
      }
    }
  } catch (error) {
    result.error =
      error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
  }

  return result;
}

/**
 * Generate summary statistics from audit results
 */
function generateSummary(results: TableAuditResult[]): AuditSummary {
  const existingTables = results.filter((r) => r.exists);

  const summary: AuditSummary = {
    totalTables: existingTables.length,
    tablesWithOrgId: existingTables.filter((r) => r.hasOrganizationId).length,
    tablesWithCreatedBy: existingTables.filter((r) => r.hasCreatedBy).length,
    tablesWithBothColumns: existingTables.filter((r) => r.hasOrganizationId && r.hasCreatedBy)
      .length,
    tablesMissingOrgId: existingTables.filter((r) => !r.hasOrganizationId).length,
    tablesMissingCreatedBy: existingTables.filter((r) => !r.hasCreatedBy).length,
    totalRecords: existingTables.reduce((sum, r) => sum + r.totalRecords, 0),
    recordsNeedingOrgId: existingTables.reduce((sum, r) => sum + r.nullOrganizationId, 0),
    recordsNeedingCreatedBy: existingTables.reduce((sum, r) => sum + r.nullCreatedBy, 0),
    migrationScope: 'low',
  };

  // Determine migration scope based on percentage of records needing migration
  const orgIdPercentage =
    summary.totalRecords > 0 ? (summary.recordsNeedingOrgId / summary.totalRecords) * 100 : 0;
  const createdByPercentage =
    summary.totalRecords > 0 ? (summary.recordsNeedingCreatedBy / summary.totalRecords) * 100 : 0;
  const maxPercentage = Math.max(orgIdPercentage, createdByPercentage);

  if (maxPercentage > 75) {
    summary.migrationScope = 'high';
  } else if (maxPercentage > 25) {
    summary.migrationScope = 'medium';
  } else {
    summary.migrationScope = 'low';
  }

  return summary;
}

/**
 * Format a number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Print table audit results
 */
function printResults(results: TableAuditResult[], summary: AuditSummary, verbose: boolean): void {
  console.log('\n' + '='.repeat(80));
  console.log('RBAC Phase 4 - Pre-Migration Ownership Audit Report');
  console.log('='.repeat(80));
  console.log(`\nAudit Date: ${new Date().toISOString()}`);
  console.log(`Tables Analyzed: ${RESOURCE_TABLES.length}`);
  console.log('\n' + '-'.repeat(80));

  // Summary section
  console.log('\n📊 SUMMARY\n');
  console.log(`  Tables Found:              ${summary.totalTables}/${RESOURCE_TABLES.length}`);
  console.log(`  Tables with organization_id: ${summary.tablesWithOrgId}`);
  console.log(`  Tables with created_by:      ${summary.tablesWithCreatedBy}`);
  console.log(`  Tables with both columns:    ${summary.tablesWithBothColumns}`);
  console.log(`  Tables missing org_id:       ${summary.tablesMissingOrgId}`);
  console.log(`  Tables missing created_by:   ${summary.tablesMissingCreatedBy}`);
  console.log('');
  console.log(`  Total Records:             ${formatNumber(summary.totalRecords)}`);
  console.log(`  Records needing org_id:    ${formatNumber(summary.recordsNeedingOrgId)}`);
  console.log(`  Records needing created_by: ${formatNumber(summary.recordsNeedingCreatedBy)}`);
  console.log('');
  console.log(`  Migration Scope: ${summary.migrationScope.toUpperCase()}`);

  // Tables missing columns
  const missingOrgId = results.filter((r) => r.exists && !r.hasOrganizationId);
  const missingCreatedBy = results.filter((r) => r.exists && !r.hasCreatedBy);
  const missingTables = results.filter((r) => !r.exists);

  if (missingOrgId.length > 0) {
    console.log('\n⚠️  TABLES MISSING organization_id COLUMN:\n');
    missingOrgId.forEach((r) => console.log(`    - ${r.tableName}`));
  }

  if (missingCreatedBy.length > 0) {
    console.log('\n⚠️  TABLES MISSING created_by COLUMN:\n');
    missingCreatedBy.forEach((r) => console.log(`    - ${r.tableName}`));
  }

  if (missingTables.length > 0) {
    console.log('\n❌ TABLES NOT FOUND:\n');
    missingTables.forEach((r) => console.log(`    - ${r.tableName}`));
  }

  // Verbose per-table details
  if (verbose) {
    console.log('\n' + '-'.repeat(80));
    console.log('\n📋 DETAILED TABLE ANALYSIS\n');

    const existingTables = results.filter((r) => r.exists);
    for (const table of existingTables) {
      console.log(`\n  📁 ${table.tableName}`);
      console.log(`     Total Records: ${formatNumber(table.totalRecords)}`);
      console.log(`     organization_id: ${table.hasOrganizationId ? '✅ exists' : '❌ missing'}`);
      if (table.hasOrganizationId && table.totalRecords > 0) {
        console.log(
          `       - NULL values: ${formatNumber(table.nullOrganizationId)} (${table.percentNullOrgId.toFixed(1)}%)`,
        );
      }
      console.log(`     created_by: ${table.hasCreatedBy ? '✅ exists' : '❌ missing'}`);
      if (table.hasCreatedBy && table.totalRecords > 0) {
        console.log(
          `       - NULL values: ${formatNumber(table.nullCreatedBy)} (${table.percentNullCreatedBy.toFixed(1)}%)`,
        );
      }
      if (table.error) {
        console.log(`     ⚠️  Error: ${table.error}`);
      }
    }
  }

  // Recommendations
  console.log('\n' + '-'.repeat(80));
  console.log('\n📝 RECOMMENDATIONS\n');

  if (summary.tablesMissingOrgId > 0) {
    console.log(
      '  1. Add organization_id column to missing tables before running ownership assignment',
    );
  }
  if (summary.tablesMissingCreatedBy > 0) {
    console.log(
      '  2. Add created_by column to missing tables before running ownership assignment',
    );
  }
  if (summary.recordsNeedingOrgId > 0 || summary.recordsNeedingCreatedBy > 0) {
    console.log('  3. Create default organization before running ownership migration');
    console.log('  4. Register system user for legacy data attribution');
    console.log('  5. Run ownership assignment migration to populate NULL values');
  }
  if (summary.migrationScope === 'high') {
    console.log(
      '  6. Consider batch processing for large tables to avoid timeout (test_runs, etc.)',
    );
    console.log('  7. Schedule migration during low-traffic period');
  }
  console.log('  8. Create database backup before running migrations');

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
  console.log('✅ Resource tables defined:', RESOURCE_TABLES.length);
  console.log('\nResource tables to audit:');
  RESOURCE_TABLES.forEach((table, index) => {
    console.log(`  ${index + 1}. ${table}`);
  });
  console.log(
    '\n📋 To run actual audit, execute without --dry-run flag and ensure database connection.',
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

  console.log('\n🚀 Starting RBAC Phase 4 Pre-Migration Audit...\n');

  let dataSource: DataSource | null = null;

  try {
    // Connect to database
    console.log('📡 Connecting to database...');
    dataSource = await createDataSource();
    console.log('✅ Database connection established\n');

    // Audit each table
    console.log('🔍 Auditing resource tables...\n');
    const results: TableAuditResult[] = [];

    for (const tableName of RESOURCE_TABLES) {
      process.stdout.write(`  Checking ${tableName}...`);
      const result = await auditTable(dataSource, tableName);
      results.push(result);
      if (result.exists) {
        console.log(` ✅ (${formatNumber(result.totalRecords)} records)`);
      } else {
        console.log(' ⚠️  table not found');
      }
    }

    // Generate and print summary
    const summary = generateSummary(results);
    printResults(results, summary, isVerbose);

    // Exit with appropriate code
    if (summary.tablesMissingOrgId > 0 || summary.tablesMissingCreatedBy > 0) {
      console.log('⚠️  Some tables are missing ownership columns. Review before migration.\n');
      process.exit(1);
    }

    console.log('✅ Audit completed successfully.\n');
    process.exit(0);
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
    console.error('\n❌ Audit failed:', message);
    process.exit(1);
  } finally {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  }
}

// Execute main function
main();
