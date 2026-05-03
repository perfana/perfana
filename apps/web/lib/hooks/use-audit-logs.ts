'use client';

/**
 * React Query hooks for the audit-log viewer.
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchAuditCapabilities,
  fetchAuditLogs,
  fetchResourceAuditHistory,
  AuditFilter,
} from '../audit-api';

export const auditKeys = {
  all: ['audit-logs'] as const,
  capabilities: () => [...auditKeys.all, 'capabilities'] as const,
  list: (filter: AuditFilter) => [...auditKeys.all, 'list', filter] as const,
  resource: (resourceType: string, resourceId: string) =>
    [...auditKeys.all, 'resource', resourceType, resourceId] as const,
};

export function useAuditCapabilities() {
  return useQuery({
    queryKey: auditKeys.capabilities(),
    queryFn: fetchAuditCapabilities,
    // Capabilities rarely change mid-session; keep this fresh for a few
    // minutes so we don't re-probe on every re-render.
    staleTime: 5 * 60_000,
  });
}

export function useAuditLogs(filter: AuditFilter, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: auditKeys.list(filter),
    queryFn: () => fetchAuditLogs(filter),
    enabled: options?.enabled ?? true,
    // Keep results visible while the next page is being fetched (smoother
    // pagination UX).
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useResourceAuditHistory(
  resourceType: string | undefined,
  resourceId: string | undefined,
) {
  return useQuery({
    queryKey: auditKeys.resource(resourceType ?? '', resourceId ?? ''),
    queryFn: () => fetchResourceAuditHistory(resourceType!, resourceId!),
    enabled: !!resourceType && !!resourceId,
    staleTime: 30_000,
  });
}
