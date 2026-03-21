import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cleanup Legacy Migration Records
 *
 * After consolidating all 23 migrations into a single ConsolidatedSchema migration,
 * existing databases still have orphaned records in the migrations table for the
 * deleted migration files. This migration removes those stale records so that
 * `migration:revert` and `migration:show` work correctly.
 *
 * This migration is safe to run on both:
 * - Existing databases (removes orphaned records)
 * - Fresh databases (no-op, no orphaned records exist)
 */
export class CleanupLegacyMigrationRecords1700000000001
  implements MigrationInterface
{
  name = 'CleanupLegacyMigrationRecords1700000000001';

  private readonly legacyMigrations = [
    'CleanupMigrationHistory1774000000000',
    'CreateDefaultOrganization1776000000000',
    'RegisterSystemUser1776000000001',
    'AssignResourceOwnership1776000000002',
    'EnforceOwnershipConstraints1776000000003',
    'AddOwnershipForeignKeys1776000000004',
    'EnableRowLevelSecurity1776000000005',
    'CreateRLSHelperFunctions1776000000006',
    'CreateRLSPolicies1776000000007',
    'CreateAuditLogTable1776000000008',
    'AddMembershipTables1776000000009',
    'UpdateAuditLogSchema1776000000010',
    'AddOrganizationToProfiles1776000000011',
    'AddOwnershipColumnsToTestRuns1776000000012',
    'AddOwnershipColumnsToApplicationDashboards1776000000013',
    'AddOwnershipColumnsToGrafanaEntities1776000000014',
    'AddOwnershipColumnsToRemainingTables1776000000015',
    'AddOwnershipColumnsToDsAndRelatedTables1776000000016',
    'CreateRestrictedAppRole1776000000017',
    'FixRLSPoliciesColumnReferences1776000000018',
    'RemoveOwnerAndLeadRoles1776000000019',
    'CreateEventsTable1776000000020',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Detect the actual migrations table name (varies by TypeORM config)
    const tables = await queryRunner.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('migrations', 'typeorm_migrations')`,
    );

    if (!tables || tables.length === 0) {
      return;
    }

    const tableName = tables[0].table_name;
    const result = await queryRunner.query(
      `DELETE FROM "${tableName}" WHERE name = ANY($1) RETURNING name`,
      [this.legacyMigrations],
    );

    const count = Array.isArray(result) ? result.length : 0;
    if (count > 0) {
      console.log(
        `Removed ${count} orphaned migration records from "${tableName}".`,
      );
    }
  }

  public async down(): Promise<void> {
    // No-op: we don't re-insert orphaned records on revert
  }
}
