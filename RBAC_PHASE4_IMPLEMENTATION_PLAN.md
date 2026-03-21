# RBAC Phase 4 Implementation Plan: Data Migration & Ownership Enforcement

## Overview

**Goal**: Migrate existing data to the RBAC system and enforce ownership constraints at the database level.

**Dependencies**:
- Phase 1 (RolesGuard, role constants, admin endpoint protection) ✅ Complete
- Phase 2 (Membership infrastructure, ownership tracking, AuthorizationService) ✅ Complete
- Phase 3 (Service-layer authorization enforcement) ✅ Complete

**Estimated Time**: 2-3 weeks

**Key Deliverables**:
1. Default organization for legacy data
2. Migration scripts to assign ownership to all existing resources
3. Database constraints to enforce ownership (NOT NULL, foreign keys)
4. Data validation and integrity checks
5. Rollback procedures and safety measures

---

## Phase 4 Scope

### What's Included
- ✅ Create default organization for legacy data
- ✅ Assign ownership (created_by, organization_id) to all existing resources
- ✅ Make ownership fields required (NOT NULL constraints)
- ✅ Add foreign key constraints to organizations table
- ✅ Data validation before and after migration
- ✅ Rollback scripts for safety

### What's NOT Included (Phase 5)
- ❌ PostgreSQL Row-Level Security policies
- ❌ Comprehensive audit logging
- ❌ Performance optimization beyond indexes
- ❌ Real-time permission updates

---

## Phase 3 Implementation Analysis

### Files Created/Modified in Phase 3

**New Infrastructure (5 files)**:
1. `apps/api/src/common/decorators/user-context.decorator.ts` - @UserCtx() decorator
2. `apps/api/src/common/services/authorized-base.service.ts` - Base service pattern
3. `packages/shared/src/entities/owned-resource.interface.ts` - OwnedResource interface
4. `packages/shared/src/entities/organization-member.entity.ts` - Org membership entity
5. `packages/shared/src/entities/team-member.entity.ts` - Team membership entity

**Updated Services (30+ services)**:
- TestRunsService, BenchmarksService, ProfilesService
- SystemsUnderTestService, ApiKeysService
- GrafanaDashboardsService, GrafanaInstancesService, ApplicationDashboardsService
- TracingInstancesService, TracingServicesService
- PyroscopeInstancesService
- ReportsService, ReportGenerationService, ReportTemplateService
- OrganizationsService, TeamsService
- NotificationsService, DeepLinksService
- GraphPresetsService, TrendsPresetsService, ComparePresetsService
- DynatraceService
- All services now extend AuthorizedBaseService or accept userId/roles parameters

**Updated Controllers (40+ controllers)**:
- All controllers now use @UserCtx() decorator
- All endpoints pass user context to services
- Backward-compatible API contracts maintained

**Testing**:
- E2E authorization tests (773 lines)
- Unit tests for AuthorizedBaseService
- Unit tests for @UserCtx() decorator

**Statistics**:
- **106 files changed**
- **8,621 insertions**
- **1,320 deletions**

### Key Features Implemented

1. **Organization-based filtering**: All queries filter by accessible organizations
2. **Permission checks**: Modify/delete operations check ownership
3. **Global admin bypass**: Admins see everything
4. **Legacy data support**: Resources with null organization_id still accessible
5. **Caching**: Organization membership cached for performance

---

## Critical Insight: Organization Membership Source

**IMPORTANT DISCOVERY**: Phase 3 implementation shows that organization membership comes from **Keycloak JWT tokens**, not the database!

From `user-context.decorator.ts`:
```typescript
// Extract organizations and teams arrays from the user
const organizations = request.user?.organizations || [];
const teams = request.user?.teams || [];
```

**Implications for Phase 4**:
1. **Organization membership is managed in Keycloak**, not in the database
2. The `organization_members` and `team_members` tables from Phase 2 may be for:
   - Caching/performance
   - API key scoping
   - Audit trails
   - Admin UI for membership management
3. **Migration strategy must account for Keycloak as source of truth**

**Phase 4 Decisions Needed**:
- How to map existing data to Keycloak organizations?
- Should we create a default organization in Keycloak or just in the database?
- How do API keys get scoped to organizations?

---

## Implementation Steps

### Step 1: Pre-Migration Analysis & Planning (Week 1, Days 1-2)

#### 1.1 Data Audit Script

**File**: `database/scripts/audit-ownership-status.ts`

```typescript
import { DataSource } from 'typeorm';
import { dataSource } from '../data-source';

interface ResourceAudit {
  tableName: string;
  totalRecords: number;
  withOrganization: number;
  withoutOrganization: number;
  withCreatedBy: number;
  withoutCreatedBy: number;
  percentageComplete: number;
}

/**
 * Audit script to analyze current ownership data status.
 * Run this before migration to understand the scope of work.
 */
async function auditOwnershipStatus(): Promise<void> {
  await dataSource.initialize();

  const resourceTables = [
    'test_runs',
    'benchmarks',
    'systems_under_test',
    'profiles',
    'test_environments',
    'workload_types',
    'grafana_dashboards',
    'grafana_instances',
    'application_dashboard_configs',
    'tracing_instances',
    'tracing_services',
    'pyroscope_instances',
    'dynatrace_configurations',
    'dynatrace_entity_mappings',
    'dynatrace_usql_queries',
    'reports',
    'report_templates',
    'api_keys',
    'notification_channels',
    'graph_presets',
    'trends_presets',
    'compare_presets',
    'deep_links',
    'url_patterns',
    'expected_config_changes',
  ];

  console.log('========================================');
  console.log('RBAC Ownership Audit');
  console.log('========================================\n');

  const results: ResourceAudit[] = [];

  for (const tableName of resourceTables) {
    try {
      const [totalResult] = await dataSource.query(
        `SELECT COUNT(*) as count FROM ${tableName}`,
      );
      const total = parseInt(totalResult.count, 10);

      const [withOrgResult] = await dataSource.query(
        `SELECT COUNT(*) as count FROM ${tableName} WHERE organization_id IS NOT NULL`,
      );
      const withOrg = parseInt(withOrgResult.count, 10);

      const [withCreatedByResult] = await dataSource.query(
        `SELECT COUNT(*) as count FROM ${tableName} WHERE created_by IS NOT NULL`,
      );
      const withCreatedBy = parseInt(withCreatedByResult.count, 10);

      const percentageComplete = total > 0 ? Math.round((withOrg / total) * 100) : 100;

      results.push({
        tableName,
        totalRecords: total,
        withOrganization: withOrg,
        withoutOrganization: total - withOrg,
        withCreatedBy,
        withoutCreatedBy: total - withCreatedBy,
        percentageComplete,
      });

      console.log(`${tableName}:`);
      console.log(`  Total: ${total}`);
      console.log(`  With organization: ${withOrg} (${percentageComplete}%)`);
      console.log(`  Without organization: ${total - withOrg}`);
      console.log(`  With created_by: ${withCreatedBy}`);
      console.log(`  Without created_by: ${total - withCreatedBy}\n`);
    } catch (error) {
      console.error(`Error auditing ${tableName}:`, error.message);
    }
  }

  // Summary
  const totalRecords = results.reduce((sum, r) => sum + r.totalRecords, 0);
  const totalWithOrg = results.reduce((sum, r) => sum + r.withOrganization, 0);
  const totalWithoutOrg = results.reduce((sum, r) => sum + r.withoutOrganization, 0);

  console.log('========================================');
  console.log('Summary:');
  console.log(`  Total resources: ${totalRecords}`);
  console.log(`  With organization: ${totalWithOrg}`);
  console.log(`  Without organization: ${totalWithoutOrg}`);
  console.log(
    `  Migration needed: ${totalWithoutOrg} records (${Math.round((totalWithoutOrg / totalRecords) * 100)}%)`,
  );
  console.log('========================================');

  await dataSource.destroy();
}

auditOwnershipStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Audit failed:', error);
    process.exit(1);
  });
```

**Run with**:
```bash
npx ts-node database/scripts/audit-ownership-status.ts
```

**Verification**:
- [ ] Script runs without errors
- [ ] Generates comprehensive report
- [ ] Identifies all resources needing migration
- [ ] Calculates migration scope

---

#### 1.2 Backup Strategy

**Before ANY migration**:

```bash
# Full database backup
pg_dump -h localhost -U perfana_user perfana_db > backups/pre-phase4-$(date +%Y%m%d_%H%M%S).sql

# Verify backup
pg_restore --list backups/pre-phase4-*.sql | head -20

# Test restore on a separate database
createdb perfana_test_restore
pg_restore -d perfana_test_restore backups/pre-phase4-*.sql
```

**Verification**:
- [ ] Backup created successfully
- [ ] Backup file size reasonable (>100MB)
- [ ] Test restore successful
- [ ] All tables present in restored database

---

### Step 2: Create Default Organization (Week 1, Days 2-3)

#### 2.1 Migration: Create Default Organization

**File**: `database/migrations/YYYYMMDDHHMMSS-create-default-organization.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDefaultOrganization1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create default organization for legacy data
    const orgResult = await queryRunner.query(`
      INSERT INTO organizations (name, description, created_at, updated_at)
      VALUES (
        'Default Organization',
        'Default organization for migrated legacy data. Resources without explicit organization assignment belong here.',
        NOW(),
        NOW()
      )
      RETURNING id
    `);

    const defaultOrgId = orgResult[0].id;

    // Store the default org ID in a metadata table for use in subsequent migrations
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS migration_metadata (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      INSERT INTO migration_metadata (key, value)
      VALUES ('default_organization_id', '${defaultOrgId}')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);

    console.log(`✅ Created default organization with ID: ${defaultOrgId}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Get default org ID
    const result = await queryRunner.query(`
      SELECT value FROM migration_metadata WHERE key = 'default_organization_id'
    `);

    if (result.length > 0) {
      const defaultOrgId = result[0].value;

      // Delete default organization (CASCADE will handle related records)
      await queryRunner.query(`
        DELETE FROM organizations WHERE id = '${defaultOrgId}'
      `);

      console.log(`✅ Deleted default organization`);
    }

    // Clean up metadata entry
    await queryRunner.query(`
      DELETE FROM migration_metadata WHERE key = 'default_organization_id'
    `);

    // Drop metadata table if empty
    const count = await queryRunner.query(`
      SELECT COUNT(*) as count FROM migration_metadata
    `);

    if (parseInt(count[0].count, 10) === 0) {
      await queryRunner.query(`DROP TABLE IF EXISTS migration_metadata`);
    }
  }
}
```

**Verification**:
- [ ] Migration runs successfully
- [ ] Default organization created
- [ ] Organization ID stored in metadata table
- [ ] Rollback works correctly

---

#### 2.2 Create System User for Legacy Data

**File**: `database/migrations/YYYYMMDDHHMMSS-create-system-user.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSystemUser1234567891 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Store system user ID for legacy data attribution
    await queryRunner.query(`
      INSERT INTO migration_metadata (key, value)
      VALUES ('system_user_id', 'system-migration')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);

    console.log(`✅ Registered system user ID: system-migration`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM migration_metadata WHERE key = 'system_user_id'
    `);
  }
}
```

**Verification**:
- [ ] System user ID registered
- [ ] ID follows convention (system-migration)

---

### Step 3: Assign Ownership to Existing Resources (Week 1, Days 4-7)

#### 3.1 Migration: Assign Ownership (Batch Processing)

**File**: `database/migrations/YYYYMMDDHHMMSS-assign-resource-ownership.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssignResourceOwnership1234567892 implements MigrationInterface {
  private resourceTables = [
    'test_runs',
    'benchmarks',
    'systems_under_test',
    'profiles',
    'test_environments',
    'workload_types',
    'grafana_dashboards',
    'grafana_instances',
    'application_dashboard_configs',
    'tracing_instances',
    'tracing_services',
    'pyroscope_instances',
    'dynatrace_configurations',
    'dynatrace_entity_mappings',
    'dynatrace_usql_queries',
    'reports',
    'report_templates',
    'api_keys',
    'notification_channels',
    'graph_presets',
    'trends_presets',
    'compare_presets',
    'deep_links',
    'url_patterns',
    'expected_config_changes',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get default organization and system user IDs
    const [orgIdResult] = await queryRunner.query(`
      SELECT value FROM migration_metadata WHERE key = 'default_organization_id'
    `);
    const defaultOrgId = orgIdResult.value;

    const [userIdResult] = await queryRunner.query(`
      SELECT value FROM migration_metadata WHERE key = 'system_user_id'
    `);
    const systemUserId = userIdResult.value;

    console.log(`\n🔄 Starting ownership assignment...`);
    console.log(`   Default Org ID: ${defaultOrgId}`);
    console.log(`   System User ID: ${systemUserId}\n`);

    let totalUpdated = 0;

    for (const tableName of this.resourceTables) {
      try {
        // Update resources without organization_id
        const result = await queryRunner.query(`
          UPDATE ${tableName}
          SET
            organization_id = '${defaultOrgId}',
            created_by = COALESCE(created_by, '${systemUserId}'),
            updated_by = '${systemUserId}'
          WHERE organization_id IS NULL
        `);

        const rowCount = result[1] || 0;
        totalUpdated += rowCount;

        console.log(`✅ ${tableName}: ${rowCount} records updated`);
      } catch (error) {
        console.error(`❌ Error updating ${tableName}:`, error.message);
        throw error;
      }
    }

    console.log(`\n✅ Total records updated: ${totalUpdated}`);

    // Verify no resources are left without organization
    for (const tableName of this.resourceTables) {
      const [result] = await queryRunner.query(`
        SELECT COUNT(*) as count
        FROM ${tableName}
        WHERE organization_id IS NULL
      `);

      const nullCount = parseInt(result.count, 10);
      if (nullCount > 0) {
        throw new Error(
          `Migration incomplete: ${tableName} still has ${nullCount} records without organization_id`,
        );
      }
    }

    console.log(`\n✅ Verification complete: All resources have organization assignment`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Get IDs for rollback
    const [orgIdResult] = await queryRunner.query(`
      SELECT value FROM migration_metadata WHERE key = 'default_organization_id'
    `);
    const defaultOrgId = orgIdResult.value;

    const [userIdResult] = await queryRunner.query(`
      SELECT value FROM migration_metadata WHERE key = 'system_user_id'
    `);
    const systemUserId = userIdResult.value;

    console.log(`\n🔄 Rolling back ownership assignment...`);

    for (const tableName of this.resourceTables) {
      try {
        // Revert to NULL for resources assigned to default org by migration
        await queryRunner.query(`
          UPDATE ${tableName}
          SET
            organization_id = NULL,
            created_by = CASE
              WHEN created_by = '${systemUserId}' THEN NULL
              ELSE created_by
            END,
            updated_by = NULL
          WHERE organization_id = '${defaultOrgId}'
            AND updated_by = '${systemUserId}'
        `);

        console.log(`✅ ${tableName}: ownership reverted`);
      } catch (error) {
        console.error(`❌ Error reverting ${tableName}:`, error.message);
      }
    }

    console.log(`\n✅ Rollback complete`);
  }
}
```

**Verification**:
- [ ] All resources have organization_id assigned
- [ ] All resources have created_by assigned
- [ ] No records left with NULL ownership
- [ ] Rollback reverts changes correctly

---

### Step 4: Enforce Ownership Constraints (Week 2, Days 1-3)

#### 4.1 Migration: Add NOT NULL Constraints

**File**: `database/migrations/YYYYMMDDHHMMSS-enforce-ownership-constraints.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceOwnershipConstraints1234567893 implements MigrationInterface {
  private resourceTables = [
    'test_runs',
    'benchmarks',
    'systems_under_test',
    'profiles',
    'test_environments',
    'workload_types',
    'grafana_dashboards',
    'grafana_instances',
    'application_dashboard_configs',
    'tracing_instances',
    'tracing_services',
    'pyroscope_instances',
    'dynatrace_configurations',
    'dynatrace_entity_mappings',
    'dynatrace_usql_queries',
    'reports',
    'report_templates',
    'api_keys',
    'notification_channels',
    'graph_presets',
    'trends_presets',
    'compare_presets',
    'deep_links',
    'url_patterns',
    'expected_config_changes',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log(`\n🔒 Enforcing ownership constraints...\n`);

    for (const tableName of this.resourceTables) {
      try {
        // Pre-check: Verify no NULL values exist
        const [nullOrgCheck] = await queryRunner.query(`
          SELECT COUNT(*) as count FROM ${tableName}
          WHERE organization_id IS NULL
        `);

        if (parseInt(nullOrgCheck.count, 10) > 0) {
          throw new Error(
            `Cannot add NOT NULL constraint: ${tableName} has ${nullOrgCheck.count} records with NULL organization_id`,
          );
        }

        const [nullCreatedByCheck] = await queryRunner.query(`
          SELECT COUNT(*) as count FROM ${tableName}
          WHERE created_by IS NULL
        `);

        if (parseInt(nullCreatedByCheck.count, 10) > 0) {
          throw new Error(
            `Cannot add NOT NULL constraint: ${tableName} has ${nullCreatedByCheck.count} records with NULL created_by`,
          );
        }

        // Add NOT NULL constraints
        await queryRunner.query(`
          ALTER TABLE ${tableName}
          ALTER COLUMN organization_id SET NOT NULL
        `);

        await queryRunner.query(`
          ALTER TABLE ${tableName}
          ALTER COLUMN created_by SET NOT NULL
        `);

        console.log(`✅ ${tableName}: NOT NULL constraints added`);
      } catch (error) {
        console.error(`❌ Error constraining ${tableName}:`, error.message);
        throw error;
      }
    }

    console.log(`\n✅ All ownership constraints enforced`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log(`\n🔓 Removing ownership constraints...\n`);

    for (const tableName of this.resourceTables) {
      try {
        // Remove NOT NULL constraints
        await queryRunner.query(`
          ALTER TABLE ${tableName}
          ALTER COLUMN organization_id DROP NOT NULL
        `);

        await queryRunner.query(`
          ALTER TABLE ${tableName}
          ALTER COLUMN created_by DROP NOT NULL
        `);

        console.log(`✅ ${tableName}: constraints removed`);
      } catch (error) {
        console.error(`❌ Error removing constraints from ${tableName}:`, error.message);
      }
    }

    console.log(`\n✅ All constraints removed`);
  }
}
```

**Verification**:
- [ ] All resource tables have NOT NULL on organization_id
- [ ] All resource tables have NOT NULL on created_by
- [ ] No inserts possible without ownership
- [ ] Rollback removes constraints successfully

---

#### 4.2 Migration: Add Foreign Key Constraints

**File**: `database/migrations/YYYYMMDDHHMMSS-add-ownership-foreign-keys.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOwnershipForeignKeys1234567894 implements MigrationInterface {
  private resourceTables = [
    'test_runs',
    'benchmarks',
    'systems_under_test',
    // ... all resource tables
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log(`\n🔗 Adding foreign key constraints...\n`);

    for (const tableName of this.resourceTables) {
      try {
        // Add foreign key to organizations table
        await queryRunner.query(`
          ALTER TABLE ${tableName}
          ADD CONSTRAINT fk_${tableName}_organization
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE RESTRICT
        `);

        console.log(`✅ ${tableName}: foreign key to organizations added`);
      } catch (error) {
        console.error(`❌ Error adding FK to ${tableName}:`, error.message);
        throw error;
      }
    }

    console.log(`\n✅ All foreign key constraints added`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log(`\n🔓 Removing foreign key constraints...\n`);

    for (const tableName of this.resourceTables) {
      try {
        await queryRunner.query(`
          ALTER TABLE ${tableName}
          DROP CONSTRAINT IF EXISTS fk_${tableName}_organization
        `);

        console.log(`✅ ${tableName}: foreign key removed`);
      } catch (error) {
        console.error(`❌ Error removing FK from ${tableName}:`, error.message);
      }
    }

    console.log(`\n✅ All foreign key constraints removed`);
  }
}
```

**Verification**:
- [ ] Foreign key constraints added
- [ ] Cannot delete organization with resources (RESTRICT works)
- [ ] Cannot insert resource with invalid organization_id
- [ ] Rollback removes constraints

---

### Step 5: Update Entity Files (Week 2, Days 4-5)

#### 5.1 Update OwnedResource Interface

**File**: `packages/shared/src/entities/owned-resource.interface.ts`

```typescript
// Before (from Phase 3):
export interface OwnedResource {
  created_by?: string;
  updated_by?: string;
  organization_id?: string;
  team_id?: string;
  created_at: Date;
  updated_at: Date;
}

// After (Phase 4 - enforce required fields):
export interface OwnedResource {
  /** User ID who created the resource (required) */
  created_by: string;
  /** User ID who last updated the resource */
  updated_by?: string;
  /** Organization this resource belongs to (required) */
  organization_id: string;
  /** Team this resource belongs to (optional) */
  team_id?: string;
  created_at: Date;
  updated_at: Date;
}
```

**Verification**:
- [ ] TypeScript compilation passes
- [ ] Required fields enforced at type level
- [ ] All entity classes updated

---

### Step 6: Update Services to Enforce Organization (Week 2, Days 5-7)

#### 6.1 Update AuthorizedBaseService

**File**: `apps/api/src/common/services/authorized-base.service.ts`

Update `assignOwnership` method to require organization:

```typescript
// Before:
protected assignOwnership(
  entity: Partial<T>,
  userId: string,
  orgId?: string,
  teamId?: string,
): Partial<T> {
  return {
    ...entity,
    created_by: userId,
    updated_by: userId,
    organization_id: orgId,
    team_id: teamId,
  };
}

// After:
protected assignOwnership(
  entity: Partial<T>,
  userId: string,
  orgId: string, // Now required
  teamId?: string,
): Partial<T> {
  if (!orgId) {
    throw new Error('Organization ID is required for resource creation');
  }

  return {
    ...entity,
    created_by: userId,
    updated_by: userId,
    organization_id: orgId,
    team_id: teamId,
  };
}
```

**Verification**:
- [ ] Method signature updated
- [ ] Error thrown if orgId not provided
- [ ] All service call sites updated
- [ ] Tests pass

---

#### 6.2 Update Controllers to Require Organization

Update all controllers to ensure organization is always provided:

```typescript
// Before (Phase 3):
@Post()
async create(@Body() dto: CreateDto, @UserCtx() ctx: UserContext) {
  const orgId = ctx.organizationId ||
    await this.service['getDefaultOrganization'](ctx.userId);
  return this.service.create(dto, ctx.userId, orgId);
}

// After (Phase 4):
@Post()
async create(@Body() dto: CreateDto, @UserCtx() ctx: UserContext) {
  if (!ctx.organizationId) {
    throw new BadRequestException(
      'User must belong to an organization to create resources'
    );
  }
  return this.service.create(dto, ctx.userId, ctx.organizationId);
}
```

**Verification**:
- [ ] All controllers updated
- [ ] Clear error messages for users without organization
- [ ] API tests updated

---

### Step 7: Post-Migration Validation (Week 3, Day 1)

#### 7.1 Validation Script

**File**: `database/scripts/validate-ownership-migration.ts`

```typescript
import { DataSource } from 'typeorm';
import { dataSource } from '../data-source';

async function validateOwnershipMigration(): Promise<void> {
  await dataSource.initialize();

  const resourceTables = [
    // ... all resource tables
  ];

  console.log('========================================');
  console.log('RBAC Phase 4 Validation');
  console.log('========================================\n');

  let allValid = true;

  for (const tableName of resourceTables) {
    // Check for NULL organization_id
    const [nullOrgResult] = await dataSource.query(`
      SELECT COUNT(*) as count FROM ${tableName}
      WHERE organization_id IS NULL
    `);

    const nullOrgCount = parseInt(nullOrgResult.count, 10);
    if (nullOrgCount > 0) {
      console.error(`❌ ${tableName}: ${nullOrgCount} records with NULL organization_id`);
      allValid = false;
    } else {
      console.log(`✅ ${tableName}: All records have organization_id`);
    }

    // Check for NULL created_by
    const [nullCreatedByResult] = await dataSource.query(`
      SELECT COUNT(*) as count FROM ${tableName}
      WHERE created_by IS NULL
    `);

    const nullCreatedByCount = parseInt(nullCreatedByResult.count, 10);
    if (nullCreatedByCount > 0) {
      console.error(`❌ ${tableName}: ${nullCreatedByCount} records with NULL created_by`);
      allValid = false;
    }

    // Verify foreign key constraint exists
    const [constraintResult] = await dataSource.query(`
      SELECT COUNT(*) as count
      FROM information_schema.table_constraints
      WHERE table_name = '${tableName}'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'fk_${tableName}_organization'
    `);

    const hasFK = parseInt(constraintResult.count, 10) > 0;
    if (!hasFK) {
      console.error(`❌ ${tableName}: Missing foreign key constraint`);
      allValid = false;
    }
  }

  console.log('\n========================================');
  if (allValid) {
    console.log('✅ All validation checks passed!');
  } else {
    console.log('❌ Validation failed - migration incomplete');
    process.exit(1);
  }
  console.log('========================================');

  await dataSource.destroy();
}

validateOwnershipMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Validation failed:', error);
    process.exit(1);
  });
```

**Verification**:
- [ ] All resources have organization_id
- [ ] All resources have created_by
- [ ] All foreign keys in place
- [ ] No constraint violations

---

## Migration Execution Strategy

### Staged Rollout

**Stage 1: Development/Staging** (Week 1)
1. Run audit script
2. Create full backup
3. Execute migrations 1-2 (default org, system user)
4. Execute migration 3 (assign ownership)
5. Validate data
6. Test application thoroughly

**Stage 2: Pre-Production** (Week 2, Days 1-3)
1. Apply constraints (migrations 4-5)
2. Run validation script
3. Test all CRUD operations
4. Performance testing

**Stage 3: Production** (Week 2, Days 4-7)
1. Maintenance window announcement
2. Full production backup
3. Execute all migrations
4. Validation
5. Monitor for issues

### Rollback Procedure

If issues occur:

```bash
# Step 1: Stop application
systemctl stop perfana-api

# Step 2: Revert migrations (in reverse order)
npm run migration:revert  # Revert migration 5
npm run migration:revert  # Revert migration 4
npm run migration:revert  # Revert migration 3
npm run migration:revert  # Revert migration 2
npm run migration:revert  # Revert migration 1

# Step 3: Or restore from backup
pg_restore -d perfana_db backups/pre-phase4-*.sql

# Step 4: Restart application
systemctl start perfana-api
```

---

## Success Criteria

### Data Integrity
- [ ] 100% of resources have organization_id
- [ ] 100% of resources have created_by
- [ ] 0 constraint violations
- [ ] 0 orphaned resources

### Application Functionality
- [ ] All CRUD operations work
- [ ] Authorization checks pass
- [ ] No 500 errors from missing organization
- [ ] API tests pass (100%)
- [ ] E2E tests pass (100%)

### Performance
- [ ] Query performance maintained (<200ms p95)
- [ ] Foreign key lookups cached
- [ ] No N+1 query issues
- [ ] Database CPU <80%

### Backward Compatibility
- [ ] Existing API contracts work
- [ ] No breaking changes to responses
- [ ] Error messages clear and actionable

---

## Risk Mitigation

### Data Loss Risk
**Mitigation**:
- Full database backup before migration
- Test restore verified
- Migration rollback scripts tested
- Staging environment validation

### Application Downtime
**Mitigation**:
- Migrations can run with app online (add columns first)
- Only constraints require brief downtime
- Maintenance window scheduled
- Quick rollback procedure

### Constraint Violations
**Mitigation**:
- Pre-migration validation
- Batch processing with logging
- Dry-run mode for migrations
- Post-migration validation

### Orphaned Data
**Mitigation**:
- Foreign keys use RESTRICT (not CASCADE)
- Default organization cannot be deleted
- Validation checks after migration

---

## Monitoring & Alerting

### During Migration
- Monitor slow query log
- Track migration progress
- Alert on errors
- Validate incrementally

### Post-Migration
- Monitor 500 errors
- Track constraint violations
- Alert on foreign key errors
- Dashboard for ownership metrics

---

## Next Steps After Phase 4

**Phase 5**: Advanced Features & Hardening (3-4 weeks)
- PostgreSQL Row-Level Security policies
- Comprehensive audit logging
- Performance optimization and monitoring
- Real-time permission updates via WebSocket
- Security audit and penetration testing

---

## Appendix: Migration Checklist

### Pre-Migration
- [ ] Code reviewed and approved
- [ ] Staging environment tested
- [ ] Database backup created and verified
- [ ] Rollback procedure tested
- [ ] Team trained on new requirements
- [ ] Maintenance window scheduled
- [ ] Stakeholders notified

### Migration Execution
- [ ] Audit script executed
- [ ] Migration 1: Default organization created
- [ ] Migration 2: System user registered
- [ ] Migration 3: Ownership assigned
- [ ] Migration 4: NOT NULL constraints added
- [ ] Migration 5: Foreign keys added
- [ ] Validation script passed

### Post-Migration
- [ ] Application started successfully
- [ ] API tests passing
- [ ] E2E tests passing
- [ ] No errors in logs
- [ ] Performance metrics acceptable
- [ ] User acceptance testing complete
- [ ] Documentation updated
- [ ] Team notified of completion

---

**Total Estimated Effort**: 2-3 weeks
**Risk Level**: Medium (database constraints, potential downtime)
**Impact**: Critical (enforces data integrity, enables multi-tenancy)
