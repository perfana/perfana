import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { AuditLog, AuditAction, AuditLogChanges, AuditLogMetadata } from '@perfana/shared/entities';
import { OwnedResource, getAuditableFields } from '@perfana/shared/entities';
import { REQ_CTX, RequestContextStore } from '../../common/context/request-context';
import { diff, truncateOversizedFields } from './audit-diff';

export type AuditOptions = {
  resourceName?: string;
  resourceTypeOverride?: string;
  organizationIdOverride?: string;
  actorOverride?: {
    userId: string;
    userEmail?: string | null;
    ipAddress?: string | null;
  };
  success?: boolean;
  errorMessage?: string;
};

export type AuditFilter = {
  resourceType?: string;
  resourceId?: string;
  userId?: string;
  action?: AuditAction;
  organizationId?: string;
  organizationIds?: string[]; // applied via withOrgFilter for org-admin scoping
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly warnedAboutMissingFields = new Set<string>();

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
    private readonly cls: ClsService,
  ) {}

  // ---------------------------------------------------------------- Mutations
  logCreate(entity: OwnedResource, options: AuditOptions = {}): void {
    this.dispatch(AuditAction.CREATE, null, entity, options);
  }

  logUpdate(before: OwnedResource, after: OwnedResource, options: AuditOptions = {}): void {
    this.dispatch(AuditAction.UPDATE, before, after, options);
  }

  logDelete(entity: OwnedResource, options: AuditOptions = {}): void {
    this.dispatch(AuditAction.DELETE, entity, null, options);
  }

  // ---------------------------------------------------------------- Queries
  async findByFilter(filter: AuditFilter): Promise<{ rows: AuditLog[]; total: number }> {
    const where = this.buildWhere(filter);
    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { timestamp: 'DESC' },
      take: filter.limit ?? 100,
      skip: filter.offset ?? 0,
    });
    return { rows, total };
  }

  async findByResource(
    resourceType: string,
    resourceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<AuditLog[]> {
    return this.repo.find({
      where: { resourceType, resourceId },
      order: { timestamp: 'DESC' },
      take: opts.limit ?? 100,
      skip: opts.offset ?? 0,
    });
  }

  // ---------------------------------------------------------------- Internals
  private dispatch(
    action: AuditAction,
    before: OwnedResource | null,
    after: OwnedResource | null,
    options: AuditOptions,
  ): void {
    const ctx = this.cls.get<RequestContextStore | undefined>(REQ_CTX);
    if (!ctx && !options.actorOverride) {
      this.logger.warn(`audit ${action} call outside request context — skipping`);
      return;
    }

    // The reference entity is whichever side is non-null (after for CREATE/UPDATE, before for DELETE).
    const ref = (after ?? before) as OwnedResource;
    const klass = ref.constructor as { auditableFields?: readonly string[]; name?: string };
    const allow = getAuditableFields(klass as never);

    let changes: AuditLogChanges | null = null;
    if (allow) {
      const d = diff(
        before,
        after,
        allow as readonly (keyof OwnedResource & string)[],
      );
      if (d.fields.length === 0 && action === AuditAction.UPDATE) {
        return; // no auditable change → no row
      }
      changes = {
        before: truncateOversizedFields(d.before as Record<string, unknown>),
        after: truncateOversizedFields(d.after as Record<string, unknown>),
        fields: d.fields as string[],
      };
    } else {
      const klassName = klass.name ?? 'unknown';
      if (!this.warnedAboutMissingFields.has(klassName)) {
        this.warnedAboutMissingFields.add(klassName);
        this.logger.warn(
          `Entity ${klassName} has no auditableFields — audit row will record action+actor only`,
        );
      }
    }

    const actor = options.actorOverride ?? {
      userId: ctx!.userId,
      userEmail: ctx!.userEmail,
      ipAddress: ctx!.ipAddress,
    };

    const metadata: AuditLogMetadata = {
      request_id: ctx?.requestId,
      auth_type: ctx?.authType ?? undefined,
    };

    const orgId =
      options.organizationIdOverride ?? (ref as { organization_id?: string }).organization_id ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = {
      userId: actor.userId,
      userEmail: actor.userEmail ?? undefined,
      organizationId: orgId ?? undefined,
      action,
      resourceType: options.resourceTypeOverride ?? defaultResourceType(klass.name ?? 'unknown'),
      resourceId: (ref as { id?: string }).id ?? undefined,
      resourceName: options.resourceName,
      changes: changes ?? undefined,
      metadata,
      success: options.success ?? true,
      errorMessage: options.errorMessage,
      ipAddress: actor.ipAddress ?? undefined,
      userAgent: ctx?.userAgent ?? undefined,
    };

    setImmediate(() => {
      this.repo
        .insert(row)
        .catch((err) => {
          this.logger.error(
            `audit insert failed (${action} ${klass.name ?? 'unknown'}): ${
              err && typeof err === 'object' && 'message' in err
                ? (err as Error).message
                : 'unknown'
            }`,
          );
        });
    });
  }

  private buildWhere(
    f: AuditFilter,
  ): FindOptionsWhere<AuditLog> | FindOptionsWhere<AuditLog>[] {
    const base: FindOptionsWhere<AuditLog> = {};
    if (f.resourceType) base.resourceType = f.resourceType;
    if (f.resourceId) base.resourceId = f.resourceId;
    if (f.userId) base.userId = f.userId;
    if (f.action) base.action = f.action;
    if (f.organizationId) base.organizationId = f.organizationId;
    if (f.startDate && f.endDate) base.timestamp = Between(f.startDate, f.endDate);
    else if (f.startDate) base.timestamp = MoreThanOrEqual(f.startDate);
    else if (f.endDate) base.timestamp = LessThanOrEqual(f.endDate);

    if (f.organizationIds?.length) {
      // OR each accessible org id (org-admin scoping)
      return f.organizationIds.map((id) => ({ ...base, organizationId: id }));
    }
    return base;
  }
}

function defaultResourceType(className: string): string {
  // "ApiKey" → "api-keys"
  return className
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/-?$/, 's')
    .replace(/^-+/, '');
}
