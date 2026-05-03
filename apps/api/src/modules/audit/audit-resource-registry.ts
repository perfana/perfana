import { Injectable } from '@nestjs/common';

export type EntityClass = {
  new (...args: unknown[]): object;
  auditableFields?: readonly string[];
};

/**
 * AuditResourceRegistry (Phase 5a)
 *
 * Maps a public `resource_type` string (e.g., 'api-keys') to its entity class
 * (e.g., `ApiKey`). The per-resource audit history endpoint
 * (`GET /api/audit-logs/resource/:resourceType/:resourceId`) uses this to look
 * up which entity to load before delegating to AuthorizationService.canAccessResource.
 *
 * Registration happens at module-init time in each domain module's
 * `onModuleInit` hook (see PR5+ migration tasks).
 */
@Injectable()
export class AuditResourceRegistry {
  private readonly map = new Map<string, EntityClass>();

  register(resourceType: string, entityClass: EntityClass): void {
    this.map.set(resourceType, entityClass);
  }

  resolve(resourceType: string): EntityClass | null {
    return this.map.get(resourceType) ?? null;
  }

  knownTypes(): string[] {
    return Array.from(this.map.keys()).sort();
  }
}
