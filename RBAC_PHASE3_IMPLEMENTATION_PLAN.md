# RBAC Phase 3 Implementation Plan: Service-Layer Authorization Enforcement

## Overview

**Goal**: Enforce organization-based authorization at the service layer, ensuring users can only access resources within their organizations.

**Dependencies**:
- Phase 1 (RolesGuard, role constants, admin endpoint protection) ✅ Complete
- Phase 2 (Membership infrastructure, ownership tracking, AuthorizationService) ✅ Complete

**Estimated Time**: 4-6 weeks

**Key Deliverables**:
1. Base service pattern with built-in authorization
2. Organization filtering on all list/query operations
3. Permission checks on all modify/delete operations
4. User context passed through all controller endpoints
5. 30+ services updated with authorization enforcement

---

## Phase 3 Scope

### What's Included
- ✅ Authorized base service pattern
- ✅ Organization filtering helpers
- ✅ Permission checking on all CUD operations
- ✅ Automatic ownership assignment on create
- ✅ User context extraction from requests
- ✅ Update all controllers to pass user context
- ✅ Update all services to enforce permissions

### What's NOT Included (Future Phases)
- ❌ Database RLS policies (Phase 5)
- ❌ Data migration for legacy resources (Phase 4)
- ❌ Audit logging (Phase 5)
- ❌ Making ownership fields required (Phase 4)

---

## Architecture Overview

### Request Flow

```
User Request
    ↓
KeycloakEnhancedAuthGuard (extracts userId, roles)
    ↓
RolesGuard (checks @Roles decorator)
    ↓
Controller (extracts userId, orgId from request)
    ↓
Service (applies org filter, checks permissions)
    ↓
AuthorizationService (permission logic)
    ↓
Database (filtered by organization)
```

### Key Patterns

1. **Read Operations**: Filter by accessible organizations
2. **Create Operations**: Auto-assign ownership and organization
3. **Update/Delete Operations**: Check permission before proceeding
4. **Global Admins**: Bypass all filters and checks

---

## Implementation Steps

### Step 1: Create Base Service Pattern (Week 1)

#### 1.1 Authorized Base Service

**File**: `apps/api/src/common/services/authorized-base.service.ts`

```typescript
import { ForbiddenException } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { OwnedEntity } from '@perfana/shared/entities';
import { AuthorizationService } from './authorization.service';

/**
 * Base service class that provides authorization-aware CRUD operations.
 *
 * All services managing owned resources should extend this class.
 *
 * Usage:
 * @Injectable()
 * export class TestRunsService extends AuthorizedBaseService<TestRun> {
 *   constructor(
 *     @InjectRepository(TestRun) repository: Repository<TestRun>,
 *     authzService: AuthorizationService,
 *   ) {
 *     super(repository, authzService);
 *   }
 * }
 */
export abstract class AuthorizedBaseService<T extends OwnedEntity> {
  constructor(
    protected readonly repository: Repository<T>,
    protected readonly authzService: AuthorizationService,
  ) {}

  /**
   * Apply organization filter to query builder based on user's accessible organizations.
   * Global admins see everything, regular users only see resources in their orgs.
   *
   * @param queryBuilder - TypeORM query builder
   * @param userId - Current user ID
   * @param roles - Current user's roles
   * @returns Modified query builder with org filter applied
   */
  protected async applyOrgFilter(
    queryBuilder: SelectQueryBuilder<T>,
    userId: string,
    roles: string[],
  ): Promise<SelectQueryBuilder<T>> {
    // Global admin sees everything
    if (this.authzService.isGlobalAdmin(userId, roles)) {
      return queryBuilder;
    }

    // Get user's accessible organizations
    const orgIds = await this.authzService.getAccessibleOrganizations(userId);

    if (orgIds.length === 0) {
      // User has no organizations - return empty result
      queryBuilder.where('1 = 0');
    } else {
      // Filter by accessible organizations OR legacy data without org
      queryBuilder.andWhere(
        '(entity.organization_id IN (:...orgIds) OR entity.organization_id IS NULL)',
        { orgIds },
      );
    }

    return queryBuilder;
  }

  /**
   * Check if user has permission to modify a resource.
   * Throws ForbiddenException if permission denied.
   *
   * @param userId - Current user ID
   * @param resource - Resource to check
   * @throws ForbiddenException if user lacks permission
   */
  protected async checkModifyPermission(
    userId: string,
    resource: T,
  ): Promise<void> {
    const canModify = await this.authzService.canModifyResource(userId, resource);

    if (!canModify) {
      throw new ForbiddenException(
        'You do not have permission to modify this resource',
      );
    }
  }

  /**
   * Check if user has permission to delete a resource.
   * Throws ForbiddenException if permission denied.
   *
   * @param userId - Current user ID
   * @param resource - Resource to check
   * @throws ForbiddenException if user lacks permission
   */
  protected async checkDeletePermission(
    userId: string,
    resource: T,
  ): Promise<void> {
    const canDelete = await this.authzService.canDeleteResource(userId, resource);

    if (!canDelete) {
      throw new ForbiddenException(
        'You do not have permission to delete this resource',
      );
    }
  }

  /**
   * Check if user has permission to access a resource.
   * Throws ForbiddenException if permission denied.
   *
   * @param userId - Current user ID
   * @param resource - Resource to check
   * @throws ForbiddenException if user lacks permission
   */
  protected async checkAccessPermission(
    userId: string,
    resource: T,
  ): Promise<void> {
    const canAccess = await this.authzService.canAccessResource(userId, resource);

    if (!canAccess) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }
  }

  /**
   * Assign ownership metadata to an entity before creation.
   * Sets created_by, updated_by, organization_id, and optionally team_id.
   *
   * @param entity - Partial entity to be created
   * @param userId - Current user ID
   * @param orgId - Organization ID
   * @param teamId - Optional team ID
   * @returns Entity with ownership fields set
   */
  protected assignOwnership(
    entity: Partial<T>,
    userId: string,
    orgId: string,
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

  /**
   * Update the updated_by field before saving changes.
   *
   * @param entity - Entity to update
   * @param userId - Current user ID
   * @returns Entity with updated_by set
   */
  protected markUpdated(entity: T, userId: string): T {
    entity.updated_by = userId;
    return entity;
  }

  /**
   * Get user's default organization ID.
   * Uses the first organization in user's accessible organizations.
   *
   * @param userId - Current user ID
   * @returns Default organization ID or undefined
   */
  protected async getDefaultOrganization(userId: string): Promise<string | undefined> {
    const orgIds = await this.authzService.getAccessibleOrganizations(userId);
    return orgIds.length > 0 ? orgIds[0] : undefined;
  }
}
```

**Verification**:
- [ ] Base service compiles without errors
- [ ] All helper methods properly typed
- [ ] Documentation clear and comprehensive

---

#### 1.2 Request Context Helper

**File**: `apps/api/src/common/decorators/user-context.decorator.ts`

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../types/authenticated-request.interface';
import { KeycloakEnhancedAuthGuard } from '../../guards/keycloak-enhanced-auth.guard';

/**
 * User context extracted from authenticated request
 */
export interface UserContext {
  userId: string;
  roles: string[];
  organizationId?: string;
  teamId?: string;
}

/**
 * Decorator to extract user context from request.
 *
 * Usage in controller:
 * @Get()
 * async findAll(@UserCtx() ctx: UserContext) {
 *   return this.service.findAll(ctx.userId, ctx.roles);
 * }
 */
export const UserCtx = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): UserContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    return {
      userId: KeycloakEnhancedAuthGuard.getUserId(request),
      roles: KeycloakEnhancedAuthGuard.getRoles(request),
      organizationId: request.user?.organization_id,
      teamId: request.user?.team_id,
    };
  },
);
```

**Verification**:
- [ ] Decorator compiles without errors
- [ ] Properly extracts user context
- [ ] Works with both JWT and API key auth

---

### Step 2: Update Core Services (Week 1-3)

#### 2.1 Test Runs Service (Priority 1 - Highest Impact)

**File**: `apps/api/src/modules/test-runs/test-runs.service.ts`

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun } from '@perfana/shared/entities';
import { AuthorizedBaseService } from '../../common/services/authorized-base.service';
import { AuthorizationService } from '../../common/services/authorization.service';
import { CreateTestRunDto } from './dto/create-test-run.dto';
import { UpdateTestRunDto } from './dto/update-test-run.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';

@Injectable()
export class TestRunsService extends AuthorizedBaseService<TestRun> {
  constructor(
    @InjectRepository(TestRun)
    repository: Repository<TestRun>,
    authzService: AuthorizationService,
  ) {
    super(repository, authzService);
  }

  /**
   * Find all test runs with pagination, filtered by user's organizations
   */
  async findAllPaginated(
    paginationDto: PaginationQueryDto,
    userId: string,
    roles: string[],
  ): Promise<PaginatedResponseDto<TestRun>> {
    const queryBuilder = this.repository.createQueryBuilder('test_run');

    // Apply organization filter
    await this.applyOrgFilter(queryBuilder, userId, roles);

    // Apply pagination
    const { offset, limit } = paginationDto;
    queryBuilder
      .skip(offset)
      .take(limit)
      .orderBy('test_run.created_at', 'DESC');

    // Execute query
    const [items, total] = await queryBuilder.getManyAndCount();

    // Calculate pagination metadata
    const page = Math.floor(offset / limit) + 1;
    const pageSize = limit;
    const totalPages = Math.ceil(total / limit);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  /**
   * Find test run by ID with permission check
   */
  async findOne(id: string, userId: string): Promise<TestRun> {
    const testRun = await this.repository.findOne({ where: { id } });

    if (!testRun) {
      throw new NotFoundException(`Test run with ID ${id} not found`);
    }

    // Check access permission
    await this.checkAccessPermission(userId, testRun);

    return testRun;
  }

  /**
   * Create new test run with automatic ownership assignment
   */
  async create(
    createDto: CreateTestRunDto,
    userId: string,
    orgId: string,
    teamId?: string,
  ): Promise<TestRun> {
    // Create test run with ownership
    const testRun = this.repository.create(
      this.assignOwnership(createDto, userId, orgId, teamId),
    );

    return await this.repository.save(testRun);
  }

  /**
   * Update test run with permission check
   */
  async update(
    id: string,
    updateDto: UpdateTestRunDto,
    userId: string,
  ): Promise<TestRun> {
    const testRun = await this.repository.findOne({ where: { id } });

    if (!testRun) {
      throw new NotFoundException(`Test run with ID ${id} not found`);
    }

    // Check modify permission
    await this.checkModifyPermission(userId, testRun);

    // Apply updates
    Object.assign(testRun, updateDto);
    this.markUpdated(testRun, userId);

    return await this.repository.save(testRun);
  }

  /**
   * Delete test run with permission check
   */
  async remove(id: string, userId: string): Promise<void> {
    const testRun = await this.repository.findOne({ where: { id } });

    if (!testRun) {
      throw new NotFoundException(`Test run with ID ${id} not found`);
    }

    // Check delete permission
    await this.checkDeletePermission(userId, testRun);

    await this.repository.remove(testRun);
  }

  /**
   * Find test runs by system under test, filtered by organization
   */
  async findBySystem(
    systemId: string,
    userId: string,
    roles: string[],
  ): Promise<TestRun[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('test_run')
      .where('test_run.system_under_test_id = :systemId', { systemId });

    // Apply organization filter
    await this.applyOrgFilter(queryBuilder, userId, roles);

    return await queryBuilder.getMany();
  }

  /**
   * Get test run statistics for user's organizations
   */
  async getStatistics(
    userId: string,
    roles: string[],
  ): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byEnvironment: Record<string, number>;
  }> {
    const queryBuilder = this.repository.createQueryBuilder('test_run');

    // Apply organization filter
    await this.applyOrgFilter(queryBuilder, userId, roles);

    // Get total count
    const total = await queryBuilder.getCount();

    // Get counts by status
    const statusQuery = this.repository.createQueryBuilder('test_run');
    await this.applyOrgFilter(statusQuery, userId, roles);
    const byStatusRaw = await statusQuery
      .select('test_run.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('test_run.status')
      .getRawMany();

    const byStatus = byStatusRaw.reduce((acc, { status, count }) => {
      acc[status] = parseInt(count, 10);
      return acc;
    }, {} as Record<string, number>);

    // Get counts by environment
    const envQuery = this.repository.createQueryBuilder('test_run');
    await this.applyOrgFilter(envQuery, userId, roles);
    const byEnvRaw = await envQuery
      .select('test_run.test_environment', 'environment')
      .addSelect('COUNT(*)', 'count')
      .groupBy('test_run.test_environment')
      .getRawMany();

    const byEnvironment = byEnvRaw.reduce((acc, { environment, count }) => {
      acc[environment] = parseInt(count, 10);
      return acc;
    }, {} as Record<string, number>);

    return { total, byStatus, byEnvironment };
  }
}
```

**Verification**:
- [ ] Service extends AuthorizedBaseService
- [ ] All methods accept userId/roles parameters
- [ ] Organization filtering applied to all queries
- [ ] Permission checks on all modify/delete operations
- [ ] Ownership assigned on create
- [ ] Existing tests updated

---

#### 2.2 Update Test Runs Controller

**File**: `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`

```typescript
import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TestRunsService } from '../test-runs.service';
import { CreateTestRunDto } from '../dto/create-test-run.dto';
import { UpdateTestRunDto } from '../dto/update-test-run.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsController {
  constructor(private readonly testRunsService: TestRunsService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of test runs' })
  async findAll(
    @Query() paginationDto: PaginationQueryDto,
    @UserCtx() ctx: UserContext,
  ) {
    return await this.testRunsService.findAllPaginated(
      paginationDto,
      ctx.userId,
      ctx.roles,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get test run by ID' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    return await this.testRunsService.findOne(id, ctx.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create new test run' })
  async create(
    @Body() createDto: CreateTestRunDto,
    @UserCtx() ctx: UserContext,
  ) {
    // Get organization from context or use default
    const orgId = ctx.organizationId ||
      await this.testRunsService['getDefaultOrganization'](ctx.userId);

    if (!orgId) {
      throw new Error('User must belong to an organization to create test runs');
    }

    return await this.testRunsService.create(
      createDto,
      ctx.userId,
      orgId,
      ctx.teamId,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update test run' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateTestRunDto,
    @UserCtx() ctx: UserContext,
  ) {
    return await this.testRunsService.update(id, updateDto, ctx.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete test run' })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    await this.testRunsService.remove(id, ctx.userId);
    return { message: 'Test run deleted successfully' };
  }

  @Get('system/:systemId')
  @ApiOperation({ summary: 'Get test runs for a system' })
  async findBySystem(
    @Param('systemId') systemId: string,
    @UserCtx() ctx: UserContext,
  ) {
    return await this.testRunsService.findBySystem(
      systemId,
      ctx.userId,
      ctx.roles,
    );
  }

  @Get('statistics/overview')
  @ApiOperation({ summary: 'Get test run statistics' })
  async getStatistics(@UserCtx() ctx: UserContext) {
    return await this.testRunsService.getStatistics(ctx.userId, ctx.roles);
  }
}
```

**Verification**:
- [ ] All endpoints use @UserCtx() decorator
- [ ] User context passed to all service methods
- [ ] No breaking changes to API contracts
- [ ] Swagger documentation updated

---

### Step 3: Service Update Priority List (Week 2-4)

Update services in order of business impact and usage:

#### High Priority (Week 2)
1. **TestRunsService** ✅ (Example above)
2. **BenchmarksService** - SLO management, critical for performance testing
3. **SystemsUnderTestService** - Core resource referenced by test runs
4. **ProfilesService** - Test configuration profiles
5. **ApiKeysService** - Security-critical resource

#### Medium Priority (Week 3)
6. **GrafanaDashboardsService** - Dashboard management
7. **GrafanaInstancesService** - Integration management
8. **TracingInstancesService** - Tempo/Jaeger integration
9. **PyroscopeInstancesService** - Profiling integration
10. **TestEnvironmentsService** - Environment management
11. **WorkloadTypesService** - Workload configuration
12. **ReportsService** - Report generation and sharing

#### Lower Priority (Week 4)
13. **OrganizationsService** - Organization management
14. **TeamsService** - Team management
15. **UsersService** - User management (if exists)
16. **DynatraceConfigurationsService** - Dynatrace integration
17. **ApplicationDashboardConfigsService** - Dashboard configurations
18. All other remaining services

---

### Step 4: Service Update Template (Weeks 2-4)

For each service, follow this pattern:

#### Step 4.1: Update Service Class

```typescript
// Before:
@Injectable()
export class MyResourceService {
  constructor(
    @InjectRepository(MyResource)
    private readonly repository: Repository<MyResource>,
  ) {}

  async findAll(): Promise<MyResource[]> {
    return await this.repository.find();
  }

  async findOne(id: string): Promise<MyResource> {
    return await this.repository.findOne({ where: { id } });
  }

  async create(dto: CreateDto): Promise<MyResource> {
    const resource = this.repository.create(dto);
    return await this.repository.save(resource);
  }

  async update(id: string, dto: UpdateDto): Promise<MyResource> {
    await this.repository.update(id, dto);
    return await this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}

// After:
@Injectable()
export class MyResourceService extends AuthorizedBaseService<MyResource> {
  constructor(
    @InjectRepository(MyResource)
    repository: Repository<MyResource>,
    authzService: AuthorizationService,
  ) {
    super(repository, authzService);
  }

  async findAll(userId: string, roles: string[]): Promise<MyResource[]> {
    const queryBuilder = this.repository.createQueryBuilder('resource');
    await this.applyOrgFilter(queryBuilder, userId, roles);
    return await queryBuilder.getMany();
  }

  async findOne(id: string, userId: string): Promise<MyResource> {
    const resource = await this.repository.findOne({ where: { id } });
    if (!resource) {
      throw new NotFoundException(`Resource ${id} not found`);
    }
    await this.checkAccessPermission(userId, resource);
    return resource;
  }

  async create(
    dto: CreateDto,
    userId: string,
    orgId: string,
  ): Promise<MyResource> {
    const resource = this.repository.create(
      this.assignOwnership(dto, userId, orgId),
    );
    return await this.repository.save(resource);
  }

  async update(
    id: string,
    dto: UpdateDto,
    userId: string,
  ): Promise<MyResource> {
    const resource = await this.repository.findOne({ where: { id } });
    if (!resource) {
      throw new NotFoundException(`Resource ${id} not found`);
    }
    await this.checkModifyPermission(userId, resource);
    Object.assign(resource, dto);
    this.markUpdated(resource, userId);
    return await this.repository.save(resource);
  }

  async remove(id: string, userId: string): Promise<void> {
    const resource = await this.repository.findOne({ where: { id } });
    if (!resource) {
      throw new NotFoundException(`Resource ${id} not found`);
    }
    await this.checkDeletePermission(userId, resource);
    await this.repository.remove(resource);
  }
}
```

#### Step 4.2: Update Controller

```typescript
// Before:
@Controller('my-resource')
export class MyResourceController {
  @Get()
  async findAll() {
    return await this.service.findAll();
  }

  @Post()
  async create(@Body() dto: CreateDto) {
    return await this.service.create(dto);
  }
}

// After:
@Controller('my-resource')
export class MyResourceController {
  @Get()
  async findAll(@UserCtx() ctx: UserContext) {
    return await this.service.findAll(ctx.userId, ctx.roles);
  }

  @Post()
  async create(@Body() dto: CreateDto, @UserCtx() ctx: UserContext) {
    const orgId = ctx.organizationId ||
      await this.service['getDefaultOrganization'](ctx.userId);
    return await this.service.create(dto, ctx.userId, orgId);
  }
}
```

#### Step 4.3: Update Module (if needed)

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([MyResource]),
    CommonModule, // Import for AuthorizationService
  ],
  providers: [MyResourceService],
  controllers: [MyResourceController],
  exports: [MyResourceService],
})
export class MyResourceModule {}
```

#### Step 4.4: Update Tests

```typescript
describe('MyResourceService', () => {
  let service: MyResourceService;
  let authzService: AuthorizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyResourceService,
        {
          provide: getRepositoryToken(MyResource),
          useClass: Repository,
        },
        {
          provide: AuthorizationService,
          useValue: {
            isGlobalAdmin: jest.fn(),
            getAccessibleOrganizations: jest.fn(),
            canAccessResource: jest.fn(),
            canModifyResource: jest.fn(),
            canDeleteResource: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MyResourceService>(MyResourceService);
    authzService = module.get<AuthorizationService>(AuthorizationService);
  });

  describe('findAll', () => {
    it('should filter by organization for regular users', async () => {
      jest.spyOn(authzService, 'isGlobalAdmin').mockReturnValue(false);
      jest
        .spyOn(authzService, 'getAccessibleOrganizations')
        .mockResolvedValue(['org-123']);

      const result = await service.findAll('user-123', ['org-member']);

      // Assert query was filtered by organization
    });

    it('should not filter for global admins', async () => {
      jest.spyOn(authzService, 'isGlobalAdmin').mockReturnValue(true);

      const result = await service.findAll('admin-123', ['perfana-admin']);

      // Assert no organization filter applied
    });
  });

  describe('update', () => {
    it('should allow owner to update resource', async () => {
      const resource = {
        id: '1',
        created_by: 'user-123',
        organization_id: 'org-123',
      } as MyResource;

      jest.spyOn(authzService, 'canModifyResource').mockResolvedValue(true);

      await expect(
        service.update('1', { name: 'Updated' }, 'user-123'),
      ).resolves.not.toThrow();
    });

    it('should deny non-owner from updating resource', async () => {
      const resource = {
        id: '1',
        created_by: 'user-123',
        organization_id: 'org-123',
      } as MyResource;

      jest.spyOn(authzService, 'canModifyResource').mockResolvedValue(false);

      await expect(
        service.update('1', { name: 'Updated' }, 'user-456'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
```

**Verification Checklist per Service**:
- [ ] Service extends AuthorizedBaseService
- [ ] All methods accept userId/roles
- [ ] Organization filter on all queries
- [ ] Permission checks on modify/delete
- [ ] Ownership assignment on create
- [ ] Controller updated with @UserCtx()
- [ ] Module imports CommonModule
- [ ] Tests updated and passing
- [ ] No breaking API changes

---

### Step 5: Handle Special Cases (Week 4-5)

#### 5.1 Services with Complex Queries

Some services have complex queries with joins, aggregations, etc. Handle these carefully:

```typescript
async getTestRunsWithMetrics(
  userId: string,
  roles: string[],
): Promise<TestRunWithMetrics[]> {
  const queryBuilder = this.repository
    .createQueryBuilder('test_run')
    .leftJoinAndSelect('test_run.metrics', 'metric')
    .leftJoinAndSelect('test_run.system', 'system')
    .where('metric.value > :threshold', { threshold: 100 });

  // Apply organization filter on main entity
  await this.applyOrgFilter(queryBuilder, userId, roles);

  // Additional filters
  queryBuilder.orderBy('test_run.created_at', 'DESC');

  return await queryBuilder.getMany();
}
```

#### 5.2 Services with Bulk Operations

For bulk operations, filter the set first:

```typescript
async bulkDelete(ids: string[], userId: string): Promise<void> {
  // Fetch all resources first
  const resources = await this.repository.findByIds(ids);

  // Check permission for each
  for (const resource of resources) {
    await this.checkDeletePermission(userId, resource);
  }

  // Delete all that passed permission check
  await this.repository.remove(resources);
}
```

#### 5.3 Services with Cross-Organization Logic

Some operations may need to span organizations (e.g., comparisons, trends):

```typescript
async compareAcrossOrganizations(
  orgIds: string[],
  userId: string,
  roles: string[],
): Promise<ComparisonResult> {
  // Verify user has access to all requested orgs
  const accessibleOrgs = await this.authzService.getAccessibleOrganizations(userId);
  const hasAccess = orgIds.every(orgId =>
    this.authzService.isGlobalAdmin(userId, roles) ||
    accessibleOrgs.includes(orgId)
  );

  if (!hasAccess) {
    throw new ForbiddenException(
      'You do not have access to all requested organizations',
    );
  }

  // Proceed with cross-org query
  return await this.performComparison(orgIds);
}
```

#### 5.4 Legacy Data Without Organizations

Handle legacy data gracefully:

```typescript
protected async applyOrgFilter(
  queryBuilder: SelectQueryBuilder<T>,
  userId: string,
  roles: string[],
): Promise<SelectQueryBuilder<T>> {
  if (this.authzService.isGlobalAdmin(userId, roles)) {
    return queryBuilder;
  }

  const orgIds = await this.authzService.getAccessibleOrganizations(userId);

  if (orgIds.length === 0) {
    // No orgs - only show legacy data
    queryBuilder.where('entity.organization_id IS NULL');
  } else {
    // Show org data + legacy data
    queryBuilder.andWhere(
      '(entity.organization_id IN (:...orgIds) OR entity.organization_id IS NULL)',
      { orgIds },
    );
  }

  return queryBuilder;
}
```

---

### Step 6: Integration Testing (Week 5)

#### 6.1 End-to-End Authorization Tests

**File**: `apps/api/test/authorization.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Authorization (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let user1Token: string;
  let user2Token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Get tokens for different users
    adminToken = 'Bearer admin-jwt-token';
    user1Token = 'Bearer user1-jwt-token';
    user2Token = 'Bearer user2-jwt-token';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Test Runs Authorization', () => {
    let org1TestRunId: string;
    let org2TestRunId: string;

    it('should create test run in user org', async () => {
      const response = await request(app.getHttpServer())
        .post('/test-runs')
        .set('Authorization', user1Token)
        .send({
          name: 'Test Run 1',
          system_under_test_id: 'system-123',
        })
        .expect(201);

      org1TestRunId = response.body.id;
      expect(response.body.organization_id).toBeDefined();
      expect(response.body.created_by).toBeDefined();
    });

    it('should list only own org test runs', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-runs')
        .set('Authorization', user1Token)
        .expect(200);

      expect(response.body.items).toBeInstanceOf(Array);
      // Verify all items belong to user's org
      response.body.items.forEach((item: any) => {
        expect(item.organization_id).toBe('org-1');
      });
    });

    it('should deny access to other org test run', async () => {
      await request(app.getHttpServer())
        .get(`/test-runs/${org2TestRunId}`)
        .set('Authorization', user1Token)
        .expect(403);
    });

    it('should allow owner to update own test run', async () => {
      await request(app.getHttpServer())
        .patch(`/test-runs/${org1TestRunId}`)
        .set('Authorization', user1Token)
        .send({ name: 'Updated Test Run' })
        .expect(200);
    });

    it('should deny non-owner update', async () => {
      await request(app.getHttpServer())
        .patch(`/test-runs/${org1TestRunId}`)
        .set('Authorization', user2Token)
        .send({ name: 'Hacked Test Run' })
        .expect(403);
    });

    it('should allow org admin to update any org test run', async () => {
      // Assuming user1 is org admin
      await request(app.getHttpServer())
        .patch(`/test-runs/${org1TestRunId}`)
        .set('Authorization', user1Token)
        .send({ name: 'Admin Updated' })
        .expect(200);
    });

    it('should allow global admin to access all test runs', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-runs')
        .set('Authorization', adminToken)
        .expect(200);

      // Admin should see test runs from all orgs
      const orgIds = new Set(response.body.items.map((item: any) => item.organization_id));
      expect(orgIds.size).toBeGreaterThan(1);
    });

    it('should allow owner to delete own test run', async () => {
      await request(app.getHttpServer())
        .delete(`/test-runs/${org1TestRunId}`)
        .set('Authorization', user1Token)
        .expect(200);
    });
  });

  describe('Cross-Service Authorization', () => {
    it('should filter related resources by organization', async () => {
      // Create system in org1
      const systemResponse = await request(app.getHttpServer())
        .post('/systems-under-test')
        .set('Authorization', user1Token)
        .send({ name: 'System 1' })
        .expect(201);

      const systemId = systemResponse.body.id;

      // Get test runs for system - should only see org1 test runs
      const testRunsResponse = await request(app.getHttpServer())
        .get(`/test-runs/system/${systemId}`)
        .set('Authorization', user1Token)
        .expect(200);

      testRunsResponse.body.forEach((item: any) => {
        expect(item.organization_id).toBe('org-1');
      });
    });
  });
});
```

**Verification**:
- [ ] E2E tests pass for all authorization scenarios
- [ ] Organization filtering verified
- [ ] Permission checks verified
- [ ] Global admin access verified
- [ ] Cross-service authorization verified

---

### Step 7: Performance Testing (Week 5)

#### 7.1 Query Performance Tests

```typescript
describe('Authorization Performance', () => {
  it('should filter 10,000 test runs in <200ms', async () => {
    const start = Date.now();
    const result = await testRunsService.findAll('user-123', ['org-member']);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(200);
  });

  it('should check permission in <20ms with caching', async () => {
    const resource = { id: '1', organization_id: 'org-123' } as TestRun;

    // First call (cache miss)
    const start1 = Date.now();
    await authzService.canAccessResource('user-123', resource);
    const duration1 = Date.now() - start1;

    // Second call (cache hit)
    const start2 = Date.now();
    await authzService.canAccessResource('user-123', resource);
    const duration2 = Date.now() - start2;

    expect(duration2).toBeLessThan(20);
    expect(duration2).toBeLessThan(duration1);
  });
});
```

#### 7.2 Database Query Analysis

```sql
-- Check index usage
EXPLAIN ANALYZE
SELECT * FROM test_runs
WHERE organization_id IN ('org-1', 'org-2')
ORDER BY created_at DESC
LIMIT 20;

-- Should show:
-- Index Scan using idx_test_runs_org_created
-- Planning Time: < 1ms
-- Execution Time: < 10ms
```

**Verification**:
- [ ] Organization filtering queries <200ms p95
- [ ] Permission checks <20ms p95 (cached)
- [ ] Proper index usage confirmed
- [ ] No N+1 query issues

---

### Step 8: Documentation (Week 6)

#### 8.1 Update RBAC Developer Guide

**File**: `RBAC_DEVELOPER_GUIDE.md`

Add Phase 3 sections:
- How to use AuthorizedBaseService
- How to pass user context from controllers
- How to handle special authorization cases
- How to test authorization in services
- Common pitfalls and solutions

#### 8.2 Update API Documentation

Add authorization notes to Swagger docs:

```typescript
@ApiTags('test-runs')
@ApiOperation({
  summary: 'Get test runs',
  description: 'Returns test runs filtered by user\'s organization membership. Global admins see all test runs.',
})
@ApiResponse({
  status: 200,
  description: 'List of test runs',
})
@ApiResponse({
  status: 403,
  description: 'User does not have access to requested resource',
})
@Get()
async findAll(@UserCtx() ctx: UserContext) {
  return await this.testRunsService.findAll(ctx.userId, ctx.roles);
}
```

---

## Migration Strategy

### Phased Rollout

**Week 1**: Core infrastructure + Test Runs service (highest impact)
**Week 2**: Top 5 priority services
**Week 3**: Medium priority services
**Week 4**: Lower priority services
**Week 5**: Integration testing and fixes
**Week 6**: Performance testing and documentation

### Feature Flag

Consider adding a feature flag for gradual rollout:

```typescript
// In app.module.ts
{
  provide: 'AUTHORIZATION_ENABLED',
  useValue: process.env.ENABLE_AUTHORIZATION === 'true',
}

// In services
if (this.authorizationEnabled) {
  await this.applyOrgFilter(queryBuilder, userId, roles);
}
```

### Monitoring

Add metrics to track authorization:
- Number of permission denials by endpoint
- Organization filter performance
- Cache hit rates for authorization checks
- Number of resources per organization

---

## Rollback Plan

### Immediate Rollback

If critical issues arise:
1. Set `ENABLE_AUTHORIZATION=false` environment variable
2. Restart services
3. Authorization checks bypassed, all users see all data (temporary)

### Code Rollback

1. Revert controller changes (remove @UserCtx())
2. Revert service method signatures (remove userId/roles params)
3. Keep base service infrastructure (for next attempt)

### Data Safety

- No database changes in Phase 3
- All ownership data preserved
- No data loss risk

---

## Success Criteria

### Functional
- [ ] All 30+ services enforce organization-based filtering
- [ ] Users only see resources in their organizations
- [ ] Owners can modify their own resources
- [ ] Org admins can modify any resource in their org
- [ ] Global admins have unrestricted access
- [ ] Permission denials return clear 403 errors

### Technical
- [ ] All services extend AuthorizedBaseService
- [ ] All controllers use @UserCtx() decorator
- [ ] Organization filter on 100% of queries
- [ ] Permission checks on 100% of modify/delete operations
- [ ] 80%+ test coverage maintained
- [ ] No breaking API changes

### Performance
- [ ] Query performance <200ms p95
- [ ] Authorization checks <20ms p95 (cached)
- [ ] Cache hit rate >80%
- [ ] No N+1 query issues introduced

### Security
- [ ] 0 unauthorized access attempts succeed in testing
- [ ] All permission boundaries verified
- [ ] Cross-organization access properly blocked

---

## Risk Mitigation

### Performance Degradation
**Risk**: Organization filtering slows queries
**Mitigation**:
- Comprehensive indexing (already in Phase 2)
- Query result caching
- Load testing before production
- Monitoring and alerting

### Breaking Changes
**Risk**: API changes break clients
**Mitigation**:
- API contracts unchanged (responses identical)
- Only internal parameter additions
- Graceful handling of legacy data
- Feature flag for quick disable

### Permission Bugs
**Risk**: Users see data they shouldn't
**Mitigation**:
- Extensive E2E testing
- Security audit of all services
- Phase 5 RLS as defense-in-depth
- Incident response plan

---

## Next Steps After Phase 3

**Phase 4**: Data Migration & Enforcement (2-3 weeks)
- Migrate legacy data to default organization
- Make ownership fields required (NOT NULL)
- Add foreign key constraints
- Enforce organization assignment

**Phase 5**: Advanced Features (3-4 weeks)
- PostgreSQL RLS policies (defense-in-depth)
- Comprehensive audit logging
- Performance optimization
- Real-time permission updates

---

## Appendix: Files to Modify

### New Files to Create
- [ ] `apps/api/src/common/services/authorized-base.service.ts`
- [ ] `apps/api/src/common/decorators/user-context.decorator.ts`
- [ ] `apps/api/test/authorization.e2e-spec.ts`
- [ ] `RBAC_DEVELOPER_GUIDE.md` (or update existing)

### Files to Modify (30+ services)

#### High Priority Services (Week 2)
1. [ ] `apps/api/src/modules/test-runs/test-runs.service.ts`
2. [ ] `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`
3. [ ] `apps/api/src/modules/benchmarks/benchmarks.service.ts`
4. [ ] `apps/api/src/modules/benchmarks/benchmarks.controller.ts`
5. [ ] `apps/api/src/modules/systems-under-test/systems-under-test.service.ts`
6. [ ] `apps/api/src/modules/systems-under-test/systems-under-test.controller.ts`
7. [ ] `apps/api/src/modules/profiles/profiles.service.ts`
8. [ ] `apps/api/src/modules/profiles/profiles.controller.ts`
9. [ ] `apps/api/src/modules/api-keys/api-keys.service.ts`
10. [ ] `apps/api/src/modules/api-keys/api-keys.controller.ts`

#### Medium Priority Services (Week 3)
11. [ ] `apps/api/src/modules/grafana/grafana-dashboards.service.ts`
12. [ ] `apps/api/src/modules/grafana/grafana-dashboards.controller.ts`
13. [ ] `apps/api/src/modules/grafana/grafana-instances.service.ts`
14. [ ] `apps/api/src/modules/grafana/grafana-instances.controller.ts`
15. [ ] `apps/api/src/modules/tracing/tracing-instances.service.ts`
16. [ ] `apps/api/src/modules/tracing/tracing-instances.controller.ts`
17. [ ] `apps/api/src/modules/pyroscope/pyroscope-instances.service.ts`
18. [ ] `apps/api/src/modules/pyroscope/pyroscope-instances.controller.ts`
19. [ ] `apps/api/src/modules/test-environments/test-environments.service.ts`
20. [ ] `apps/api/src/modules/test-environments/test-environments.controller.ts`
21. [ ] `apps/api/src/modules/workload-types/workload-types.service.ts`
22. [ ] `apps/api/src/modules/workload-types/workload-types.controller.ts`
23. [ ] `apps/api/src/modules/reports/reports.service.ts`
24. [ ] `apps/api/src/modules/reports/reports.controller.ts`

#### Lower Priority Services (Week 4)
25. [ ] `apps/api/src/modules/organizations/organizations.service.ts`
26. [ ] `apps/api/src/modules/organizations/organizations.controller.ts`
27. [ ] `apps/api/src/modules/teams/teams.service.ts`
28. [ ] `apps/api/src/modules/teams/teams.controller.ts`
29. [ ] `apps/api/src/modules/dynatrace/dynatrace.service.ts`
30. [ ] `apps/api/src/modules/dynatrace/dynatrace.controller.ts`
31. [ ] All remaining services...

#### Tests to Update (Ongoing)
- [ ] `apps/api/src/modules/test-runs/__tests__/test-runs.service.spec.ts`
- [ ] `apps/api/src/modules/benchmarks/__tests__/benchmarks.service.spec.ts`
- [ ] (30+ test files to update)

#### Module Updates
- [ ] `apps/api/src/common/common.module.ts` - Export base service
- [ ] All service modules - Import CommonModule

---

**Total Estimated Files**: 4 new, 90+ modified (30 services × 3 files each)
**Total Estimated Time**: 4-6 weeks
**Risk Level**: Medium-High (touches all services)
**Impact**: Very High (complete authorization enforcement)
