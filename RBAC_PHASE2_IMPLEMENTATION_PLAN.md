# RBAC Phase 2 Implementation Plan: Organization Membership & Ownership Tracking

## Overview

**Goal**: Add organization membership infrastructure and resource ownership tracking to enable multi-tenant authorization.

**Dependencies**: Phase 1 (RolesGuard, role constants, admin endpoint protection) must be complete.

**Estimated Time**: 3-5 weeks

**Key Deliverables**:
1. Database schema for organization/team membership
2. Ownership tracking on all resources (created_by, organization_id)
3. Membership management service
4. Authorization helper service for permission checks
5. Base entity and service patterns for owned resources

---

## Phase 2 Scope

### What's Included
- ✅ Organization membership tables and entities
- ✅ Team membership tables and entities
- ✅ Ownership fields on all resource entities
- ✅ Membership CRUD operations
- ✅ Authorization helper service with caching
- ✅ Base entity pattern for owned resources
- ✅ Database migrations with backward compatibility

### What's NOT Included (Future Phases)
- ❌ Service-layer authorization enforcement (Phase 3)
- ❌ Row-level security policies (Phase 5)
- ❌ Audit logging (Phase 5)
- ❌ Data migration for existing resources (Phase 4)

---

## Implementation Steps

### Step 1: Database Schema Changes (Week 1)

#### 1.1 Create Organization Membership Table

**File**: `database/migrations/YYYYMMDDHHMMSS-create-organization-members.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateOrganizationMembers1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'organization_members',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'organization_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'user_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
            comment: 'Keycloak user sub or api-key:{id}',
          },
          {
            name: 'roles',
            type: 'jsonb',
            default: "'[]'::jsonb",
            comment: 'Organization-level roles: org-admin, org-member, org-viewer',
          },
          {
            name: 'joined_at',
            type: 'timestamp with time zone',
            default: 'NOW()',
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    // Foreign key constraint
    await queryRunner.query(`
      ALTER TABLE organization_members
      ADD CONSTRAINT fk_organization_members_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
      ON DELETE CASCADE
    `);

    // Unique constraint
    await queryRunner.query(`
      ALTER TABLE organization_members
      ADD CONSTRAINT uq_organization_members_org_user
      UNIQUE (organization_id, user_id)
    `);

    // Indexes for performance
    await queryRunner.createIndex(
      'organization_members',
      new TableIndex({
        name: 'idx_org_members_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'organization_members',
      new TableIndex({
        name: 'idx_org_members_org_user',
        columnNames: ['organization_id', 'user_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('organization_members');
  }
}
```

**Verification**:
- [ ] Migration runs without errors
- [ ] Foreign key constraint enforced
- [ ] Unique constraint prevents duplicate memberships
- [ ] Indexes created for performance

---

#### 1.2 Create Team Membership Table

**File**: `database/migrations/YYYYMMDDHHMMSS-create-team-members.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateTeamMembers1234567891 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'team_members',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'team_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'user_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
            comment: 'Keycloak user sub or api-key:{id}',
          },
          {
            name: 'roles',
            type: 'jsonb',
            default: "'[]'::jsonb",
            comment: 'Team-level roles: team-admin, team-member, team-viewer',
          },
          {
            name: 'joined_at',
            type: 'timestamp with time zone',
            default: 'NOW()',
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    // Foreign key constraint
    await queryRunner.query(`
      ALTER TABLE team_members
      ADD CONSTRAINT fk_team_members_team
      FOREIGN KEY (team_id) REFERENCES teams(id)
      ON DELETE CASCADE
    `);

    // Unique constraint
    await queryRunner.query(`
      ALTER TABLE team_members
      ADD CONSTRAINT uq_team_members_team_user
      UNIQUE (team_id, user_id)
    `);

    // Indexes for performance
    await queryRunner.createIndex(
      'team_members',
      new TableIndex({
        name: 'idx_team_members_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'team_members',
      new TableIndex({
        name: 'idx_team_members_team_user',
        columnNames: ['team_id', 'user_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('team_members');
  }
}
```

**Verification**:
- [ ] Migration runs without errors
- [ ] Foreign key constraint enforced
- [ ] Unique constraint prevents duplicate memberships
- [ ] Indexes created for performance

---

#### 1.3 Add Ownership Columns to Resource Tables

**File**: `database/migrations/YYYYMMDDHHMMSS-add-resource-ownership.ts`

```typescript
import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddResourceOwnership1234567892 implements MigrationInterface {
  private resourceTables = [
    'test_runs',
    'benchmarks',
    'systems_under_test',
    'profiles',
    'test_environments',
    'workload_types',
    'grafana_dashboards',
    'grafana_instances',
    'tracing_instances',
    'pyroscope_instances',
    'dynatrace_configurations',
    'reports',
    'api_keys',
    // Add all other resource tables
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of this.resourceTables) {
      // Add ownership columns (nullable for backward compatibility)
      await queryRunner.addColumn(
        tableName,
        new TableColumn({
          name: 'created_by',
          type: 'varchar',
          length: '255',
          isNullable: true,
          comment: 'User ID from Keycloak or api-key:{id}',
        }),
      );

      await queryRunner.addColumn(
        tableName,
        new TableColumn({
          name: 'updated_by',
          type: 'varchar',
          length: '255',
          isNullable: true,
          comment: 'User ID from Keycloak or api-key:{id}',
        }),
      );

      await queryRunner.addColumn(
        tableName,
        new TableColumn({
          name: 'organization_id',
          type: 'uuid',
          isNullable: true,
        }),
      );

      await queryRunner.addColumn(
        tableName,
        new TableColumn({
          name: 'team_id',
          type: 'uuid',
          isNullable: true,
        }),
      );

      // Add indexes for performance
      await queryRunner.createIndex(
        tableName,
        new TableIndex({
          name: `idx_${tableName}_organization_id`,
          columnNames: ['organization_id'],
        }),
      );

      await queryRunner.createIndex(
        tableName,
        new TableIndex({
          name: `idx_${tableName}_created_by`,
          columnNames: ['created_by'],
        }),
      );

      // Composite index for common query pattern
      await queryRunner.createIndex(
        tableName,
        new TableIndex({
          name: `idx_${tableName}_org_created`,
          columnNames: ['organization_id', 'created_at'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of this.resourceTables) {
      await queryRunner.dropIndex(tableName, `idx_${tableName}_org_created`);
      await queryRunner.dropIndex(tableName, `idx_${tableName}_created_by`);
      await queryRunner.dropIndex(tableName, `idx_${tableName}_organization_id`);

      await queryRunner.dropColumn(tableName, 'team_id');
      await queryRunner.dropColumn(tableName, 'organization_id');
      await queryRunner.dropColumn(tableName, 'updated_by');
      await queryRunner.dropColumn(tableName, 'created_by');
    }
  }
}
```

**Verification**:
- [ ] All resource tables have ownership columns
- [ ] Columns are nullable (backward compatible)
- [ ] Indexes created for performance
- [ ] No existing data is broken

---

### Step 2: Create Entities (Week 1-2)

#### 2.1 Organization Member Entity

**File**: `packages/shared/src/entities/organization-member.entity.ts`

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Organization } from './organization.entity';

@Entity('organization_members')
@Unique(['organization_id', 'user_id'])
@Index(['user_id'])
@Index(['organization_id', 'user_id'])
export class OrganizationMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organization_id: string;

  @Column('varchar', { length: 255, comment: 'Keycloak user sub or api-key:{id}' })
  user_id: string;

  @Column('jsonb', {
    default: '[]',
    comment: 'Organization-level roles: org-admin, org-member, org-viewer',
  })
  roles: string[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  joined_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @ManyToOne(() => Organization, (org) => org.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;
}
```

**Export**: Add to `packages/shared/src/entities/index.ts`:
```typescript
export * from './organization-member.entity';
```

**Verification**:
- [ ] Entity compiles without errors
- [ ] Decorators match database schema
- [ ] Relationship with Organization entity defined

---

#### 2.2 Team Member Entity

**File**: `packages/shared/src/entities/team-member.entity.ts`

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Team } from './team.entity';

@Entity('team_members')
@Unique(['team_id', 'user_id'])
@Index(['user_id'])
@Index(['team_id', 'user_id'])
export class TeamMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  team_id: string;

  @Column('varchar', { length: 255, comment: 'Keycloak user sub or api-key:{id}' })
  user_id: string;

  @Column('jsonb', {
    default: '[]',
    comment: 'Team-level roles: team-admin, team-member, team-viewer',
  })
  roles: string[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  joined_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @ManyToOne(() => Team, (team) => team.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;
}
```

**Export**: Add to `packages/shared/src/entities/index.ts`:
```typescript
export * from './team-member.entity';
```

**Verification**:
- [ ] Entity compiles without errors
- [ ] Decorators match database schema
- [ ] Relationship with Team entity defined

---

#### 2.3 Base Owned Entity Pattern

**File**: `packages/shared/src/entities/base/owned-entity.base.ts`

```typescript
import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Base class for entities that support ownership tracking and organization assignment.
 *
 * Usage:
 * @Entity('my_resource')
 * export class MyResource extends OwnedEntity {
 *   // ... resource-specific fields
 * }
 */
export abstract class OwnedEntity {
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'User ID from Keycloak or api-key:{id}',
  })
  created_by?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'User ID from Keycloak or api-key:{id}',
  })
  updated_by?: string;

  @Column({ type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
```

**Export**: Add to `packages/shared/src/entities/index.ts`:
```typescript
export * from './base/owned-entity.base';
```

**Verification**:
- [ ] Base class compiles without errors
- [ ] Fields are optional (backward compatible)
- [ ] Timestamp fields auto-managed by TypeORM

---

#### 2.4 Update Resource Entities to Extend OwnedEntity

**Example**: `packages/shared/src/entities/test-run.entity.ts`

```typescript
// Before:
@Entity('test_runs')
export class TestRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ... existing fields

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

// After:
import { OwnedEntity } from './base/owned-entity.base';

@Entity('test_runs')
export class TestRun extends OwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ... existing fields
  // Remove created_at and updated_at (inherited from OwnedEntity)
}
```

**Entities to Update**:
1. `test-run.entity.ts`
2. `benchmark.entity.ts`
3. `system-under-test.entity.ts`
4. `profile.entity.ts`
5. `test-environment.entity.ts`
6. `workload-type.entity.ts`
7. `grafana-dashboard.entity.ts`
8. `grafana-instance.entity.ts`
9. `tracing-instance.entity.ts`
10. `pyroscope-instance.entity.ts`
11. `dynatrace-configuration.entity.ts`
12. `report.entity.ts`
13. `api-key.entity.ts`
14. All other resource entities (20+ total)

**Verification**:
- [ ] All resource entities extend OwnedEntity
- [ ] No duplicate timestamp fields
- [ ] Type checking passes
- [ ] Existing tests still pass

---

### Step 3: Create Membership Services (Week 2)

#### 3.1 Organization Members Service

**File**: `apps/api/src/modules/organizations/organization-members.service.ts`

```typescript
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationMember, Organization } from '@perfana/shared/entities';

@Injectable()
export class OrganizationMembersService {
  constructor(
    @InjectRepository(OrganizationMember)
    private readonly memberRepository: Repository<OrganizationMember>,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
  ) {}

  /**
   * Add a user to an organization with specified roles
   */
  async addMember(
    orgId: string,
    userId: string,
    roles: string[],
  ): Promise<OrganizationMember> {
    // Verify organization exists
    const org = await this.orgRepository.findOne({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    // Check for existing membership
    const existing = await this.memberRepository.findOne({
      where: { organization_id: orgId, user_id: userId },
    });

    if (existing) {
      throw new ConflictException(
        `User ${userId} is already a member of organization ${orgId}`,
      );
    }

    // Create membership
    const member = this.memberRepository.create({
      organization_id: orgId,
      user_id: userId,
      roles,
    });

    return await this.memberRepository.save(member);
  }

  /**
   * Remove a user from an organization
   */
  async removeMember(orgId: string, userId: string): Promise<void> {
    const member = await this.memberRepository.findOne({
      where: { organization_id: orgId, user_id: userId },
    });

    if (!member) {
      throw new NotFoundException(
        `User ${userId} is not a member of organization ${orgId}`,
      );
    }

    await this.memberRepository.remove(member);
  }

  /**
   * Update a member's roles within an organization
   */
  async updateMemberRoles(
    orgId: string,
    userId: string,
    roles: string[],
  ): Promise<OrganizationMember> {
    const member = await this.memberRepository.findOne({
      where: { organization_id: orgId, user_id: userId },
    });

    if (!member) {
      throw new NotFoundException(
        `User ${userId} is not a member of organization ${orgId}`,
      );
    }

    member.roles = roles;
    member.updated_at = new Date();

    return await this.memberRepository.save(member);
  }

  /**
   * Get all members of an organization
   */
  async getMembers(orgId: string): Promise<OrganizationMember[]> {
    return await this.memberRepository.find({
      where: { organization_id: orgId },
      order: { joined_at: 'ASC' },
    });
  }

  /**
   * Get all organizations a user belongs to
   */
  async getUserOrganizations(userId: string): Promise<Organization[]> {
    const memberships = await this.memberRepository.find({
      where: { user_id: userId },
      relations: ['organization'],
    });

    return memberships.map((m) => m.organization);
  }

  /**
   * Get a user's roles within an organization
   */
  async getUserRoles(orgId: string, userId: string): Promise<string[]> {
    const member = await this.memberRepository.findOne({
      where: { organization_id: orgId, user_id: userId },
    });

    return member?.roles || [];
  }

  /**
   * Check if a user is a member of an organization
   */
  async isMember(orgId: string, userId: string): Promise<boolean> {
    const count = await this.memberRepository.count({
      where: { organization_id: orgId, user_id: userId },
    });

    return count > 0;
  }

  /**
   * Check if a user has org-admin role in an organization
   */
  async isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
    const member = await this.memberRepository.findOne({
      where: { organization_id: orgId, user_id: userId },
    });

    return member?.roles.includes('org-admin') || false;
  }
}
```

**Module**: Update `apps/api/src/modules/organizations/organizations.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization, OrganizationMember } from '@perfana/shared/entities';
import { OrganizationMembersService } from './organization-members.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, OrganizationMember])],
  providers: [OrganizationMembersService],
  exports: [OrganizationMembersService],
})
export class OrganizationsModule {}
```

**Verification**:
- [ ] Service compiles without errors
- [ ] All methods have unit tests
- [ ] Methods handle edge cases (not found, duplicates)
- [ ] Service exported from module

---

#### 3.2 Team Members Service

**File**: `apps/api/src/modules/teams/team-members.service.ts`

Similar structure to OrganizationMembersService. Key methods:
- `addMember(teamId, userId, roles)`
- `removeMember(teamId, userId)`
- `updateMemberRoles(teamId, userId, roles)`
- `getMembers(teamId)`
- `getUserTeams(userId)`
- `getUserRoles(teamId, userId)`
- `isMember(teamId, userId)`
- `isTeamAdmin(teamId, userId)`

**Verification**:
- [ ] Service follows same pattern as OrganizationMembersService
- [ ] All methods have unit tests
- [ ] Service exported from TeamsModule

---

### Step 4: Create Authorization Service (Week 2-3)

#### 4.1 Authorization Helper Service

**File**: `apps/api/src/common/services/authorization.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { OrganizationMembersService } from '../../modules/organizations/organization-members.service';
import { TeamMembersService } from '../../modules/teams/team-members.service';
import { OwnedEntity } from '@perfana/shared/entities';
import { SystemRole } from '../../constants/roles.constants';

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly orgMembersService: OrganizationMembersService,
    private readonly teamMembersService: TeamMembersService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Check if user has global admin role
   */
  isGlobalAdmin(userId: string, roles: string[]): boolean {
    return (
      roles.includes(SystemRole.GLOBAL_ADMIN) ||
      roles.includes(SystemRole.ADMIN)
    );
  }

  /**
   * Check if user has org admin role in an organization
   */
  async isOrgAdmin(userId: string, orgId: string): Promise<boolean> {
    // Global admins are org admins everywhere
    const roles = await this.getUserRoles(userId);
    if (this.isGlobalAdmin(userId, roles)) {
      return true;
    }

    // Check org-specific admin role
    return await this.orgMembersService.isOrgAdmin(orgId, userId);
  }

  /**
   * Check if user can access a resource
   * Returns true if user is global admin OR member of resource's organization
   */
  async canAccessResource(
    userId: string,
    resource: OwnedEntity,
  ): Promise<boolean> {
    // Global admin can access everything
    const roles = await this.getUserRoles(userId);
    if (this.isGlobalAdmin(userId, roles)) {
      return true;
    }

    // Check organization membership
    if (resource.organization_id) {
      return await this.orgMembersService.isMember(
        resource.organization_id,
        userId,
      );
    }

    // Legacy data without organization (allow for backward compatibility)
    return true;
  }

  /**
   * Check if user can modify a resource
   * Returns true if user is:
   * - Global admin
   * - Resource owner (created_by matches userId)
   * - Org admin of resource's organization
   */
  async canModifyResource(
    userId: string,
    resource: OwnedEntity,
  ): Promise<boolean> {
    // Global admin can modify everything
    const roles = await this.getUserRoles(userId);
    if (this.isGlobalAdmin(userId, roles)) {
      return true;
    }

    // Owner can modify their own resources
    if (resource.created_by === userId) {
      return true;
    }

    // Org admin can modify anything in their org
    if (resource.organization_id) {
      return await this.isOrgAdmin(userId, resource.organization_id);
    }

    return false;
  }

  /**
   * Check if user can delete a resource
   * Same logic as canModifyResource for now
   */
  async canDeleteResource(
    userId: string,
    resource: OwnedEntity,
  ): Promise<boolean> {
    return await this.canModifyResource(userId, resource);
  }

  /**
   * Get list of organization IDs a user can access
   * Cached for performance
   */
  async getAccessibleOrganizations(userId: string): Promise<string[]> {
    const cacheKey = `user:${userId}:orgs`;
    const cached = await this.cacheManager.get<string[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const orgs = await this.orgMembersService.getUserOrganizations(userId);
    const orgIds = orgs.map((o) => o.id);

    // Cache for 5 minutes
    await this.cacheManager.set(cacheKey, orgIds, 300000);

    return orgIds;
  }

  /**
   * Get all roles for a user (from Keycloak token or cache)
   * This is a placeholder - actual implementation depends on how roles are stored
   */
  private async getUserRoles(userId: string): Promise<string[]> {
    // TODO: Implement based on your authentication system
    // For now, return empty array
    return [];
  }

  /**
   * Invalidate cached authorization data for a user
   */
  async invalidateUserCache(userId: string): Promise<void> {
    await this.cacheManager.del(`user:${userId}:orgs`);
  }
}
```

**Module**: Create `apps/api/src/common/common.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { AuthorizationService } from './services/authorization.service';
import { OrganizationsModule } from '../modules/organizations/organizations.module';
import { TeamsModule } from '../modules/teams/teams.module';

@Module({
  imports: [
    CacheModule.register({
      ttl: 300000, // 5 minutes default TTL
      max: 1000, // Max 1000 items in cache
    }),
    OrganizationsModule,
    TeamsModule,
  ],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class CommonModule {}
```

**Verification**:
- [ ] Service compiles without errors
- [ ] All methods have unit tests
- [ ] Caching works correctly
- [ ] Cache invalidation on membership changes

---

### Step 5: Testing (Week 3)

#### 5.1 Unit Tests for OrganizationMembersService

**File**: `apps/api/src/modules/organizations/__tests__/organization-members.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationMembersService } from '../organization-members.service';
import { OrganizationMember, Organization } from '@perfana/shared/entities';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('OrganizationMembersService', () => {
  let service: OrganizationMembersService;
  let memberRepository: Repository<OrganizationMember>;
  let orgRepository: Repository<Organization>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationMembersService,
        {
          provide: getRepositoryToken(OrganizationMember),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Organization),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<OrganizationMembersService>(OrganizationMembersService);
    memberRepository = module.get<Repository<OrganizationMember>>(
      getRepositoryToken(OrganizationMember),
    );
    orgRepository = module.get<Repository<Organization>>(
      getRepositoryToken(Organization),
    );
  });

  describe('addMember', () => {
    it('should add a member to an organization', async () => {
      const orgId = 'org-123';
      const userId = 'user-456';
      const roles = ['org-member'];

      const org = { id: orgId, name: 'Test Org' } as Organization;
      const member = {
        id: 'member-789',
        organization_id: orgId,
        user_id: userId,
        roles,
      } as OrganizationMember;

      jest.spyOn(orgRepository, 'findOne').mockResolvedValue(org);
      jest.spyOn(memberRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(memberRepository, 'create').mockReturnValue(member);
      jest.spyOn(memberRepository, 'save').mockResolvedValue(member);

      const result = await service.addMember(orgId, userId, roles);

      expect(result).toEqual(member);
      expect(memberRepository.save).toHaveBeenCalledWith(member);
    });

    it('should throw NotFoundException if organization does not exist', async () => {
      jest.spyOn(orgRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.addMember('org-123', 'user-456', ['org-member']),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if user is already a member', async () => {
      const org = { id: 'org-123', name: 'Test Org' } as Organization;
      const existingMember = {
        id: 'member-789',
        organization_id: 'org-123',
        user_id: 'user-456',
        roles: ['org-member'],
      } as OrganizationMember;

      jest.spyOn(orgRepository, 'findOne').mockResolvedValue(org);
      jest.spyOn(memberRepository, 'findOne').mockResolvedValue(existingMember);

      await expect(
        service.addMember('org-123', 'user-456', ['org-admin']),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('isMember', () => {
    it('should return true if user is a member', async () => {
      jest.spyOn(memberRepository, 'count').mockResolvedValue(1);

      const result = await service.isMember('org-123', 'user-456');

      expect(result).toBe(true);
    });

    it('should return false if user is not a member', async () => {
      jest.spyOn(memberRepository, 'count').mockResolvedValue(0);

      const result = await service.isMember('org-123', 'user-456');

      expect(result).toBe(false);
    });
  });

  describe('isOrgAdmin', () => {
    it('should return true if user has org-admin role', async () => {
      const member = {
        id: 'member-789',
        organization_id: 'org-123',
        user_id: 'user-456',
        roles: ['org-admin', 'org-member'],
      } as OrganizationMember;

      jest.spyOn(memberRepository, 'findOne').mockResolvedValue(member);

      const result = await service.isOrgAdmin('org-123', 'user-456');

      expect(result).toBe(true);
    });

    it('should return false if user does not have org-admin role', async () => {
      const member = {
        id: 'member-789',
        organization_id: 'org-123',
        user_id: 'user-456',
        roles: ['org-member'],
      } as OrganizationMember;

      jest.spyOn(memberRepository, 'findOne').mockResolvedValue(member);

      const result = await service.isOrgAdmin('org-123', 'user-456');

      expect(result).toBe(false);
    });
  });

  // Add tests for other methods: removeMember, updateMemberRoles, etc.
});
```

**Verification**:
- [ ] All service methods have unit tests
- [ ] Edge cases covered (not found, conflicts, permissions)
- [ ] 80%+ code coverage

---

#### 5.2 Unit Tests for AuthorizationService

**File**: `apps/api/src/common/services/__tests__/authorization.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AuthorizationService } from '../authorization.service';
import { OrganizationMembersService } from '../../../modules/organizations/organization-members.service';
import { TeamMembersService } from '../../../modules/teams/team-members.service';
import { OwnedEntity } from '@perfana/shared/entities';
import { SystemRole } from '../../../constants/roles.constants';

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let orgMembersService: OrganizationMembersService;
  let cacheManager: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: OrganizationMembersService,
          useValue: {
            isMember: jest.fn(),
            isOrgAdmin: jest.fn(),
            getUserOrganizations: jest.fn(),
          },
        },
        {
          provide: TeamMembersService,
          useValue: {},
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthorizationService>(AuthorizationService);
    orgMembersService = module.get<OrganizationMembersService>(
      OrganizationMembersService,
    );
    cacheManager = module.get(CACHE_MANAGER);
  });

  describe('isGlobalAdmin', () => {
    it('should return true for perfana-admin role', () => {
      const result = service.isGlobalAdmin('user-123', [
        SystemRole.GLOBAL_ADMIN,
      ]);
      expect(result).toBe(true);
    });

    it('should return true for admin role', () => {
      const result = service.isGlobalAdmin('user-123', [SystemRole.ADMIN]);
      expect(result).toBe(true);
    });

    it('should return false for non-admin roles', () => {
      const result = service.isGlobalAdmin('user-123', ['org-admin']);
      expect(result).toBe(false);
    });
  });

  describe('canAccessResource', () => {
    it('should allow global admin to access any resource', async () => {
      jest.spyOn(service as any, 'getUserRoles').mockResolvedValue([
        SystemRole.GLOBAL_ADMIN,
      ]);

      const resource = {
        organization_id: 'org-123',
        created_by: 'other-user',
      } as OwnedEntity;

      const result = await service.canAccessResource('user-123', resource);

      expect(result).toBe(true);
    });

    it('should allow org member to access org resource', async () => {
      jest.spyOn(service as any, 'getUserRoles').mockResolvedValue([]);
      jest.spyOn(orgMembersService, 'isMember').mockResolvedValue(true);

      const resource = {
        organization_id: 'org-123',
        created_by: 'other-user',
      } as OwnedEntity;

      const result = await service.canAccessResource('user-123', resource);

      expect(result).toBe(true);
      expect(orgMembersService.isMember).toHaveBeenCalledWith(
        'org-123',
        'user-123',
      );
    });

    it('should deny non-member access to org resource', async () => {
      jest.spyOn(service as any, 'getUserRoles').mockResolvedValue([]);
      jest.spyOn(orgMembersService, 'isMember').mockResolvedValue(false);

      const resource = {
        organization_id: 'org-123',
        created_by: 'other-user',
      } as OwnedEntity;

      const result = await service.canAccessResource('user-123', resource);

      expect(result).toBe(false);
    });

    it('should allow access to legacy resource without organization', async () => {
      jest.spyOn(service as any, 'getUserRoles').mockResolvedValue([]);

      const resource = {
        created_by: 'other-user',
      } as OwnedEntity;

      const result = await service.canAccessResource('user-123', resource);

      expect(result).toBe(true);
    });
  });

  describe('canModifyResource', () => {
    it('should allow owner to modify their resource', async () => {
      jest.spyOn(service as any, 'getUserRoles').mockResolvedValue([]);

      const resource = {
        organization_id: 'org-123',
        created_by: 'user-123',
      } as OwnedEntity;

      const result = await service.canModifyResource('user-123', resource);

      expect(result).toBe(true);
    });

    it('should allow org admin to modify org resource', async () => {
      jest.spyOn(service as any, 'getUserRoles').mockResolvedValue([]);
      jest.spyOn(orgMembersService, 'isOrgAdmin').mockResolvedValue(true);

      const resource = {
        organization_id: 'org-123',
        created_by: 'other-user',
      } as OwnedEntity;

      const result = await service.canModifyResource('user-123', resource);

      expect(result).toBe(true);
    });

    it('should deny non-owner, non-admin from modifying resource', async () => {
      jest.spyOn(service as any, 'getUserRoles').mockResolvedValue([]);
      jest.spyOn(orgMembersService, 'isOrgAdmin').mockResolvedValue(false);

      const resource = {
        organization_id: 'org-123',
        created_by: 'other-user',
      } as OwnedEntity;

      const result = await service.canModifyResource('user-123', resource);

      expect(result).toBe(false);
    });
  });

  describe('getAccessibleOrganizations', () => {
    it('should return cached organizations if available', async () => {
      const cachedOrgIds = ['org-123', 'org-456'];
      jest.spyOn(cacheManager, 'get').mockResolvedValue(cachedOrgIds);

      const result = await service.getAccessibleOrganizations('user-123');

      expect(result).toEqual(cachedOrgIds);
      expect(orgMembersService.getUserOrganizations).not.toHaveBeenCalled();
    });

    it('should fetch and cache organizations if not cached', async () => {
      const orgs = [
        { id: 'org-123', name: 'Org 1' },
        { id: 'org-456', name: 'Org 2' },
      ];
      jest.spyOn(cacheManager, 'get').mockResolvedValue(null);
      jest
        .spyOn(orgMembersService, 'getUserOrganizations')
        .mockResolvedValue(orgs as any);

      const result = await service.getAccessibleOrganizations('user-123');

      expect(result).toEqual(['org-123', 'org-456']);
      expect(cacheManager.set).toHaveBeenCalledWith(
        'user:user-123:orgs',
        ['org-123', 'org-456'],
        300000,
      );
    });
  });
});
```

**Verification**:
- [ ] All authorization methods have unit tests
- [ ] Permission logic thoroughly tested
- [ ] Caching behavior verified
- [ ] 80%+ code coverage

---

### Step 6: Documentation & Rollout (Week 3)

#### 6.1 Update API Documentation

Add Swagger documentation for new endpoints (if exposing membership management):

```typescript
@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  @Post(':orgId/members')
  @ApiOperation({ summary: 'Add member to organization' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiBody({
    schema: {
      properties: {
        userId: { type: 'string' },
        roles: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  async addMember(
    @Param('orgId') orgId: string,
    @Body() dto: AddMemberDto,
  ): Promise<OrganizationMember> {
    return await this.membersService.addMember(orgId, dto.userId, dto.roles);
  }
}
```

#### 6.2 Create Developer Guide

**File**: `RBAC_DEVELOPER_GUIDE.md`

Document:
- How to use OwnedEntity base class
- How to check permissions with AuthorizationService
- How to add users to organizations
- Common authorization patterns
- Troubleshooting guide

#### 6.3 Update CLAUDE.md

Add Phase 2 completion status to project overview.

---

## Rollback Plan

### Database Rollback

Each migration has a `down()` method that reverses the changes:

```bash
npm run migration:revert
```

### Code Rollback

If issues arise:
1. Comment out new services from module imports
2. Keep database changes (columns are nullable)
3. Don't enforce ownership requirements yet

### Data Safety

- All new columns are nullable (backward compatible)
- No data is deleted or modified
- Existing functionality continues to work

---

## Success Criteria

### Functional Requirements
- [ ] Organization membership tables created
- [ ] Team membership tables created
- [ ] All resource entities have ownership fields
- [ ] Membership CRUD operations work
- [ ] Authorization service returns correct results
- [ ] Base entity pattern working correctly

### Technical Requirements
- [ ] All migrations run successfully
- [ ] All entities compile without errors
- [ ] All services have 80%+ test coverage
- [ ] Type checking passes
- [ ] No breaking changes to existing API

### Performance Requirements
- [ ] Organization membership queries <50ms p95
- [ ] Authorization checks <20ms p95 (with caching)
- [ ] Cache hit rate >80% for organization lookups

---

## Next Steps After Phase 2

**Phase 3**: Service-Layer Authorization Enforcement
- Update all services to use AuthorizationService
- Filter queries by organization membership
- Enforce permissions on all CRUD operations
- Add user context to all controller methods

**Phase 4**: Data Migration & Enforcement
- Create default organization for legacy data
- Assign ownership to existing resources
- Make ownership fields required (NOT NULL)
- Add foreign key constraints

**Phase 5**: Advanced Features
- PostgreSQL RLS policies (defense-in-depth)
- Audit logging for all access/modifications
- Performance optimization and monitoring
- Real-time permission updates

---

## Questions & Considerations

### API Key Scoping
- **Decision Needed**: Should API keys be scoped to organizations?
- **Impact**: If yes, need to add organization_id to api_keys table
- **Recommendation**: Yes, for better multi-tenant isolation

### Default Organization Assignment
- **Decision Needed**: How to determine default organization for new resources?
- **Options**:
  1. User's primary organization (requires user profile)
  2. Require explicit organization_id in create requests
  3. Use first organization user belongs to
- **Recommendation**: Option 2 (explicit) for clarity

### Team vs Organization Permissions
- **Decision Needed**: Should team membership grant org access?
- **Current**: Teams belong to organizations, but membership is separate
- **Recommendation**: Team members auto-added to parent organization

### Legacy Data Handling
- **Decision Needed**: Timeline for migrating existing data?
- **Options**:
  1. Immediate (Phase 4)
  2. Gradual (allow NULL ownership indefinitely)
- **Recommendation**: Phase 4 (controlled migration)

---

## Appendix: File Checklist

### New Files to Create
- [ ] `database/migrations/YYYYMMDDHHMMSS-create-organization-members.ts`
- [ ] `database/migrations/YYYYMMDDHHMMSS-create-team-members.ts`
- [ ] `database/migrations/YYYYMMDDHHMMSS-add-resource-ownership.ts`
- [ ] `packages/shared/src/entities/organization-member.entity.ts`
- [ ] `packages/shared/src/entities/team-member.entity.ts`
- [ ] `packages/shared/src/entities/base/owned-entity.base.ts`
- [ ] `apps/api/src/modules/organizations/organization-members.service.ts`
- [ ] `apps/api/src/modules/teams/team-members.service.ts`
- [ ] `apps/api/src/common/services/authorization.service.ts`
- [ ] `apps/api/src/common/common.module.ts`
- [ ] `apps/api/src/modules/organizations/__tests__/organization-members.service.spec.ts`
- [ ] `apps/api/src/common/services/__tests__/authorization.service.spec.ts`
- [ ] `RBAC_DEVELOPER_GUIDE.md`

### Files to Modify
- [ ] `packages/shared/src/entities/index.ts` - Export new entities
- [ ] `packages/shared/src/entities/test-run.entity.ts` - Extend OwnedEntity
- [ ] `packages/shared/src/entities/benchmark.entity.ts` - Extend OwnedEntity
- [ ] `packages/shared/src/entities/system-under-test.entity.ts` - Extend OwnedEntity
- [ ] (20+ more entity files to extend OwnedEntity)
- [ ] `apps/api/src/modules/organizations/organizations.module.ts` - Add membership service
- [ ] `apps/api/src/modules/teams/teams.module.ts` - Add membership service
- [ ] `apps/api/src/app.module.ts` - Import CommonModule
- [ ] `CLAUDE.md` - Update with Phase 2 status

---

**Total Estimated Files**: 13 new, 25+ modified
**Total Estimated Time**: 3-5 weeks (varies by team size and resource count)
**Risk Level**: Medium (database changes, but backward compatible)
**Impact**: High (foundation for all future authorization work)
