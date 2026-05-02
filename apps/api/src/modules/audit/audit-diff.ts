/** Default 4 KB per field. Override via env in AuditService (not here). */
export const AUDIT_MAX_FIELD_BYTES = 4096;

/** Pick only allowlisted, defined keys from an entity. */
export function pickAuditable<T extends object>(
  entity: T | null | undefined,
  allow: readonly (keyof T & string)[]
): Partial<T> {
  if (!entity) return {};
  const out: Partial<T> = {};
  for (const k of allow) {
    const v = (entity as Record<string, unknown>)[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Compute the changed-fields diff between `before` and `after` over the allowlist. */
export function diff<T extends object>(
  before: T | null,
  after: T | null,
  allow: readonly (keyof T & string)[]
): { before: Partial<T>; after: Partial<T>; fields: (keyof T & string)[] } {
  const fields: (keyof T & string)[] = [];
  const beforeOut: Partial<T> = {};
  const afterOut: Partial<T> = {};

  for (const k of allow) {
    const b = before ? (before as Record<string, unknown>)[k] : undefined;
    const a = after ? (after as Record<string, unknown>)[k] : undefined;
    const isCreate = before === null && a !== undefined;
    const isDelete = after === null && b !== undefined;
    const isChange = before !== null && after !== null && !shallowEqual(b, a);

    if (isCreate || isDelete || isChange) {
      fields.push(k);
      if (b !== undefined) (beforeOut as Record<string, unknown>)[k] = b;
      if (a !== undefined) (afterOut as Record<string, unknown>)[k] = a;
    }
  }
  return { before: beforeOut, after: afterOut, fields };
}

/** Replace any field whose JSON length exceeds AUDIT_MAX_FIELD_BYTES with a marker. */
export function truncateOversizedFields<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const json = JSON.stringify(v ?? null);
    if (json.length > AUDIT_MAX_FIELD_BYTES) {
      out[k] = { truncated: true, originalLength: typeof v === 'string' ? v.length : json.length };
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // Deeper structural equality is left to JSON-string compare for simplicity.
  return JSON.stringify(a) === JSON.stringify(b);
}
