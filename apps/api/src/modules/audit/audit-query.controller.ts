import {
  Controller,
  Get,
  Query,
  Param,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles, RoleMatchingMode } from '../../decorators/roles.decorator';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { OwnedResource } from '@perfana/shared/entities';
import { AuditService, AuditFilter } from './audit.service';
import { AuditResourceRegistry, EntityClass } from './audit-resource-registry';
import { AuditFilterDto } from './dto/audit-filter.dto';
import { AuthorizationService } from '../../common/services/authorization.service';
import { Capability } from '../../constants/capabilities.constants';
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
   * - super-admin / system-admin / support → cross-org (granted SystemAuditRead)
   * - org-admin → scoped to accessible organizations
   * - Anyone else → 403 (RolesGuard)
   *
   * Cross-org vs scoped is decided by `Capability.SystemAuditRead` rather than
   * `isGlobalAdmin(roles)` directly: the capability is the contract, the
   * roles → capability mapping is owned by `capabilities.constants.ts`.
   */
  @Get()
  @Roles({
    roles: ['super-admin', 'system-admin', 'support', 'org-admin'],
    mode: RoleMatchingMode.ANY,
  })
  @ApiOperation({ summary: 'Filterable search of audit log rows (admin only)' })
  async findByFilter(
    @Query() dto: AuditFilterDto,
    @UserCtx() ctx: UserContext,
  ): Promise<{ rows: unknown[]; total: number }> {
    const caps = await this.authz.getCapabilities(ctx.userId, ctx.roles, null);
    const isAdmin = caps.includes(Capability.SystemAuditRead);

    const filter: AuditFilter = {
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      userId: dto.userId,
      action: dto.action,
      organizationId: dto.organizationId,
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
