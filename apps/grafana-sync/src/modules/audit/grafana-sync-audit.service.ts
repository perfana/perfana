import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AuditLog,
  AuditAction,
  AuditLogChanges,
  AuditLogMetadata,
  OwnedResource,
  getAuditableFields,
} from '@perfana/shared/entities';
import { diff, truncateOversizedFields } from '@perfana/shared/utils';

/**
 * Synthetic actor stamped on every grafana-sync audit row. The `system:`
 * prefix mirrors the `api-key:{id}` convention already used elsewhere so
 * audit-log readers can distinguish background-service writes from user /
 * api-key writes without a separate column.
 */
export const GRAFANA_SYNC_ACTOR_ID = 'system:grafana-sync';

export type GrafanaSyncAuditOptions = {
  resourceName?: string;
  resourceTypeOverride?: string;
  organizationIdOverride?: string;
};

/**
 * Audit dispatcher for grafana-sync.
 *
 * grafana-sync runs as a background scheduler with no incoming HTTP request,
 * so the API's request-context (nestjs-cls REQ_CTX) is never populated.
 * This service mirrors the API's AuditService.dispatch() shape but stamps a
 * fixed system actor on every row, making mutations from the auto-config
 * pipeline visible in /audit-logs alongside user-driven changes.
 *
 * Same diff/truncation semantics as the API audit service — both consume the
 * shared diff helpers in @perfana/shared/utils.
 */
@Injectable()
export class GrafanaSyncAuditService {
  private readonly logger = new Logger(GrafanaSyncAuditService.name);
  private readonly warnedAboutMissingFields = new Set<string>();

  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  logCreate(entity: OwnedResource, options: GrafanaSyncAuditOptions = {}): void {
    this.dispatch(AuditAction.CREATE, null, entity, options);
  }

  logUpdate(
    before: OwnedResource,
    after: OwnedResource,
    options: GrafanaSyncAuditOptions = {},
  ): void {
    this.dispatch(AuditAction.UPDATE, before, after, options);
  }

  private dispatch(
    action: AuditAction,
    before: OwnedResource | null,
    after: OwnedResource | null,
    options: GrafanaSyncAuditOptions,
  ): void {
    const ref = (after ?? before) as OwnedResource;
    const klass = ref.constructor as { auditableFields?: readonly string[]; name?: string };
    const allow = getAuditableFields(klass as never);

    let changes: AuditLogChanges | null = null;
    if (allow) {
      const d = diff(before, after, allow as readonly (keyof OwnedResource & string)[]);
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

    const orgId =
      options.organizationIdOverride ??
      (ref as { organizationId?: string; organization_id?: string }).organizationId ??
      (ref as { organization_id?: string }).organization_id ??
      null;

    const sutId =
      klass.name === 'SystemUnderTest'
        ? ((ref as { id?: string }).id ?? null)
        : ((ref as { systemUnderTestId?: string; system_under_test_id?: string })
            .systemUnderTestId ??
          (ref as { system_under_test_id?: string }).system_under_test_id ??
          null);

    const metadata: AuditLogMetadata = {
      auth_type: 'system',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = {
      userId: GRAFANA_SYNC_ACTOR_ID,
      userEmail: undefined,
      organizationId: orgId ?? undefined,
      systemUnderTestId: sutId ?? undefined,
      action,
      resourceType: options.resourceTypeOverride ?? defaultResourceType(klass.name ?? 'unknown'),
      resourceId: (ref as { id?: string }).id ?? undefined,
      resourceName: options.resourceName,
      changes: changes ?? undefined,
      metadata,
      success: true,
      ipAddress: undefined,
      userAgent: undefined,
    };

    setImmediate(() => {
      this.repo.insert(row).catch((err) => {
        this.logger.error(
          `audit insert failed (${action} ${klass.name ?? 'unknown'}): ${
            err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'unknown'
          }`,
        );
      });
    });
  }
}

function defaultResourceType(className: string): string {
  // "Benchmark" → "benchmarks"
  return className
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/-?$/, 's')
    .replace(/^-+/, '');
}
