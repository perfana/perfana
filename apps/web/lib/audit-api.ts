/**
 * Audit-log API client (Phase 5a viewer MVP).
 *
 * Wraps the three audit endpoints exposed by the API:
 *   GET /audit-logs/capabilities  → AuditCapabilities probe
 *   GET /audit-logs               → filterable rows + total
 *   GET /audit-logs/resource/...  → per-resource history
 *
 * All calls go through `authenticatedFetch`, so the bearer token is injected
 * automatically and 401s are handled by the auth layer.
 */
import { authenticatedFetch } from './api';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export type AuditScope = 'cross-org' | 'org-scoped' | 'none';

export interface AuditCapabilities {
  canView: boolean;
  scope: AuditScope;
  /**
   * True iff the caller has perfana-admin / admin / super-admin. Drives
   * "true admin only" affordances (e.g. the cross-org filter dropdown), which
   * we keep tighter than `scope === 'cross-org'` (system-admin / support also
   * see cross-org rows but should not switch organizations).
   */
  isSuperAdmin: boolean;
  accessibleOrganizationIds: string[];
  knownResourceTypes: string[];
}

export interface AuditLogChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  fields?: string[];
}

export interface AuditLogMetadata {
  request_id?: string;
  correlation_id?: string;
  session_id?: string;
  auth_type?: string;
  route?: string;
  method?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

export interface AuditLogRow {
  id: string;
  timestamp: string;
  userId: string;
  userEmail?: string;
  organizationId?: string;
  /**
   * Denormalized SUT id populated by the audit dispatcher: the entity's own
   * id when the resource is a SystemUnderTest, the carried `system_under_test_id`
   * for child entities, or null for global / pre-migration rows.
   */
  systemUnderTestId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  changes?: AuditLogChanges;
  metadata?: AuditLogMetadata;
  success: boolean;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditFilter {
  resourceType?: string;
  resourceId?: string;
  userId?: string;
  action?: AuditAction;
  organizationId?: string;
  systemUnderTestId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  rows: AuditLogRow[];
  total: number;
}

function buildQuery(filter: AuditFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function fetchAuditCapabilities(): Promise<AuditCapabilities> {
  const response = await authenticatedFetch('/audit-logs/capabilities', {
    cache: 'no-store',
  });
  if (!response.ok) {
    // Treat any non-OK response as "no access" — sidebar should hide silently.
    return {
      canView: false,
      scope: 'none',
      isSuperAdmin: false,
      accessibleOrganizationIds: [],
      knownResourceTypes: [],
    };
  }
  return response.json();
}

export async function fetchAuditLogs(filter: AuditFilter = {}): Promise<AuditQueryResult> {
  const response = await authenticatedFetch(`/audit-logs${buildQuery(filter)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body && typeof body === 'object' && 'message' in body
      ? String((body as { message: unknown }).message)
      : `Failed to fetch audit logs (${response.status})`;
    throw new Error(message);
  }
  return response.json();
}

export async function fetchResourceAuditHistory(
  resourceType: string,
  resourceId: string,
): Promise<AuditLogRow[]> {
  const response = await authenticatedFetch(
    `/audit-logs/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body && typeof body === 'object' && 'message' in body
      ? String((body as { message: unknown }).message)
      : `Failed to fetch resource audit history (${response.status})`;
    throw new Error(message);
  }
  return response.json();
}
