import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import * as entities from '../index';
import { AuditableEntityClass, getAuditableFields } from '../owned-resource.interface';

/**
 * Snapshot — every TypeORM entity that owns an `organization_id` column gets
 * its current `auditableFields` declaration recorded. Adding a new column
 * (especially a sensitive one) to an entity will not change the snapshot, but
 * adding/removing the entity itself, or declaring/redeclaring auditableFields,
 * will surface as a snapshot diff and force the reviewer to make a deliberate
 * "log this" or "redact" call. See:
 *   docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md (Q10)
 *   docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md (burndown)
 */
describe('auditableFields snapshot — every OwnedResource entity', () => {
  it('has a stable declaration', () => {
    // Find every entity class with an `organization_id` column declared via
    // TypeORM column metadata. The snapshot below pins both the set of
    // OwnedResource entities and each one's auditableFields declaration.
    const ownedEntityNames = new Set<string>();
    for (const col of getMetadataArgsStorage().columns) {
      const propName =
        (col.options && (col.options.name as string | undefined)) || col.propertyName;
      if (propName === 'organization_id' && typeof col.target === 'function') {
        ownedEntityNames.add(col.target.name);
      }
    }

    const out: Record<string, readonly string[] | null> = {};
    for (const [exportName, exported] of Object.entries(entities)) {
      if (typeof exported !== 'function') continue;
      const klass = exported as { name: string };
      if (!ownedEntityNames.has(klass.name)) continue;
      out[exportName] = getAuditableFields(exported as AuditableEntityClass);
    }

    // Sort for determinism (jest snapshot ordering is normally stable but make
    // it explicit so future entity additions land in a predictable place).
    const sorted: Record<string, readonly string[] | null> = {};
    for (const k of Object.keys(out).sort()) sorted[k] = out[k];

    expect(sorted).toMatchSnapshot();
  });
});
