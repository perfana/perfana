# RBAC Phase 5 Implementation Plan: Row-Level Security, Audit Logging & Hardening

## Overview

**Goal**: Add defense-in-depth security with PostgreSQL RLS policies, comprehensive audit logging, and system hardening.

**Dependencies**:
- Phase 1 (RolesGuard, role constants, admin endpoint protection) ✅ Complete
- Phase 2 (Membership infrastructure, ownership tracking, AuthorizationService) ✅ Complete
- Phase 3 (Service-layer authorization enforcement) ✅ Complete
- Phase 4 (Data migration, ownership constraints) ✅ Complete

**Estimated Time**: 3-4 weeks

**Key Deliverables**:
1. PostgreSQL Row-Level Security (RLS) policies for defense-in-depth
2. Comprehensive audit logging system
3. Performance optimization and caching enhancements
4. Security hardening and penetration testing
5. Real-time permission updates (optional)
6. Documentation and operational runbooks

---

## Phase 4 Implementation Review

### Files Created/Modified in Phase 4

**Database Migrations (5 files)**:
1. `1776000000000-CreateDefaultOrganization.ts` - Created default org with well-known UUID
2. `1776000000001-RegisterSystemUser.ts` - Registered system user for legacy data
3. `1776000000002-AssignResourceOwnership.ts` - Batch ownership assignment to 25 tables
4. `1776000000003-EnforceOwnershipConstraints.ts` - Added NOT NULL constraints
5. `1776000000004-AddOwnershipForeignKeys.ts` - Added foreign key constraints

**Validation Scripts (2 files)**:
1. `audit-ownership-status.ts` - Pre-migration audit of ownership data
2. `validate-ownership-migration.ts` - Post-migration validation (648 lines)

**Controllers Updated (20+ files)**:
- All CREATE endpoints now check `ctx.organizationId` and throw `BadRequestException` if missing
- Clear error messages: "User must belong to an organization to create resources"

**Core Services Updated**:
- `AuthorizedBaseService.assignOwnership()` - Now requires organization_id (no longer optional)
- `OwnedResource` interface - organization_id and created_by are now required fields

**Statistics**:
- **36 files changed**
- **3,860 insertions**
- **1,009 deletions**

### Key Achievements

1. **Complete Data Migration**: All 25 resource tables have ownership assigned
2. **Database Constraints**: NOT NULL and foreign key constraints enforce data integrity
3. **Application Enforcement**: Controllers reject requests without organization
4. **Audit Trail**: All resources track who created them
5. **No Legacy Data**: All orphaned resources assigned to default organization

---

## Phase 5 Scope

### What's Included
- ✅ PostgreSQL Row-Level Security (RLS) policies
- ✅ Comprehensive audit logging for all CRUD operations
- ✅ Performance optimization (query tuning, caching)
- ✅ Security hardening (rate limiting, SQL injection prevention)
- ✅ Monitoring and alerting for authorization failures
- ✅ Security audit and penetration testing

### What's NOT Included (Future Work)
- ❌ Real-time WebSocket permission updates (could be Phase 6)
- ❌ Advanced analytics on audit logs (separate project)
- ❌ GDPR compliance features (separate project)
- ❌ Data retention policies (separate project)

---

## Implementation Steps

### Step 1: PostgreSQL Row-Level Security (Week 1)

#### 1.1 Understanding RLS in Perfana Context

**Challenge**: Perfana uses Keycloak JWT tokens for organization membership, not database tables.

**RLS Session Variable Strategy**:
- Middleware sets PostgreSQL session variables before each request
- RLS policies read these session variables to filter data
- Session variables cleared after each transaction

#### 1.2 Migration: Enable RLS on Resource Tables

**File**: `packages/shared/src/database/migrations/1776000000005-EnableRowLevelSecurity.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enable Row-Level Security Migration
 *
 * This migration enables RLS on all 25 resource tables to provide
 * defense-in-depth security at the database level.
 *
 * RLS complements application-level authorization by:
 * - Preventing accidental data leaks from bugs
 * - Protecting against SQL injection attacks
 * - Ensuring data isolation even if application logic is bypassed
 *
 * This migration is part of RBAC Phase 5: Security Hardening
 */
export class EnableRowLevelSecurity1776000000005 implements MigrationInterface {
  name = 'EnableRowLevelSecurity1776000000005';

  private readonly resourceTables = [
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
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('🔒 Running migration: Enable Row-Level Security...');

    // Enable RLS on each resource table
    for (const table of this.resourceTables) {
      console.log(`  🔐 Enabling RLS on ${table}...`);

      await queryRunner.query(`
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY
      `);

      console.log(`  ✅ RLS enabled on ${table}`);
    }

    console.log('✅ Migration complete: RLS enabled on all resource tables');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log('🔓 Reverting migration: Disable Row-Level Security...');

    // Disable RLS on each resource table
    for (const table of this.resourceTables) {
      console.log(`  🔓 Disabling RLS on ${table}...`);

      await queryRunner.query(`
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY
      `);

      console.log(`  ✅ RLS disabled on ${table}`);
    }

    console.log('✅ Rollback complete: RLS disabled on all resource tables');
  }
}
```

**Verification**:
- [ ] RLS enabled on all 25 resource tables
- [ ] No queries break (RLS only enabled, no policies yet)
- [ ] Performance unchanged

---

#### 1.3 Migration: Create RLS Helper Functions

**File**: `packages/shared/src/database/migrations/1776000000006-CreateRLSHelpers.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create RLS Helper Functions Migration
 *
 * This migration creates PostgreSQL functions that RLS policies
 * use to check user permissions based on session variables.
 *
 * Session variables set by middleware:
 * - perfana.current_user_id: User's Keycloak sub or api-key:{id}
 * - perfana.current_user_roles: JSON array of user's roles
 * - perfana.current_user_organizations: JSON array of organization IDs
 * - perfana.current_user_teams: JSON array of team IDs
 */
export class CreateRLSHelpers1776000000006 implements MigrationInterface {
  name = 'CreateRLSHelpers1776000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('🚀 Running migration: Create RLS helper functions...');

    // Function: Check if current user is a global admin
    console.log('  📝 Creating is_global_admin() function...');
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION is_global_admin()
      RETURNS BOOLEAN AS $$
      DECLARE
        user_roles TEXT;
      BEGIN
        -- Get current user's roles from session variable
        user_roles := current_setting('perfana.current_user_roles', true);

        -- Check if user has global admin role
        RETURN user_roles IS NOT NULL AND (
          user_roles LIKE '%super-admin%' OR
          user_roles LIKE '%system-admin%'
        );
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    `);

    // Function: Get current user's organization IDs
    console.log('  📝 Creating current_user_organizations() function...');
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION current_user_organizations()
      RETURNS TEXT[] AS $$
      DECLARE
        orgs_json TEXT;
        orgs TEXT[];
      BEGIN
        -- Get organizations from session variable
        orgs_json := current_setting('perfana.current_user_organizations', true);

        IF orgs_json IS NULL OR orgs_json = '' THEN
          RETURN ARRAY[]::TEXT[];
        END IF;

        -- Parse JSON array to PostgreSQL array
        SELECT ARRAY(
          SELECT jsonb_array_elements_text(orgs_json::jsonb)
        ) INTO orgs;

        RETURN orgs;
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    `);

    // Function: Get current user's team IDs
    console.log('  📝 Creating current_user_teams() function...');
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION current_user_teams()
      RETURNS TEXT[] AS $$
      DECLARE
        teams_json TEXT;
        teams TEXT[];
      BEGIN
        -- Get teams from session variable
        teams_json := current_setting('perfana.current_user_teams', true);

        IF teams_json IS NULL OR teams_json = '' THEN
          RETURN ARRAY[]::TEXT[];
        END IF;

        -- Parse JSON array to PostgreSQL array
        SELECT ARRAY(
          SELECT jsonb_array_elements_text(teams_json::jsonb)
        ) INTO teams;

        RETURN teams;
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    `);

    // Function: Get current user ID
    console.log('  📝 Creating current_user_id() function...');
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION current_user_id()
      RETURNS TEXT AS $$
      BEGIN
        RETURN current_setting('perfana.current_user_id', true);
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    `);

    // Function: Check if user can access resource
    console.log('  📝 Creating can_access_resource() function...');
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION can_access_resource(resource_org_id UUID)
      RETURNS BOOLEAN AS $$
      BEGIN
        -- Global admins can access everything
        IF is_global_admin() THEN
          RETURN true;
        END IF;

        -- User must be member of resource's organization
        RETURN resource_org_id::TEXT = ANY(current_user_organizations());
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    `);

    // Function: Check if user can modify resource
    console.log('  📝 Creating can_modify_resource() function...');
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION can_modify_resource(
        resource_org_id UUID,
        resource_created_by TEXT
      )
      RETURNS BOOLEAN AS $$
      DECLARE
        user_id TEXT;
      BEGIN
        -- Global admins can modify everything
        IF is_global_admin() THEN
          RETURN true;
        END IF;

        user_id := current_user_id();

        -- Owner can modify their own resources
        IF resource_created_by = user_id THEN
          RETURN true;
        END IF;

        -- Org admin can modify anything in their org
        -- (This would require additional org_admin check - simplified for now)
        RETURN resource_org_id::TEXT = ANY(current_user_organizations());
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    `);

    console.log('✅ Migration complete: RLS helper functions created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log('🔄 Reverting migration: Drop RLS helper functions...');

    await queryRunner.query(`DROP FUNCTION IF EXISTS can_modify_resource(UUID, TEXT)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS can_access_resource(UUID)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS current_user_id()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS current_user_teams()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS current_user_organizations()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS is_global_admin()`);

    console.log('✅ Rollback complete: RLS helper functions dropped');
  }
}
```

**Verification**:
- [ ] All helper functions created
- [ ] Functions are SECURITY DEFINER
- [ ] Functions are STABLE (cacheable)
- [ ] Manual testing with SET commands

---

#### 1.4 Migration: Create RLS Policies

**File**: `packages/shared/src/database/migrations/1776000000007-CreateRLSPolicies.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create RLS Policies Migration
 *
 * This migration creates Row-Level Security policies for all resource tables.
 *
 * Policies created:
 * 1. SELECT policy - Users can read resources in their organizations
 * 2. INSERT policy - Users can create resources in their organizations
 * 3. UPDATE policy - Users can modify resources they own or org resources
 * 4. DELETE policy - Users can delete resources they own or org resources
 *
 * All policies have global admin bypass.
 */
export class CreateRLSPolicies1776000000007 implements MigrationInterface {
  name = 'CreateRLSPolicies1776000000007';

  private readonly resourceTables = [
    'test_runs',
    'benchmarks',
    'systems_under_test',
    // ... all 25 tables
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('🚀 Running migration: Create RLS policies...');

    for (const table of this.resourceTables) {
      console.log(`  📝 Creating policies for ${table}...`);

      // SELECT policy - Read access for organization members
      await queryRunner.query(`
        CREATE POLICY ${table}_select_policy ON ${table}
        FOR SELECT
        USING (can_access_resource(organization_id))
      `);

      // INSERT policy - Can create in their organizations
      await queryRunner.query(`
        CREATE POLICY ${table}_insert_policy ON ${table}
        FOR INSERT
        WITH CHECK (
          organization_id::TEXT = ANY(current_user_organizations())
        )
      `);

      // UPDATE policy - Can modify owned or org resources
      await queryRunner.query(`
        CREATE POLICY ${table}_update_policy ON ${table}
        FOR UPDATE
        USING (can_modify_resource(organization_id, created_by))
        WITH CHECK (can_modify_resource(organization_id, created_by))
      `);

      // DELETE policy - Can delete owned or org resources
      await queryRunner.query(`
        CREATE POLICY ${table}_delete_policy ON ${table}
        FOR DELETE
        USING (can_modify_resource(organization_id, created_by))
      `);

      console.log(`  ✅ Policies created for ${table}`);
    }

    console.log('✅ Migration complete: RLS policies created for all tables');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log('🔄 Reverting migration: Drop RLS policies...');

    for (const table of this.resourceTables) {
      console.log(`  🗑️  Dropping policies for ${table}...`);

      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_delete_policy ON ${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_update_policy ON ${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_insert_policy ON ${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_select_policy ON ${table}`);

      console.log(`  ✅ Policies dropped for ${table}`);
    }

    console.log('✅ Rollback complete: RLS policies dropped');
  }
}
```

**Verification**:
- [ ] Policies created for all 25 tables
- [ ] SELECT queries respect organization boundaries
- [ ] INSERT requires valid organization membership
- [ ] UPDATE/DELETE check ownership

---

#### 1.5 Create RLS Middleware

**File**: `apps/api/src/common/middleware/rls-session.middleware.ts`

```typescript
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { KeycloakEnhancedAuthGuard } from '../../guards/keycloak-enhanced-auth.guard';

/**
 * RLS Session Middleware
 *
 * Sets PostgreSQL session variables before each request to enable
 * Row-Level Security policies to filter data based on user context.
 *
 * Session variables set:
 * - perfana.current_user_id: User's Keycloak sub or api-key:{id}
 * - perfana.current_user_roles: JSON array of roles
 * - perfana.current_user_organizations: JSON array of org IDs
 * - perfana.current_user_teams: JSON array of team IDs
 */
@Injectable()
export class RLSSessionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RLSSessionMiddleware.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Skip if not authenticated (public endpoints)
    if (!req.user) {
      return next();
    }

    try {
      // Extract user context
      const userId = KeycloakEnhancedAuthGuard.getUserId(req);
      const roles = KeycloakEnhancedAuthGuard.getRoles(req);
      const organizations = req.user.organizations || [];
      const teams = req.user.teams || [];

      // Set session variables for RLS
      await this.dataSource.query(`SET LOCAL perfana.current_user_id = $1`, [userId]);
      await this.dataSource.query(`SET LOCAL perfana.current_user_roles = $1`, [
        JSON.stringify(roles),
      ]);
      await this.dataSource.query(`SET LOCAL perfana.current_user_organizations = $1`, [
        JSON.stringify(organizations),
      ]);
      await this.dataSource.query(`SET LOCAL perfana.current_user_teams = $1`, [
        JSON.stringify(teams),
      ]);

      this.logger.debug(
        `RLS session variables set for user ${userId} ` +
        `(orgs: ${organizations.length}, teams: ${teams.length})`,
      );
    } catch (error) {
      this.logger.error(`Failed to set RLS session variables: ${error.message}`);
      // Don't block the request - application-level auth is still enforced
    }

    next();
  }
}
```

**Register Middleware** in `apps/api/src/app.module.ts`:
```typescript
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RLSSessionMiddleware)
      .forRoutes('*'); // Apply to all routes
  }
}
```

**Verification**:
- [ ] Middleware sets session variables correctly
- [ ] Session variables cleared after transaction
- [ ] No performance degradation
- [ ] RLS policies correctly filter data

---

### Step 2: Comprehensive Audit Logging (Week 2)

#### 2.1 Create Audit Log Schema

**File**: `packages/shared/src/database/migrations/1776000000008-CreateAuditLogTable.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAuditLogTable1776000000008 implements MigrationInterface {
  name = 'CreateAuditLogTable1776000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('🚀 Running migration: Create audit log table...');

    await queryRunner.createTable(
      new Table({
        name: 'audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'timestamp',
            type: 'timestamp with time zone',
            default: 'NOW()',
          },
          {
            name: 'user_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
            comment: 'User who performed the action',
          },
          {
            name: 'user_email',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'organization_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'action',
            type: 'varchar',
            length: '50',
            isNullable: false,
            comment: 'Action type: CREATE, UPDATE, DELETE, ACCESS, ACCESS_DENIED',
          },
          {
            name: 'resource_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
            comment: 'Type of resource affected',
          },
          {
            name: 'resource_id',
            type: 'uuid',
            isNullable: true,
            comment: 'ID of the affected resource',
          },
          {
            name: 'resource_name',
            type: 'varchar',
            length: '500',
            isNullable: true,
            comment: 'Name/identifier of the resource',
          },
          {
            name: 'changes',
            type: 'jsonb',
            isNullable: true,
            comment: 'Before/after values for updates',
          },
          {
            name: 'metadata',
            type: 'jsonb',
            default: "'{}'::jsonb",
            comment: 'Additional context (IP, user agent, etc.)',
          },
          {
            name: 'success',
            type: 'boolean',
            default: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'ip_address',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'user_agent',
            type: 'text',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Indexes for performance
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_timestamp',
        columnNames: ['timestamp'],
      }),
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_resource',
        columnNames: ['resource_type', 'resource_id'],
      }),
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_action',
        columnNames: ['action'],
      }),
    );

    // Composite index for common query patterns
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_org_timestamp',
        columnNames: ['organization_id', 'timestamp'],
      }),
    );

    console.log('✅ Migration complete: Audit log table created');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('audit_logs');
  }
}
```

**Verification**:
- [ ] Table created with all columns
- [ ] Indexes created for performance
- [ ] JSONB columns for flexible metadata

---

#### 2.2 Create Audit Log Entity & Service

**File**: `packages/shared/src/entities/audit-log.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  ACCESS = 'ACCESS',
  ACCESS_DENIED = 'ACCESS_DENIED',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
}

@Entity('audit_logs')
@Index(['timestamp'])
@Index(['user_id'])
@Index(['organization_id'])
@Index(['resource_type', 'resource_id'])
@Index(['organization_id', 'timestamp'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  timestamp: Date;

  @Column('varchar', { length: 255 })
  user_id: string;

  @Column('varchar', { length: 255, nullable: true })
  user_email?: string;

  @Column('uuid', { nullable: true })
  organization_id?: string;

  @Column('varchar', { length: 50 })
  action: AuditAction;

  @Column('varchar', { length: 100 })
  resource_type: string;

  @Column('uuid', { nullable: true })
  resource_id?: string;

  @Column('varchar', { length: 500, nullable: true })
  resource_name?: string;

  @Column('jsonb', { nullable: true })
  changes?: Record<string, any>;

  @Column('jsonb', { default: {} })
  metadata: Record<string, any>;

  @Column('boolean', { default: true })
  success: boolean;

  @Column('text', { nullable: true })
  error_message?: string;

  @Column('varchar', { length: 45, nullable: true })
  ip_address?: string;

  @Column('text', { nullable: true })
  user_agent?: string;
}
```

**File**: `apps/api/src/modules/audit/audit.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction } from '@perfana/shared/entities';

export interface CreateAuditLogDto {
  userId: string;
  userEmail?: string;
  organizationId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
  success?: boolean;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /**
   * Create an audit log entry
   */
  async log(dto: CreateAuditLogDto): Promise<void> {
    try {
      const auditLog = this.auditRepository.create({
        user_id: dto.userId,
        user_email: dto.userEmail,
        organization_id: dto.organizationId,
        action: dto.action,
        resource_type: dto.resourceType,
        resource_id: dto.resourceId,
        resource_name: dto.resourceName,
        changes: dto.changes,
        metadata: dto.metadata || {},
        success: dto.success !== false,
        error_message: dto.errorMessage,
        ip_address: dto.ipAddress,
        user_agent: dto.userAgent,
      });

      // Fire and forget - don't block the request
      this.auditRepository.save(auditLog).catch((error) => {
        this.logger.error(`Failed to save audit log: ${error.message}`);
      });
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${error.message}`);
      // Don't throw - audit logging failure shouldn't break the request
    }
  }

  /**
   * Log successful resource access
   */
  async logAccess(
    userId: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.ACCESS,
      resourceType,
      resourceId,
      metadata,
      success: true,
    });
  }

  /**
   * Log denied access attempt
   */
  async logAccessDenied(
    userId: string,
    resourceType: string,
    resourceId: string,
    reason: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.ACCESS_DENIED,
      resourceType,
      resourceId,
      errorMessage: reason,
      metadata,
      success: false,
    });
  }

  /**
   * Query audit logs for a resource
   */
  async getResourceAuditLog(
    resourceType: string,
    resourceId: string,
    limit: number = 100,
  ): Promise<AuditLog[]> {
    return await this.auditRepository.find({
      where: {
        resource_type: resourceType,
        resource_id: resourceId,
      },
      order: {
        timestamp: 'DESC',
      },
      take: limit,
    });
  }

  /**
   * Query audit logs for a user
   */
  async getUserAuditLog(userId: string, limit: number = 100): Promise<AuditLog[]> {
    return await this.auditRepository.find({
      where: {
        user_id: userId,
      },
      order: {
        timestamp: 'DESC',
      },
      take: limit,
    });
  }

  /**
   * Query audit logs for an organization
   */
  async getOrganizationAuditLog(
    organizationId: string,
    limit: number = 100,
  ): Promise<AuditLog[]> {
    return await this.auditRepository.find({
      where: {
        organization_id: organizationId,
      },
      order: {
        timestamp: 'DESC',
      },
      take: limit,
    });
  }
}
```

**Verification**:
- [ ] Audit log entity created
- [ ] AuditService implemented
- [ ] Fire-and-forget logging (no request blocking)
- [ ] Error handling (logging failures don't break requests)

---

#### 2.3 Create Audit Interceptor

**File**: `apps/api/src/common/interceptors/audit.interceptor.ts`

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';
import { KeycloakEnhancedAuthGuard } from '../../guards/keycloak-enhanced-auth.guard';
import { AuditAction } from '@perfana/shared/entities';

/**
 * Audit Interceptor
 *
 * Automatically logs all CRUD operations for auditing purposes.
 * Extracts user context and request details to create comprehensive audit trail.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;

    // Skip audit for health checks, metrics, etc.
    if (this.shouldSkipAudit(url)) {
      return next.handle();
    }

    // Extract user context
    const userId = KeycloakEnhancedAuthGuard.getUserId(request) || 'anonymous';
    const userEmail = request.user?.email;
    const organizationId = request.user?.organizations?.[0];
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    // Determine action based on HTTP method
    const action = this.getActionFromMethod(method);

    // Extract resource info from URL
    const { resourceType, resourceId } = this.extractResourceInfo(url);

    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        // Log successful operation
        const duration = Date.now() - startTime;
        this.auditService.log({
          userId,
          userEmail,
          organizationId,
          action,
          resourceType,
          resourceId,
          metadata: {
            method,
            url,
            duration,
          },
          success: true,
          ipAddress,
          userAgent,
        });
      }),
      catchError((error) => {
        // Log failed operation
        this.auditService.log({
          userId,
          userEmail,
          organizationId,
          action,
          resourceType,
          resourceId,
          metadata: {
            method,
            url,
            errorCode: error.status,
          },
          success: false,
          errorMessage: error.message,
          ipAddress,
          userAgent,
        });

        return throwError(() => error);
      }),
    );
  }

  private shouldSkipAudit(url: string): boolean {
    const skipPaths = ['/health', '/metrics', '/docs', '/swagger'];
    return skipPaths.some((path) => url.startsWith(path));
  }

  private getActionFromMethod(method: string): AuditAction {
    switch (method.toUpperCase()) {
      case 'POST':
        return AuditAction.CREATE;
      case 'PUT':
      case 'PATCH':
        return AuditAction.UPDATE;
      case 'DELETE':
        return AuditAction.DELETE;
      case 'GET':
      default:
        return AuditAction.ACCESS;
    }
  }

  private extractResourceInfo(url: string): {
    resourceType: string;
    resourceId?: string;
  } {
    // Parse URL to extract resource type and ID
    // Example: /api/test-runs/123 -> { resourceType: 'test-runs', resourceId: '123' }
    const parts = url.split('/').filter(Boolean);
    const resourceType = parts[1] || 'unknown';
    const resourceId = parts[2] && parts[2].match(/^[a-f0-9-]+$/i) ? parts[2] : undefined;

    return { resourceType, resourceId };
  }
}
```

**Register Globally** in `apps/api/src/app.module.ts`:
```typescript
providers: [
  {
    provide: APP_INTERCEPTOR,
    useClass: AuditInterceptor,
  },
]
```

**Verification**:
- [ ] All API calls logged
- [ ] Successful and failed operations tracked
- [ ] User context captured
- [ ] No performance impact (<10ms overhead)

---

### Step 3: Performance Optimization (Week 3, Days 1-3)

#### 3.1 Query Optimization Analysis

**File**: `database/scripts/analyze-query-performance.ts`

```typescript
import { DataSource } from 'typeorm';
import { dataSource } from '../data-source';

/**
 * Query Performance Analysis Script
 *
 * Analyzes slow queries and provides optimization recommendations.
 */
async function analyzeQueryPerformance(): Promise<void> {
  await dataSource.initialize();

  console.log('========================================');
  console.log('Query Performance Analysis');
  console.log('========================================\n');

  // Enable query timing
  await dataSource.query(`SET track_io_timing = ON`);

  // Get slow queries from pg_stat_statements (if enabled)
  console.log('Top 10 Slowest Queries:\n');
  const slowQueries = await dataSource.query(`
    SELECT
      mean_exec_time::numeric(10,2) as avg_ms,
      calls,
      total_exec_time::numeric(10,2) as total_ms,
      LEFT(query, 100) as query_preview
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat_statements%'
    ORDER BY mean_exec_time DESC
    LIMIT 10
  `);

  slowQueries.forEach((q: any, i: number) => {
    console.log(`${i + 1}. Avg: ${q.avg_ms}ms, Calls: ${q.calls}, Total: ${q.total_ms}ms`);
    console.log(`   ${q.query_preview}...\n`);
  });

  // Check index usage
  console.log('\nIndex Usage Analysis:\n');
  const indexUsage = await dataSource.query(`
    SELECT
      schemaname,
      tablename,
      indexname,
      idx_scan,
      idx_tup_read,
      idx_tup_fetch
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
    ORDER BY schemaname, tablename
  `);

  if (indexUsage.length > 0) {
    console.log('⚠️  Unused Indexes (consider dropping):\n');
    indexUsage.forEach((idx: any) => {
      console.log(`  - ${idx.schemaname}.${idx.tablename}.${idx.indexname}`);
    });
  } else {
    console.log('✅ All indexes are being used');
  }

  // Check missing indexes
  console.log('\n\nMissing Index Analysis:\n');
  const missingIndexes = await dataSource.query(`
    SELECT
      schemaname,
      tablename,
      attname,
      n_distinct,
      correlation
    FROM pg_stats
    WHERE schemaname = 'public'
      AND n_distinct > 100
      AND correlation < 0.5
    ORDER BY n_distinct DESC
    LIMIT 20
  `);

  if (missingIndexes.length > 0) {
    console.log('💡 Potential Index Candidates:\n');
    missingIndexes.forEach((col: any) => {
      console.log(`  - ${col.tablename}.${col.attname} (distinct: ${col.n_distinct})`);
    });
  }

  console.log('\n========================================');
  await dataSource.destroy();
}

analyzeQueryPerformance()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Analysis failed:', error);
    process.exit(1);
  });
```

**Verification**:
- [ ] Slow queries identified
- [ ] Unused indexes found
- [ ] Missing index candidates suggested

---

#### 3.2 Add Performance Indexes

Based on analysis, add indexes for common query patterns:

```sql
-- Organization membership lookups (already done in Phase 2)
CREATE INDEX CONCURRENTLY idx_org_members_user_orgs
  ON organization_members(user_id) INCLUDE (organization_id);

-- Audit log queries
CREATE INDEX CONCURRENTLY idx_audit_logs_user_org_time
  ON audit_logs(user_id, organization_id, timestamp DESC);

-- Test run queries with multiple filters
CREATE INDEX CONCURRENTLY idx_test_runs_org_system_env_workload_time
  ON test_runs(organization_id, system_under_test_id, test_environment, workload, created_at DESC);

-- Resource lookup by organization and type
CREATE INDEX CONCURRENTLY idx_resources_org_created
  ON test_runs(organization_id, created_at DESC) WHERE deleted_at IS NULL;
```

---

#### 3.3 Enhanced Caching Strategy

**File**: `apps/api/src/common/services/cache.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  /**
   * Cache organization membership (5 min TTL)
   */
  async cacheOrganizations(userId: string, orgIds: string[]): Promise<void> {
    await this.cacheManager.set(`user:${userId}:orgs`, orgIds, 300000);
  }

  async getOrganizations(userId: string): Promise<string[] | null> {
    return await this.cacheManager.get<string[]>(`user:${userId}:orgs`);
  }

  /**
   * Cache authorization decisions (1 min TTL)
   */
  async cacheAuthDecision(
    key: string,
    canAccess: boolean,
  ): Promise<void> {
    await this.cacheManager.set(`auth:${key}`, canAccess, 60000);
  }

  async getAuthDecision(key: string): Promise<boolean | null> {
    return await this.cacheManager.get<boolean>(`auth:${key}`);
  }

  /**
   * Invalidate user caches on membership change
   */
  async invalidateUserCaches(userId: string): Promise<void> {
    await this.cacheManager.del(`user:${userId}:orgs`);
    await this.cacheManager.del(`user:${userId}:teams`);
    // Invalidate all auth decisions for this user
    const pattern = `auth:${userId}:*`;
    // Implementation depends on cache backend (Redis supports pattern delete)
  }
}
```

**Verification**:
- [ ] Cache hit rate >80%
- [ ] Cache invalidation on membership changes
- [ ] Query performance improved

---

### Step 4: Security Hardening (Week 3, Days 4-5)

#### 4.1 Rate Limiting

**File**: `apps/api/src/common/guards/rate-limit.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

export const RateLimit = Reflector.createDecorator<{
  ttl: number; // Time window in seconds
  limit: number; // Max requests in window
}>();

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rateLimitOptions = this.reflector.get(RateLimit, context.getHandler());

    if (!rateLimitOptions) {
      return true; // No rate limit configured
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub || request.ip;
    const key = `rate-limit:${userId}:${request.url}`;

    const current = await this.redis.incr(key);

    if (current === 1) {
      await this.redis.expire(key, rateLimitOptions.ttl);
    }

    if (current > rateLimitOptions.limit) {
      throw new HttpException(
        `Rate limit exceeded. Max ${rateLimitOptions.limit} requests per ${rateLimitOptions.ttl}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
```

**Usage**:
```typescript
@Post()
@RateLimit({ ttl: 60, limit: 10 }) // 10 requests per minute
async create(@Body() dto: CreateDto) {
  // ...
}
```

---

#### 4.2 SQL Injection Prevention Audit

Run audit to ensure all queries use parameterized queries:

```bash
# Search for potential SQL injection vulnerabilities
grep -r "query(\`" apps/api/src --include="*.ts"
grep -r 'query("' apps/api/src --include="*.ts"
grep -r "query('SELECT" apps/api/src --include="*.ts"
```

---

### Step 5: Monitoring & Alerting (Week 4)

#### 5.1 Authorization Metrics

**File**: `apps/api/src/common/services/metrics.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrometheusService } from '@nestjs/prometheus';

@Injectable()
export class AuthorizationMetricsService {
  private accessDeniedCounter;
  private authCheckDuration;

  constructor(private readonly prometheus: PrometheusService) {
    this.accessDeniedCounter = this.prometheus.registerCounter({
      name: 'perfana_access_denied_total',
      help: 'Total number of access denied events',
      labelNames: ['resource_type', 'action', 'reason'],
    });

    this.authCheckDuration = this.prometheus.registerHistogram({
      name: 'perfana_auth_check_duration_ms',
      help: 'Duration of authorization checks',
      labelNames: ['resource_type'],
      buckets: [1, 5, 10, 20, 50, 100, 200],
    });
  }

  recordAccessDenied(resourceType: string, action: string, reason: string): void {
    this.accessDeniedCounter.inc({ resource_type: resourceType, action, reason });
  }

  recordAuthCheckDuration(resourceType: string, durationMs: number): void {
    this.authCheckDuration.observe({ resource_type: resourceType }, durationMs);
  }
}
```

---

### Step 6: Documentation & Runbooks (Week 4)

#### 6.1 Security Runbook

Create operational documentation:
- How to investigate access denied events
- How to debug RLS policy issues
- How to query audit logs
- How to add users to organizations
- How to handle security incidents

#### 6.2 Performance Runbook

Create performance documentation:
- How to analyze slow queries
- How to add indexes
- How to invalidate caches
- How to monitor RLS overhead

---

## Success Criteria

### Security
- [ ] RLS policies enforce organization boundaries
- [ ] 100% of CRUD operations logged
- [ ] 0 SQL injection vulnerabilities
- [ ] Rate limiting on all endpoints
- [ ] Security audit passed

### Performance
- [ ] RLS overhead <10ms p95
- [ ] Audit logging overhead <5ms p95
- [ ] Cache hit rate >80%
- [ ] Query performance <200ms p95
- [ ] No N+1 queries

### Monitoring
- [ ] Grafana dashboards for auth metrics
- [ ] Alerts for suspicious activity
- [ ] Audit log retention policy
- [ ] Performance regression alerts

---

## Rollback Plan

Each migration can be rolled back independently:
1. Drop RLS policies (migration 7)
2. Drop RLS helper functions (migration 6)
3. Disable RLS (migration 5)
4. Drop audit log table (migration 8)

**RLS can be disabled globally** for emergency:
```sql
ALTER TABLE test_runs DISABLE ROW LEVEL SECURITY;
-- Repeat for all tables
```

---

## Next Steps After Phase 5

**Production Hardening**:
- Load testing with production-like data
- Disaster recovery testing
- Security penetration testing
- Performance benchmarking

**Advanced Features**:
- Real-time WebSocket permission updates
- Advanced audit analytics
- Compliance reporting (SOC 2, GDPR)
- Data retention automation

---

**Total Estimated Effort**: 3-4 weeks
**Risk Level**: Medium (RLS complexity, performance impact)
**Impact**: High (defense-in-depth security, compliance-ready)
