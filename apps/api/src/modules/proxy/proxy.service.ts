import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProxyServer } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { Capability } from '../../constants/capabilities.constants';
import { AuditService } from '../audit/audit.service';
import { UpsertProxyDto, ProxyResponseDto } from './dto/proxy.dto';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    @InjectRepository(ProxyServer)
    private readonly repo: Repository<ProxyServer>,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Strip the password from a ProxyServer row and expose a hasPassword flag.
   * The password is NEVER returned by any endpoint.
   *
   * Fields are listed explicitly (no spread) so a future sensitive column
   * cannot accidentally leak into API responses.
   */
  toResponse(row: ProxyServer): ProxyResponseDto {
    const r = row as ProxyServer & { password?: string };
    return {
      id: r.id,
      proxyUrl: r.proxyUrl,
      username: r.username,
      hasPassword: Boolean(r.password),
      organizationId: r.organizationId,
      teamId: r.teamId,
      createdBy: r.createdBy,
      updatedBy: r.updatedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /**
   * Resolve the caller's primary organization (Pattern B from CLAUDE.md).
   * Throws ForbiddenException if the user has no accessible organization.
   */
  private async resolveOrgId(userId: string, _roles?: string[]): Promise<string> {
    const orgs = await this.authzService.getAccessibleOrganizations(userId);
    const orgId = orgs[0];
    if (!orgId) {
      throw new ForbiddenException('User has no accessible organization');
    }
    return orgId;
  }

  /**
   * Assert the caller is allowed to manage (write/delete) proxy settings for orgId.
   * Gated on `Capability.ProxyManage`, which org-admins hold for their org and
   * global admins hold everywhere (via `getCapabilities(_, _, null)`).
   * Throws ForbiddenException otherwise.
   */
  private async assertCanManageProxy(
    userId: string,
    roles: string[],
    orgId: string,
  ): Promise<void> {
    const caps = await this.authzService.getCapabilities(userId, roles, orgId);
    if (!caps.includes(Capability.ProxyManage)) {
      throw new ForbiddenException('Requires organization admin to modify proxy settings');
    }
  }

  /**
   * Return the proxy config for the caller's organization, or null if none.
   */
  async getForOrg(userId: string, _roles: string[]): Promise<ProxyResponseDto | null> {
    const orgId = await this.resolveOrgId(userId);
    const row = await this.repo.findOne({ where: { organizationId: orgId } });
    if (!row) return null;
    return this.toResponse(row);
  }

  /**
   * Create or update the proxy config for the caller's organization.
   *
   * On update: if dto.password is empty/undefined, the existing password is
   * preserved (blank = "unchanged"). Writes are always audited.
   */
  async upsert(userId: string, roles: string[], dto: UpsertProxyDto): Promise<ProxyResponseDto> {
    const orgId = await this.resolveOrgId(userId);
    await this.assertCanManageProxy(userId, roles, orgId);

    const existing = await this.repo.findOne({ where: { organizationId: orgId } });

    if (!existing) {
      // CREATE
      const entity = this.repo.create({
        organizationId: orgId,
        createdBy: userId,
        updatedBy: userId,
        proxyUrl: dto.proxyUrl,
        username: dto.username,
        password: dto.password,
      });
      const saved = await this.repo.save(entity);
      this.auditService.logCreate(saved as unknown as Parameters<typeof this.auditService.logCreate>[0]);
      this.logger.log(`Created proxy config for org ${orgId}`);
      return this.toResponse(saved);
    }

    // UPDATE — keep existing password if dto.password is blank/undefined
    const snapshot = { ...existing };
    existing.proxyUrl = dto.proxyUrl;
    existing.username = dto.username;
    existing.updatedBy = userId;
    if (dto.password) {
      existing.password = dto.password;
    }
    // If dto.password is '' or undefined, existing.password is untouched

    const saved = await this.repo.save(existing);
    this.auditService.logUpdate(
      snapshot as unknown as Parameters<typeof this.auditService.logUpdate>[0],
      saved as unknown as Parameters<typeof this.auditService.logUpdate>[1],
    );
    this.logger.log(`Updated proxy config for org ${orgId}`);
    return this.toResponse(saved);
  }

  /**
   * Delete the proxy config for the caller's organization.
   * No-ops silently if no proxy is configured.
   */
  async remove(userId: string, roles: string[]): Promise<void> {
    const orgId = await this.resolveOrgId(userId);
    await this.assertCanManageProxy(userId, roles, orgId);

    const existing = await this.repo.findOne({ where: { organizationId: orgId } });
    if (!existing) return;

    await this.repo.delete({ organizationId: orgId });
    this.auditService.logDelete(existing as unknown as Parameters<typeof this.auditService.logDelete>[0]);
    this.logger.log(`Deleted proxy config for org ${orgId}`);
  }
}
