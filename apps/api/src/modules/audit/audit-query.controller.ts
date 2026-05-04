import {
  Controller,
  Get,
  Query,
  Param,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { OwnedResource } from '@perfana/shared/entities';
import { AuditService, AuditFilter } from './audit.service';
import { AuditResourceRegistry, EntityClass } from './audit-resource-registry';
import { AuditFilterDto } from './dto/audit-filter.dto';
import { AuthorizationService } from '../../common/services/authorization.service';
import { Capability } from '../../constants/capabilities.constants';
import { hasGlobalAdminRole } from '../../constants/roles.constants';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditQueryController {
  constructor(
    private readonly auditService: AuditService,
    private readonly registry: AuditResourceRegistry,
    private readonly authz: AuthorizationService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Admin filterable search across audit logs.
   *
   * - SystemAuditRead capability (super-admin / system-admin / support) → cross-org
   * - org-admin in at least one org → scoped to accessible orgs
   * - Anyone else → 403 ForbiddenException
   *
   * NOTE: We deliberately do NOT use `@Roles` here. `org-admin` is a DB-only
   * role stored in `organization_members.roles`; it never reaches the JWT, so
   * the role guard cannot match it. Authorization happens in the body using
   * `Capability.SystemAuditRead` (capability ←→ Keycloak role mapping owned by
   * `capabilities.constants.ts`) and `AuthorizationService.isOrgAdminInAnyOrganization`
   * (which reads `organization_members`). Mirrors `getCapabilities` below.
   */
  @Get()
  @ApiOperation({ summary: 'Filterable search of audit log rows (admin only)' })
  async findByFilter(
    @Query() dto: AuditFilterDto,
    @UserCtx() ctx: UserContext,
  ): Promise<{ rows: unknown[]; total: number }> {
    const caps = await this.authz.getCapabilities(ctx.userId, ctx.roles, null);
    const isAdmin = caps.includes(Capability.SystemAuditRead);

    if (!isAdmin) {
      const isOrgAdmin = await this.authz.isOrgAdminInAnyOrganization(ctx.userId);
      if (!isOrgAdmin) {
        throw new ForbiddenException(
          'Audit log access requires global-admin, system-admin, support, or org-admin in at least one organization.',
        );
      }
    }

    const filter: AuditFilter = {
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      userId: dto.userId,
      action: dto.action,
      organizationId: dto.organizationId,
      systemUnderTestId: dto.systemUnderTestId,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      limit: dto.limit ?? 100,
      offset: dto.offset ?? 0,
      organizationIds: undefined,
    };

    if (!isAdmin) {
      const accessible = await this.authz.getAccessibleOrganizations(ctx.userId);
      if (dto.organizationId) {
        // Caller asked for a specific org — must be in their accessible set.
        if (!accessible.includes(dto.organizationId)) {
          return { rows: [], total: 0 };
        }
        filter.organizationIds = [dto.organizationId];
      } else {
        filter.organizationIds = accessible;
      }
    }

    return this.auditService.findByFilter(filter);
  }

  /**
   * Probe whether the caller can view audit logs and at what scope.
   * Used by the frontend sidebar to decide whether to render the
   * "Audit Logs" item, and by the page itself to decide whether to expose
   * the cross-org filter or pre-scope to the user's accessible orgs.
   *
   * - `cross-org`: SystemAuditRead capability (super-admin / system-admin / support).
   * - `org-scoped`: org-admin in at least one org. `accessibleOrganizationIds` is populated.
   * - `none`: no access. Frontend should hide the sidebar item.
   *
   * Authenticated users only (KeycloakEnhancedAuthGuard); never returns 403 —
   * an unauthorized caller gets `{ canView: false, scope: 'none' }`.
   */
  @Get('capabilities')
  @ApiOperation({ summary: 'Probe audit-log access for the current user' })
  async getCapabilities(
    @UserCtx() ctx: UserContext,
  ): Promise<{
    canView: boolean;
    scope: 'cross-org' | 'org-scoped' | 'none';
    isSuperAdmin: boolean;
    accessibleOrganizationIds: string[];
    knownResourceTypes: string[];
  }> {
    const caps = await this.authz.getCapabilities(ctx.userId, ctx.roles, null);
    const isSuperAdmin =
      hasGlobalAdminRole(ctx.roles) || (ctx.roles ?? []).includes('super-admin');

    if (caps.includes(Capability.SystemAuditRead)) {
      return {
        canView: true,
        scope: 'cross-org',
        isSuperAdmin,
        accessibleOrganizationIds: [],
        knownResourceTypes: await this.auditService.getDistinctResourceTypes(),
      };
    }

    const isOrgAdmin = await this.authz.isOrgAdminInAnyOrganization(ctx.userId);
    if (isOrgAdmin) {
      const accessible = await this.authz.getAccessibleOrganizations(ctx.userId);
      return {
        canView: true,
        scope: 'org-scoped',
        isSuperAdmin,
        accessibleOrganizationIds: accessible,
        knownResourceTypes: await this.auditService.getDistinctResourceTypes(accessible),
      };
    }

    return {
      canView: false,
      scope: 'none',
      isSuperAdmin,
      accessibleOrganizationIds: [],
      knownResourceTypes: [],
    };
  }

  /**
   * Per-resource history.
   * RBAC: caller must have read access to the resource via
   * AuthorizationService.canAccessResource(userId, roles, resource).
   */
  @Get('resource/:resourceType/:resourceId')
  @ApiOperation({ summary: 'Audit history for a single resource' })
  async findByResource(
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<unknown[]> {
    const klass = this.registry.resolve(resourceType);
    if (!klass) {
      throw new NotFoundException('unknown resourceType');
    }

    const resource = await this.loadResource(klass, resourceId);
    if (!resource) {
      throw new NotFoundException('resource not found');
    }

    const result = await this.authz.canAccessResource(ctx.userId, ctx.roles, resource);
    if (!result.allowed) {
      throw new ForbiddenException(result.reason ?? 'No read access to this resource');
    }

    return this.auditService.findByResource(resourceType, resourceId, {});
  }

  /**
   * Loads the entity by id using the DataSource. Separated for testability —
   * specs override this method to avoid hitting the DB.
   */
  protected async loadResource(klass: EntityClass, id: string): Promise<OwnedResource | null> {
    const repo = this.dataSource.getRepository(klass);
    const found = await repo.findOne({
      where: { id } as FindOptionsWhere<{ id: string }>,
    });
    return (found as OwnedResource | null) ?? null;
  }
}
